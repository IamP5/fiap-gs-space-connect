package agent

import (
	"context"
	"swarmbuild/internal/bus"
	"swarmbuild/internal/bus/bustest"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/harness/spec"
	"swarmbuild/internal/wire"
	"sync"
	"testing"
	"time"
)

// fakeLiveBuilder is a no-network agent.LiveBuilder for the live-mode integration
// tests: it streams one or more scripted iteration batches (ok=true), or — when
// Fail is set — emits nothing and returns ok=false to exercise the graceful
// degrade-to-primitive path. It records each call so a test can assert the live
// seam was (or was not) reached. A single ops slice is streamed as one iteration;
// iters (when set) streams each batch as its own iteration, modelling self-correction.
type fakeLiveBuilder struct {
	ops   []wire.BuildOp   // single-iteration script (used when iters is nil)
	iters [][]wire.BuildOp // multi-iteration script: one emit per batch
	fail  bool

	mu        sync.Mutex
	calls     int
	priorSeen []wire.BuildOp // the priorOps the LAST BuildLive call received (bh-08e)
}

func (f *fakeLiveBuilder) BuildLive(_ context.Context, _ domain.TaskID, _ domain.TaskType, priorOps []wire.BuildOp, emit func([]wire.BuildOp)) bool {
	f.mu.Lock()
	f.calls++
	f.priorSeen = append([]wire.BuildOp(nil), priorOps...)
	f.mu.Unlock()
	if f.fail {
		return false // nothing emitted: the rover degrades to replay/primitive
	}
	if f.iters != nil {
		for _, batch := range f.iters {
			emit(batch)
		}
		return true
	}
	emit(f.ops)
	return true
}

// prior returns the priorOps the last BuildLive call received (bh-08e resume seed).
func (f *fakeLiveBuilder) prior() []wire.BuildOp {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]wire.BuildOp(nil), f.priorSeen...)
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
	h.awardWithPrior(t, task, nil)
}

