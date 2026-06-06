package agent

import (
	"context"
	"swarmbuild/internal/bus"
	"swarmbuild/internal/bus/bustest"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"sync"
	"testing"
	"time"
)

// fakeLiveBuilder is a no-network agent.LiveBuilder for the live-mode integration
// tests: it returns a scripted op stream (ok=true), or — when Fail is set —
// ok=false to exercise the graceful degrade-to-primitive path. It records each
// call so a test can assert the live seam was (or was not) reached.
type fakeLiveBuilder struct {
	ops  []wire.BuildOp
	fail bool

	mu    sync.Mutex
	calls int
}

func (f *fakeLiveBuilder) BuildLive(_ context.Context, _ domain.TaskID, _ domain.TaskType) ([]wire.BuildOp, bool) {
	f.mu.Lock()
	f.calls++
	f.mu.Unlock()
	if f.fail {
		return nil, false
	}
	return f.ops, true
}

func (f *fakeLiveBuilder) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

// liveSpec is a distinctive generated op stream: a single sphere, which neither the
// foundation primitive stream nor the cache test fixtures start with, so a test can
// tell live-generated ops apart from the primitive fallback.
func liveSpec() []wire.BuildOp {
	return []wire.BuildOp{
		{Op: wire.BuildOpPlace, Shape: wire.ShapeSphere, Pos: domain.Vec3{X: 0, Y: 1, Z: 0}, Scale: domain.Vec3{X: 0.5, Y: 0.5, Z: 0.5}, Material: wire.Material{Color: "#11ff22"}},
		{Op: wire.BuildOpPlace, Shape: wire.ShapeSphere, Pos: domain.Vec3{X: 0, Y: 2, Z: 0}, Scale: domain.Vec3{X: 0.4, Y: 0.4, Z: 0.4}, Material: wire.Material{Color: "#11ff22"}},
	}
}

// liveHarness boots an embedded NATS server, runs ONE live-mode rover, and
// collects its build ops and completion. The test drives the rover by publishing
// an Award directly (the auction is the coordinator's job, covered elsewhere).
type liveHarness struct {
	conn      *bus.Conn
	roverID   domain.RobotID
	ops       func() []wire.BuildOpMsg
	completes func() int
}

func newLiveHarness(t *testing.T, id domain.RobotID, cfg Config) *liveHarness {
	t.Helper()

	url, shutdown := bustest.RunServer(t)
	t.Cleanup(shutdown)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	cfg.ID = id
	cfg.Battery = 1.0
	cfg.Capabilities = []domain.Capability{domain.Capability(typeFoundation)}
	cfg.HeartbeatEvery = 100 * time.Millisecond

	roverConn, err := bus.Connect(ctx, url, bus.ConnectOptions{Name: "rover", MaxWait: 5 * time.Second})
	if err != nil {
		t.Fatalf("rover connect: %v", err)
	}
	t.Cleanup(roverConn.Close)
	go func() { _ = Run(ctx, cfg, roverConn) }()

	obs, err := bus.Connect(ctx, url, bus.ConnectOptions{Name: "observer", MaxWait: 5 * time.Second})
	if err != nil {
		t.Fatalf("observer connect: %v", err)
	}
	t.Cleanup(obs.Close)

	var mu sync.Mutex
	var gotOps []wire.BuildOpMsg
	completeCount := 0

	unsubOps, err := bus.SubscribeJSON(obs, wire.SubjBuildOp("foundation-live"), func(m wire.BuildOpMsg) {
		mu.Lock()
		gotOps = append(gotOps, m)
		mu.Unlock()
	})
	if err != nil {
		t.Fatalf("subscribe build ops: %v", err)
	}
	t.Cleanup(unsubOps)

	unsubComplete, err := bus.SubscribeJSON(obs, wire.SubjTaskComplete, func(c wire.Complete) {
		if c.Robot != id {
			return
		}
		mu.Lock()
		completeCount++
		mu.Unlock()
	})
	if err != nil {
		t.Fatalf("subscribe complete: %v", err)
	}
	t.Cleanup(unsubComplete)

	return &liveHarness{
		conn:    obs,
		roverID: id,
		ops: func() []wire.BuildOpMsg {
			mu.Lock()
			defer mu.Unlock()
			out := make([]wire.BuildOpMsg, len(gotOps))
			copy(out, gotOps)
			return out
		},
		completes: func() int {
			mu.Lock()
			defer mu.Unlock()
			return completeCount
		},
	}
}

