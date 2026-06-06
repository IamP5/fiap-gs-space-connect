// Wire contract — must match wire/wire.go EXACTLY.
//
// The gateway fans out a full world Snapshot (~10 Hz) over the WebSocket. The
// dashboard is a pure, stateless re-render of the latest snapshot — no
// client-side simulation (TECHSPEC §4, ADR-0004). NOTE: positions use capital
// X/Y (Go's domain.Vec2 has no JSON tags, so it marshals as {X, Y}).

export type Vec2 = { X: number; Y: number };

// Vec3 mirrors Go's domain.Vec3 (no JSON tags, so capital X/Y/Z), used by the
// Build spec for a position, rotation (Euler radians), or scale in the Task's
// Build-envelope frame.
export type Vec3 = { X: number; Y: number; Z: number };

export type TaskStatus = "UNCLAIMED" | "LEASED" | "DONE";

// --- Build spec (TECHSPEC §4, ADR-0006) — forward-compatible geometry-as-data.
//
// An ordered list of declarative BuildOps the renderer INTERPRETS into meshes,
// never executes. Mirrors wire.go's BuildOp/Material exactly (snake_case JSON
// field names) so the two round-trip. box|cylinder|sphere render today; "model"
// (with model_ref) and material `map` are reserved future glTF/texture slots the
// current renderer treats as no-ops.
export type BuildShape = "box" | "cylinder" | "sphere" | "model";

export type Material = {
  color: string;
  roughness?: number; // 0..1; omitted ⇒ renderer default
  metalness?: number; // 0..1; omitted ⇒ renderer default
  map?: string; // future texture reference; no-op today
};

export type BuildOp = {
  op: "place";
  shape: BuildShape;
  pos: Vec3;
  rot: Vec3;
  scale: Vec3;
  material: Material;
  model_ref?: string; // future glTF reference; only with shape "model"
};

export type RoverView = {
  id: string;
  pos: Vec2;
  battery: number; // 0..1
  alive: boolean;
  load: number;
  task?: string; // task id the rover currently holds, if any
};

export type TaskView = {
  id: string;
  type: string;
  pos: Vec2;
  status: TaskStatus;
  assignee?: string;
  lease_expiry?: number;
  version: number;
  deps?: string[];
  // Accumulated, ordered Build spec (ADR-0006). Absent ⇒ the renderer falls back
  // to the deterministic `tierOf` primitive, so the field is purely additive.
  build_spec?: BuildOp[];
};

// A choreography beat (slice 06), derived server-side from a REAL engine event
// and carried in the snapshot's `events`. The browser only DECORATES the
// authoritative world with these (a bid flash, a winner glow); a beat must never
// contradict the rovers/tasks state. Beats are transient — each snapshot carries
// only those since the previous one. `value` carries the bid cost for "bid".
export type WorldEvent = {
  kind: string; // "bid" | "won" | "expired" | "solidify" | "killed" | "revived"
  task_id?: string;
  robot_id?: string;
  value?: number;
  at: number;
};

export type Snapshot = {
  type: "snapshot";
  connected: boolean;
  rovers: RoverView[];
  tasks: TaskView[];
  events?: WorldEvent[];
  at: number;
};

// EarthUplink — the DELAYED Earth-bound telemetry view (issue 09). It rides the
// `earth.uplink` subject ONLY (ADR-0002: the latency shim never touches
// heartbeats or the tactical loop), so it is a lagging copy of the world. At
// high latency it trails the live Snapshot — that visible gap is the whole point
// ("Earth never knew"). `type` is always "earth" so the browser routes it apart
// from a Snapshot. Marshals as wire.go's EarthUplink: {type,rovers,tasks,at}.
export type EarthUplink = {
  type: "earth";
  rovers: RoverView[];
  tasks: TaskView[];
  at: number; // the world time this view reflects (lag = snapshot.at - earth.at)
};

// Browser → server control message (TECHSPEC §4). `cmd`/`robot`/`value` already
// cover every command — no shape change per command:
//   · kill            (robot) — flag-flip an in-proc rover dead (the headline)
//   · killContainer   (robot) — the encore: gateway relays it onto NATS and a
//                                killer sidecar runs `docker kill` on the real
//                                rover container (R7), which then self-heals
//                                (Expiry → Re-auction → Self-heal); issue 11
//   · reloadDemo               — reset the board so the swarm rebuilds the dome
//                                from scratch (the Coordinator re-seeds the
//                                worksite); cmd-only, no robot/value
//   · setFailureProb  (value) — 0..1 per-rover induced failure rate (issue 08)
//   · setLatency      (value) — ms of delay on the earth.uplink feed (issue 09)
export type Control = {
  cmd: string;
  robot?: string;
  value?: number;
};

// Narrow an arbitrary parsed JSON value to a Snapshot. Defensive: a malformed
// frame must never crash the pure render.
export function isSnapshot(v: unknown): v is Snapshot {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    o.type === "snapshot" &&
    typeof o.connected === "boolean" &&
    Array.isArray(o.rovers) &&
    Array.isArray(o.tasks)
  );
}

// Narrow an arbitrary parsed JSON value to an EarthUplink. Same defensive ethos
// as isSnapshot: a malformed earth frame must never crash the pure render.
export function isEarthUplink(v: unknown): v is EarthUplink {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return o.type === "earth" && Array.isArray(o.rovers) && Array.isArray(o.tasks);
}
