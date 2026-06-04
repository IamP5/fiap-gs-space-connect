// Wire contract — must match wire/wire.go EXACTLY.
//
// The gateway fans out a full world Snapshot (~10 Hz) over the WebSocket. The
// dashboard is a pure, stateless re-render of the latest snapshot — no
// client-side simulation (TECHSPEC §4, ADR-0004). NOTE: positions use capital
// X/Y (Go's domain.Vec2 has no JSON tags, so it marshals as {X, Y}).

export type Vec2 = { X: number; Y: number };

export type TaskStatus = "UNCLAIMED" | "LEASED" | "DONE";

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
};

// A choreography beat (slice 06), derived server-side from a REAL engine event
// and carried in the snapshot's `events`. The browser only DECORATES the
// authoritative world with these (a bid flash, a winner glow); a beat must never
// contradict the rovers/tasks state. Beats are transient — each snapshot carries
// only those since the previous one. `value` carries the bid cost for "bid".
export type WorldEvent = {
  kind: string; // "bid" | "won" | "expired" | "solidify" | "killed"
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
// cover kill (robot) and the slider commands setFailureProb/setLatency (value).
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