// awardWithPrior publishes an Award carrying a durable prior patch log (bh-08e), as
// the coordinator does when re-auctioning a Task whose predecessor was killed
// mid-live-build. nil priorOps is the fresh-start award.
func (h *liveHarness) awardWithPrior(t *testing.T, task domain.TaskID, priorOps []wire.BuildOp) {
	t.Helper()
	if err := h.conn.PublishJSON(wire.SubjTaskAward, wire.Award{
		TaskID:   task,
		Robot:    h.roverID,
		Type:     typeFoundation,
		Pos:      domain.Vec2{X: 1, Y: 0},
		PriorOps: priorOps,
	}); err != nil {
		t.Fatalf("publish award: %v", err)
	}
	_ = h.conn.Flush()
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

// TestLiveMode_StreamsIterationsAndSelfCorrects: a LiveBuilder that emits MULTIPLE
// iterations streams each iteration's patch batch onto build.op.<task> as separate
// paced ops (Seq monotonic ACROSS iterations), and a later iteration's move/delete
// patches update the world IN PLACE — the bh-08d "grows and self-corrects" path.
// The streamed patch log folds to the final geometry (the renderer's pure fold).
func TestLiveMode_StreamsIterationsAndSelfCorrects(t *testing.T) {
	sphere := func(id string, y, scale float64, color string) wire.BuildOp {
		return wire.BuildOp{
			Op:       wire.BuildOpPlace,
			ID:       id,
			Shape:    wire.ShapeSphere,
			Pos:      domain.Vec3{X: 0, Y: y, Z: 0},
			Scale:    domain.Vec3{X: scale, Y: scale, Z: scale},
			Material: wire.Material{Color: color},
		}
	}
	// Iteration 1: place two pieces. Iteration 2: move p0 up + recolour, delete p1 —
	// the self-correction (a piece visibly moves/recolours, another vanishes).
	iter1 := []wire.BuildOp{sphere("p0", 1, 0.5, "#11ff22"), sphere("p1", 2, 0.4, "#11ff22")}
	iter2 := []wire.BuildOp{
		{Op: wire.BuildOpMove, ID: "p0", Pos: domain.Vec3{X: 0, Y: 3, Z: 0}, Scale: domain.Vec3{X: 0.5, Y: 0.5, Z: 0.5}},
		sphere("p0", 3, 0.5, "#ff0000"), // recolour after the move
		{Op: wire.BuildOpDelete, ID: "p1"},
	}
	builder := &fakeLiveBuilder{iters: [][]wire.BuildOp{iter1, iter2}}
	h := newLiveHarness(t, "R-live-iter", Config{Mode: ModeLive, LiveBuilder: builder})

	h.award(t, "foundation-live")

	wantTotal := len(iter1) + len(iter2)
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if h.completes() > 0 && len(h.ops()) >= wantTotal {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if h.completes() == 0 {
		t.Fatalf("live-mode multi-iteration rover did not complete the task")
	}

	got := h.ops()
	if len(got) != wantTotal {
		t.Fatalf("expected %d streamed ops across two iterations, got %d", wantTotal, len(got))
	}
	// Seq is monotonic across iterations and the op kinds prove move/delete streamed.
	assertMonotonicSeq(t, got)
	assertStreamedKinds(t, got, wire.BuildOpMove, wire.BuildOpDelete)

	// The whole streamed patch log folds to the final geometry: p0 moved+recoloured,
	// p1 gone — exactly the renderer's pure fold (ADR-0004 / 08a).
	folded := foldStreamed(t, got)
	if len(folded) != 1 {
		t.Fatalf("after delete of p1, fold must leave 1 piece, got %d", len(folded))
	}
	if folded[0].ID != "p0" || folded[0].Pos.Y != 3 || folded[0].Material.Color != "#ff0000" {
		t.Fatalf("folded piece must be the moved+recoloured p0 at y=3 #ff0000, got %+v", folded[0])
	}
}

// foldStreamed flattens the streamed ops into a patch log and folds it, failing the
// test if the log does not fold cleanly (the renderer's pure fold, ADR-0004 / 08a).
func foldStreamed(t *testing.T, msgs []wire.BuildOpMsg) []wire.BuildOp {
	t.Helper()
	log := make([]wire.BuildOp, len(msgs))
	for i, m := range msgs {
		log[i] = m.Op
	}
	folded, err := spec.Fold(log)
	if err != nil {
		t.Fatalf("streamed patch log must fold cleanly: %v", err)
	}
	return folded
}

// assertStreamedKinds fails unless every named op kind appears in the stream.
func assertStreamedKinds(t *testing.T, msgs []wire.BuildOpMsg, kinds ...string) {
	t.Helper()
	for _, k := range kinds {
		if !streamedKind(msgs, k) {
			t.Fatalf("a self-correcting iteration must stream a %q patch; ops=%+v", k, msgs)
		}
	}
}

// assertMonotonicSeq checks each streamed op's Seq is its zero-based position.
func assertMonotonicSeq(t *testing.T, msgs []wire.BuildOpMsg) {
	t.Helper()
	for i, m := range msgs {
		if m.Seq != i {
			t.Fatalf("op %d: expected monotonic Seq %d, got %d", i, i, m.Seq)
		}
	}
}

// streamedKind reports whether any streamed op carries the given op kind.
func streamedKind(msgs []wire.BuildOpMsg, kind string) bool {
	for _, m := range msgs {
		if m.Op.Op == kind {
			return true
		}
	}
	return false
}

// TestLiveMode_ResumeSeedsBuilderAndContinuesSeq (bh-08e): when a live-mode rover
// is awarded a Task that ALREADY carries a durable prior patch log (the predecessor
// was killed mid-build), the rover (1) hands the prior ops to the LiveBuilder as the
// resume seed and (2) continues Seq numbering AFTER the prior ops, so the
// coordinator's append-by-Seq stays monotonic and gap-free across the handoff. It
// emits only the NEW ops — never re-placing the durable prior ops — and completes.
func TestLiveMode_ResumeSeedsBuilderAndContinuesSeq(t *testing.T) {
	// The predecessor streamed 3 ops (Seq 0..2) before it was killed; the Task came
	// back UNCLAIMED with this patch log intact.
	prior := []wire.BuildOp{
		{Op: wire.BuildOpPlace, ID: "p0", Shape: wire.ShapeBox, Pos: domain.Vec3{X: 0, Y: -1, Z: 0}, Scale: domain.Vec3{X: 1.8, Y: 0.3, Z: 1.8}, Material: wire.Material{Color: "#cfcfd6"}},
		{Op: wire.BuildOpPlace, ID: "p1", Shape: wire.ShapeCylinder, Pos: domain.Vec3{X: -0.6, Y: -0.2, Z: -0.6}, Scale: domain.Vec3{X: 0.2, Y: 0.9, Z: 0.2}, Material: wire.Material{Color: "#b8b8c2"}},
		{Op: wire.BuildOpPlace, ID: "p2", Shape: wire.ShapeCylinder, Pos: domain.Vec3{X: 0.6, Y: -0.2, Z: 0.6}, Scale: domain.Vec3{X: 0.2, Y: 0.9, Z: 0.2}, Material: wire.Material{Color: "#b8b8c2"}},
	}
	// The replacement's builder continues the structure with two more pieces.
	builder := &fakeLiveBuilder{ops: liveSpec()}
	h := newLiveHarness(t, "R-resume", Config{Mode: ModeLive, LiveBuilder: builder})

	h.awardWithPrior(t, "foundation-live", prior)

	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		if h.completes() > 0 && len(h.ops()) >= len(liveSpec()) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if h.completes() == 0 {
		t.Fatalf("resuming rover did not complete the task")
	}

	// (1) The prior patch log reached the builder as the resume seed.
	if seen := builder.prior(); len(seen) != len(prior) {
		t.Fatalf("resume must hand the prior patch log to the builder: got %d ops, want %d", len(seen), len(prior))
	}

	// (2) The rover streamed only the NEW ops, with Seq continuing AFTER the prior
	// ops (3,4,...) — never restarting at 0, so the coordinator append stays monotonic.
	got := h.ops()
	if len(got) != len(liveSpec()) {
		t.Fatalf("resume must stream only the NEW ops, got %d want %d", len(got), len(liveSpec()))
	}
	for i, m := range got {
		wantSeq := len(prior) + i
		if m.Seq != wantSeq {
			t.Fatalf("resumed op %d: expected Seq %d (continuing after %d prior ops), got %d", i, wantSeq, len(prior), m.Seq)
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
