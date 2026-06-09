package agent

import (
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"testing"
)

const (
	testBlueprint   = "dome"
	taskFoundation1 = domain.TaskID("foundation-1")
)

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

func TestOpsFor_CacheMissFallsBackToPrimitive(t *testing.T) {
	cfg := Config{
		BlueprintID: testBlueprint,
		ReplaySpec: func(_, _ domain.TaskID) ([]wire.BuildOp, bool) {
			return nil, false
		},
	}
	ops := cfg.opsFor(taskFoundation1, "foundation")
	want := buildOpsFor(taskFoundation1, "foundation")
	if len(ops) != len(want) {
		t.Fatalf("cache miss must fall back to the primitive stream: got %d ops, want %d", len(ops), len(want))
	}
	if ops[0].Shape != want[0].Shape {
		t.Fatalf("fallback stream mismatch: got %v, want %v", ops[0].Shape, want[0].Shape)
	}
}

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

func TestOpsFor_ConfigOverrideBeatsCache(t *testing.T) {
	cfg := Config{
		BlueprintID: testBlueprint,
		BuildOps:    map[domain.TaskType][]wire.BuildOp{"foundation": {}},
		ReplaySpec: func(_, _ domain.TaskID) ([]wire.BuildOp, bool) {
			return cachedOps(), true
		},
	}
	if ops := cfg.opsFor(taskFoundation1, "foundation"); len(ops) != 0 {
		t.Fatalf("forced-empty BuildOps override must beat the cache, got %#v", ops)
	}
}

func TestLocalTaskID(t *testing.T) {
	cases := map[domain.TaskID]string{
		"foundation-1":           "foundation-1",
		"lunar/foundation-1":     "foundation-1",
		"shackleton/wall-3":      "wall-3",
		"bp1/dome-cap":           "dome-cap",
		"lunar/foundation-1/odd": "odd",
		"":                       "",
	}
	for in, want := range cases {
		if got := localTaskID(in); got != want {
			t.Fatalf("localTaskID(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestReplayOps_TwoSitePrefixedIDHitsEmbeddedCache(t *testing.T) {
	cfg := Config{BlueprintID: testBlueprint}

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
