package planner

import (
	"errors"
	"fmt"
	"slices"
	"sort"
	"swarmbuild/internal/core/domain"
)

type Plan struct {
	tasks      map[domain.TaskID]domain.Task
	dependents map[domain.TaskID][]domain.TaskID
	order      []domain.TaskID
}

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

func (p *Plan) topoSort() ([]domain.TaskID, error) {
	indegree := make(map[domain.TaskID]int, len(p.tasks))
	for id, t := range p.tasks {
		if _, ok := indegree[id]; !ok {
			indegree[id] = 0
		}
		indegree[id] += len(t.Deps)
	}

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
		return nil, errors.New("planner: blueprint contains a dependency cycle")
	}
	return order, nil
}

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

func (p *Plan) depsAllDone(t domain.Task) bool {
	for _, dep := range t.Deps {
		if p.tasks[dep].Status != domain.Done {
			return false
		}
	}
	return true
}

func (p *Plan) MarkDone(id domain.TaskID) bool {
	t, ok := p.tasks[id]
	if !ok {
		return false
	}
	t.Status = domain.Done
	p.tasks[id] = t
	return true
}

func (p *Plan) TopoOrder() []domain.TaskID {
	out := make([]domain.TaskID, len(p.order))
	copy(out, p.order)
	return out
}

func (p *Plan) Status(id domain.TaskID) (domain.TaskStatus, bool) {
	t, ok := p.tasks[id]
	return t.Status, ok
}

func (p *Plan) Get(id domain.TaskID) (domain.Task, bool) {
	t, ok := p.tasks[id]
	return t, ok
}

func (p *Plan) Len() int {
	return len(p.tasks)
}
