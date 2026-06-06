package bake

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sort"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/core/planner"
	"swarmbuild/internal/harness/cache"
	"swarmbuild/internal/harness/evaluator"
	"swarmbuild/internal/harness/model"
)

// PlanTask is one Task to bake: its identity/type, its dependencies (so BakeAll can
// generate in topological order), and its worksite position (so neighbours are
// placed in a shared world frame for the collision check). It is a self-contained
// input so the bake package never imports the coordinator/agent (which would drag
// the live swarm into the bake binary's graph); cmd/bake adapts the demo blueprint
// into this shape.
type PlanTask struct {
	ID   domain.TaskID
	Type domain.TaskType
	Deps []domain.TaskID
	Pos  domain.Vec2 // worksite position on the flat board
}

// worldOrigin lifts a flat worksite Vec2 into the shared 3D world frame the
// collision check uses: board X → world X, board Y → world Z, ground at Y=0. The
// per-Task ops are authored in their LOCAL envelope frame; adding this origin
// places them where the Task sits so neighbour overlaps are detectable.
func worldOrigin(p domain.Vec2) domain.Vec3 {
	return domain.Vec3{X: p.X, Y: 0, Z: p.Y}
}

// AllResult is one Task's entry in a BakeAll run: the bake Result plus whether it
// fell back. Reason carries the human-readable disposition for the operator review.
type AllResult struct {
	TaskID domain.TaskID
	Type   domain.TaskType
	Result Result
	Err    error // non-nil (ErrFallback-wrapped) when the Task fell back
}

// FellBack reports whether this Task took the primitive fallback.
func (r AllResult) FellBack() bool {
	return r.Err != nil && errors.Is(r.Err, model.ErrFallback)
}

// LowQuality reports whether this Task cached a spec flagged quality_flag:low.
func (r AllResult) LowQuality() bool {
	return !r.FellBack() && r.Result.LowQuality()
}

// Review is the operator-review surface over a BakeAll run (ADR-0008): the quality
// surface the operator inspects to decide the (B)→(C) topology move. It lists every
// Task that fell back UNION every Task cached quality_flag:low, plus totals.
type Review struct {
	Total    int
	Cached   int
	FellBack []domain.TaskID
	LowQual  []domain.TaskID
	Results  []AllResult
}

// Summary renders the operator review as a stable, human-readable report (printed
// by cmd/bake and written beside the cache). It lists the fell-back ∪ low-quality
// population — the inspectable trigger for specialized sub-agents (topology C).
func (rv Review) Summary() string {
	var b []byte
	add := func(format string, args ...any) { b = fmt.Appendf(b, format, args...) }
	add("Bake-all operator review\n")
	add("========================\n")
	add("tasks: %d   cached: %d   fell back: %d   low-quality: %d\n",
		rv.Total, rv.Cached, len(rv.FellBack), len(rv.LowQual))
	add("\nper-task:\n")
	for _, r := range rv.Results {
		status := "ok"
		switch {
		case r.FellBack():
			status = "FALLBACK"
		case r.LowQuality():
			status = "low-quality"
		}
		add("  %-14s %-10s %-12s %s\n", r.TaskID, r.Type, status, r.Result.Reason)
	}
	if len(rv.FellBack) > 0 {
		add("\nfell back (primitive geometry, not cached): %v\n", rv.FellBack)
	}
	if len(rv.LowQual) > 0 {
		add("cached quality_flag:low (review for regeneration): %v\n", rv.LowQual)
	}
	if len(rv.FellBack) == 0 && len(rv.LowQual) == 0 {
		add("\nall tasks baked at quality_flag:ok — no observed trace gaps.\n")
	}
	return string(b)
}

// ContractFn builds the Build contract for one Task. cmd/bake passes DemoContract;
// a test can pass its own to bake a different shape. It must populate the analytic
// done-criteria so the hard gate is meaningful.
type ContractFn func(id domain.TaskID, taskType domain.TaskType) (Contract, error)

