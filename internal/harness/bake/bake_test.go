package bake

import (
	"context"
	"encoding/json"
	"errors"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/harness/cache"
	"swarmbuild/internal/harness/model"
	"swarmbuild/internal/wire"
	"testing"
)

func validOpsJSON(t *testing.T) json.RawMessage {
	t.Helper()
	ops := []wire.BuildOp{{
		Op:       wire.BuildOpPlace,
		Shape:    wire.ShapeBox,
		Pos:      domain.Vec3{X: 0, Y: 0.15, Z: 0},
		Rot:      domain.Vec3{},
		Scale:    domain.Vec3{X: 1.4, Y: 0.3, Z: 1.4},
		Material: wire.Material{Color: "#cfcfd6"},
	}}
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

	c, err := DemoContract("foundation-1", "foundation")
	if err != nil {
		t.Fatalf("contract: %v", err)
	}
	res, err := Bake(context.Background(), fake, store, c, WorldContext{TaskPos: domain.Vec2{X: 10, Y: 20}}, "openai", "gpt-4o")
	if err != nil {
		t.Fatalf("bake: %v", err)
	}
	if res.Ops != 1 {
		t.Fatalf("want 1 op cached, got %d", res.Ops)
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
	if !ok || len(ops) != 1 {
		t.Fatalf("baked spec must replay for its task, got ok=%v len=%d", ok, len(ops))
	}
}

// TestBake_FallbackWritesNothing: model exhaustion returns ErrFallback and leaves
// the cache empty, so the demo Task uses the primitive (and still completes).
func TestBake_FallbackWritesNothing(t *testing.T) {
	dir := t.TempDir()
	store, err := cache.NewStore(dir)
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	// Two invalid responses ⇒ exhausts the single repair.
	invalid := json.RawMessage(`{"ops":[{"op":"place","shape":"box","pos":{"X":0,"Y":0,"Z":0},"rot":{"X":0,"Y":0,"Z":0},"scale":{"X":0,"Y":0,"Z":0},"material":{"color":"#fff"}}]}`)
	fake := &model.FakeModel{Responses: []json.RawMessage{invalid, invalid}}

	c, _ := DemoContract("foundation-1", "foundation")
	_, err = Bake(context.Background(), fake, store, c, WorldContext{}, "openai", "gpt-4o")
	if !errors.Is(err, model.ErrFallback) {
		t.Fatalf("want ErrFallback on exhaustion, got %v", err)
	}
	if n := countFiles(t, dir); n != 0 {
		t.Fatalf("fallback must write no cache file, found %d", n)
	}
}

// TestDemoContract_HashStable: the demo contract hashes the same across calls, so
// re-baking an unchanged contract reuses one cache key/file.
func TestDemoContract_HashStable(t *testing.T) {
	a, _ := DemoContract("foundation-1", "foundation")
	b, _ := DemoContract("foundation-1", "foundation")
	aj, _ := a.JSON()
	bj, _ := b.JSON()
	if cache.ContractHash(aj) != cache.ContractHash(bj) {
		t.Fatal("demo contract hash must be stable across calls")
	}
}
