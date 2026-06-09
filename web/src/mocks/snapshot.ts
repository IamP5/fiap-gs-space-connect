
import type { BuildOp, Snapshot, TaskView, EarthUplink, Vec2 } from "../types/wire";

function ringPt(radius: number, deg: number): Vec2 {
  const r = (deg * Math.PI) / 180;
  return { X: Math.round(radius * Math.cos(r)), Y: Math.round(radius * Math.sin(r)) };
}

function moduleSteps(kind: string, n: number): BuildOp[] {
  return Array.from({ length: n }, (_, i) => ({
    op: "place",
    id: `op-${i}`,
    shape: "module",
    part: kind,
    pos: { X: 0, Y: 0, Z: 0 },
    rot: { X: 0, Y: 0, Z: 0 },
    scale: { X: 1, Y: 1, Z: 1 },
    material: { color: "#cfcfd6" },
  }));
}

const DOME_TASKS: TaskView[] = [
  { id: "dome-cap", type: "dome-cap", site: "lunar", pos: { X: 0, Y: 0 }, status: "DONE", version: 4 },
  ...[45, 135, 225, 315].map((deg, i): TaskView => ({
    id: `foundation-${i + 1}`,
    type: "foundation",
    site: "lunar",
    pos: ringPt(13, deg),
    status: "DONE",
    version: 2,
  })),
  ...[0, 60, 120, 180, 240, 300].map((deg, i): TaskView => {
    const n = i + 1;
    const status = n === 1 ? "LEASED" : n === 2 ? "UNCLAIMED" : "DONE";
    return {
      id: `wall-${n}`,
      type: "wall",
      site: "lunar",
      pos: ringPt(14, deg),
      status,
      ...(status === "LEASED"
        ? { assignee: "R1", lease_expiry: 120, build_spec: moduleSteps("wall", 4) }
        : {}),
      version: status === "DONE" ? 3 : status === "LEASED" ? 5 : 1,
      deps: ["foundation-1"],
    };
  }),
];

const SOLAR_TASKS: TaskView[] = [
  { id: "solar-pad-1", type: "foundation", site: "lunar", pos: { X: 30, Y: -4 }, status: "DONE", version: 2 },
  { id: "solar-pad-2", type: "foundation", site: "lunar", pos: { X: 38, Y: -4 }, status: "DONE", version: 2 },
  { id: "solar-panel-1", type: "panel", site: "lunar", pos: { X: 30, Y: -4 }, status: "DONE", version: 2 },
  { id: "solar-panel-2", type: "panel", site: "lunar", pos: { X: 38, Y: -4 }, status: "DONE", version: 2 },
];

const COMMS_TASKS: TaskView[] = [
  { id: "comms-base", type: "foundation", site: "lunar", pos: { X: -32, Y: -4 }, status: "DONE", version: 2 },
  { id: "comms-mast", type: "mast", site: "lunar", pos: { X: -32, Y: -4 }, status: "DONE", version: 2, deps: ["comms-base"] },
  { id: "comms-antenna", type: "dome-cap", site: "lunar", pos: { X: -32, Y: -4 }, status: "DONE", version: 2, deps: ["comms-mast"] },
];

const LEGACY_SPEC_TASK: TaskView = {
  id: "legacy-pad",
  type: "foundation",
  site: "lunar",
  pos: { X: -52, Y: 44 },
  status: "DONE",
  version: 3,
  build_spec: [
    {
      op: "place",
      id: "slab",
      shape: "box",
      pos: { X: 0, Y: 0.15, Z: 0 },
      rot: { X: 0, Y: 0, Z: 0 },
      scale: { X: 2.4, Y: 0.3, Z: 2.4 },
      material: {
        color: "#cfcfd6",
        roughness: 0.95,
        metalness: 0.05,
        map: "/assets/textures/regolith_diff_512.jpg",
        normal_map: "/assets/textures/regolith_nor_gl_512.jpg",
        roughness_map: "/assets/textures/regolith_rough_512.jpg",
        ao_map: "/assets/textures/regolith_ao_512.jpg",
      },
    },
    {
      op: "place",
      id: "dome",
      shape: "model",
      pos: { X: 0, Y: 0.3, Z: 0 },
      rot: { X: 0, Y: 0, Z: 0 },
      scale: { X: 1.4, Y: 1.4, Z: 1.4 },
      material: { color: "#e8e8ef" },
      model_ref: "/assets/models/hangar_roundA.glb",
    },
    {
      op: "place",
      id: "generator",
      shape: "model",
      pos: { X: 1.6, Y: 0.3, Z: 0 },
      rot: { X: 0, Y: 0, Z: 0 },
      scale: { X: 1.4, Y: 1.4, Z: 1.4 },
      material: { color: "#cdd2e0" },
      model_ref: "/assets/models/machine_generator_draco.glb",
    },
  ],
};

