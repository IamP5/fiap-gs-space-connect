package live

import (
	"context"
	"encoding/json"
	"errors"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/harness/loop"
	"swarmbuild/internal/harness/model"
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

// TestBuildLive_GeneratesAcceptedSpec: a FakeModel returning a hard-gate-passing
// foundation spec flows through the real harness and BuildLive returns those ops
// with ok=true — the Rover builds from generated ops (no network).
func TestBuildLive_GeneratesAcceptedSpec(t *testing.T) {
	fake := &model.FakeModel{Responses: []json.RawMessage{specJSON(t, richFoundation())}}
	b := fakeBuilder(fake)

	ops, ok := b.BuildLive(context.Background(), "foundation-1", "foundation")
	if !ok {
		t.Fatalf("expected accepted live spec, got ok=false")
	}
	if len(ops) != len(richFoundation()) {
		t.Fatalf("expected %d generated ops, got %d", len(richFoundation()), len(ops))
	}
	if ops[0].Shape != wire.ShapeBox {
		t.Fatalf("expected the generated slab first, got %v", ops[0].Shape)
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

	ops, ok := b.BuildLive(context.Background(), "foundation-1", "foundation")
	if !ok {
		t.Fatalf("expected accepted after one repair, got ok=false")
	}
	if len(ops) == 0 {
		t.Fatalf("expected repaired ops, got none")
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

	ops, ok := b.BuildLive(context.Background(), "foundation-1", "foundation")
	if ok {
		t.Fatalf("a forced model error must degrade to fallback (ok=false), got ok=true with %d ops", len(ops))
	}
	if ops != nil {
		t.Fatalf("fallback must return nil ops, got %#v", ops)
	}
}

// TestBuildLive_UnknownTaskTypeDegrades: a task type with no demo contract yields
// ok=false (no contract to build), so the Rover falls back rather than crashing.
func TestBuildLive_UnknownTaskTypeDegrades(t *testing.T) {
	fake := &model.FakeModel{Responses: []json.RawMessage{specJSON(t, richFoundation())}}
	b := fakeBuilder(fake)

	if _, ok := b.BuildLive(context.Background(), "mystery-1", "mystery"); ok {
		t.Fatalf("an unknown task type must degrade to fallback (ok=false)")
	}
	if fake.Calls() != 0 {
		t.Fatalf("an unbuildable contract must not reach the model; got %d Generate calls", fake.Calls())
	}
}
