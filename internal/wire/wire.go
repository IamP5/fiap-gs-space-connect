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

// SubjBuildOp is the subject a rover streams build ops on for a given task as it
// works (bh-02). The coordinator subscribes to the build.op.* wildcard and
// appends each received op to the Task's durable, accumulating Build spec.
func SubjBuildOp(task domain.TaskID) string { return "build.op." + string(task) }

// SubjBuildOpWildcard matches every rover build-op stream.
const SubjBuildOpWildcard = "build.op.*"

// --- KV ---.
const (
	// KVBucketWorld mirrors the World Model: key = task id, value = TaskRecord JSON.
	KVBucketWorld = "world"
)

// KVSpecKey is the World-bucket key the coordinator mirrors a Task's
// accumulating Build spec under (bh-02): "spec/<task id>", value = the ordered
// []BuildOp JSON. It is namespaced away from the bare task-id key (which holds
// the domain.Task record) so the durable spec survives independently and a
// reader can fetch the partial structure of a killed Task to confirm resume.
func KVSpecKey(task domain.TaskID) string { return "spec/" + string(task) }

// --- Bus messages (rover ↔ coordinator) ---

// Announce auctions a ready task. Pos is the task's worksite location so rovers
// can score distance.
type Announce struct {
	TaskID domain.TaskID   `json:"task_id"`
	Type   domain.TaskType `json:"type"`
	Pos    domain.Vec2     `json:"pos"`
	// Mode is the Task's build mode tag (bh-08c): "live" ⇒ the winning Rover runs
	// the Build harness inline; empty/"replay" ⇒ the deterministic replay/primitive
	// stream (the default). Carried on the Announce so a bidder could surface it,
	// though the binding decision rides the Award. A plain string, never the
	// agent.Mode type, so wire stays model-free. Omitted when empty (back-compat).
	Mode string `json:"mode,omitempty"`
	// SiteID gates the auction by worksite (two-site lunar surface, epic 04): a
	// rover only bids on an Announce whose SiteID matches its own Config.SiteID, so
	// the two sites' auctions never cross. Omitted when empty ⇒ the single default
	// site, so an old single-site coordinator/agent is byte-for-byte unchanged.
	SiteID  string         `json:"site,omitempty"`
	Version domain.Lamport `json:"version"`
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
	TaskID domain.TaskID  `json:"task_id"`
	Robot  domain.RobotID `json:"robot_id"`
	// Type is the task's kind, carried so the winning Rover knows which
	// deterministic build-op stream to emit while working it (bh-02) without
	// having to remember the prior Announce.
	Type domain.TaskType `json:"type,omitempty"`
	// Mode is the Task's build mode tag (bh-08c), threaded from the placeBlueprint
	// control onto the Task and carried here so the WINNING Rover honours the
	// PER-TASK mode at award time: "live" ⇒ run the Build harness inline via the
	// injected LiveBuilder seam; empty/"replay" ⇒ the deterministic replay/primitive
	// stream. The Rover falls back to its own Config.Mode when this is empty, so
	// `cmd/agent --build-mode=live` still works and existing awards are unchanged.
	// A plain string, never the agent.Mode type, so wire stays model-free.
	Mode     string         `json:"mode,omitempty"`
	Pos      domain.Vec2    `json:"pos"`
	LeaseTTL domain.Tick    `json:"lease_ttl"`
	Version  domain.Lamport `json:"version"`

	// PriorOps is the Task's already-accumulated, durable patch log at award time
	// (bh-08e, resume-live on kill). It is EMPTY for a fresh Task and NON-EMPTY when
	// a predecessor Rover streamed ops before it was killed/expired and the Task
	// returned to UNCLAIMED with its patch log intact (the bh-02 durable partial
	// state). The replacement Rover, on a non-empty PriorOps in live mode, FOLDS it
	// to the current geometry and continues the live harness loop from there —
	// extending the half-built structure rather than restarting from scratch — and
	// resumes Seq numbering AFTER the prior ops so the stream stays monotonic and the
	// renderer fold stays correct. Carried on the Award so the winner needs no extra
	// round-trip to learn the partial state. Absent ⇒ a clean start, byte-identical
	// to the pre-08e award.
	PriorOps []BuildOp `json:"prior_ops,omitempty"`
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
//
// One Reason IS load-bearing: ReasonBuilderDied (bh-08g). A live-mode rover that
// crosses its model-failure threshold (bh-08f) publishes a Failed with this exact
// reason BEFORE going silent, so the coordinator can count builder deaths PER TASK
// precisely (distinct from an ordinary expiry/kill) and, past a threshold, trip the
// circuit breaker that finishes the Task with the deterministic primitive op-source.
// Any other Reason value (or none) is an ordinary cooperative release and never
// counts toward the breaker.
type Failed struct {
	TaskID domain.TaskID  `json:"task_id"`
	Robot  domain.RobotID `json:"robot_id"`
	Reason string         `json:"reason,omitempty"`
}

// ReasonBuilderDied is the Failed.Reason a live-mode rover stamps when it abandons
// a Task because its MODEL failed past the per-Rover death threshold (bh-08f/08g):
// the distinguishable, inspectable signal the coordinator counts per Task to trip
// the live-mode circuit breaker (≈3 builder deaths ⇒ finish via primitive). It is a
// stable wire string, so the dying rover and the coordinator agree without sharing
// the agent's death-path internals.
const ReasonBuilderDied = "builder-died"

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
	// Site is the worksite the rover is stationed at (two-site lunar surface, epic
	// 04): the agent stamps it from its Config.SiteID so publishSnapshot can tag
	// each RoverView with its site WITHOUT the coordinator tracking a rover→site
	// map. Omitted when empty ⇒ the single default site (back-compat).
	Site string `json:"site,omitempty"`
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
	// Site is the worksite this rover is stationed at (two-site lunar surface, epic
	// 04), reported by the rover via Telemetry.Site. The dashboard slices rovers by
	// site so each surface view shows only its own swarm. Omitted when empty ⇒ the
	// single default site, so an old frontend reads everything as one site.
	Site string `json:"site,omitempty"`
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
	// Site is the worksite this task belongs to (two-site lunar surface, epic 04).
	// The dashboard slices tasks by site so each surface view shows only its own
	// structure. Omitted when empty ⇒ the single default site (back-compat).
	Site string `json:"site,omitempty"`
	// BuildSpec is the Task's accumulated, ordered Build spec (TECHSPEC §4,
	// ADR-0006): declarative geometry the renderer INTERPRETS, never executes.
	// Absent ⇒ the renderer falls back to the deterministic `tierOf` primitive,
	// so the field is purely additive. It is validated server-side
	// (internal/harness/spec) before it rides a snapshot.
	BuildSpec []BuildOp `json:"build_spec,omitempty"`
}

