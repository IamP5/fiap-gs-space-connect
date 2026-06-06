package live

import (
	"context"
	"encoding/json"
	"errors"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/harness/loop"
	"swarmbuild/internal/harness/model"
	"swarmbuild/internal/harness/spec"
	"swarmbuild/internal/wire"
	"testing"
)

// richFoundation is a multi-shape plinth spec that clears the demo foundation
// contract's hard gate (MinOps=3, MinCoverage) AND its soft threshold. Every op
// sits inside the foundation envelope (Size 3.0×2.4×3.0, centred on the origin).
func richFoundation() []wire.BuildOp {
	box := func(pos, scale domain.Vec3, color string) wire.BuildOp {
		return wire.BuildOp{Op: wire.BuildOpPlace, Shape: wire.ShapeBox, Pos: pos, Scale: scale, Material: wire.Material{Color: color}}
	}
	cyl := func(pos, scale domain.Vec3, color string) wire.BuildOp {
		return wire.BuildOp{Op: wire.BuildOpPlace, Shape: wire.ShapeCylinder, Pos: pos, Scale: scale, Material: wire.Material{Color: color}}
	}
	return []wire.BuildOp{
		box(domain.Vec3{X: 0, Y: -1.0, Z: 0}, domain.Vec3{X: 1.8, Y: 0.3, Z: 1.8}, "#cfcfd6"),
		cyl(domain.Vec3{X: -0.6, Y: -0.2, Z: -0.6}, domain.Vec3{X: 0.2, Y: 0.9, Z: 0.2}, "#b8b8c2"),
		cyl(domain.Vec3{X: 0.6, Y: -0.2, Z: 0.6}, domain.Vec3{X: 0.2, Y: 0.9, Z: 0.2}, "#b8b8c2"),
		{Op: wire.BuildOpPlace, Shape: wire.ShapeSphere, Pos: domain.Vec3{X: 0, Y: 0.6, Z: 0}, Scale: domain.Vec3{X: 0.45, Y: 0.45, Z: 0.45}, Material: wire.Material{Color: "#e0e0ea"}},
	}
}

// specJSON wraps ops in the strict {"ops":[...]} envelope a provider emits.
func specJSON(t *testing.T, ops []wire.BuildOp) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(struct {
		Ops []wire.BuildOp `json:"ops"`
	}{Ops: ops})
	if err != nil {
		t.Fatalf("marshal spec: %v", err)
	}
	return b
}

// fakeBuilder wires the REAL refine loop + evaluator over a FakeModel (no
// network), so the contract test proves the whole live path end to end:
// validate-and-repair inside the seam, the loop's hard gate, and the accepted ops.
func fakeBuilder(fake *model.FakeModel) *Builder {
	return NewBuilderWithGenerator(loop.ModelGenerator{M: fake}, "fake", "fake-model")
}

// collect drives BuildLive and gathers every streamed iteration batch plus the
// flattened patch log, so a test can assert on what the live path emits (bh-08d).
type collected struct {
	batches [][]wire.BuildOp
	log     []wire.BuildOp
	ok      bool
}

func collect(t *testing.T, b *Builder, task domain.TaskID, taskType domain.TaskType) collected {
	t.Helper()
	var c collected
	c.ok = b.BuildLive(context.Background(), task, taskType, func(ops []wire.BuildOp) {
		c.batches = append(c.batches, ops)
		c.log = append(c.log, ops...)
	})
	return c
}

// TestBuildLive_GeneratesAcceptedSpec: a FakeModel returning a hard-gate-passing
// foundation spec flows through the real harness and BuildLive streams those ops as
// a place batch with ok=true — the Rover builds from generated ops (no network). The
// streamed patch log folds to the generated geometry.
func TestBuildLive_GeneratesAcceptedSpec(t *testing.T) {
	fake := &model.FakeModel{Responses: []json.RawMessage{specJSON(t, richFoundation())}}
	b := fakeBuilder(fake)

	c := collect(t, b, "foundation-1", "foundation")
	if !c.ok {
		t.Fatalf("expected accepted live spec, got ok=false")
	}
	folded, err := spec.Fold(c.log)
	if err != nil {
		t.Fatalf("streamed patch log must fold cleanly: %v", err)
	}
	if len(folded) != len(richFoundation()) {
		t.Fatalf("expected %d folded ops, got %d", len(richFoundation()), len(folded))
	}
	if folded[0].Shape != wire.ShapeBox {
		t.Fatalf("expected the generated slab first, got %v", folded[0].Shape)
	}
	// A single accepted iteration streams as place-only ops (nothing to self-correct).
	for i, op := range c.log {
		if op.Op != wire.BuildOpPlace {
			t.Fatalf("op %d: first accepted spec must stream as a place, got %q", i, op.Op)
		}
		if op.ID == "" {
			t.Fatalf("op %d: a streamed place must carry a stable slot id", i)
		}
	}
}

