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

export type WorldEvent = {
  kind: string;
  task_id?: string;
  robot_id?: string;
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

// Browser → server control message (TECHSPEC §4). Not needed visually this
// slice, but the shape is fixed here so the send path can use it.
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
