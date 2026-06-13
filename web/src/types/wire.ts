
export type Vec2 = { X: number; Y: number };

export type Vec3 = { X: number; Y: number; Z: number };

export type TaskStatus = "UNCLAIMED" | "LEASED" | "DONE";

export type BuildShape = "box" | "cylinder" | "sphere" | "model" | "module";

export type Material = {
  color: string;
  roughness?: number;
  metalness?: number;
  map?: string;
  normal_map?: string;
  roughness_map?: string;
  ao_map?: string;
};

export type BuildOp = {
  op: "place" | "move" | "delete";
  id: string;
  shape: BuildShape;
  pos: Vec3;
  rot: Vec3;
  scale: Vec3;
  material: Material;
  model_ref?: string;
  asset_key?: string;
  part?: string;
};

export type RoverView = {
  id: string;
  pos: Vec2;
  battery: number;
  alive: boolean;
  load: number;
  task?: string;
  site?: string;
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
  site?: string;
  build_spec?: BuildOp[];
};

export type WorldEvent = {
  kind: string;
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

export type EarthUplink = {
  type: "earth";
  rovers: RoverView[];
  tasks: TaskView[];
  at: number;
};

export type Control = {
  cmd: string;
  robot?: string;
  value?: number;
  blueprint_id?: string;
  origin?: Vec2;
  rotation?: number;
};

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

export function isEarthUplink(v: unknown): v is EarthUplink {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return o.type === "earth" && Array.isArray(o.rovers) && Array.isArray(o.tasks);
}