// TestBuildLive_RepairsThenAccepts: the FakeModel returns an INVALID spec first
// (zero ops), then a valid one. GenerateSpec's single validate-and-repair re-ask
// recovers, the loop accepts, and BuildLive returns the repaired ops — proving the
// harness validates/repairs on the live path.
func TestBuildLive_RepairsThenAccepts(t *testing.T) {
	fake := &model.FakeModel{Responses: []json.RawMessage{
		json.RawMessage(`{"ops":[]}`), // invalid: zero ops ⇒ repairable
		specJSON(t, richFoundation()), // repaired valid spec
	}}
	b := fakeBuilder(fake)

	c := collect(t, b, "foundation-1", "foundation")
	if !c.ok {
		t.Fatalf("expected accepted after one repair, got ok=false")
	}
	if len(c.log) == 0 {
		t.Fatalf("expected repaired ops streamed, got none")
	}
	if fake.Calls() != 2 {
		t.Fatalf("expected exactly one repair re-ask (2 Generate calls), got %d", fake.Calls())
	}
}

// TestBuildLive_ForcedErrorDegradesGracefully: a FakeModel that returns a
// transport error on EVERY call must NEVER crash — BuildLive returns ok=false so
// the Rover falls back to its deterministic replay/primitive stream (the swarm
// survives a model fault; failure-heal is slice 08f).
func TestBuildLive_ForcedErrorDegradesGracefully(t *testing.T) {
	fake := &model.FakeModel{Err: errors.New("simulated provider timeout")}
	b := fakeBuilder(fake)

	c := collect(t, b, "foundation-1", "foundation")
	if c.ok {
		t.Fatalf("a forced model error must degrade to fallback (ok=false), got ok=true with %d ops", len(c.log))
	}
	if len(c.batches) != 0 {
		t.Fatalf("fallback must stream nothing, got %d iteration batches", len(c.batches))
	}
}

// TestBuildLive_UnknownTaskTypeDegrades: a task type with no demo contract yields
// ok=false (no contract to build), so the Rover falls back rather than crashing.
func TestBuildLive_UnknownTaskTypeDegrades(t *testing.T) {
	fake := &model.FakeModel{Responses: []json.RawMessage{specJSON(t, richFoundation())}}
	b := fakeBuilder(fake)

	if c := collect(t, b, "mystery-1", "mystery"); c.ok {
		t.Fatalf("an unknown task type must degrade to fallback (ok=false)")
	}
	if fake.Calls() != 0 {
		t.Fatalf("an unbuildable contract must not reach the model; got %d Generate calls", fake.Calls())
	}
}

// TestBuildLiveResult_RetriesTransientThenAccepts: a FakeModel that fails the FIRST
// Generate call with a transient error, then returns a valid spec, is ridden out by
// the live path's bounded per-call retry (bh-08f) — the build ACCEPTS, makes 2 model
// calls, and is NOT a model failure.
func TestBuildLiveResult_RetriesTransientThenAccepts(t *testing.T) {
	fake := &model.FakeModel{FailFirst: 1, Responses: []json.RawMessage{specJSON(t, richFoundation())}}
	b := fakeBuilder(fake)

	r := b.BuildLiveResult(context.Background(), "foundation-1", "foundation", func([]wire.BuildOp) {})
	if !r.OK {
		t.Fatalf("a transient blip within the retry budget must still accept, got %+v", r)
	}
	if r.ModelFailed {
		t.Fatal("a recovered build is not a model failure")
	}
	if fake.Calls() != 2 {
		t.Fatalf("expected exactly 1 retry (2 Generate calls), got %d", fake.Calls())
	}
}

// TestBuildLiveResult_ForcedErrorIsModelFailure: a FakeModel that errors on EVERY
// call (surviving the bounded retry) yields ok=false with ModelFailed=TRUE, so the
// Rover routes it through self-heal (counts toward its death threshold) — distinct
// from a graceful degrade. More than one Generate call proves the retry occurred.
func TestBuildLiveResult_ForcedErrorIsModelFailure(t *testing.T) {
	fake := &model.FakeModel{Err: errors.New("simulated provider timeout")}
	b := fakeBuilder(fake)

	r := b.BuildLiveResult(context.Background(), "foundation-1", "foundation", func([]wire.BuildOp) {})
	if r.OK {
		t.Fatalf("a forced model error must not produce ops (ok=false), got %+v", r)
	}
	if !r.ModelFailed {
		t.Fatal("a model error surviving the retry must report ModelFailed=true (route through self-heal)")
	}
	if fake.Calls() < 2 {
		t.Fatalf("the bounded per-call retry must re-ask the model at least once; got %d Generate calls", fake.Calls())
	}
}

// TestBuildLiveResult_UnbuildableContractIsNotModelFailure: an unknown task type (no
// contract) yields ok=false but ModelFailed=FALSE — it is a degrade, not a Rover
// fault, so it never counts toward the death threshold and never reaches the model.
func TestBuildLiveResult_UnbuildableContractIsNotModelFailure(t *testing.T) {
	fake := &model.FakeModel{Responses: []json.RawMessage{specJSON(t, richFoundation())}}
	b := fakeBuilder(fake)

	r := b.BuildLiveResult(context.Background(), "mystery-1", "mystery", func([]wire.BuildOp) {})
	if r.OK || r.ModelFailed {
		t.Fatalf("an unbuildable contract must degrade (ok=false, modelFailed=false), got %+v", r)
	}
	if fake.Calls() != 0 {
		t.Fatalf("an unbuildable contract must not reach the model; got %d Generate calls", fake.Calls())
	}
}

