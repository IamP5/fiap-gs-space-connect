package coordinator_test

import (
	"swarmbuild/internal/coordinator"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
	"testing"
)

const replayBlueprint = "dome"

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

func replayConfig(id domain.TaskID, resolver func(blueprint, task domain.TaskID) ([]wire.BuildOp, bool)) coordinator.Config {
	cfg := oneTaskConfig(id, nil)
	for i := range cfg.Rovers {
		cfg.Rovers[i].BlueprintID = replayBlueprint
		cfg.Rovers[i].ReplaySpec = resolver
	}
	return cfg
}

func TestReplay_CacheHitReplaysBakedSpecDeterministically(t *testing.T) {
	const id domain.TaskID = "replay-x"
	want := bakedReplayOps()
	resolver := func(blueprint, task domain.TaskID) ([]wire.BuildOp, bool) {
		if blueprint == replayBlueprint && task == id {
			return want, true
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

func TestReplay_ForcedCacheMissFallsBackToPrimitive(t *testing.T) {
	const id domain.TaskID = "miss-x"
	resolver := func(_, _ domain.TaskID) ([]wire.BuildOp, bool) {
		return nil, false
	}
	h := newSelfHealHarness(t, replayConfig(id, resolver), id)

	h.poll("miss-x DONE", func() bool {
		tk, ok := h.getTask(id)
		return ok && tk.Status == domain.Done
	})
	h.poll("miss-x accumulated the primitive stream", func() bool {
		got := h.getSpec(id)
		return len(got) > 0 && !specEqual(got, bakedReplayOps())
	})
}