// All generates and caches the Build spec for EVERY Task in tasks, in
// dependency/topological order (bake-all), so each Task's Generator sees a coherent
// world: the accumulated ops of its already-baked neighbours (within/near its
// envelope) ride the world snapshot, and the Evaluator checks the new ops for
// collisions against them. A Task that falls back contributes no neighbour ops (its
// primitive is not modelled here) but the run continues — one Task's exhaustion
// never aborts the dome. It returns the per-Task results and the operator Review.
//
// m is the constructed Model seam (a fake in tests). store is the committed cache.
// contractFor builds each Task's contract. The trace sidecar + quality flag are
// written by the underlying Bake.
func All(ctx context.Context, m model.Model, store *cache.Store, tasks []PlanTask, contractFor ContractFn, provider, modelID string) ([]AllResult, Review, error) {
	order, err := topoOrder(tasks)
	if err != nil {
		return nil, Review{}, err
	}
	byID := make(map[domain.TaskID]PlanTask, len(tasks))
	for _, t := range tasks {
		byID[t.ID] = t
	}

	// accumulated holds each successfully-baked Task's ops in its world frame, so a
	// later Task can be handed its neighbours.
	accumulated := make(map[domain.TaskID]evaluator.Neighbour)

	results := make([]AllResult, 0, len(order))
	review := Review{Total: len(order)}

	for _, id := range order {
		t := byID[id]
		contract, cErr := contractFor(t.ID, t.Type)
		if cErr != nil {
			return nil, Review{}, fmt.Errorf("contract for %s: %w", t.ID, cErr)
		}

		neighbours := neighboursFor(t, byID, accumulated)
		world := WorldContext{
			TaskPos:       t.Pos,
			Note:          "demo dome on the lunar surface; build in the Task envelope frame, clear of neighbours",
			SubjectOrigin: worldOrigin(t.Pos),
			Neighbours:    neighbours,
		}

		res, bErr := Bake(ctx, m, store, contract, world, provider, modelID)
		ar := AllResult{TaskID: t.ID, Type: t.Type, Result: res, Err: bErr}
		results = append(results, ar)

		switch {
		case ar.FellBack():
			review.FellBack = append(review.FellBack, t.ID)
		case bErr != nil:
			// A non-fallback hard error (e.g. cache write) aborts the run — it is a
			// build-environment failure, not a per-Task quality outcome.
			return results, review, fmt.Errorf("bake %s: %w", t.ID, bErr)
		default:
			review.Cached++
			if ar.LowQuality() {
				review.LowQual = append(review.LowQual, t.ID)
			}
			// Feed this Task's ops forward as a neighbour for dependents/peers.
			accumulated[t.ID] = evaluator.Neighbour{
				TaskID: t.ID,
				Origin: worldOrigin(t.Pos),
				Ops:    res.opsForNeighbour(),
			}
		}
	}

	review.Results = results
	return results, review, nil
}

// neighboursFor selects the already-baked neighbour ops handed to a Task's
// Generator/Evaluator: every accumulated Task whose world envelope is near this
// Task's (its dependencies plus any spatially-close peer). Keeping it to nearby
// tasks keeps the snapshot focused and the collision check cheap; for the compact
// demo dome "near" is generous so the whole rising structure is visible. The result
// is sorted by TaskID for deterministic prompts/traces.
func neighboursFor(t PlanTask, byID map[domain.TaskID]PlanTask, accumulated map[domain.TaskID]evaluator.Neighbour) []evaluator.Neighbour {
	const nearRadius = 60.0 // board units; the demo dome spans ~90, so peers within a segment count

	var out []evaluator.Neighbour
	for id, n := range accumulated {
		other, ok := byID[id]
		if !ok {
			continue
		}
		if t.Pos.Dist(other.Pos) <= nearRadius || dependsOn(t, id) {
			out = append(out, n)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].TaskID < out[j].TaskID })
	return out
}

// dependsOn reports whether t lists dep among its dependencies.
func dependsOn(t PlanTask, dep domain.TaskID) bool {
	return slices.Contains(t.Deps, dep)
}

// topoOrder returns the task ids in a valid dependency order via the planner DAG
// (foundations → walls → dome-cap), so each Task is baked only after its
// dependencies, giving the Generator a coherent neighbour world.
func topoOrder(tasks []PlanTask) ([]domain.TaskID, error) {
	dt := make([]domain.Task, len(tasks))
	for i, t := range tasks {
		dt[i] = domain.Task{ID: t.ID, Type: t.Type, Deps: t.Deps}
	}
	plan, err := planner.Load(dt)
	if err != nil {
		return nil, fmt.Errorf("bake-all: blueprint is not a valid DAG: %w", err)
	}
	return plan.TopoOrder(), nil
}