// --- Build spec (TECHSPEC §4) — forward-compatible declarative geometry ---
//
// A Build spec is an ordered list of BuildOps that describe the geometry a Rover
// builds for a Task. It is DATA, never executed code (ADR-0006): the renderer
// interprets box/cylinder/sphere ops into meshes today, and the schema reserves
// the `model`/`map`/`model_ref` slots for future glTF + textures, which current
// renderers treat as no-ops. The whole spec is a pure function of the snapshot,
// so the scene can never claim geometry the World Model has not recorded.

// BuildShape is the geometry primitive a BuildOp places. Only box/cylinder/
// sphere are rendered today; "model" is a reserved forward-compatible slot for a
// future glTF reference (model_ref) and is a renderer no-op for now.
type BuildShape string

// The shapes a BuildOp may place. box/cylinder/sphere render today; model is a
// reserved forward-compatible glTF slot (renderer no-op for now).
const (
	ShapeBox      BuildShape = "box"
	ShapeCylinder BuildShape = "cylinder"
	ShapeSphere   BuildShape = "sphere"
	ShapeModel    BuildShape = "model" // future glTF; not rendered yet
	// ShapeModule places one build STEP of a procedural immersive structure
	// (Structures.tsx). The op's Part names the StructureKind; the renderer reveals
	// the structure step-by-step as the per-step module ops fold in (milestone 08).
	// A module op carries no geometry of its own — Part + the Task's (type,id) fully
	// determine what is drawn — so its transform is identity and its Material a
	// placeholder (the procedural structure carries its own palette + lighting).
	ShapeModule BuildShape = "module"
)

// Build op kinds (bh-08a). The Build spec is an append-only PATCH LOG that the
// renderer FOLDS into current geometry: a `place` adds a piece keyed by its Id;
// a `move` updates the pos/rot/scale of an existing Id; a `delete` removes an
// Id. Folding applies the ops in order, last-write-wins per Id. A place-only log
// (today's cache + primitive op stream) is a degenerate patch log that folds to
// itself, so existing replay renders pixel-identically. Kept as consts (not an
// enum type) so the JSON value is the literal string.
const (
	BuildOpPlace  = "place"  // add a piece keyed by Id
	BuildOpMove   = "move"   // update an existing Id's pos/rot/scale
	BuildOpDelete = "delete" // remove an existing Id
)

// Material is a BuildOp's procedural surface. Color/roughness/metalness drive a
// standard PBR material; Map is the diffuse/albedo texture (sRGB). NormalMap,
// RoughnessMap and AOMap extend it to a full PBR set (all linear colorspace,
// applied best-effort by the renderer): a missing/failed map falls back silently
// to the flat color, so the scene never depends on any texture (ADR-0004).
type Material struct {
	Color        string   `json:"color"`                   // CSS/hex color, e.g. "#cfcfd6"
	Roughness    *float64 `json:"roughness,omitempty"`     // 0..1; nil ⇒ renderer default
	Metalness    *float64 `json:"metalness,omitempty"`     // 0..1; nil ⇒ renderer default
	Map          string   `json:"map,omitempty"`           // diffuse/albedo texture (sRGB)
	NormalMap    string   `json:"normal_map,omitempty"`    // tangent-space normal map (linear)
	RoughnessMap string   `json:"roughness_map,omitempty"` // roughness map (linear, R channel)
	AOMap        string   `json:"ao_map,omitempty"`        // ambient-occlusion map (linear; needs uv2)
}

