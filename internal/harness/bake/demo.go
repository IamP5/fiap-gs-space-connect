package bake

import (
	"fmt"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/harness/cache"
)

const DemoBlueprintID = cache.DemoBlueprintID

const (
	typeFoundation domain.TaskType = "foundation"
	typeWall       domain.TaskType = "wall"
	typeDomeCap    domain.TaskType = "dome-cap"
)

var demoEnvelopes = map[domain.TaskType]Envelope{
	typeFoundation: {Center: Vec3{}, Size: Vec3{X: 3.0, Y: 2.4, Z: 3.0}},
	typeWall:       {Center: Vec3{}, Size: Vec3{X: 3.0, Y: 3.6, Z: 2.0}},
	typeDomeCap:    {Center: Vec3{}, Size: Vec3{X: 3.6, Y: 3.6, Z: 3.6}},
	"panel":        {Center: Vec3{}, Size: Vec3{X: 4.0, Y: 3.0, Z: 3.6}},
	"mast":         {Center: Vec3{}, Size: Vec3{X: 2.4, Y: 7.0, Z: 2.4}},
}

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
