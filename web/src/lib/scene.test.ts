// scene.test.ts — the world→3D mapping is pure math (no three, no DOM), so it
// runs in vitest's node env. We assert the framing invariants that make the
// hardened click-to-kill possible: the SAME map positions both the rendered
// rover and its raycast hit-proxy, so they can never drift apart.

import { describe, expect, it } from "vitest";
import {
  GROUND_MARGIN,
  GROUND_SPAN,
  computeBounds,
  isBuilt,
  sceneMap,
  tierHeight,
  tierOf,
} from "./scene";
import type { Vec2 } from "../types/wire";

const v = (X: number, Y: number): Vec2 => ({ X, Y });

describe("computeBounds", () => {
  it("returns a unit box for no points", () => {
    expect(computeBounds([])).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
  });

  it("nudges a degenerate (single-point) span out by 1 unit", () => {
    const b = computeBounds([v(5, 5)]);
    expect(b.maxX - b.minX).toBeGreaterThanOrEqual(1);
    expect(b.maxY - b.minY).toBeGreaterThanOrEqual(1);
  });

  it("covers all points", () => {
    const b = computeBounds([v(2, 3), v(10, 1), v(6, 9)]);
    expect(b.minX).toBe(2);
    expect(b.maxX).toBe(10);
    expect(b.minY).toBe(1);
    expect(b.maxY).toBe(9);
  });
});

describe("sceneMap", () => {
  it("centers the worksite on the origin", () => {
    const rovers = [v(0, 0), v(10, 10)];
    const m = sceneMap(rovers, []);
    // The midpoint (5,5) must map to the scene origin on the ground plane.
    const mid = m.at(v(5, 5));
    expect(mid.x).toBeCloseTo(0, 6);
    expect(mid.z).toBeCloseTo(0, 6);
    expect(mid.y).toBe(0);
  });

  it("maps world +Y to scene -z (away from a +z camera)", () => {
    const m = sceneMap([v(0, 0), v(0, 10)], []);
    const near = m.at(v(0, 0));
    const far = m.at(v(0, 10));
    expect(far.z).toBeLessThan(near.z);
  });

  it("fits the worksite inside the ground span with margin", () => {
    const m = sceneMap([v(0, 0), v(100, 0)], []);
    const a = m.at(v(0, 0));
    const b = m.at(v(100, 0));
    const widthUsed = Math.abs(b.x - a.x);
    expect(widthUsed).toBeLessThanOrEqual(GROUND_SPAN - GROUND_MARGIN * 2 + 1e-6);
  });

  it("uses one uniform scale shared by render and hit-proxy", () => {
    const m = sceneMap([v(0, 0), v(10, 20)], []);
    // A point and the same point at a height differ ONLY in y — same x/z, proving
    // the rendered mesh and an elevated hit-proxy stay vertically aligned.
    const ground = m.at(v(7, 3), 0);
    const raised = m.at(v(7, 3), 5);
    expect(raised.x).toBeCloseTo(ground.x, 9);
    expect(raised.z).toBeCloseTo(ground.z, 9);
    expect(raised.y).toBe(5);
    expect(m.scale).toBeGreaterThan(0);
  });

  it("invert is the exact inverse of at on the ground plane (round-trip)", () => {
    const m = sceneMap([v(0, 0), v(10, 20)], [v(-5, 8)]);
    for (const p of [v(3, 7), v(-4, 12), v(0, 0), v(10, 20)]) {
      const s = m.at(p);
      const back = m.invert(s.x, s.z);
      expect(back.X).toBeCloseTo(p.X, 6);
      expect(back.Y).toBeCloseTo(p.Y, 6);
    }
  });

  it("includes both rovers and tasks in the framing", () => {
    // A task far out widens the box, so a rover at the old edge is no longer at
    // the scene edge — proving tasks participate in the shared framing.
    const roversOnly = sceneMap([v(0, 0), v(10, 0)], []);
    const withTask = sceneMap([v(0, 0), v(10, 0)], [v(50, 0)]);
    const edgeOnly = roversOnly.at(v(10, 0)).x;
    const edgeWith = withTask.at(v(10, 0)).x;
    expect(Math.abs(edgeWith)).toBeLessThan(Math.abs(edgeOnly));
  });
});

describe("tierOf / tierHeight", () => {
  it("classifies the construction tiers from the task type", () => {
    expect(tierOf("foundation")).toBe("foundation");
    expect(tierOf("wall")).toBe("wall");
    expect(tierOf("dome")).toBe("dome");
    expect(tierOf("widget")).toBe("other");
  });

  it("stacks the tiers: foundation < wall < dome", () => {
    expect(tierHeight("foundation")).toBeLessThan(tierHeight("wall"));
    expect(tierHeight("wall")).toBeLessThan(tierHeight("dome"));
  });
});

describe("isBuilt", () => {
  it("is built only when the task is DONE (pure read of authoritative status)", () => {
    expect(isBuilt({ status: "DONE" })).toBe(true);
    expect(isBuilt({ status: "LEASED" })).toBe(false);
    expect(isBuilt({ status: "UNCLAIMED" })).toBe(false);
  });
});
