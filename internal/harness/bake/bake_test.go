package bake

import (
	"context"
	"encoding/json"
	"errors"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/harness/cache"
	"swarmbuild/internal/harness/model"
	"swarmbuild/internal/harness/trace"
	"swarmbuild/internal/wire"
	"testing"
)

// validOpsJSON is a hard-gate-PASSING foundation spec: a slab plus two pillars and
// a finial (≥ MinOps, inside the foundation envelope, multi-shape → coherent), so
// the loop accepts it on the first iteration.
func validOpsJSON(t *testing.T) json.RawMessage {
	t.Helper()
	rough := 0.7
	ops := []wire.BuildOp{
		{Op: wire.BuildOpPlace, Shape: wire.ShapeBox, Pos: domain.Vec3{X: 0, Y: -0.7, Z: 0}, Scale: domain.Vec3{X: 1.8, Y: 0.2, Z: 1.8}, Material: wire.Material{Color: "#cfcfd6", Roughness: &rough}},
		{Op: wire.BuildOpPlace, Shape: wire.ShapeCylinder, Pos: domain.Vec3{X: -0.6, Y: 0, Z: 0}, Scale: domain.Vec3{X: 0.2, Y: 0.8, Z: 0.2}, Material: wire.Material{Color: colorSilver}},
		{Op: wire.BuildOpPlace, Shape: wire.ShapeCylinder, Pos: domain.Vec3{X: 0.6, Y: 0, Z: 0}, Scale: domain.Vec3{X: 0.2, Y: 0.8, Z: 0.2}, Material: wire.Material{Color: colorSilver}},
		{Op: wire.BuildOpPlace, Shape: wire.ShapeSphere, Pos: domain.Vec3{X: 0, Y: 0.6, Z: 0}, Scale: domain.Vec3{X: 0.4, Y: 0.3, Z: 0.4}, Material: wire.Material{Color: "#808080"}},
	}
	b, err := json.Marshal(struct {
		Ops []wire.BuildOp `json:"ops"`
	}{ops})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}

// TestBake_WritesValidCacheEntry: a valid generation is cached and re-loadable
// through the cache's own replay index — the full bake → cache → replay loop with
// NO network (fake Model).
func TestBake_WritesValidCacheEntry(t *testing.T) {
	store, err := cache.NewStore(t.TempDir())
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	fake := &model.FakeModel{Responses: []json.RawMessage{validOpsJSON(t)}}

	c, err := DemoContract("foundation-1", typeFoundation)
	if err != nil {
		t.Fatalf("contract: %v", err)
	}
	res, err := Bake(context.Background(), fake, store, c, WorldContext{TaskPos: domain.Vec2{X: 10, Y: 20}}, "openai", "gpt-4o")
	if err != nil {
		t.Fatalf("bake: %v", err)
	}
	if res.Ops != 4 {
		t.Fatalf("want 4 ops cached, got %d", res.Ops)
	}
	if res.FellBack() {
		t.Fatalf("a hard-gate-passing spec must be accepted, got fallback: %s", res.Reason)
	}
	if res.QualityFlag != trace.QualityOK {
		t.Fatalf("a high-quality spec must be flagged ok, got %q", res.QualityFlag)
	}
	if res.TracePath == "" {
		t.Fatal("bake must write a trace sidecar beside the spec")
	}

	// Read the written file back through the cache and confirm it replays.
	data, err := readFile(t, res.Path)
	if err != nil {
		t.Fatalf("read written cache: %v", err)
	}
	replay, err := cache.New(map[string][]byte{res.Key.Filename(): data})
	if err != nil {
		t.Fatalf("rebuild cache from written file: %v", err)
	}
	ops, ok := replay.Lookup(DemoBlueprintID, "foundation-1")
	if !ok || len(ops) != 4 {
		t.Fatalf("baked spec must replay for its task, got ok=%v len=%d", ok, len(ops))
	}
}

// TestBake_FallbackWritesTraceButNoSpec: model exhaustion returns ErrFallback and
// caches NO spec, so the demo Task uses the primitive (and still completes) — but a
// trace sidecar IS written so the fallback is inspectable in the operator review
// (ADR-0008).
func TestBake_FallbackWritesTraceButNoSpec(t *testing.T) {
	dir := t.TempDir()
	store, err := cache.NewStore(dir)
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	// Every response is a degenerate single-block spec that fails the foundation
	// done-criteria (MinOps 3), across the full iteration cap (each iteration runs
	// the seam's own ask+repair, so stage 2× the cap).
	invalid := json.RawMessage(`{"ops":[{"op":"place","shape":"box","pos":{"X":0,"Y":0,"Z":0},"rot":{"X":0,"Y":0,"Z":0},"scale":{"X":0.5,"Y":0.5,"Z":0.5},"material":{"color":"#fff"}}]}`)
	fake := &model.FakeModel{Responses: []json.RawMessage{invalid, invalid, invalid, invalid, invalid, invalid}}

	c, _ := DemoContract("foundation-1", typeFoundation)
	res, err := Bake(context.Background(), fake, store, c, WorldContext{}, "openai", "gpt-4o")
	if !errors.Is(err, model.ErrFallback) {
		t.Fatalf("want ErrFallback on exhaustion, got %v", err)
	}
	if !res.FellBack() {
		t.Fatalf("result must report fallback, got %q", res.Result)
	}
	if countSpecFiles(t, dir) != 0 {
		t.Fatal("fallback must write no SPEC cache file")
	}
	if countTraceFiles(t, dir) != 1 {
		t.Fatal("fallback must still write a trace sidecar for the operator review")
	}
}

// TestDemoContract_HashStable: the demo contract hashes the same across calls, so
// re-baking an unchanged contract reuses one cache key/file.
func TestDemoContract_HashStable(t *testing.T) {
	a, _ := DemoContract("foundation-1", typeFoundation)
	b, _ := DemoContract("foundation-1", typeFoundation)
	aj, _ := a.JSON()
	bj, _ := b.JSON()
	if cache.ContractHash(aj) != cache.ContractHash(bj) {
		t.Fatal("demo contract hash must be stable across calls")
	}
}
