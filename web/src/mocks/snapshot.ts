// Dev mock — only used when VITE_MOCK=1. Lets the UI be seen with no backend.
// Kept clearly separated from the live WebSocket path. This is a single static
// snapshot exercising all three task statuses, an alive + a dead rover, and a
// lease beam (rover R1 holds wall-1, which is LEASED to it).
//
// TWO SITES (Epic 04 P2): every rover/task carries a `site` tag and the snapshot
// includes BOTH sites — "lunar" (the original equatorial worksite, world coords
// near the origin) and "shackleton" (the south-pole outpost, world coords near
// X≈400, matching SITE_FRAMES.shackleton.cx so siteMap recenters it). VITE_MOCK=1
// thus shows live rovers/tasks on EITHER site as the operator toggles.

import type { BuildOp, Snapshot, TaskView, EarthUplink, Vec2 } from "../types/wire";

// A point on a circle in world coords (worksite units), 12-o'clock start, used to
// lay the dome's foundation/wall ring out for the mock the way the catalog ring does.
function ringPt(radius: number, deg: number): Vec2 {
  const r = (deg * Math.PI) / 180;
  return { X: Math.round(radius * Math.cos(r)), Y: Math.round(radius * Math.sin(r)) };
}

// moduleSteps mirrors the live rover's procedural-structure op stream (milestone 08,
// internal/agent/opsource.go): `n` "module" build ops for the given StructureKind, so
// a LEASED mock task renders the SAME reveal-by-count rising structure the real
// agents stream (here, a partially-built wall) instead of a translucent full shell.
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

// --- the lunar habitat dome (hero): a cap at centre, four corner foundations and a
// six-module wall ring around it (one LEASED rising, one UNCLAIMED footprint). ---
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
      // The LEASED wall is mid-build: a partial module stream (4 of the wall's 7
      // steps) so it reads as a wall RISING op-by-op, exactly as a live rover would.
      ...(status === "LEASED"
        ? { assignee: "R1", lease_expiry: 120, build_spec: moduleSteps("wall", 4) }
        : {}),
      version: status === "DONE" ? 3 : status === "LEASED" ? 5 : 1,
      deps: ["foundation-1"],
    };
  }),
];

// --- the solar array: two pads + two sun-tracking panels, off to one side. ---
const SOLAR_TASKS: TaskView[] = [
  { id: "solar-pad-1", type: "foundation", site: "lunar", pos: { X: 30, Y: -4 }, status: "DONE", version: 2 },
  { id: "solar-pad-2", type: "foundation", site: "lunar", pos: { X: 38, Y: -4 }, status: "DONE", version: 2 },
  { id: "solar-panel-1", type: "panel", site: "lunar", pos: { X: 30, Y: -4 }, status: "DONE", version: 2 },
  { id: "solar-panel-2", type: "panel", site: "lunar", pos: { X: 38, Y: -4 }, status: "DONE", version: 2 },
];

// --- the comms mast: foundation base, lattice mast, parabolic antenna keystone. ---
const COMMS_TASKS: TaskView[] = [
  { id: "comms-base", type: "foundation", site: "lunar", pos: { X: -32, Y: -4 }, status: "DONE", version: 2 },
  { id: "comms-mast", type: "mast", site: "lunar", pos: { X: -32, Y: -4 }, status: "DONE", version: 2, deps: ["comms-base"] },
  { id: "comms-antenna", type: "dome-cap", site: "lunar", pos: { X: -32, Y: -4 }, status: "DONE", version: 2, deps: ["comms-mast"] },
];

// --- legacy ADR-0006 Build-spec demo (kept for coverage): a textured slab + two
// glTF placements, parked away from the three hero blueprints. Exercises the
// model_ref + material.map slots end-to-end; falls back to the box if an asset
// fails. Dev-only (VITE_MOCK=1). ---
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
    // --- lunar site ---
    { id: "R1", pos: { X: 13, Y: 2 }, battery: 0.82, alive: true, load: 1, task: "wall-1", site: "lunar" },
    { id: "R2", pos: { X: 3, Y: 10 }, battery: 0.45, alive: true, load: 0, site: "lunar" },
    { id: "R3", pos: { X: 10, Y: -10 }, battery: 0.0, alive: false, load: 0, site: "lunar" },
    // --- shackleton site (world coords offset to cx≈400) ---
    { id: "S1", pos: { X: 408, Y: 6 }, battery: 0.74, alive: true, load: 1, task: "shk-wall-1", site: "shackleton" },
    { id: "S2", pos: { X: 396, Y: 12 }, battery: 0.6, alive: true, load: 0, site: "shackleton" },
    { id: "S3", pos: { X: 414, Y: 2 }, battery: 0.0, alive: false, load: 0, site: "shackleton" },
  ],
  tasks: [
    ...DOME_TASKS,
    ...SOLAR_TASKS,
    ...COMMS_TASKS,
    LEGACY_SPEC_TASK,
    // --- shackleton site (world coords offset to cx≈400; siteMap recenters) ---
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

// A DELAYED Earth view (issue 09), used only in VITE_MOCK=1. Its `at` trails the
// live snapshot (5000 → 3200 ≈ +1.8s behind) and its tasks are an EARLIER state:
// Earth still believes wall-1 is only LEASED and has not seen the foundation as
// DONE for as long — so the Earth panel visibly lags the live TaskLedger.
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