func (h *liveHarness) award(t *testing.T, task domain.TaskID) {
	t.Helper()
	h.awardMode(t, task, "")
}

// awardMode publishes an Award carrying a per-Task build mode tag (bh-08c), so a
// test can prove the WINNING rover honours the Task's mode (not just its Config).
func (h *liveHarness) awardMode(t *testing.T, task domain.TaskID, mode string) {
	t.Helper()
	if err := h.conn.PublishJSON(wire.SubjTaskAward, wire.Award{
		TaskID: task,
		Robot:  h.roverID,
		Type:   typeFoundation,
		Mode:   mode,
		Pos:    domain.Vec2{X: 1, Y: 0},
	}); err != nil {
		t.Fatalf("publish award: %v", err)
	}
	_ = h.conn.Flush()
}

func (h *liveHarness) awaitComplete(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		if h.completes() > 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("rover did not complete the task")
}

// TestLiveMode_BuildsFromGeneratedOps: a live-mode rover with a LiveBuilder that
// returns generated ops streams THOSE ops on build.op.<task> (not the primitive
// stream) and completes the Task — the live work phase end to end.
func TestLiveMode_BuildsFromGeneratedOps(t *testing.T) {
	builder := &fakeLiveBuilder{ops: liveSpec()}
	h := newLiveHarness(t, "R-live", Config{Mode: ModeLive, LiveBuilder: builder})

	h.award(t, "foundation-live")

	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		if h.completes() > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if h.completes() == 0 {
		t.Fatalf("live-mode rover did not complete the task")
	}
	if builder.callCount() == 0 {
		t.Fatalf("live-mode work phase never reached the LiveBuilder seam")
	}

	got := h.ops()
	if len(got) != len(liveSpec()) {
		t.Fatalf("expected %d generated ops streamed, got %d", len(liveSpec()), len(got))
	}
	for i, m := range got {
		if m.Op.Shape != wire.ShapeSphere {
			t.Fatalf("op %d: live mode must stream the GENERATED ops (sphere), got %v", i, m.Op.Shape)
		}
		if m.Seq != i {
			t.Fatalf("op %d: expected Seq %d, got %d", i, i, m.Seq)
		}
	}
}

// TestLiveMode_ForcedErrorDegradesToPrimitive: a LiveBuilder that returns ok=false
// (a model fault / exhaustion) must NOT crash the rover — it degrades to the
// deterministic primitive stream and STILL completes the Task. This is the
// graceful-fallback acceptance for bh-08 (failure-heal proper is slice 08f).
func TestLiveMode_ForcedErrorDegradesToPrimitive(t *testing.T) {
	builder := &fakeLiveBuilder{fail: true}
	h := newLiveHarness(t, "R-live-fail", Config{Mode: ModeLive, LiveBuilder: builder})

	h.award(t, "foundation-live")

	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		if h.completes() > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if h.completes() == 0 {
		t.Fatalf("rover did not complete after the live builder failed: a model fault must degrade, not crash")
	}
	if builder.callCount() == 0 {
		t.Fatalf("the live seam should have been reached (and then fallen back)")
	}

	// The streamed ops must be the deterministic foundation primitive stream — a
	// box first, NOT the live spheres — proving the graceful degrade.
	got := h.ops()
	want := buildOpsFor(typeFoundation)
	if len(got) != len(want) {
		t.Fatalf("fallback must stream the primitive foundation stream: got %d ops, want %d", len(got), len(want))
	}
	if len(got) > 0 && got[0].Op.Shape != want[0].Shape {
		t.Fatalf("fallback stream mismatch: got %v, want %v", got[0].Op.Shape, want[0].Shape)
	}
}

// TestPerTaskLive_ReplayConfigRoverBuildsLive is the bh-08c headline: a rover whose
// Config.Mode is the REPLAY default still builds LIVE when it wins a Task whose
// award carries mode="live". The per-Task tag wins over the per-rover Config, so the
// operator's per-placement choice is honoured. The rover streams the GENERATED ops.
func TestPerTaskLive_ReplayConfigRoverBuildsLive(t *testing.T) {
	builder := &fakeLiveBuilder{ops: liveSpec()}
	// Config.Mode left at the replay default; the award carries the live tag.
	h := newLiveHarness(t, "R-pertask-live", Config{LiveBuilder: builder})

	h.awardMode(t, "foundation-live", string(ModeLive))
	h.awaitComplete(t)

	if builder.callCount() == 0 {
		t.Fatalf("a live-tagged Task must reach the LiveBuilder even on a replay-config rover")
	}
	got := h.ops()
	if len(got) != len(liveSpec()) {
		t.Fatalf("expected %d generated ops streamed, got %d", len(liveSpec()), len(got))
	}
	for i, m := range got {
		if m.Op.Shape != wire.ShapeSphere {
			t.Fatalf("op %d: per-task live must stream the GENERATED ops (sphere), got %v", i, m.Op.Shape)
		}
	}
}

