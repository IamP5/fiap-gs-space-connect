// Dev mock — only used when VITE_MOCK=1. Lets the UI be seen with no backend.
// Kept clearly separated from the live WebSocket path. This is a single static
// snapshot exercising all three task statuses, an alive + a dead rover, and a
// lease beam (rover R1 holds wall-1, which is LEASED to it).

import type { EarthUplink, Snapshot } from "../types/wire";

export const MOCK_SNAPSHOT: Snapshot = {
  type: "snapshot",
  connected: true,
  at: 5000,
  rovers: [
    { id: "R1", pos: { X: 12, Y: 8 }, battery: 0.82, alive: true, load: 1, task: "wall-1" },
    { id: "R2", pos: { X: 4, Y: 14 }, battery: 0.45, alive: true, load: 0 },
    { id: "R3", pos: { X: 18, Y: 3 }, battery: 0.0, alive: false, load: 0 },
  ],
  tasks: [
    {
      id: "foundation-1",
      type: "foundation",
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
            map: "/assets/textures/rock_boulder_dry_diff_512.jpg",
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
      ],
    },
    {
      id: "wall-1",
      type: "wall",
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
