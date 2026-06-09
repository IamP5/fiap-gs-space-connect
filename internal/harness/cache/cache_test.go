package cache

import (
	"encoding/json"
	"strings"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"testing"
)

func sampleOps() []wire.BuildOp {
	return []wire.BuildOp{{
		Op:       wire.BuildOpPlace,
		Shape:    wire.ShapeBox,
		Pos:      domain.Vec3{X: 0, Y: 0.5, Z: 0},
		Rot:      domain.Vec3{},
		Scale:    domain.Vec3{X: 1, Y: 1, Z: 1},
		Material: wire.Material{Color: "#cfcfd6"},
	}}
}

func sampleEntry(blueprint, task string) Entry {
	return Entry{
		BlueprintID:  blueprint,
		TaskID:       task,
		TaskType:     "foundation",
		ContractHash: "abcd1234",
		Model:        "gpt-4o",
		Ops:          sampleOps(),
	}
}

func TestKeyFilename_Sanitized(t *testing.T) {
	k := Key{BlueprintID: "dome", TaskID: "foundation-1", ContractHash: "ab/cd 12", Model: "gpt-4o:2024"}
	got := k.Filename()
	for _, bad := range []string{"/", " ", ":"} {
		if strings.Contains(got, bad) {
			t.Fatalf("filename %q still contains unsafe %q", got, bad)
		}
	}
	if !strings.HasSuffix(got, ".json") {
		t.Fatalf("filename %q must end .json", got)
	}
}

func TestContractHash_StableAcrossKeyOrder(t *testing.T) {
	a := json.RawMessage(`{"task_id":"foundation-1","type":"foundation"}`)
	b := json.RawMessage(`{ "type": "foundation", "task_id": "foundation-1" }`)
	if ContractHash(a) != ContractHash(b) {
		t.Fatalf("contract hash must be invariant to key order/whitespace: %s vs %s", ContractHash(a), ContractHash(b))
	}
}

func TestCacheLookup_HitAndMiss(t *testing.T) {
	e := sampleEntry("dome", "foundation-1")
	data, err := e.Marshal()
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	c, err := New(map[string][]byte{"dome_foundation-1_abcd1234_gpt-4o.json": data})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ops, ok := c.Lookup("dome", "foundation-1")
	if !ok {
		t.Fatal("want cache hit for baked task")
	}
	if len(ops) != 1 {
		t.Fatalf("want 1 op, got %d", len(ops))
	}
	ops[0].Material.Color = "#000000"
	again, _ := c.Lookup("dome", "foundation-1")
	if again[0].Material.Color == "#000000" {
		t.Fatal("Lookup must return a defensive copy, not the cached slice")
	}
	if _, ok := c.Lookup("dome", "wall-7"); ok {
		t.Fatal("want cache miss for un-baked task")
	}
	if _, ok := c.Lookup("other-blueprint", "foundation-1"); ok {
		t.Fatal("want cache miss for a different blueprint")
	}
}

func TestCacheNew_RejectsInvalidEntry(t *testing.T) {
	bad := sampleEntry("dome", "foundation-1")
	bad.Ops[0].Scale = domain.Vec3{}
	data, _ := json.Marshal(bad)
	if _, err := New(map[string][]byte{"x.json": data}); err == nil {
		t.Fatal("New must reject a cache file whose ops fail validation")
	}
}

func TestCacheNew_DeterministicOnCollision(t *testing.T) {
	first := sampleEntry("dome", "foundation-1")
	first.Ops[0].Material.Color = "#111111"
	second := sampleEntry("dome", "foundation-1")
	second.Ops[0].Material.Color = "#222222"
	fa, _ := first.Marshal()
	fb, _ := second.Marshal()
	for range 5 {
		c, err := New(map[string][]byte{
			"b_second.json": fb,
			"a_first.json":  fa,
		})
		if err != nil {
			t.Fatalf("New: %v", err)
		}
		ops, _ := c.Lookup("dome", "foundation-1")
		if ops[0].Material.Color != "#111111" {
			t.Fatalf("collision must resolve to the sorted-first file, got %s", ops[0].Material.Color)
		}
	}
}

func TestEmbeddedCache_Loads(t *testing.T) {
	c, err := Embedded()
	if err != nil {
		t.Fatalf("embedded cache failed to load: %v", err)
	}
	if c == nil {
		t.Fatal("embedded cache is nil")
	}
	t.Logf("embedded cache holds %d baked spec(s)", c.Len())
}

func TestEmbeddedCache_ReplaysBakedFoundationDeterministically(t *testing.T) {
	c, err := Embedded()
	if err != nil {
		t.Fatalf("embedded cache failed to load: %v", err)
	}
	a, ok := c.Lookup(DemoBlueprintID, "foundation-1")
	if !ok {
		t.Skip("no baked foundation-1 spec committed yet; run the live bake first")
	}
	if len(a) == 0 {
		t.Fatal("baked spec has zero ops")
	}
	b, _ := c.Lookup(DemoBlueprintID, "foundation-1")
	aj, _ := json.Marshal(a)
	bj, _ := json.Marshal(b)
	if string(aj) != string(bj) {
		t.Fatalf("replay is not deterministic:\n a=%s\n b=%s", aj, bj)
	}
	t.Logf("deterministic replay of %d-op baked foundation-1 spec confirmed", len(a))
}
