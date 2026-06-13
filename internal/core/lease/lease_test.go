package lease

import (
	"swarmbuild/internal/core/domain"
	"testing"
)

type fakeClock struct{ now domain.Tick }

func (c *fakeClock) Now() domain.Tick      { return c.now }
func (c *fakeClock) advance(d domain.Tick) { c.now += d }
func (c *fakeClock) set(t domain.Tick)     { c.now = t }

const ttl = domain.Tick(30)

const wall7 = domain.TaskID("wall-7")

func newFixture(start domain.Tick) (*fakeClock, *Manager) {
	clk := &fakeClock{now: start}
	return clk, NewManager(clk, ttl)
}

func TestGrant(t *testing.T) {
	tests := []struct {
		name      string
		setup     func(m *Manager)
		task      domain.TaskID
		rover     domain.RobotID
		wantOK    bool
		wantState domain.TaskStatus
	}{
		{
			name:      "grant on unclaimed succeeds and sets LEASED",
			task:      wall7,
			rover:     "R3",
			wantOK:    true,
			wantState: domain.Leased,
		},
		{
			name:      "grant on already-leased task is rejected",
			setup:     func(m *Manager) { m.Grant(wall7, "R3") },
			task:      wall7,
			rover:     "R5",
			wantOK:    false,
			wantState: domain.Leased,
		},
		{
			name: "grant on done task is rejected",
			setup: func(m *Manager) {
				m.Grant(wall7, "R3")
				m.Complete(wall7, "R3")
			},
			task:      wall7,
			rover:     "R5",
			wantOK:    false,
			wantState: domain.Done,
		},
		{
			name: "re-grant after release succeeds",
			setup: func(m *Manager) {
				m.Grant(wall7, "R3")
				m.Release(wall7, "R3")
			},
			task:      wall7,
			rover:     "R5",
			wantOK:    true,
			wantState: domain.Leased,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, m := newFixture(100)
			if tc.setup != nil {
				tc.setup(m)
			}
			if got := m.Grant(tc.task, tc.rover); got != tc.wantOK {
				t.Fatalf("Grant ok = %v, want %v", got, tc.wantOK)
			}
			if got := m.Status(tc.task); got != tc.wantState {
				t.Fatalf("Status = %v, want %v", got, tc.wantState)
			}
		})
	}
}

func TestStatusOfUnknownTaskIsUnclaimed(t *testing.T) {
	_, m := newFixture(0)
	if got := m.Status("never-seen"); got != domain.Unclaimed {
		t.Fatalf("Status of unknown task = %v, want UNCLAIMED", got)
	}
}

func TestTTLSetOnGrant_LiveBeforeExpiry(t *testing.T) {
	clk, m := newFixture(100)
	if !m.Grant(wall7, "R3") {
		t.Fatal("Grant failed")
	}
	clk.set(129)
	if released := m.Sweep(); released != nil {
		t.Fatalf("Sweep before expiry released %v, want none", released)
	}
	if got := m.Status(wall7); got != domain.Leased {
		t.Fatalf("Status before expiry = %v, want LEASED", got)
	}
}

func TestHeartbeatBeforeExpiryExtendsLease(t *testing.T) {
	clk, m := newFixture(100)
	m.Grant(wall7, "R3")

	clk.set(120)
	if !m.Heartbeat(wall7, "R3") {
		t.Fatal("Heartbeat by holder rejected")
	}

	clk.set(140)
	if released := m.Sweep(); released != nil {
		t.Fatalf("Sweep after heartbeat-renewal released %v, want none", released)
	}
	if got := m.Status(wall7); got != domain.Leased {
		t.Fatalf("Status = %v, want LEASED after heartbeat renewal", got)
	}

	clk.set(150)
	if released := m.Sweep(); len(released) != 1 || released[0] != wall7 {
		t.Fatalf("Sweep past renewed expiry = %v, want [wall-7]", released)
	}
}

func TestHeartbeatFromNonHolderRejected(t *testing.T) {
	clk, m := newFixture(100)
	m.Grant(wall7, "R3")

	if m.Heartbeat(wall7, "R5") {
		t.Fatal("Heartbeat from non-holder R5 accepted, want rejected")
	}
	clk.set(130)
	if released := m.Sweep(); len(released) != 1 {
		t.Fatalf("expected wall-7 to expire on its original TTL, got %v", released)
	}
}

func TestHeartbeatRejectedForUnclaimedAndDone(t *testing.T) {
	_, m := newFixture(0)
	if m.Heartbeat("nope", "R1") {
		t.Fatal("Heartbeat on unknown task accepted")
	}
	m.Grant(wall7, "R3")
	m.Complete(wall7, "R3")
	if m.Heartbeat(wall7, "R3") {
		t.Fatal("Heartbeat on DONE task accepted")
	}
}

func TestSilenceBeyondTTLExpires(t *testing.T) {
	clk, m := newFixture(100)
	m.Grant(wall7, "R3")

	clk.set(130)
	released := m.Sweep()
	if len(released) != 1 || released[0] != wall7 {
		t.Fatalf("Sweep at expiry = %v, want [wall-7]", released)
	}
	if got := m.Status(wall7); got != domain.Unclaimed {
		t.Fatalf("Status after expiry = %v, want UNCLAIMED", got)
	}
}