// BuildOp is a single declarative build step in the append-only patch log
// (bh-08a). pos/rot/scale are expressed relative to the Task's Build-envelope
// frame (TECHSPEC §4). ModelRef is the future glTF reference, populated only
// when Shape is "model".
//
// Id is the stable key the renderer folds on: a `place` introduces an Id; a
// later `move`/`delete` targets that earlier Id. A place-only log gives every
// op a distinct Id, so it folds to itself (pixel-identical replay, ADR-0006).
//
// AssetKey references a curated Asset by KEY in the closed Asset catalog (ADR-0010,
// internal/harness/asset). In live mode the Model emits ONLY a key, never a path;
// the SERVER resolves the key to the catalog entry's self-hosted model_ref before
// the browser sees the op (the browser only ever receives resolved URLs). Empty on
// a procedural op or a spec that already carries a resolved ModelRef.
type BuildOp struct {
	Op       string      `json:"op"`    // place | move | delete (BuildOpPlace/Move/Delete)
	ID       string      `json:"id"`    // stable piece key; move/delete target an earlier place's ID
	Shape    BuildShape  `json:"shape"` // box | cylinder | sphere | model (place only)
	Pos      domain.Vec3 `json:"pos"`
	Rot      domain.Vec3 `json:"rot"`
	Scale    domain.Vec3 `json:"scale"`
	Material Material    `json:"material"`
	ModelRef string      `json:"model_ref,omitempty"` // future glTF reference; only with shape "model"
	AssetKey string      `json:"asset_key,omitempty"` // curated Asset catalog key (ADR-0010); server resolves to ModelRef
	// Part is the StructureKind (foundation|wall|dome|panel|mast|dish) a "module"
	// op builds one step of (milestone 08). Required with shape "module"; empty on
	// every other shape. The renderer reveals the procedural structure step-by-step
	// as these ops fold in, preserving op-by-op rising + self-heal convergence.
	Part string `json:"part,omitempty"`
}

// BuildOpMsg is one streamed build op a Rover emits on SubjBuildOp(task) as it
// works (bh-02). Seq is the op's zero-based position in the Task's accumulating
// Build spec: the coordinator appends an op only when Seq equals the current
// spec length (the next expected slot), so duplicates and out-of-order
// redeliveries are idempotent no-ops. Because the Rover's op stream is a pure
// deterministic function of the Task (it stands in for the LLM), a replacement
// Rover re-emitting from Seq 0 after a kill re-confirms the ops already appended
// (deduped) and continues from where its predecessor stopped — so the final
// op-set converges to the same sequence whether or not a kill interrupted it.
type BuildOpMsg struct {
	TaskID domain.TaskID `json:"task_id"`
	Seq    int           `json:"seq"`
	Op     BuildOp       `json:"op"`
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
// "placeBlueprint" is the game-like authoring command (bh-05): the dashboard
// drags a pre-authored Blueprint from the palette into the world and confirms an
// origin + rotation. The gateway relays it generically onto control.command; the
// coordinator VALIDATES placement (world bounds, terrain, no-overlap with
// existing structures) on its single writer and, on success, injects the
// Blueprint's pre-baked task DAG (translated to the origin and rotated) so the
// Auction picks the new tasks up exactly as it does the startup blueprint.
// Multiple blueprints may be placed — each is just another DAG the Auction feeds
// on. Invalid placement is rejected (logged for the UI) and injects nothing.
// BlueprintID names a catalog entry (internal/blueprint); Origin is the worksite
// anchor the DAG is translated onto; Rotation is radians about the origin.
//
// Robot carries the target rover for both "kill" and "killContainer".
type Control struct {
	Cmd   string         `json:"cmd"`             // "kill" | "killContainer" | "setLatency" | "setFailureProb" | "reloadDemo" | "placeBlueprint"
	Robot domain.RobotID `json:"robot,omitempty"` // target rover for "kill" / "killContainer"
	Value float64        `json:"value,omitempty"` // slider value for latency/failure

	// placeBlueprint fields (bh-05). Empty/zero for every other command.
	BlueprintID string      `json:"blueprint_id,omitempty"` // catalog Blueprint to place
	Origin      domain.Vec2 `json:"origin,omitzero"`        // worksite anchor for the injected DAG
	Rotation    float64     `json:"rotation,omitempty"`     // radians, about the origin
	// Mode picks the build mode for THIS placement (bh-08c): "live" ⇒ the injected
	// DAG's Tasks are tagged live and a winning Rover runs the Build harness inline;
	// "replay" or empty ⇒ the deterministic replay (the default, back-compat). The
	// coordinator stamps it onto every injected Task. Ignored by every other command.
	Mode string `json:"mode,omitempty"`
}

// SubjControl is the bus subject the gateway relays browser Control messages onto.
const SubjControl = "control.command"

// String renders an Announce for audit logs.
func (a Announce) String() string {
	return fmt.Sprintf("announce task=%s type=%s v=%d", a.TaskID, a.Type, a.Version)
}
