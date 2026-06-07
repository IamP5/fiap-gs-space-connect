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

import type { EarthUplink, Snapshot } from "../types/wire";

export const MOCK_SNAPSHOT: Snapshot = {
  type: "snapshot",
  connected: true,
  at: 5000,
  rovers: [
    // --- lunar site ---
    { id: "R1", pos: { X: 12, Y: 8 }, battery: 0.82, alive: true, load: 1, task: "wall-1", site: "lunar" },
    { id: "R2", pos: { X: 4, Y: 14 }, battery: 0.45, alive: true, load: 0, site: "lunar" },
    { id: "R3", pos: { X: 18, Y: 3 }, battery: 0.0, alive: false, load: 0, site: "lunar" },
    // --- shackleton site (world coords offset to cx≈400) ---
    { id: "S1", pos: { X: 408, Y: 6 }, battery: 0.74, alive: true, load: 1, task: "shk-wall-1", site: "shackleton" },
    { id: "S2", pos: { X: 396, Y: 12 }, battery: 0.6, alive: true, load: 0, site: "shackleton" },
    { id: "S3", pos: { X: 414, Y: 2 }, battery: 0.0, alive: false, load: 0, site: "shackleton" },
  ],
  tasks: [
    {
      id: "foundation-1",
      type: "foundation",
      site: "lunar",
      pos: { X: 6, Y: 6 },
      status: "DONE",
      version: 3,
      // bh-07b demo: a Build spec exercising BOTH forward-compatible slots with
      // REAL CC0 assets — a textured slab (material.map → the Poly Haven rock
      // diffuse) and a glTF placement (shape "model" + model_ref → the Kenney
      // hangar dome). A missing/failed asset falls back to the primitive, so the
      // scene never breaks. Dev-only (VITE_MOCK=1); the headline replay is
      // untouched.
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
            // issue #53: exercise the FULL PBR set (diffuse + normal + roughness +
            // ao) on a SpecPrimitive with the self-hosted CC0 regolith maps.
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
          // issue #52 demo: a DRACO-compressed conditioned model (recentered,
          // fit-to-unit, KHR_draco_mesh_compression required) — exercises the
          // self-hosted /draco/ decoder end-to-end. Falls back to the box if the
          // decoder is missing, so the scene never breaks. Dev-only (VITE_MOCK=1).
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
    },
    {
      id: "wall-1",
      type: "wall",
      site: "lunar",
      pos: { X: 13, Y: 9 },
      status: "LEASED",
      assignee: "R1",
      lease_expiry: 120,
      version: 5,
      deps: ["foundation-1"],
    },
    {
      id: "wall-2",
      type: "wall",
      site: "lunar",
      pos: { X: 16, Y: 12 },
      status: "UNCLAIMED",
      version: 1,
      deps: ["foundation-1"],
    },
    {
      id: "dome-cap",
      type: "dome",
      site: "lunar",
      pos: { X: 10, Y: 16 },
      status: "UNCLAIMED",
      version: 1,
      deps: ["wall-1", "wall-2"],
    },
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
