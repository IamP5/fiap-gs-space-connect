package bake

import (
	"fmt"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/harness/cache"
)

// DemoBlueprintID re-exports cache.DemoBlueprintID so bake callers (cmd/bake) and
// the cache key stay in lockstep on the demo blueprint id.
const DemoBlueprintID = cache.DemoBlueprintID

// The demo dome's three task types (the blueprint contract — rovers advertise these
// as capabilities and the auction matches on them, so the string values must match
// internal/demo).
const (
	typeFoundation domain.TaskType = "foundation"
	typeWall       domain.TaskType = "wall"
	typeDomeCap    domain.TaskType = "dome-cap"
)

// demoEnvelopes are reasonable Build envelopes per demo task type, big enough to
// hold a small plinth/wall/cap. Center at the origin: the spec is expressed in the
// Task's envelope frame.
var demoEnvelopes = map[domain.TaskType]Envelope{
	typeFoundation: {Center: Vec3{}, Size: Vec3{X: 3.0, Y: 2.4, Z: 3.0}},
	typeWall:       {Center: Vec3{}, Size: Vec3{X: 3.0, Y: 3.6, Z: 2.0}},
	typeDomeCap:    {Center: Vec3{}, Size: Vec3{X: 3.6, Y: 3.6, Z: 3.6}},
	// Drag-to-place catalog Blueprints (solar-array, comms-mast) add two more types.
	"panel": {Center: Vec3{}, Size: Vec3{X: 4.0, Y: 3.0, Z: 3.6}},
	"mast":  {Center: Vec3{}, Size: Vec3{X: 2.4, Y: 7.0, Z: 2.4}},
}

// demoDone is the measurable "done" per task type: human guidance PLUS the
// analytic criteria the Evaluator's hard gate checks (MinOps so a structure is
// "richer than a single block", MinCoverage so it meaningfully fills its envelope).
// These are deliberately modest so a real GPT-class spec clears them while a
// degenerate single-block spec is rejected.
var demoDone = map[domain.TaskType]Done{
	typeFoundation: {
		Description: "a stable plinth: a slab base with supporting pillars and a small finial, clearly richer than a single block",
		MinOps:      3,
		MinCoverage: 0.02,
	},
	typeWall: {
		Description: "several stacked courses rising to a coping stone, forming one segment of the dome wall",
		MinOps:      3,
		MinCoverage: 0.02,
	},
	typeDomeCap: {
		Description: "a keystone ring topped by a cap, closing the dome",
		MinOps:      3,
		MinCoverage: 0.015,
	},
	"panel": {
		Description: "a photovoltaic array: a mounting frame carrying sun-facing panel slats, clearly richer than a single block",
		MinOps:      3,
		MinCoverage: 0.02,
	},
	"mast": {
		Description: "a slender comms mast rising in tapering segments to an antenna seat at the top",
		MinOps:      3,
		MinCoverage: 0.012,
	},
}

// DemoContract builds the Build contract for one demo dome Task of the given type
// and id, under DemoBlueprintID. It is the contract both the bake command and the
// bake test feed to the harness, so the cache key is reproducible.
func DemoContract(taskID domain.TaskID, taskType domain.TaskType) (Contract, error) {
	env, ok := demoEnvelopes[taskType]
	if !ok {
		return Contract{}, fmt.Errorf("bake: no demo envelope for task type %q", taskType)
	}
	done, ok := demoDone[taskType]
	if !ok {
		return Contract{}, fmt.Errorf("bake: no demo done-criteria for task type %q", taskType)
	}
	return Contract{
		BlueprintID: DemoBlueprintID,
		TaskID:      taskID,
		Type:        taskType,
		Envelope:    env,
		Done:        done,
		Style:       "moon-base habitat, pale prefab panels, brushed metal accents",
	}, nil
}
