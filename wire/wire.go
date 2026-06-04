// Package wire is the integration contract between the SwarmBuild services: the
// NATS subject names and the JSON message shapes that cross the bus and the
// WebSocket. Every service (coordinator, agent, gateway) marshals these exact
// types, so the wire format lives in one place.
//
// Subjects follow TECHSPEC §4. task.complete extends that list to carry the
// Lease "complete" transition explicitly (auditable, per issue 03) rather than
// inferring completion from telemetry.
package wire

import (
	"fmt"

	"swarmbuild/core/domain"
)

// --- NATS subjects (TECHSPEC §4) ---
const (
	SubjTaskAnnounce = "task.announce"  // coordinator announces a ready task for auction
	SubjTaskAward    = "task.award"     // coordinator grants the winning rover a lease
	SubjTaskComplete = "task.complete"  // a rover reports its leased task finished
	SubjTaskFailed   = "task.failed"    // a rover reports it cannot finish its leased task (cooperative release)
	SubjSnapshot     = "world.snapshot" // coordinator publishes the merged world snapshot (~10 Hz)
	SubjEarthUplink  = "earth.uplink"   // latency shim lives here ONLY (never on heartbeats)
)

// SubjBid is the subject a rover publishes its bid on for a given task. The
// coordinator subscribes to the task.bid.* wildcard during an auction.
func SubjBid(task domain.TaskID) string { return "task.bid." + string(task) }

// SubjBidWildcard matches every rover bid subject.
const SubjBidWildcard = "task.bid.*"

// SubjHeartbeat is the subject a rover renews its lease on.
func SubjHeartbeat(robot domain.RobotID) string { return "robot.heartbeat." + string(robot) }

// SubjHeartbeatWildcard matches every rover heartbeat.
const SubjHeartbeatWildcard = "robot.heartbeat.*"

// SubjTelemetry is the subject a rover publishes position/battery/health on.
func SubjTelemetry(robot domain.RobotID) string { return "robot.telemetry." + string(robot) }

// SubjTelemetryWildcard matches every rover telemetry stream.
const SubjTelemetryWildcard = "robot.telemetry.*"

// --- KV ---
const (
	// KVBucketWorld mirrors the World Model: key = task id, value = TaskRecord JSON.
	KVBucketWorld = "world"
)

// --- Bus messages (rover ↔ coordinator) ---

// Announce auctions a ready task. Pos is the task's worksite location so rovers
// can score distance.
type Announce struct {
	TaskID  domain.TaskID   `json:"task_id"`
	Type    domain.TaskType `json:"type"`
	Pos     domain.Vec2     `json:"pos"`
	Version domain.Lamport  `json:"version"`
}

// Bid is a rover's cost to perform an announced task. Lower wins; ties break by
// lower RobotID. A rover that cannot perform the task does not send a Bid.
type Bid struct {
	TaskID domain.TaskID  `json:"task_id"`
	Robot  domain.RobotID `json:"robot_id"`
	Cost   float64        `json:"cost"`
}

// Award grants a task to the winning rover as a lease. Pos is the task's
// worksite location so the winning rover knows where to drive (slice 02: the
// rover interpolates toward Pos, draining battery, before it works the task).
type Award struct {
	TaskID   domain.TaskID  `json:"task_id"`
	Robot    domain.RobotID `json:"robot_id"`
	Pos      domain.Vec2    `json:"pos"`
	LeaseTTL domain.Tick    `json:"lease_ttl"`
	Version  domain.Lamport `json:"version"`
}

// Complete reports that a rover finished its leased task.
type Complete struct {
	TaskID domain.TaskID  `json:"task_id"`
	Robot  domain.RobotID `json:"robot_id"`
}

