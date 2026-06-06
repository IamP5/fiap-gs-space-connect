package agent

import (
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"testing"
)

// testBlueprint is the blueprint id the replay tests bake/replay under.
const testBlueprint = "dome"

// cachedOps is a distinctive baked spec a forced cache HIT replays: a single
// cylinder, which neither the foundation nor wall primitive streams start with, so
// a test can tell replay apart from the primitive fallback.
func cachedOps() []wire.BuildOp {
	return []wire.BuildOp{{
		Op:       wire.BuildOpPlace,
		Shape:    wire.ShapeCylinder,
		Pos:      domain.Vec3{X: 0, Y: 1, Z: 0},
		Rot:      domain.Vec3{},
		Scale:    domain.Vec3{X: 0.5, Y: 2, Z: 0.5},
		Material: wire.Material{Color: "#abcabc"},
	}}
}

// TestOpsFor_CacheHitReplays: with a ReplaySpec resolver that HITS, opsFor returns
// the cached spec verbatim instead of the primitive stream (the headline replay).
func TestOpsFor_CacheHitReplays(t *testing.T) {
	cfg := Config{
		BlueprintID: testBlueprint,
		ReplaySpec: func(blueprint, task domain.TaskID) ([]wire.BuildOp, bool) {
			if blueprint == testBlueprint && task == "foundation-1" {
				return cachedOps(), true
			}
			return nil, false
		},
	}
	ops := cfg.opsFor("foundation-1", "foundation")
	if len(ops) != 1 || ops[0].Shape != wire.ShapeCylinder {
		t.Fatalf("cache hit must replay the baked spec, got %#v", ops)
	}
}

// TestOpsFor_CacheMissFallsBackToPrimitive: a forced MISS yields the deterministic
// primitive stream (buildOpsFor), so the Task still builds and completes.
func TestOpsFor_CacheMissFallsBackToPrimitive(t *testing.T) {
	cfg := Config{
		BlueprintID: testBlueprint,
		ReplaySpec: func(_, _ domain.TaskID) ([]wire.BuildOp, bool) {
			return nil, false // forced miss
		},
	}
	ops := cfg.opsFor("foundation-1", "foundation")
	want := buildOpsFor("foundation")
	if len(ops) != len(want) {
		t.Fatalf("cache miss must fall back to the primitive stream: got %d ops, want %d", len(ops), len(want))
	}
	if ops[0].Shape != want[0].Shape {
		t.Fatalf("fallback stream mismatch: got %v, want %v", ops[0].Shape, want[0].Shape)
	}
}

// TestOpsFor_NoBlueprintNeverConsultsCache: with no BlueprintID the rover never
// consults the cache (even if a resolver is set) and uses the primitive stream —
// the cache path is strictly opt-in.
func TestOpsFor_NoBlueprintNeverConsultsCache(t *testing.T) {
	called := false
	cfg := Config{
		ReplaySpec: func(_, _ domain.TaskID) ([]wire.BuildOp, bool) {
			called = true
			return cachedOps(), true
		},
	}
	ops := cfg.opsFor("foundation-1", "foundation")
	if called {
		t.Fatal("opsFor must not consult the cache when BlueprintID is empty")
	}
	if len(ops) == 0 || ops[0].Shape == wire.ShapeCylinder {
		t.Fatalf("no-blueprint config must use the primitive stream, got %#v", ops)
	}
}

// TestOpsFor_ConfigOverrideBeatsCache: an explicit Config.BuildOps override wins
// over both the cache and the primitive (tests/invariant path), and a forced-empty
// override still forces zero ops.
func TestOpsFor_ConfigOverrideBeatsCache(t *testing.T) {
	cfg := Config{
		BlueprintID: testBlueprint,
		BuildOps:    map[domain.TaskType][]wire.BuildOp{"foundation": {}}, // forced empty
		ReplaySpec: func(_, _ domain.TaskID) ([]wire.BuildOp, bool) {
			return cachedOps(), true
		},
	}
	if ops := cfg.opsFor("foundation-1", "foundation"); len(ops) != 0 {
		t.Fatalf("forced-empty BuildOps override must beat the cache, got %#v", ops)
	}
}
