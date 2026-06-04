// Dev mock — only used when VITE_MOCK=1. Lets the UI be seen with no backend.
// Kept clearly separated from the live WebSocket path. This is a single static
// snapshot exercising all three task statuses, an alive + a dead rover, and a
// lease beam (rover R1 holds wall-1, which is LEASED to it).

import type { Snapshot } from "../types/wire";

export const MOCK_SNAPSHOT: Snapshot = {
  type: "snapshot",
  connected: true,
  at: 0,
  rovers: [
    { id: "R1", pos: { X: 12, Y: 8 }, battery: 0.82, alive: true, load: 1, task: "wall-1" },
    { id: "R2", pos: { X: 4, Y: 14 }, battery: 0.45, alive: true, load: 0 },
    { id: "R3", pos: { X: 18, Y: 3 }, battery: 0.0, alive: false, load: 0 },
  ],
  tasks: [
    { id: "foundation-1", type: "foundation", pos: { X: 6, Y: 6 }, status: "DONE", version: 3 },
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
