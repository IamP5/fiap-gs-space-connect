// Package domain defines the shared vocabulary of the SwarmBuild worksite.
//
// It is the single contract the four deep modules (allocation, lease, world,
// planner) agree on. It holds data types and small pure helpers only — no NATS,
// no simulation, no wall clock. See CONTEXT.md for the domain language these
// names come from and docs/mvp/TECHSPEC.md §4 for the interface contracts.
package domain

import "math"

// RobotID identifies a single rover. Tie-breaks in the auction are resolved by
// the lower RobotID under ordinary string comparison, so the demo uses
// fixed-width ids ("R1".."R6") to keep that order intuitive.
type RobotID string

// TaskID identifies a single atomic unit of construction.
type TaskID string

// TaskType is the kind of work a task represents (e.g. "foundation", "wall",
// "dome-cap"). It is matched against a rover's capabilities to decide
// eligibility.
type TaskType string

// Capability is a kind of work a rover is able to perform. A rover bids on a
// task only if it has the capability matching the task's type.
type Capability string

// TaskStatus is the lifecycle of a task: UNCLAIMED → LEASED → DONE. A lost
// lease returns a LEASED task to UNCLAIMED. DONE is terminal.
type TaskStatus uint8

const (
	// Unclaimed is the status of a task that needs a rover; it is the only
	// status eligible for auction once its dependencies are complete.
	Unclaimed TaskStatus = iota
	// Leased is the status of a task on which a rover holds a time-bounded grant.
	Leased
	// Done is the status of a completed task. It is terminal.
	Done
)

// String renders a TaskStatus using the canonical UPPERCASE domain spelling.
func (s TaskStatus) String() string {
	switch s {
	case Unclaimed:
		return "UNCLAIMED"
	case Leased:
		return "LEASED"
	case Done:
		return "DONE"
	default:
		return "UNKNOWN"
	}
}

// Lamport is a monotonic logical version stamp. It guards World Model apply()
// so a redelivered expiry or duplicate re-announce across at-least-once
// delivery cannot move a task backwards or double-award it (TECHSPEC §4).
type Lamport uint64

// Tick is a point on an injectable logical clock, in abstract time units. The
// live path maps wall-clock nanoseconds onto Tick; tests advance it by hand so
// lease behaviour is deterministic and needs no real sleeping.
type Tick int64

// Clock yields the current logical time. The Lease Manager depends on this
// interface rather than the wall clock so TTL and heartbeat behaviour is
// deterministically testable (TECHSPEC §7).
type Clock interface {
	Now() Tick
}

// Vec2 is a position on the (flat) worksite. Movement is visual interpolation
// only; there is no physics (ADR-0001).
type Vec2 struct {
	X float64
	Y float64
}

// Dist returns the Euclidean distance between two positions.
func (a Vec2) Dist(b Vec2) float64 {
	dx := a.X - b.X
	dy := a.Y - b.Y
	return math.Hypot(dx, dy)
}

// Vec3 is a 3D vector used by the Build spec (TECHSPEC §4): a position,
// rotation (Euler radians), or scale expressed relative to a Task's Build
// envelope frame. Like Vec2 it carries no JSON tags, so it marshals with
// capital X/Y/Z — the TS mirror reads it the same way (see web/src/types/wire.ts).
type Vec3 struct {
	X float64
	Y float64
	Z float64
}

// Task is the authoritative record of one unit of construction in the World
// Model (TECHSPEC §4). Zero value is a well-formed UNCLAIMED task with no
// assignee.
type Task struct {
	ID     TaskID
	Type   TaskType
	Deps   []TaskID
	Status TaskStatus

	// Assignee is the rover holding the lease while Status is Leased; empty
	// otherwise.
	Assignee RobotID
	// LeaseExpiry is the logical time at which the current lease expires while
	// Status is Leased; zero otherwise.
	LeaseExpiry Tick
	// Version is the Lamport stamp guarding updates to this record.
	Version Lamport
}

// RoverState is the snapshot of a rover the Allocation Engine scores a bid
// from. It is plain data: distance is derived from Pos, charge from Battery,
// eligibility from Capabilities, and busyness from CurrentLoad.
type RoverState struct {
	ID           RobotID
	Pos          Vec2
	Battery      float64 // (0,1]; higher is more charge
	Capabilities []Capability
	CurrentLoad  int // number of tasks the rover already holds
}

// CanPerform reports whether the rover has the capability required by a task of
// the given type. A rover that cannot perform a task does not bid on it.
func (r RoverState) CanPerform(t TaskType) bool {
	for _, c := range r.Capabilities {
		if string(c) == string(t) {
			return true
		}
	}
	return false
}
