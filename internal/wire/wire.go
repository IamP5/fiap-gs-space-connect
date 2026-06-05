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
	"swarmbuild/internal/core/domain"
)

// --- NATS subjects (TECHSPEC §4) ---.
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

// --- KV ---.
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

// Choreography beat kinds (slice 06). Each is emitted by the coordinator from a
// REAL engine event — never synthesized — and rides along in the snapshot's
// Events for the browser to animate. The browser may only DECORATE the
// authoritative world state with these (a bid flash, a glow); it must never let
// a beat contradict the World Model (e.g. a "won" beat names the rover that
// actually got the lease).
const (
	EventBid      = "bid"      // a rover bid in an open auction (Robot, TaskID, Value=cost)
	EventWon      = "won"      // a rover won the auction and was granted the lease (Robot, TaskID)
	EventExpired  = "expired"  // a lease TTL-expired; the task is orphaned and re-auctioned (TaskID)
	EventSolidify = "solidify" // a task was completed end-to-end (Robot, TaskID)
	EventKilled   = "killed"   // a rover was killed (scripted or by the dashboard) (Robot)
	EventRevived  = "revived"  // a downed rover came back alive in place after its outage (Robot)
)

// Event is a discrete choreography beat derived from a real engine event
// (lease.expired, auction.won, …). Beats are transient: each snapshot carries
// only the beats that occurred since the previous one, so a reconnecting browser
// simply misses past beats and re-renders durable state from Rovers/Tasks. Value
// carries a numeric payload where a beat needs one (the bid cost for EventBid).
type Event struct {
	Kind   string         `json:"kind"`
	TaskID domain.TaskID  `json:"task_id,omitempty"`
	Robot  domain.RobotID `json:"robot_id,omitempty"`
	Value  float64        `json:"value,omitempty"`
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

// EarthUplink is the delayed Earth-bound telemetry view (issue 09). It rides
// the earth.uplink subject ONLY (ADR-0002 / TECHSPEC §8: the latency shim never
// touches heartbeats or the tactical loop). It is a lagging copy of the world so
// the Earth panel can show telemetry still in-flight while the swarm has already
// healed locally. Type is always "earth" so the browser routes it apart from a
// Snapshot.
type EarthUplink struct {
	Type   string      `json:"type"` // always "earth"
	Rovers []RoverView `json:"rovers"`
	Tasks  []TaskView  `json:"tasks"`
	At     domain.Tick `json:"at"` // the world time this view reflects (lag = now - At)
}

// --- Browser → server control (TECHSPEC §4) ---

// Control is a command from the dashboard. Skeleton wires the relay path; the
// commands themselves (kill, killContainer, setLatency, setFailureProb,
// reloadDemo) arrive in later slices.
//
// "kill" vs "killContainer" are two DISTINCT heal triggers that both land on the
// same self-heal path (lease Expiry → Re-auction):
//   - "kill" is the soft, in-proc death: the target Robot Agent flips itself dead
//     (stops bidding/heartbeating/executing) so its Lease TTL-expires. This is the
//     headline live demo and is handled by the agent (see internal/agent).
//   - "killContainer" is the container Encore (ADR-0001): the target rover runs as
//     a standalone container, and the killer sidecar does a real `docker kill` on
//     the mapped container. It is consumed ONLY by the killer sidecar (see
//     internal/killer) — no agent acts on it, and the browser never touches
//     docker.sock. The killed container goes silent on the bus, its Lease expires,
//     and the same Re-auction heals it over the REAL bus.
//
// "reloadDemo" is cmd-only (no Robot/Value): it resets the demo board IN-PROCESS
// so the swarm rebuilds the dome from scratch — no pod/process restart. The
// coordinator returns every Blueprint task to UNCLAIMED (stamped with a version
// that beats the current record so the monotonic World Model accepts the reset),
// reloads the Planner, drops all live Leases, and re-arms the scripted kills so
// the kill→heal money shot replays. It works in both the in-proc compose mode and
// the external (k8s pod-per-rover) mode. Consumed ONLY by the coordinator.
//
// Robot carries the target rover for both "kill" and "killContainer".
type Control struct {
	Cmd   string         `json:"cmd"`             // "kill" | "killContainer" | "setLatency" | "setFailureProb" | "reloadDemo"
	Robot domain.RobotID `json:"robot,omitempty"` // target rover for "kill" / "killContainer"
	Value float64        `json:"value,omitempty"` // slider value for latency/failure
}

// SubjControl is the bus subject the gateway relays browser Control messages onto.
const SubjControl = "control.command"

// String renders an Announce for audit logs.
func (a Announce) String() string {
	return fmt.Sprintf("announce task=%s type=%s v=%d", a.TaskID, a.Type, a.Version)
}
