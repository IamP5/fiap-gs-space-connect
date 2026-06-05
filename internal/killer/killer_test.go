package killer_test

import (
	"context"
	"errors"
	"swarmbuild/internal/bus"
	"swarmbuild/internal/bus/bustest"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/killer"
	"swarmbuild/internal/wire"
	"sync"
	"testing"
	"time"
)

// Control command strings used across the tests, hoisted to constants so the
// linter's repeated-literal check stays happy and the wire vocabulary lives once.
const (
	cmdKill          = "kill"
	cmdKillContainer = "killContainer"
)

// recordingKill is a killer.KillFunc that records the containers it was asked to
// kill, so a test can assert the kill path without shelling out to docker.
type recordingKill struct {
	mu     sync.Mutex
	killed []string
	err    error // returned to the caller on every kill, if set
	calls  chan string
}

func newRecordingKill() *recordingKill {
	return &recordingKill{calls: make(chan string, 8)}
}

func (r *recordingKill) fn(_ context.Context, container string) error {
	r.mu.Lock()
	r.killed = append(r.killed, container)
	r.mu.Unlock()
	r.calls <- container
	return r.err
}

func (r *recordingKill) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.killed)
}

// dial brings up an embedded NATS server and returns a connected handle.
func dial(t *testing.T) *bus.Conn {
	t.Helper()
	url, shutdown := bustest.RunServer(t)
	t.Cleanup(shutdown)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, err := bus.Connect(ctx, url, bus.ConnectOptions{Name: "killer-test", MaxWait: 5 * time.Second})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(c.Close)
	return c
}

// runKiller starts killer.Run in the background against conn and returns a cancel
// func; it waits for the subscription to be live before returning.
func runKiller(t *testing.T, conn *bus.Conn, cfg killer.Config) context.CancelFunc {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		if err := killer.Run(ctx, conn, cfg); err != nil && !errors.Is(err, context.Canceled) {
			t.Errorf("killer.Run: unexpected error: %v", err)
		}
	}()
	t.Cleanup(func() {
		cancel()
		<-done
	})
	// Flush so the SubscribeJSON is registered on the server before tests publish.
	_ = conn.Flush()
	return cancel
}

// TestRun_KillContainer exercises the kill path end to end over a real bus: only a
// killContainer naming a mapped Robot fires docker kill, with the MAPPED container
// name; an unmapped Robot, a non-target Robot, and other commands never kill.
func TestRun_KillContainer(t *testing.T) {
	const encore = "swarmbuild-rover-encore"
	targets := map[domain.RobotID]string{"R7": encore}

	tests := []struct {
		name       string
		ctrl       wire.Control
		wantKilled string // "" means no kill expected
	}{
		{
			name:       "killContainer for the mapped target kills the mapped container",
			ctrl:       wire.Control{Cmd: cmdKillContainer, Robot: "R7"},
			wantKilled: encore,
		},
		{
			name:       "killContainer for an unmapped robot does not kill",
			ctrl:       wire.Control{Cmd: cmdKillContainer, Robot: "R3"},
			wantKilled: "",
		},
		{
			name:       "soft kill command is ignored by the sidecar",
			ctrl:       wire.Control{Cmd: cmdKill, Robot: "R7"},
			wantKilled: "",
		},
		{
			name:       "setLatency command does not kill",
			ctrl:       wire.Control{Cmd: "setLatency", Value: 1500},
			wantKilled: "",
		},
		{
			name:       "setFailureProb command does not kill",
			ctrl:       wire.Control{Cmd: "setFailureProb", Value: 0.5},
			wantKilled: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			conn := dial(t)
			rec := newRecordingKill()
			runKiller(t, conn, killer.Config{Targets: targets, Kill: rec.fn})

			if err := conn.PublishJSON(wire.SubjControl, tt.ctrl); err != nil {
				t.Fatalf("publish control: %v", err)
			}
			_ = conn.Flush()

			if tt.wantKilled != "" {
				select {
				case got := <-rec.calls:
					if got != tt.wantKilled {
						t.Fatalf("killed container = %q, want %q", got, tt.wantKilled)
					}
				case <-time.After(2 * time.Second):
					t.Fatal("expected a docker kill, got none within 2s")
				}
				return
			}

			// No kill expected: give the dispatcher a beat, then assert nothing fired.
			select {
			case got := <-rec.calls:
				t.Fatalf("expected no kill, but killed %q", got)
			case <-time.After(200 * time.Millisecond):
			}
			if n := rec.count(); n != 0 {
				t.Fatalf("expected no kills, got %d", n)
			}
		})
	}
}

