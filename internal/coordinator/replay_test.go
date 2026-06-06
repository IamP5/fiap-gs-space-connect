package coordinator_test

import (
	"swarmbuild/internal/coordinator"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"testing"
)

const replayBlueprint = "dome"

// bakedReplayOps is a distinctive cached spec (a slab + cylinder + sphere finial)
// the replay test injects via agent.Config.ReplaySpec, standing in for the
// committed embedded baked spec. It is intentionally NOT what the agent's
// primitive foundation stream emits, so a passing assertion proves the rover
// replayed the CACHED spec rather than falling through to the primitive.
func bakedReplayOps() []wire.BuildOp {
	rough := 0.8
	metal := 0.0
	mat := func(c string) wire.Material { return wire.Material{Color: c, Roughness: &rough, Metalness: &metal} }
	return []wire.BuildOp{
		{Op: wire.BuildOpPlace, Shape: wire.ShapeBox, Pos: domain.Vec3{X: 0, Y: -0.8, Z: 0}, Scale: domain.Vec3{X: 2, Y: 0.2, Z: 2}, Material: mat("#d3d3d3")},
		{Op: wire.BuildOpPlace, Shape: wire.ShapeCylinder, Pos: domain.Vec3{X: -0.9, Y: 0.1, Z: 0}, Scale: domain.Vec3{X: 0.2, Y: 0.9, Z: 0.2}, Material: mat("#c0c0c0")},
		{Op: wire.BuildOpPlace, Shape: wire.ShapeSphere, Pos: domain.Vec3{X: 0, Y: 0.9, Z: 0}, Scale: domain.Vec3{X: 0.5, Y: 0.5, Z: 0.5}, Material: mat("#808080")},
	}
}

// replayConfig is oneTaskConfig with the rovers wired for cache REPLAY: each
// carries BlueprintID and a ReplaySpec resolver. resolver(blueprint, task) decides
// hit/miss, so a test drives a deterministic cache HIT (replay the baked spec) or
// a forced MISS (fall back to the primitive) with no embedded-file dependency.
func replayConfig(id domain.TaskID, resolver func(blueprint, task domain.TaskID) ([]wire.BuildOp, bool)) coordinator.Config {
	cfg := oneTaskConfig(id, nil) // nil BuildOps ⇒ the cache-or-primitive path is live
	for i := range cfg.Rovers {
		cfg.Rovers[i].BlueprintID = replayBlueprint
		cfg.Rovers[i].ReplaySpec = resolver
	}
	return cfg
}

// TestReplay_CacheHitReplaysBakedSpecDeterministically is the bh-03 headline
// proof: with a cache HIT the winning Rover streams the BAKED spec's ops on
// build.op.<task>, the coordinator accumulates them, and the Task reaches DONE
// carrying exactly the cached op-set — no model call, fully deterministic replay.
func TestReplay_CacheHitReplaysBakedSpecDeterministically(t *testing.T) {
	const id domain.TaskID = "replay-x"
	want := bakedReplayOps()
	resolver := func(blueprint, task domain.TaskID) ([]wire.BuildOp, bool) {
		if blueprint == replayBlueprint && task == id {
			return want, true // cache hit
		}
		return nil, false
	}
	h := newSelfHealHarness(t, replayConfig(id, resolver), id)

	h.poll("replay-x DONE", func() bool {
		tk, ok := h.getTask(id)
		return ok && tk.Status == domain.Done
	})
	h.poll("replay-x replayed the baked op-set", func() bool {
		return specEqual(h.getSpec(id), want)
	})
}

// TestReplay_ForcedCacheMissFallsBackToPrimitive: a forced MISS makes the Rover
// fall back to the deterministic primitive stream; the Task still reaches DONE and
// accumulates a (non-empty) spec that is NOT the baked one — the best-effort
// fallback (ADR-0005) end-to-end.
func TestReplay_ForcedCacheMissFallsBackToPrimitive(t *testing.T) {
	const id domain.TaskID = "miss-x"
	resolver := func(_, _ domain.TaskID) ([]wire.BuildOp, bool) {
		return nil, false // forced miss everywhere
	}
	h := newSelfHealHarness(t, replayConfig(id, resolver), id)

	h.poll("miss-x DONE", func() bool {
		tk, ok := h.getTask(id)
		return ok && tk.Status == domain.Done
	})
	// The primitive foundation stream is non-empty and differs from the baked spec,
	// so a miss both completes AND is distinguishable from a replay.
	h.poll("miss-x accumulated the primitive stream", func() bool {
		got := h.getSpec(id)
		return len(got) > 0 && !specEqual(got, bakedReplayOps())
	})
}
