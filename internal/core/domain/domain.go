package domain

import "math"

type RobotID string

type TaskID string

type TaskType string

type Capability string

type TaskStatus uint8

const (
	Unclaimed TaskStatus = iota
	Leased
	Done
)

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

type Lamport uint64

type Tick int64

type Clock interface {
	Now() Tick
}

type Vec2 struct {
	X float64
	Y float64
}

func (a Vec2) Dist(b Vec2) float64 {
	dx := a.X - b.X
	dy := a.Y - b.Y
	return math.Hypot(dx, dy)
}

type Vec3 struct {
	X float64
	Y float64
	Z float64
}

type Task struct {
	ID     TaskID
	Type   TaskType
	Deps   []TaskID
	Status TaskStatus

	Assignee    RobotID
	LeaseExpiry Tick
	Version     Lamport

	Mode string

	SiteID string
}

type RoverState struct {
	ID           RobotID
	Pos          Vec2
	Battery      float64
	Capabilities []Capability
	CurrentLoad  int

	SiteID string
}

func (r RoverState) CanPerform(t TaskType) bool {
	for _, c := range r.Capabilities {
		if string(c) == string(t) {
			return true
		}
	}
	return false
}
