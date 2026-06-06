package bake

import (
	"fmt"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/harness/cache"
)

// DemoBlueprintID re-exports cache.DemoBlueprintID so bake callers (cmd/bake) and
// the cache key stay in lockstep on the demo blueprint id.
const DemoBlueprintID = cache.DemoBlueprintID

// demoEnvelopes are reasonable Build envelopes per demo task type, big enough to
// hold a small plinth/wall/cap. Center at the origin: the spec is expressed in the
// Task's envelope frame.
var demoEnvelopes = map[domain.TaskType]Envelope{
	"foundation": {Center: Vec3{}, Size: Vec3{X: 2.0, Y: 1.6, Z: 2.0}},
	"wall":       {Center: Vec3{}, Size: Vec3{X: 2.0, Y: 2.6, Z: 1.2}},
	"dome-cap":   {Center: Vec3{}, Size: Vec3{X: 2.6, Y: 2.6, Z: 2.6}},
}

// demoDone is the measurable "done" guidance per task type.
var demoDone = map[domain.TaskType]string{
	"foundation": "a stable plinth: a slab base with supporting pillars and a small finial, clearly richer than a single block",
	"wall":       "several stacked courses rising to a coping stone, forming one segment of the dome wall",
	"dome-cap":   "a keystone ring topped by a cap, closing the dome",
}

// DemoContract builds the Build contract for one demo dome Task of the given type
// and id, under DemoBlueprintID. It is the contract both the bake command and the
// bake test feed to the harness, so the cache key is reproducible.
func DemoContract(taskID domain.TaskID, taskType domain.TaskType) (Contract, error) {
	env, ok := demoEnvelopes[taskType]
	if !ok {
		return Contract{}, fmt.Errorf("bake: no demo envelope for task type %q", taskType)
	}
	return Contract{
		BlueprintID: DemoBlueprintID,
		TaskID:      taskID,
		Type:        taskType,
		Envelope:    env,
		Done:        Done{Description: demoDone[taskType]},
		Style:       "moon-base habitat, pale prefab panels, brushed metal accents",
	}, nil
}
