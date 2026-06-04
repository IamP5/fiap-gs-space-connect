// Package planner turns a blueprint into a dependency DAG and answers the
// scheduling questions the worksite asks of it: which tasks are eligible to be
// auctioned now (the ready set), and in what order may the whole blueprint be
// built (a topological order).
//
// It is a pure deep module (TECHSPEC §3): data in, decisions out. It imports
// only swarmbuild/core/domain and the standard library — no NATS, no
// simulation, no wall clock. All outputs are deterministic (ties broken by
// TaskID) so tests are stable across runs.
package planner

import (
	"errors"
	"fmt"
	"slices"
	"sort"
	"swarmbuild/internal/core/domain"
)

// Plan is a loaded blueprint: a validated DAG of tasks together with their
// current status. It is the Planner's view of the World Model's task records.
// Construct one with Load; a cyclic or dangling blueprint never yields a Plan.
type Plan struct {
	// tasks holds the authoritative record per id, keyed by TaskID.
	tasks map[domain.TaskID]domain.Task
	// dependents maps a task to the tasks that depend on it, so marking a
	// task DONE can cheaply find what it might unblock.
	dependents map[domain.TaskID][]domain.TaskID
	// order is a fixed deterministic topological order computed once at Load
	// and reused by TopoOrder and to order Ready output.
	order []domain.TaskID
}

// Load builds a DAG from the given blueprint tasks and validates it.
//
// It rejects, with an error and a nil Plan:
//   - a duplicate task id,
//   - a dependency referencing an unknown task id (a dangling edge), and
//   - any dependency cycle (the blueprint must be acyclic to ever finish).
//
// The input tasks' Status fields are honoured, so a partially-built blueprint
// (some tasks already DONE) loads with that state intact. Load copies each
// task, so the caller's slice is not retained or mutated.
func Load(tasks []domain.Task) (*Plan, error) {
	p := &Plan{
		tasks:      make(map[domain.TaskID]domain.Task, len(tasks)),
		dependents: make(map[domain.TaskID][]domain.TaskID, len(tasks)),
	}

	for _, t := range tasks {
		if _, dup := p.tasks[t.ID]; dup {
			return nil, fmt.Errorf("planner: duplicate task id %q", t.ID)
		}
		p.tasks[t.ID] = t
	}

	// Validate dependency edges: every dep must reference a known task, and a
	// task may not depend on itself.
	for _, t := range tasks {
		for _, dep := range t.Deps {
			if dep == t.ID {
				return nil, fmt.Errorf("planner: task %q depends on itself", t.ID)
			}
			if _, ok := p.tasks[dep]; !ok {
				return nil, fmt.Errorf("planner: task %q depends on unknown task %q", t.ID, dep)
			}
		}
	}

	// Build the reverse (dependents) index, sorted for determinism.
	for id, t := range p.tasks {
		for _, dep := range t.Deps {
			p.dependents[dep] = append(p.dependents[dep], id)
		}
	}
	for dep := range p.dependents {
		slices.Sort(p.dependents[dep])
	}

	order, err := p.topoSort()
	if err != nil {
		return nil, err
	}
	p.order = order

	return p, nil
}

// topoSort returns a deterministic topological order of all tasks (every
// dependency precedes its dependents) and rejects cycles. It uses Kahn's
// algorithm, always emitting the lowest-id ready node next so the order is
// stable across runs and independent of input order.
func (p *Plan) topoSort() ([]domain.TaskID, error) {
	indegree := make(map[domain.TaskID]int, len(p.tasks))
	for id, t := range p.tasks {
		// Ensure every node appears, including those with no deps.
		if _, ok := indegree[id]; !ok {
			indegree[id] = 0
		}
		indegree[id] += len(t.Deps)
	}

	// Frontier of nodes with no unsatisfied dependencies, kept sorted so the
	// lowest id is always emitted next.
	var frontier []domain.TaskID
	for id, d := range indegree {
		if d == 0 {
			frontier = append(frontier, id)
		}
	}
	slices.Sort(frontier)

	order := make([]domain.TaskID, 0, len(p.tasks))
	for len(frontier) > 0 {
		id := frontier[0]
		frontier = frontier[1:]
		order = append(order, id)

		for _, dependent := range p.dependents[id] {
			indegree[dependent]--
			if indegree[dependent] == 0 {
				// Insert into the sorted frontier to preserve determinism.
				pos := sort.Search(len(frontier), func(i int) bool {
					return frontier[i] >= dependent
				})
				frontier = append(frontier, "")
				copy(frontier[pos+1:], frontier[pos:])
				frontier[pos] = dependent
			}
		}
	}

	if len(order) != len(p.tasks) {
		// Some nodes never reached indegree 0: they sit on a cycle.
		return nil, errors.New("planner: blueprint contains a dependency cycle")
	}
	return order, nil
}

// Ready returns the ids of tasks eligible to be auctioned now: every one of a
// task's dependencies is DONE and the task itself is not yet DONE. A task with
// no dependencies is ready immediately (until it is DONE). The result is in
// deterministic topological order; an empty (non-nil intent) blueprint yields
// an empty slice.
func (p *Plan) Ready() []domain.TaskID {
	ready := make([]domain.TaskID, 0)
	for _, id := range p.order {
		t := p.tasks[id]
		if t.Status == domain.Done {
			continue
		}
		if p.depsAllDone(t) {
			ready = append(ready, id)
		}
	}
	return ready
}

// depsAllDone reports whether every dependency of t is DONE.
func (p *Plan) depsAllDone(t domain.Task) bool {
	for _, dep := range t.Deps {
		if p.tasks[dep].Status != domain.Done {
			return false
		}
	}
	return true
}

// MarkDone marks the task complete, which may unblock its dependents (they can
// then appear in Ready). It reports false if the id is unknown. Marking an
// already-DONE task is a harmless no-op that returns true.
func (p *Plan) MarkDone(id domain.TaskID) bool {
	t, ok := p.tasks[id]
	if !ok {
		return false
	}
	t.Status = domain.Done
	p.tasks[id] = t
	return true
}

// TopoOrder returns all task ids in a valid dependency order — every
// dependency appears before each task that depends on it. The order is fixed
// at Load and deterministic across runs.
func (p *Plan) TopoOrder() []domain.TaskID {
	out := make([]domain.TaskID, len(p.order))
	copy(out, p.order)
	return out
}

// Status returns the current status of a task and whether the id is known.
func (p *Plan) Status(id domain.TaskID) (domain.TaskStatus, bool) {
	t, ok := p.tasks[id]
	return t.Status, ok
}

// Get returns a copy of the task record for the given id and whether it exists.
func (p *Plan) Get(id domain.TaskID) (domain.Task, bool) {
	t, ok := p.tasks[id]
	return t, ok
}

// Len reports the number of tasks in the blueprint.
func (p *Plan) Len() int {
	return len(p.tasks)
}