func TestExactlyOnce_SweepTwiceReleasesOnce(t *testing.T) {
	clk, m := newFixture(100)
	m.Grant(wall7, "R3")
	clk.set(200)

	first := m.Sweep()
	if len(first) != 1 || first[0] != wall7 {
		t.Fatalf("first Sweep = %v, want [wall-7]", first)
	}

	for i := range 3 {
		clk.advance(50)
		if again := m.Sweep(); again != nil {
			t.Fatalf("Sweep #%d after release returned %v, want none (exactly-once)", i+2, again)
		}
	}
}

func TestExactlyOnce_ReleaseIsIdempotent(t *testing.T) {
	_, m := newFixture(100)
	m.Grant(wall7, "R3")

	if !m.Release(wall7, "R3") {
		t.Fatal("first Release returned false, want true")
	}
	for i := range 3 {
		if m.Release(wall7, "R3") {
			t.Fatalf("duplicate Release #%d returned true, want false (idempotent)", i+2)
		}
	}
	if m.Release("never-seen", "R3") {
		t.Fatal("Release of unknown task returned true, want false")
	}
}

func TestReleaseScopedToHolder_StaleEventDoesNotReleaseSuccessor(t *testing.T) {
	clk, m := newFixture(100)

	m.Grant("t", "R1")
	clk.set(200)
	if released := m.Sweep(); len(released) != 1 || released[0] != "t" {
		t.Fatalf("Sweep = %v, want [t]", released)
	}

	if !m.Grant("t", "R2") {
		t.Fatal("re-grant to R2 failed")
	}

	if m.Release("t", "R1") {
		t.Fatal("stale Release(t, R1) returned true, want false (wrong holder)")
	}
	if got := m.Status("t"); got != domain.Leased {
		t.Fatalf("Status after stale release = %v, want LEASED (R2's lease intact)", got)
	}
	if !m.Heartbeat("t", "R2") {
		t.Fatal("R2 lost its lease to the stale R1-lost event")
	}
	if !m.Release("t", "R2") {
		t.Fatal("holder R2 could not release its own lease")
	}
	if got := m.Status("t"); got != domain.Unclaimed {
		t.Fatalf("Status after R2 release = %v, want UNCLAIMED", got)
	}
}

func TestComplete(t *testing.T) {
	tests := []struct {
		name   string
		setup  func(m *Manager)
		rover  domain.RobotID
		wantOK bool
	}{
		{
			name:   "holder completes a live lease",
			setup:  func(m *Manager) { m.Grant(wall7, "R3") },
			rover:  "R3",
			wantOK: true,
		},
		{
			name:   "non-holder cannot complete",
			setup:  func(m *Manager) { m.Grant(wall7, "R3") },
			rover:  "R5",
			wantOK: false,
		},
		{
			name:   "cannot complete an unclaimed task",
			rover:  "R3",
			wantOK: false,
		},
		{
			name: "cannot complete an already-released task",
			setup: func(m *Manager) {
				m.Grant(wall7, "R3")
				m.Release(wall7, "R3")
			},
			rover:  "R3",
			wantOK: false,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, m := newFixture(100)
			if tc.setup != nil {
				tc.setup(m)
			}
			if got := m.Complete(wall7, tc.rover); got != tc.wantOK {
				t.Fatalf("Complete ok = %v, want %v", got, tc.wantOK)
			}
		})
	}
}

func TestDoneIsTerminal_SweepNeverReReleasesDone(t *testing.T) {
	clk, m := newFixture(100)
	m.Grant(wall7, "R3")
	if !m.Complete(wall7, "R3") {
		t.Fatal("Complete failed")
	}
	if got := m.Status(wall7); got != domain.Done {
		t.Fatalf("Status = %v, want DONE", got)
	}

	clk.set(10_000)
	for i := range 3 {
		if released := m.Sweep(); released != nil {
			t.Fatalf("Sweep #%d re-released DONE task: %v", i+1, released)
		}
		clk.advance(1000)
	}
	if got := m.Status(wall7); got != domain.Done {
		t.Fatalf("Status after sweeps = %v, want DONE (terminal)", got)
	}
}

func TestSweepReleasesOnlyExpiredLeasedTasks(t *testing.T) {
	clk, m := newFixture(100)
	m.Grant("expired-1", "R1")
	m.Grant("expired-2", "R2")
	m.Grant("renewed", "R3")
	m.Grant("done", "R4")

	m.Complete("done", "R4")

	clk.set(125)
	m.Heartbeat("renewed", "R3")

	clk.set(140)
	released := m.Sweep()

	got := map[domain.TaskID]bool{}
	for _, id := range released {
		got[id] = true
	}
	if len(released) != 2 || !got["expired-1"] || !got["expired-2"] {
		t.Fatalf("Sweep released %v, want exactly {expired-1, expired-2}", released)
	}
	if m.Status("renewed") != domain.Leased {
		t.Fatalf("renewed = %v, want LEASED", m.Status("renewed"))
	}
	if m.Status("done") != domain.Done {
		t.Fatalf("done = %v, want DONE", m.Status("done"))
	}
	if m.Status("expired-1") != domain.Unclaimed {
		t.Fatalf("expired-1 = %v, want UNCLAIMED", m.Status("expired-1"))
	}
}
