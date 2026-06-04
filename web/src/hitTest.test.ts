// hitTest.test.ts — the "no missed clicks" guarantee.
//
// pickRover is pure math (no DOM), so these run in vitest's node env. We build
// tiny snapshots with known world positions, compute the expected screen coord
// via the SAME `project` the production click path uses, then assert the pick.

import { describe, expect, it } from "vitest";
import { ROVER_R, pickRover, project } from "./hitTest";
import type { Snapshot } from "./types";

const CSS_W = 800;
const CSS_H = 600;

function snap(rovers: Snapshot["rovers"], tasks: Snapshot["tasks"] = []): Snapshot {
  return { type: "snapshot", connected: true, at: 0, rovers, tasks };
}

function rover(id: string, X: number, Y: number): Snapshot["rovers"][number] {
  return { id, pos: { X, Y }, battery: 1, alive: true, load: 0 };
}

function screenOf(s: Snapshot, id: string): { x: number; y: number } {
  const r = s.rovers.find((rr) => rr.id === id)!;
  const proj = project(
    s.rovers.map((rr) => rr.pos),
    s.tasks.map((t) => t.pos),
    CSS_W,
    CSS_H,
  );
  return { x: proj.tx(r.pos), y: proj.ty(r.pos) };
}

describe("pickRover", () => {
  it("picks a rover when the click is exactly on its projected position", () => {
    const s = snap([rover("R1", 5, 5), rover("R2", 15, 12)]);
    const p = screenOf(s, "R1");
    expect(pickRover(s, p.x, p.y, CSS_W, CSS_H)).toBe("R1");
  });

  it("picks a rover when the click is within the forgiving radius", () => {
    const s = snap([rover("R1", 5, 5), rover("R2", 15, 12)]);
    const p = screenOf(s, "R2");
    // Just inside the default radius (ROVER_R + 12) — still a hit.
    expect(pickRover(s, p.x + (ROVER_R + 10), p.y, CSS_W, CSS_H)).toBe("R2");
  });

  it("returns null when the click is far from every rover", () => {
    const s = snap([rover("R1", 5, 5), rover("R2", 15, 12)]);
    const p = screenOf(s, "R1");
    // Well outside the radius.
    expect(pickRover(s, p.x + 200, p.y + 200, CSS_W, CSS_H)).toBeNull();
  });

  it("picks the nearer of two rovers", () => {
    const s = snap([rover("R1", 2, 2), rover("R2", 18, 18)]);
    const a = screenOf(s, "R1");
    const b = screenOf(s, "R2");
    // Midpoint nudged toward R1 → R1 should win.
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const towardA_x = mx + (a.x - mx) * 0.6;
    const towardA_y = my + (a.y - my) * 0.6;
    expect(pickRover(s, towardA_x, towardA_y, CSS_W, CSS_H, 10_000)).toBe("R1");
  });

  it("returns null when clicking empty space", () => {
    const s = snap([rover("R1", 5, 5)]);
    expect(pickRover(s, 0, 0, CSS_W, CSS_H)).toBeNull();
  });
});
