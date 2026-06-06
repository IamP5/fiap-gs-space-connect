// placement.test.ts — the drag-to-place transform is pure math (no three, no
// DOM), so it runs in vitest's node env. We assert the two invariants the ghost
// preview rides on: (1) the origin+rotation transform matches the Go
// blueprint.Place math, so the ghost and the server-injected tasks land on the
// same spot; (2) the envelope→footprint projection centres the ground quad on the
// task with half-extents from the envelope size.

import { describe, expect, it } from "vitest";
import {
  footprintOf,
  ghostTasks,
  placeRel,
  placementValid,
  type CatalogTask,
  type Footprint,
} from "./placement";
import { blueprintById } from "./blueprintCatalog";
import type { Vec2 } from "../types/wire";

const v = (X: number, Y: number): Vec2 => ({ X, Y });

describe("placeRel — origin + rotation transform", () => {
  it("translates a relative offset onto the origin with no rotation", () => {
    expect(placeRel(v(5, -3), v(10, 20), 0)).toEqual(v(15, 17));
  });

  it("rotates a relative offset about the origin (90°)", () => {
    // (16,0) rotated +90° → (0,16), matching the Go side's rx/ry math.
    const p = placeRel(v(16, 0), v(0, 0), Math.PI / 2);
    expect(p.X).toBeCloseTo(0, 6);
    expect(p.Y).toBeCloseTo(16, 6);
  });

  it("a relative (0,0) lands exactly on the origin under any rotation", () => {
    for (const rot of [0, Math.PI / 3, Math.PI, -1.2]) {
      expect(placeRel(v(0, 0), v(7, -4), rot)).toEqual(v(7, -4));
    }
  });
});

describe("footprintOf — envelope → ground footprint", () => {
  it("centres the footprint on the task position and sizes it from the envelope", () => {
    const task = {
      id: "t",
      type: "foundation",
      pos: v(10, 20),
      envelope: { center: { X: 0, Y: 0, Z: 0 }, size: { X: 8, Y: 6, Z: 2 } },
    };
    const f = footprintOf(task);
    expect(f.cx).toBe(10);
    expect(f.cy).toBe(20);
    expect(f.halfX).toBe(4);
    expect(f.halfY).toBe(3);
  });

  it("applies the envelope XY center offset to the footprint centre", () => {
    const task = {
      id: "t",
      type: "panel",
      pos: v(0, 0),
      envelope: { center: { X: 2, Y: -1, Z: 6 }, size: { X: 10, Y: 10, Z: 4 } },
    };
    const f = footprintOf(task);
    expect(f.cx).toBe(2);
    expect(f.cy).toBe(-1);
    expect(f.halfX).toBe(5);
    expect(f.halfY).toBe(5);
  });
});

describe("ghostTasks — instantiate a catalog blueprint for preview", () => {
  it("places every task at its rotated+translated origin", () => {
    const tasks: CatalogTask[] = [
      { id: "a", type: "foundation", rel: v(0, 0), envelope: { center: { X: 0, Y: 0, Z: 0 }, size: { X: 4, Y: 4, Z: 1 } } },
      { id: "b", type: "wall", rel: v(10, 0), envelope: { center: { X: 0, Y: 0, Z: 0 }, size: { X: 4, Y: 4, Z: 1 } } },
    ];
    const ghosts = ghostTasks(tasks, v(5, 5), Math.PI / 2);
    expect(ghosts[0].pos).toEqual(v(5, 5)); // (0,0) → origin
    // (10,0) rotated +90° about origin → (5, 15)
    expect(ghosts[1].pos.X).toBeCloseTo(5, 6);
    expect(ghosts[1].pos.Y).toBeCloseTo(15, 6);
  });

  it("mirrors the Go catalog: a placed solar-array's pad-2 footprint matches", () => {
    const solar = blueprintById("solar-array");
    expect(solar).toBeDefined();
    const ghosts = ghostTasks(solar!.tasks, v(0, 0), 0);
    const pad2 = ghosts.find((g) => g.id === "pad-2");
    expect(pad2).toBeDefined();
    expect(pad2!.pos).toEqual(v(16, 0));
    const f = footprintOf(pad2!);
    expect(f.halfX).toBe(8); // size.X 16 / 2
    expect(f.halfY).toBe(6); // size.Y 12 / 2
  });
});

describe("placementValid — client mirror of the server gate", () => {
  const solarGhosts = (origin: Vec2, rot = 0) =>
    ghostTasks(blueprintById("solar-array")!.tasks, origin, rot);

  it("accepts a placement well inside bounds with no obstacles", () => {
    expect(placementValid(solarGhosts(v(0, 0)), [])).toBeNull();
  });

  it("rejects a placement pushed out of bounds", () => {
    const reason = placementValid(solarGhosts(v(2000, 0)), []);
    expect(reason).not.toBeNull();
    expect(reason).toContain("out of bounds");
  });

  it("rejects a placement overlapping an existing structure", () => {
    // An obstacle footprint right where the solar array's pad-1 lands (-16,0).
    const obstacle: Footprint = { cx: -16, cy: 0, halfX: 6, halfY: 6 };
    const reason = placementValid(solarGhosts(v(0, 0)), [obstacle]);
    expect(reason).not.toBeNull();
    expect(reason).toContain("overlaps");
  });

  it("allows a placement clear of a distant obstacle", () => {
    const farObstacle: Footprint = { cx: 120, cy: 120, halfX: 6, halfY: 6 };
    expect(placementValid(solarGhosts(v(0, 0)), [farObstacle])).toBeNull();
  });
});