// Failed reports that a rover is abandoning a leased task it cannot finish
// (e.g. an execution failure or lost capability). The coordinator releases the
// lease PROMPTLY on this signal — scoped to the named holder — rather than
// waiting for the TTL to expire, so the task re-auctions immediately (slice 03,
// the cooperative counterpart to silent death by heartbeat timeout). Reason is
// a short human-readable cause for the audit log; it does not affect handling.
type Failed struct {
	TaskID domain.TaskID  `json:"task_id"`
	Robot  domain.RobotID `json:"robot_id"`
	Reason string         `json:"reason,omitempty"`
}

// Heartbeat renews a rover's lease on a task.
type Heartbeat struct {
	Robot  domain.RobotID `json:"robot_id"`
	TaskID domain.TaskID  `json:"task_id"`
	At     domain.Tick    `json:"at"`
}

// Telemetry is a rover's self-report of position, charge, health and load.
type Telemetry struct {
	Robot   domain.RobotID `json:"robot_id"`
	Pos     domain.Vec2    `json:"pos"`
	Battery float64        `json:"battery"`
	Alive   bool           `json:"alive"`
	Load    int            `json:"load"`
	At      domain.Tick    `json:"at"`
}

// --- WebSocket snapshot (server → browser, ~10 Hz) ---
//
// The full world snapshot is reconnect-safe: the browser is a pure stateless
// re-render of it, with no client-side simulation (TECHSPEC §4, ADR-0004).

// RoverView is a rover as the dashboard sees it.
type RoverView struct {
	ID      domain.RobotID `json:"id"`
	Pos     domain.Vec2    `json:"pos"`
	Battery float64        `json:"battery"`
	Alive   bool           `json:"alive"`
	Load    int            `json:"load"`
	Task    domain.TaskID  `json:"task,omitempty"` // task the rover currently holds, if any
}

// TaskView is a task record as the dashboard sees it.
type TaskView struct {
	ID          domain.TaskID   `json:"id"`
	Type        domain.TaskType `json:"type"`
	Pos         domain.Vec2     `json:"pos"`
	Status      string          `json:"status"` // UNCLAIMED | LEASED | DONE
	Assignee    domain.RobotID  `json:"assignee,omitempty"`
	LeaseExpiry domain.Tick     `json:"lease_expiry,omitempty"`
	Version     domain.Lamport  `json:"version"`
	Deps        []domain.TaskID `json:"deps,omitempty"`
}

// Event is a discrete choreography beat derived from a real engine event
// (lease.expired, auction.won, …). The skeleton emits none yet; the field
// exists so the gateway and browser can carry them without a contract change.
type Event struct {
	Kind   string         `json:"kind"`
	TaskID domain.TaskID  `json:"task_id,omitempty"`
	Robot  domain.RobotID `json:"robot_id,omitempty"`
	At     domain.Tick    `json:"at"`
}

// Snapshot is the full server-authoritative world state pushed to the browser.
type Snapshot struct {
	Type      string      `json:"type"`      // always "snapshot"
	Connected bool        `json:"connected"` // true once the coordinator's bus is healthy
	Rovers    []RoverView `json:"rovers"`
	Tasks     []TaskView  `json:"tasks"`
	Events    []Event     `json:"events,omitempty"`
	At        domain.Tick `json:"at"`
}

// --- Browser → server control (TECHSPEC §4) ---

// Control is a command from the dashboard. Skeleton wires the relay path; the
// commands themselves (kill, setLatency, setFailureProb) arrive in later slices.
type Control struct {
	Cmd   string         `json:"cmd"`             // "kill" | "setLatency" | "setFailureProb"
	Robot domain.RobotID `json:"robot,omitempty"` // target rover for "kill"
	Value float64        `json:"value,omitempty"` // slider value for latency/failure
}

// SubjControl is the bus subject the gateway relays browser Control messages onto.
const SubjControl = "control.command"

// String renders an Announce for audit logs.
func (a Announce) String() string {
	return fmt.Sprintf("announce task=%s type=%s v=%d", a.TaskID, a.Type, a.Version)
}
