package world

import "swarmbuild/internal/core/domain"

type Model struct {
	tasks map[domain.TaskID]domain.Task
}

func NewModel() *Model {
	return &Model{tasks: make(map[domain.TaskID]domain.Task)}
}

func (m *Model) Apply(t domain.Task) bool {
	cur, ok := m.tasks[t.ID]
	if ok && !less(cur, t) {
		return false
	}
	m.tasks[t.ID] = t
	return true
}

func (m *Model) Get(id domain.TaskID) (domain.Task, bool) {
	t, ok := m.tasks[id]
	return t, ok
}

func (m *Model) Snapshot() []domain.Task {
	out := make([]domain.Task, 0, len(m.tasks))
	for _, t := range m.tasks {
		out = append(out, t)
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j].ID < out[j-1].ID; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}

func Merge(a, b domain.Task) domain.Task {
	if less(a, b) {
		return b
	}
	return a
}

func less(x, y domain.Task) bool {
	if x.Version != y.Version {
		return x.Version < y.Version
	}
	if px, py := statusRank(x.Status), statusRank(y.Status); px != py {
		return px < py
	}
	if x.Assignee != y.Assignee {
		return x.Assignee > y.Assignee
	}
	if x.LeaseExpiry != y.LeaseExpiry {
		return x.LeaseExpiry < y.LeaseExpiry
	}
	if x.Type != y.Type {
		return x.Type < y.Type
	}
	if c := compareDeps(x.Deps, y.Deps); c != 0 {
		return c < 0
	}
	return x.ID < y.ID
}

func statusRank(s domain.TaskStatus) int {
	switch s {
	case domain.Done:
		return 3
	case domain.Leased:
		return 2
	case domain.Unclaimed:
		return 1
	default:
		return 0
	}
}

func compareDeps(a, b []domain.TaskID) int {
	if len(a) != len(b) {
		if len(a) < len(b) {
			return -1
		}
		return 1
	}
	for i := range a {
		if a[i] != b[i] {
			if a[i] < b[i] {
				return -1
			}
			return 1
		}
	}
	return 0
}
