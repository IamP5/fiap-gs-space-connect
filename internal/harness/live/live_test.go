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

func fakeBuilder(fake *model.FakeModel) *Builder {
	return NewBuilderWithGenerator(loop.ModelGenerator{M: fake}, "fake", "fake-model")
}

type collected struct {
	batches [][]wire.BuildOp
	log     []wire.BuildOp
	ok      bool
}

func collect(t *testing.T, b *Builder, task domain.TaskID, taskType domain.TaskType) collected {
	t.Helper()
	return collectResume(t, b, task, taskType, nil)
}

func collectResume(t *testing.T, b *Builder, task domain.TaskID, taskType domain.TaskType, priorOps []wire.BuildOp) collected {
	t.Helper()
	var c collected
	c.ok = b.BuildLive(context.Background(), task, taskType, priorOps, func(ops []wire.BuildOp) {
		c.batches = append(c.batches, ops)
		c.log = append(c.log, ops...)
	})
	return c
}

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
	for i, op := range c.log {
		if op.Op != wire.BuildOpPlace {
			t.Fatalf("op %d: first accepted spec must stream as a place, got %q", i, op.Op)
		}
		if op.ID == "" {
			t.Fatalf("op %d: a streamed place must carry a stable slot id", i)
		}
	}
}

func TestBuildLive_RepairsThenAccepts(t *testing.T) {
	fake := &model.FakeModel{Responses: []json.RawMessage{
		json.RawMessage(`{"ops":[]}`),
		specJSON(t, richFoundation()),
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

func TestBuildLiveResult_RetriesTransientThenAccepts(t *testing.T) {
	fake := &model.FakeModel{FailFirst: 1, Responses: []json.RawMessage{specJSON(t, richFoundation())}}
	b := fakeBuilder(fake)

	r := b.BuildLiveResult(context.Background(), "foundation-1", "foundation", nil, func([]wire.BuildOp) {})
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

func TestBuildLiveResult_ForcedErrorIsModelFailure(t *testing.T) {
	fake := &model.FakeModel{Err: errors.New("simulated provider timeout")}
	b := fakeBuilder(fake)

	r := b.BuildLiveResult(context.Background(), "foundation-1", "foundation", nil, func([]wire.BuildOp) {})
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

func TestBuildLiveResult_UnbuildableContractIsNotModelFailure(t *testing.T) {
	fake := &model.FakeModel{Responses: []json.RawMessage{specJSON(t, richFoundation())}}
	b := fakeBuilder(fake)

	r := b.BuildLiveResult(context.Background(), "mystery-1", "mystery", nil, func([]wire.BuildOp) {})
	if r.OK || r.ModelFailed {
		t.Fatalf("an unbuildable contract must degrade (ok=false, modelFailed=false), got %+v", r)
	}
	if fake.Calls() != 0 {
		t.Fatalf("an unbuildable contract must not reach the model; got %d Generate calls", fake.Calls())
	}
}

func TestBuildLiveFault_MatchesResult(t *testing.T) {
	fake := &model.FakeModel{Err: errors.New("boom")}
	b := fakeBuilder(fake)
	ok, modelFailed := b.BuildLiveFault(context.Background(), "foundation-1", "foundation", nil, func([]wire.BuildOp) {})
	if ok || !modelFailed {
		t.Fatalf("BuildLiveFault on a forced error: got (ok=%v, modelFailed=%v), want (false, true)", ok, modelFailed)
	}
}

func TestBuildLive_ResumeContinuesFromPriorLog(t *testing.T) {
	full := richFoundation()
	prior := []wire.BuildOp{
		withID(full[0], "p0"),
		withID(full[1], "p1"),
	}
	fake := &model.FakeModel{Responses: []json.RawMessage{specJSON(t, full)}}
	b := fakeBuilder(fake)

	c := collectResume(t, b, "foundation-1", "foundation", prior)
	if !c.ok {
		t.Fatalf("expected the resumed live build to grow the structure (ok=true)")
	}

	for i, op := range c.log {
		if op.ID == "p0" || op.ID == "p1" {
			t.Fatalf("streamed op %d re-touched a durable prior slot %q; resume must only GROW the structure", i, op.ID)
		}
	}

	combined := append(append([]wire.BuildOp(nil), prior...), c.log...)
	folded, err := spec.Fold(combined)
	if err != nil {
		t.Fatalf("prior log + streamed patches must fold cleanly: %v", err)
	}
	if len(folded) != len(full) {
		t.Fatalf("resumed structure must fold to %d pieces, got %d", len(full), len(folded))
	}
}

func TestBuildLive_ResumeWithMalformedPriorStartsClean(t *testing.T) {
	bad := []wire.BuildOp{{Op: wire.BuildOpMove, ID: "ghost"}}
	fake := &model.FakeModel{Responses: []json.RawMessage{specJSON(t, richFoundation())}}
	b := fakeBuilder(fake)

	c := collectResume(t, b, "foundation-1", "foundation", bad)
	if !c.ok {
		t.Fatalf("a malformed prior log must degrade to a clean start, not abort (want ok=true)")
	}
	if len(c.log) == 0 || c.log[0].ID != "p0" {
		t.Fatalf("a clean start must stream from slot p0; got %+v", c.log)
	}
}

func withID(op wire.BuildOp, id string) wire.BuildOp {
	op.ID = id
	return op
}

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
	iter2 := []wire.BuildOp{
		box(domain.Vec3{X: 0, Y: 5, Z: 0}, "#111111"),
		box(domain.Vec3{X: 1, Y: 0, Z: 0}, "#ff0000"),
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
	s.onIteration(2, ops)
	if calls != 1 {
		t.Fatalf("an unchanged iteration must not re-stream; emit called %d times", calls)
	}
	if s.emitted != 1 {
		t.Fatalf("expected exactly 1 emitted iteration, got %d", s.emitted)
	}
}