// TestPerTaskReplay_LiveConfigRoverReplays is the converse: a rover whose
// Config.Mode is LIVE still REPLAYS (never reaches the LiveBuilder) when it wins a
// Task whose award carries mode="replay". So a replay-tagged placement always
// replays, even on a live-configured rover.
func TestPerTaskReplay_LiveConfigRoverReplays(t *testing.T) {
	builder := &fakeLiveBuilder{ops: liveSpec()}
	h := newLiveHarness(t, "R-pertask-replay", Config{Mode: ModeLive, LiveBuilder: builder})

	h.awardMode(t, "foundation-live", string(ModeReplay))
	h.awaitComplete(t)

	if builder.callCount() != 0 {
		t.Fatalf("a replay-tagged Task must NEVER reach the LiveBuilder; got %d calls", builder.callCount())
	}
	got := h.ops()
	want := buildOpsFor(typeFoundation)
	if len(got) != len(want) {
		t.Fatalf("replay-tagged Task must stream the primitive stream: got %d ops, want %d", len(got), len(want))
	}
	if len(got) > 0 && got[0].Op.Shape != want[0].Shape {
		t.Fatalf("replay stream mismatch: got %v, want %v", got[0].Op.Shape, want[0].Shape)
	}
}

// TestEffectiveMode is the pure routing table for the per-Task/per-rover mode
// resolution (bh-08c): the Task tag wins; an empty tag falls back to Config.Mode;
// any non-"live" value is replay.
func TestEffectiveMode(t *testing.T) {
	cases := []struct {
		taskMode string
		cfgMode  Mode
		want     Mode
	}{
		{"live", ModeReplay, ModeLive},   // task tag wins over replay config
		{"live", ModeLive, ModeLive},     // both live
		{"replay", ModeLive, ModeReplay}, // explicit replay tag beats live config
		{"replay", ModeReplay, ModeReplay},
		{"", ModeLive, ModeLive},        // empty tag falls back to live config (cmd/agent)
		{"", ModeReplay, ModeReplay},    // empty tag, replay config: replay default
		{"", "", ModeReplay},            // both empty: replay default
		{"bogus", ModeLive, ModeReplay}, // unknown tag never opts into live
	}
	for _, c := range cases {
		if got := effectiveMode(c.taskMode, c.cfgMode); got != c.want {
			t.Errorf("effectiveMode(%q, %q) = %q, want %q", c.taskMode, c.cfgMode, got, c.want)
		}
	}
}

// TestReplayMode_NeverReachesLiveBuilder: the default replay mode must NOT call the
// LiveBuilder even when one is set — replay stays byte-for-byte model-free. With no
// BlueprintID it streams the primitive foundation stream and completes.
func TestReplayMode_NeverReachesLiveBuilder(t *testing.T) {
	builder := &fakeLiveBuilder{ops: liveSpec()}
	// Mode defaults to replay (empty) — explicitly leave LiveBuilder set to prove
	// replay never reaches it.
	h := newLiveHarness(t, "R-replay", Config{LiveBuilder: builder})

	h.award(t, "foundation-live")

	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		if h.completes() > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if h.completes() == 0 {
		t.Fatalf("replay-mode rover did not complete the task")
	}
	if builder.callCount() != 0 {
		t.Fatalf("replay mode must NEVER reach the LiveBuilder; got %d calls", builder.callCount())
	}

	got := h.ops()
	want := buildOpsFor(typeFoundation)
	if len(got) != len(want) {
		t.Fatalf("replay must stream the primitive stream: got %d ops, want %d", len(got), len(want))
	}
	if len(got) > 0 && got[0].Op.Shape != want[0].Shape {
		t.Fatalf("replay stream mismatch: got %v, want %v", got[0].Op.Shape, want[0].Shape)
	}
}