// TestBuildLiveFault_MatchesResult: the two-boolean facade the agent's optional seam
// matches structurally returns the same (OK, ModelFailed) as BuildLiveResult.
func TestBuildLiveFault_MatchesResult(t *testing.T) {
	fake := &model.FakeModel{Err: errors.New("boom")}
	b := fakeBuilder(fake)
	ok, modelFailed := b.BuildLiveFault(context.Background(), "foundation-1", "foundation", func([]wire.BuildOp) {})
	if ok || !modelFailed {
		t.Fatalf("BuildLiveFault on a forced error: got (ok=%v, modelFailed=%v), want (false, true)", ok, modelFailed)
	}
}

// TestStreamer_DiffsIterationsIntoPatches: the per-iteration differ turns successive
// accepted specs into place/move/delete patches on stable slot ids (bh-08d, 08a op
// identity), so the world self-corrects IN PLACE. It drives the streamer directly:
// iter1 places two pieces; iter2 moves slot 0, recolours slot 1, and drops slot 2's
// absence — the streamed log must fold to iter2's geometry.
func TestStreamer_DiffsIterationsIntoPatches(t *testing.T) {
	box := func(pos domain.Vec3, color string) wire.BuildOp {
		return wire.BuildOp{
			Op:       wire.BuildOpPlace,
			Shape:    wire.ShapeBox,
			Pos:      pos,
			Scale:    domain.Vec3{X: 1, Y: 1, Z: 1},
			Material: wire.Material{Color: color},
		}
	}
	iter1 := []wire.BuildOp{
		box(domain.Vec3{X: 0, Y: 0, Z: 0}, "#111111"),
		box(domain.Vec3{X: 1, Y: 0, Z: 0}, "#222222"),
		box(domain.Vec3{X: 2, Y: 0, Z: 0}, "#333333"),
	}
	// iter2: slot0 moves, slot1 recolours in place, slot2 is dropped.
	iter2 := []wire.BuildOp{
		box(domain.Vec3{X: 0, Y: 5, Z: 0}, "#111111"), // moved up
		box(domain.Vec3{X: 1, Y: 0, Z: 0}, "#ff0000"), // recoloured
	}

	var log []wire.BuildOp
	s := &streamer{emit: func(ops []wire.BuildOp) { log = append(log, ops...) }}
	s.onIteration(1, iter1)
	s.onIteration(2, iter2)

	if s.emitted != 2 {
		t.Fatalf("expected 2 streamed iterations, got %d", s.emitted)
	}

	var sawMove, sawDelete bool
	for _, op := range log {
		switch op.Op {
		case wire.BuildOpMove:
			sawMove = true
		case wire.BuildOpDelete:
			sawDelete = true
		}
	}
	if !sawMove {
		t.Fatalf("a moved piece must stream a move patch; log=%+v", log)
	}
	if !sawDelete {
		t.Fatalf("a dropped piece must stream a delete patch; log=%+v", log)
	}

	folded, err := spec.Fold(log)
	if err != nil {
		t.Fatalf("streamed patch log must fold cleanly: %v", err)
	}
	if len(folded) != 2 {
		t.Fatalf("after dropping slot2, fold must leave 2 pieces, got %d", len(folded))
	}
	if folded[0].Pos.Y != 5 {
		t.Fatalf("slot0 must be moved to y=5, got %+v", folded[0])
	}
	if folded[1].Material.Color != "#ff0000" {
		t.Fatalf("slot1 must be recoloured #ff0000, got %q", folded[1].Material.Color)
	}
}

// TestStreamer_UnchangedIterationStreamsNothing: an iteration identical to the last
// produces no patch (no churn on the bus), so a stable refine pass does not re-stream.
func TestStreamer_UnchangedIterationStreamsNothing(t *testing.T) {
	ops := []wire.BuildOp{
		{
			Op:       wire.BuildOpPlace,
			Shape:    wire.ShapeBox,
			Pos:      domain.Vec3{X: 0, Y: 0, Z: 0},
			Scale:    domain.Vec3{X: 1, Y: 1, Z: 1},
			Material: wire.Material{Color: "#abcabc"},
		},
	}
	var calls int
	s := &streamer{emit: func([]wire.BuildOp) { calls++ }}
	s.onIteration(1, ops)
	s.onIteration(2, ops) // identical: no patch
	if calls != 1 {
		t.Fatalf("an unchanged iteration must not re-stream; emit called %d times", calls)
	}
	if s.emitted != 1 {
		t.Fatalf("expected exactly 1 emitted iteration, got %d", s.emitted)
	}
}