// TestRun_ActOnKill proves the pod-per-rover gate: the dashboard's normal "kill"
// fires a real kill ONLY when ActOnKill is set, and "killContainer" fires in both
// modes. The ActOnKill=false rows are the backward-compatibility proof: with the
// docker-compose default, "kill" stays the agent's soft in-proc death and the
// sidecar ignores it.
func TestRun_ActOnKill(t *testing.T) {
	const podSel = "rover=R3"
	targets := map[domain.RobotID]string{"R3": podSel}

	tests := []struct {
		name       string
		actOnKill  bool
		ctrl       wire.Control
		wantKilled string // "" means no kill expected
	}{
		{
			name:       "kill is ignored when ActOnKill is off (backward compatible)",
			actOnKill:  false,
			ctrl:       wire.Control{Cmd: cmdKill, Robot: "R3"},
			wantKilled: "",
		},
		{
			name:       "killContainer still kills when ActOnKill is off",
			actOnKill:  false,
			ctrl:       wire.Control{Cmd: cmdKillContainer, Robot: "R3"},
			wantKilled: podSel,
		},
		{
			name:       "kill kills the mapped target when ActOnKill is on",
			actOnKill:  true,
			ctrl:       wire.Control{Cmd: cmdKill, Robot: "R3"},
			wantKilled: podSel,
		},
		{
			name:       "killContainer still kills when ActOnKill is on",
			actOnKill:  true,
			ctrl:       wire.Control{Cmd: cmdKillContainer, Robot: "R3"},
			wantKilled: podSel,
		},
		{
			name:       "kill for an unmapped robot never kills, even with ActOnKill on",
			actOnKill:  true,
			ctrl:       wire.Control{Cmd: cmdKill, Robot: "R9"},
			wantKilled: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			conn := dial(t)
			rec := newRecordingKill()
			runKiller(t, conn, killer.Config{Targets: targets, Kill: rec.fn, ActOnKill: tt.actOnKill})

			if err := conn.PublishJSON(wire.SubjControl, tt.ctrl); err != nil {
				t.Fatalf("publish control: %v", err)
			}
			_ = conn.Flush()

			if tt.wantKilled != "" {
				select {
				case got := <-rec.calls:
					if got != tt.wantKilled {
						t.Fatalf("killed target = %q, want %q", got, tt.wantKilled)
					}
				case <-time.After(2 * time.Second):
					t.Fatal("expected a kill, got none within 2s")
				}
				return
			}

			select {
			case got := <-rec.calls:
				t.Fatalf("expected no kill, but killed %q", got)
			case <-time.After(200 * time.Millisecond):
			}
			if n := rec.count(); n != 0 {
				t.Fatalf("expected no kills, got %d", n)
			}
		})
	}
}

// TestRun_RequiresKillFunc guards the misconfiguration: Run must reject a Config
// with no Kill func rather than panic on the first command.
func TestRun_RequiresKillFunc(t *testing.T) {
	conn := dial(t)
	err := killer.Run(context.Background(), conn, killer.Config{Targets: map[domain.RobotID]string{"R7": "c"}})
	if err == nil {
		t.Fatal("expected an error when Kill func is nil")
	}
}

// TestRun_KillFailureKeepsServing asserts a failing docker kill is swallowed: the
// sidecar logs and stays up to serve the next command (the Lease still expires).
func TestRun_KillFailureKeepsServing(t *testing.T) {
	conn := dial(t)
	rec := newRecordingKill()
	rec.err = errors.New("docker daemon unreachable")
	runKiller(t, conn, killer.Config{
		Targets: map[domain.RobotID]string{"R7": "swarmbuild-rover-encore"},
		Kill:    rec.fn,
	})

	for range 2 {
		if err := conn.PublishJSON(wire.SubjControl, wire.Control{Cmd: cmdKillContainer, Robot: "R7"}); err != nil {
			t.Fatalf("publish control: %v", err)
		}
	}
	_ = conn.Flush()

	// Both commands must reach the kill func despite the first one erroring.
	for i := range 2 {
		select {
		case <-rec.calls:
		case <-time.After(2 * time.Second):
			t.Fatalf("kill %d never fired; a failed kill must not stop the sidecar", i+1)
		}
	}
}

func TestParseTargets(t *testing.T) {
	tests := []struct {
		name    string
		spec    string
		want    map[domain.RobotID]string
		wantErr bool
	}{
		{
			name: "single pair",
			spec: "R7=swarmbuild-rover-encore",
			want: map[domain.RobotID]string{"R7": "swarmbuild-rover-encore"},
		},
		{
			name: "multiple pairs with whitespace",
			spec: " R7=swarmbuild-rover-encore , R8 = rover-encore-2 ",
			want: map[domain.RobotID]string{"R7": "swarmbuild-rover-encore", "R8": "rover-encore-2"},
		},
		{
			name: "empty spec yields empty allowlist",
			spec: "",
			want: map[domain.RobotID]string{},
		},
		{
			name: "trailing comma is skipped",
			spec: "R7=c,",
			want: map[domain.RobotID]string{"R7": "c"},
		},
		{
			// kubectl backend: the target value is a label selector that itself
			// contains "=", so the pair must split on the FIRST "=" only.
			name: "label-selector targets with = in the value cut on first =",
			spec: "R3=rover=R3,R6=rover=R6",
			want: map[domain.RobotID]string{"R3": "rover=R3", "R6": "rover=R6"},
		},
		{
			name:    "missing equals is malformed",
			spec:    "R7",
			wantErr: true,
		},
		{
			name:    "empty container is malformed",
			spec:    "R7=",
			wantErr: true,
		},
		{
			name:    "empty robot is malformed",
			spec:    "=container",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := killer.ParseTargets(tt.spec)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("ParseTargets(%q): expected error, got nil", tt.spec)
				}
				return
			}
			if err != nil {
				t.Fatalf("ParseTargets(%q): unexpected error: %v", tt.spec, err)
			}
			if len(got) != len(tt.want) {
				t.Fatalf("ParseTargets(%q) = %v, want %v", tt.spec, got, tt.want)
			}
			for k, v := range tt.want {
				if got[k] != v {
					t.Fatalf("ParseTargets(%q)[%q] = %q, want %q", tt.spec, k, got[k], v)
				}
			}
		})
	}
}
