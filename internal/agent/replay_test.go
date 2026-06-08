package agent

import (
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"testing"
)

// testBlueprint is the blueprint id the replay tests bake/replay under;
// taskFoundation1 is the local task id they look up under it.
const (
	testBlueprint   = "dome"
	taskFoundation1 = domain.TaskID("foundation-1")
)

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
			if blueprint == testBlueprint && task == taskFoundation1 {
				return cachedOps(), true
			}
			return nil, false
		},
	}
	ops := cfg.opsFor(taskFoundation1, "foundation")
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
	ops := cfg.opsFor(taskFoundation1, "foundation")
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
	ops := cfg.opsFor(taskFoundation1, "foundation")
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
	if ops := cfg.opsFor(taskFoundation1, "foundation"); len(ops) != 0 {
		t.Fatalf("forced-empty BuildOps override must beat the cache, got %#v", ops)
	}
}

// TestLocalTaskID strips the instance/site prefix blueprint.Place adds (two-site
// lunar surface, epic 04) so the baked cache — keyed by the bare local id — still
// resolves a prefixed task id. An unprefixed id passes through unchanged.
func TestLocalTaskID(t *testing.T) {
	cases := map[domain.TaskID]string{
		"foundation-1":           "foundation-1", // single-site: unchanged
		"lunar/foundation-1":     "foundation-1", // two-site prefix stripped
		"shackleton/wall-3":      "wall-3",
		"bp1/dome-cap":           "dome-cap", // drag-placed instance prefix
		"lunar/foundation-1/odd": "odd",      // only the last segment is the local id
		"":                       "",
	}
	for in, want := range cases {
		if got := localTaskID(in); got != want {
			t.Fatalf("localTaskID(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestReplayOps_TwoSitePrefixedIDHitsEmbeddedCache is the regression guard for the
// epic-04 site prefixing: a demo rover (BlueprintID="dome") building a SITE-PREFIXED
// task id ("lunar/foundation-1") must still replay the SAME committed baked spec the
// bare local id resolves — otherwise the two-site board silently loses the
// deterministic no-model-call replay headline and falls back to the primitive
// stream. SKIPPED if the dome has not been baked, so the suite stays green either way.
func TestReplayOps_TwoSitePrefixedIDHitsEmbeddedCache(t *testing.T) {
	cfg := Config{BlueprintID: testBlueprint} // embedded cache, no resolver

	local, localHit := cfg.replayOps(taskFoundation1)
	if !localHit {
		t.Skip("dome foundation-1 not baked into the embedded cache; nothing to regress")
	}
	prefixed, prefHit := cfg.replayOps("lunar/foundation-1")
	if !prefHit {
		t.Fatal("a site-prefixed task id must hit the same baked spec as its local id (epic 04)")
	}
	if len(prefixed) != len(local) {
		t.Fatalf("prefixed replay returned %d ops, want %d (same baked spec as the local id)", len(prefixed), len(local))
	}
}