export const MOCK_SNAPSHOT: Snapshot = {
  type: "snapshot",
  connected: true,
  at: 5000,
  rovers: [
    { id: "R1", pos: { X: 13, Y: 2 }, battery: 0.82, alive: true, load: 1, task: "wall-1", site: "lunar" },
    { id: "R2", pos: { X: 3, Y: 10 }, battery: 0.45, alive: true, load: 0, site: "lunar" },
    { id: "R3", pos: { X: 10, Y: -10 }, battery: 0.0, alive: false, load: 0, site: "lunar" },
    { id: "S1", pos: { X: 408, Y: 6 }, battery: 0.74, alive: true, load: 1, task: "shk-wall-1", site: "shackleton" },
    { id: "S2", pos: { X: 396, Y: 12 }, battery: 0.6, alive: true, load: 0, site: "shackleton" },
    { id: "S3", pos: { X: 414, Y: 2 }, battery: 0.0, alive: false, load: 0, site: "shackleton" },
  ],
  tasks: [
    ...DOME_TASKS,
    ...SOLAR_TASKS,
    ...COMMS_TASKS,
    LEGACY_SPEC_TASK,
    {
      id: "shk-foundation-1",
      type: "foundation",
      site: "shackleton",
      pos: { X: 406, Y: 6 },
      status: "DONE",
      version: 2,
    },
    {
      id: "shk-wall-1",
      type: "wall",
      site: "shackleton",
      pos: { X: 408, Y: 9 },
      status: "LEASED",
      assignee: "S1",
      lease_expiry: 140,
      version: 3,
      deps: ["shk-foundation-1"],
    },
    {
      id: "shk-wall-2",
      type: "wall",
      site: "shackleton",
      pos: { X: 411, Y: 12 },
      status: "UNCLAIMED",
      version: 1,
      deps: ["shk-foundation-1"],
    },
    {
      id: "shk-dome-cap",
      type: "dome",
      site: "shackleton",
      pos: { X: 405, Y: 15 },
      status: "UNCLAIMED",
      version: 1,
      deps: ["shk-wall-1", "shk-wall-2"],
    },
  ],
};

export const MOCK_EARTH: EarthUplink = {
  type: "earth",
  at: 3200,
  rovers: [
    { id: "R1", pos: { X: 9, Y: 6 }, battery: 0.88, alive: true, load: 1, task: "wall-1" },
    { id: "R2", pos: { X: 5, Y: 13 }, battery: 0.51, alive: true, load: 0 },
    { id: "R3", pos: { X: 18, Y: 3 }, battery: 0.04, alive: true, load: 0 },
  ],
  tasks: [
    { id: "foundation-1", type: "foundation", pos: { X: 6, Y: 6 }, status: "DONE", version: 3 },
    {
      id: "wall-1",
      type: "wall",
      pos: { X: 13, Y: 9 },
      status: "UNCLAIMED",
      version: 4,
      deps: ["foundation-1"],
    },
    {
      id: "wall-2",
      type: "wall",
      pos: { X: 16, Y: 12 },
      status: "UNCLAIMED",
      version: 1,
      deps: ["foundation-1"],
    },
    {
      id: "dome-cap",
      type: "dome",
      pos: { X: 10, Y: 16 },
      status: "UNCLAIMED",
      version: 1,
      deps: ["wall-1", "wall-2"],
    },
  ],
};
