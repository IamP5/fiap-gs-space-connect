package lease

import "swarmbuild/internal/core/domain"

type entry struct {
	rover  domain.RobotID
	expiry domain.Tick
	status domain.TaskStatus
}

type Manager struct {
	clk     domain.Clock
	ttl     domain.Tick
	entries map[domain.TaskID]*entry
}

func NewManager(clk domain.Clock, ttl domain.Tick) *Manager {
	return &Manager{
		clk:     clk,
		ttl:     ttl,
		entries: make(map[domain.TaskID]*entry),
	}
}

func (m *Manager) Grant(task domain.TaskID, rover domain.RobotID) bool {
	if e, ok := m.entries[task]; ok {
		if e.status == domain.Leased || e.status == domain.Done {
			return false
		}
	}
	m.entries[task] = &entry{
		rover:  rover,
		expiry: m.clk.Now() + m.ttl,
		status: domain.Leased,
	}
	return true
}

func (m *Manager) Heartbeat(task domain.TaskID, rover domain.RobotID) bool {
	e, ok := m.entries[task]
	if !ok || e.status != domain.Leased || e.rover != rover {
		return false
	}
	e.expiry = m.clk.Now() + m.ttl
	return true
}

func (m *Manager) Complete(task domain.TaskID, rover domain.RobotID) bool {
	e, ok := m.entries[task]
	if !ok || e.status != domain.Leased || e.rover != rover {
		return false
	}
	e.status = domain.Done
	e.rover = ""
	e.expiry = 0
	return true
}

func (m *Manager) Release(task domain.TaskID, rover domain.RobotID) bool {
	e, ok := m.entries[task]
	if !ok || e.status != domain.Leased || e.rover != rover {
		return false
	}
	m.release(e)
	return true
}

func (m *Manager) Sweep() []domain.TaskID {
	now := m.clk.Now()
	var released []domain.TaskID
	for id, e := range m.entries {
		if e.status == domain.Leased && now >= e.expiry {
			m.release(e)
			released = append(released, id)
		}
	}
	return released
}

func (m *Manager) Status(task domain.TaskID) domain.TaskStatus {
	if e, ok := m.entries[task]; ok {
		return e.status
	}
	return domain.Unclaimed
}

func (m *Manager) release(e *entry) {
	e.status = domain.Unclaimed
	e.rover = ""
	e.expiry = 0
}
