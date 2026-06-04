// Package lease implements the SwarmBuild Lease Manager: TTL + heartbeat over
// an injectable logical clock (TECHSPEC §4). It is a pure deep module — no
// NATS, no simulation, no wall clock. Time enters ONLY through a
// domain.Clock, so behaviour is deterministic and testable (TECHSPEC §7).
//
// The lease state machine:
//
//	UNCLAIMED --Grant------------------------> LEASED
//	--Heartbeat--------------------> LEASED    (TTL reset)
//	LEASED    --Complete---------------------> DONE      (terminal)
//	LEASED    --Sweep (TTL passed) | Release-> UNCLAIMED (re-auction)
//
// The single most important property is that release is EXACTLY ONCE /
// idempotent: a repeated Sweep, a duplicate Release, or any touch of a task
// that has already been released or completed must never release twice or
// re-touch a terminal task.
package lease

import "swarmbuild/internal/core/domain"

// entry is the Manager's private bookkeeping for one task. A task that has no
// entry is, by definition, UNCLAIMED. Done is the only terminal state and,
// once reached, the entry is retained so that redelivered expiries/releases
// for that task are recognised as no-ops.
type entry struct {
	rover  domain.RobotID
	expiry domain.Tick
	status domain.TaskStatus
}

// Manager tracks the live leases of a worksite. It is not safe for concurrent
// use: the live path drives it from a single-writer tick goroutine, which
// serialises award against expiry (TECHSPEC §8). The zero value is not usable;
// construct one with NewManager.
type Manager struct {
	clk     domain.Clock
	ttl     domain.Tick
	entries map[domain.TaskID]*entry
}

// NewManager returns a Lease Manager that reads time from clk and grants leases
// with a time-to-live of ttl. ttl is expected to be ≥ ~3× the heartbeat
// interval so a slow tick cannot false-expire a healthy rover (TECHSPEC §8);
// that ratio is the caller's responsibility and is not enforced here.
func NewManager(clk domain.Clock, ttl domain.Tick) *Manager {
	return &Manager{
		clk:     clk,
		ttl:     ttl,
		entries: make(map[domain.TaskID]*entry),
	}
}

// Grant awards a lease on task to rover, setting the TTL (expiry = now + ttl).
// It returns false — leaving any existing state untouched — if the task
// already has a live lease or is already DONE. A task that is UNCLAIMED
// (no entry, or an entry left over from a prior release) can be (re-)granted.
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

// Heartbeat renews a live lease, resetting the TTL (expiry = now + ttl). It
// returns false — changing nothing — unless task is currently LEASED and held
// by rover. A heartbeat from a rover that does not hold the lease, or for a
// task that is UNCLAIMED or DONE, is rejected.
func (m *Manager) Heartbeat(task domain.TaskID, rover domain.RobotID) bool {
	e, ok := m.entries[task]
	if !ok || e.status != domain.Leased || e.rover != rover {
		return false
	}
	e.expiry = m.clk.Now() + m.ttl
	return true
}

// Complete moves a live lease held by rover to the terminal DONE state. It
// returns false — changing nothing — unless task is currently LEASED and held
// by rover. Once DONE, a task is never released by a Sweep or Release.
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

// Release forcibly releases a live lease held by rover (e.g. that rover was
// reported lost), returning the task to UNCLAIMED. Like Heartbeat and
// Complete, it is scoped to the named holder: it returns false — changing
// nothing — unless task is currently LEASED and held by rover. This makes a
// duplicate or redelivered "rover lost" event a safe no-op, and crucially
// prevents a stale event for a prior holder (R1) from releasing the fresh
// lease of a successor (R2) granted after re-auction, under the spec's
// at-least-once delivery premise (TECHSPEC §4/§8). It is idempotent: releasing
// the same held lease twice returns true then false.
func (m *Manager) Release(task domain.TaskID, rover domain.RobotID) bool {
	e, ok := m.entries[task]
	if !ok || e.status != domain.Leased || e.rover != rover {
		return false
	}
	m.release(e)
	return true
}

// Sweep expires every lease whose TTL has passed at the current clock time,
// returning the tasks released THIS call — each exactly once. A task expires
// when now >= its expiry. Sweep is safe to call repeatedly: a task released by
// one Sweep is UNCLAIMED afterwards and is not returned again, and DONE tasks
// are never swept. The returned slice is nil when nothing expired.
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

// Status reports the lease state of task: DONE if it has been completed,
// LEASED if a live lease is held, and UNCLAIMED otherwise (including tasks the
// Manager has never seen and tasks released back for re-auction).
func (m *Manager) Status(task domain.TaskID) domain.TaskStatus {
	if e, ok := m.entries[task]; ok {
		return e.status
	}
	return domain.Unclaimed
}

// release transitions a LEASED entry to UNCLAIMED in place, clearing the
// assignee and expiry. Callers must guarantee e.status == domain.Leased; that
// guard is what makes release exactly-once.
func (m *Manager) release(e *entry) {
	e.status = domain.Unclaimed
	e.rover = ""
	e.expiry = 0
}
