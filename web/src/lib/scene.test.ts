// scene.test.ts — the world→3D mapping is pure math (no three, no DOM), so it
// runs in vitest's node env. We assert the framing invariants that make the
// hardened click-to-kill possible: the SAME map positions both the rendered
// rover and its raycast hit-proxy, so they can never drift apart.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SITE_FRAME,
  MOON_POSITION,
  MOON_RADIUS,
  REAL_METERS,
  SCENE_UNITS_PER_METER,
  SITE_FRAMES,
  computeBounds,
  isBuilt,
  latLonToGlobeNormal,
  latLonToGlobePoint,
  siteMap,
  tierHeight,
  tierOf,
} from "./scene";
import type { Vec2 } from "../types/wire";

const v = (X: number, Y: number): Vec2 => ({ X, Y });

// Small vector helpers for the globe-marker visibility assertions below.
const unit = (a: readonly number[]): number[] => {
  const m = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / m, a[1] / m, a[2] / m];
};
const dot = (a: readonly number[], b: readonly number[]): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

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

describe("siteMap", () => {
  it("recenters the site origin (cx,cy) onto the scene origin", () => {
    const site = { cx: 5, cy: 5, rot: 0, worksiteUnitsToMeters: 1 };
    const m = siteMap(site);
    const mid = m.at(v(5, 5));
    expect(mid.x).toBeCloseTo(0, 9);
    expect(mid.z).toBeCloseTo(0, 9);
    expect(mid.y).toBe(0);
  });

  it("maps world +Y to scene -z (away from a +z camera)", () => {
    const m = siteMap(DEFAULT_SITE_FRAME);
    const near = m.at(v(0, 0));
    const far = m.at(v(0, 10));
    expect(far.z).toBeLessThan(near.z);
  });

  it("uses the FIXED real-meters scale, NOT a fit-to-bbox autoscale", () => {
    // worksiteUnitsToMeters=1 ⇒ scale is exactly SCENE_UNITS_PER_METER, the same
    // regardless of how spread out the worksite is (no autoscale).
    const m = siteMap({ cx: 0, cy: 0, rot: 0, worksiteUnitsToMeters: 1 });
    expect(m.scale).toBeCloseTo(SCENE_UNITS_PER_METER, 9);
    // A 100-unit world span projects to 100·scale scene units (fixed), not capped.
    const a = m.at(v(0, 0));
    const b = m.at(v(100, 0));
    expect(Math.abs(b.x - a.x)).toBeCloseTo(100 * SCENE_UNITS_PER_METER, 6);
  });

  it("DEFAULT_SITE_FRAME scale is SCENE_UNITS_PER_METER · worksiteUnitsToMeters", () => {
    const m = siteMap(DEFAULT_SITE_FRAME);
    expect(m.scale).toBeCloseTo(
      SCENE_UNITS_PER_METER * DEFAULT_SITE_FRAME.worksiteUnitsToMeters,
      9,
    );
  });

  it("worksiteUnitsToMeters scales the whole site uniformly", () => {
    const half = siteMap({ ...DEFAULT_SITE_FRAME, worksiteUnitsToMeters: 0.5 });
    expect(half.scale).toBeCloseTo(SCENE_UNITS_PER_METER * 0.5, 9);
    const p = half.at(v(10, 0));
    expect(p.x).toBeCloseTo(10 * SCENE_UNITS_PER_METER * 0.5, 6);
  });

  it("uses one uniform scale shared by render and hit-proxy", () => {
    const m = siteMap(DEFAULT_SITE_FRAME);
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
    // Round-trips even with a non-trivial frame (offset center + rotation), which
    // is exactly what drag-to-place + the raycast hit-proxy depend on.
    const m = siteMap({ cx: 3, cy: -4, rot: 0.3, worksiteUnitsToMeters: 0.8 });
    for (const p of [v(3, 7), v(-4, 12), v(0, 0), v(10, 20)]) {
      const s = m.at(p);
      const back = m.invert(s.x, s.z);
      expect(back.X).toBeCloseTo(p.X, 6);
      expect(back.Y).toBeCloseTo(p.Y, 6);
    }
  });

  it("believable relative sizes — launcher towers ~60:1 over an astronaut", () => {
    const launcher = REAL_METERS.mobileLauncher * SCENE_UNITS_PER_METER;
    const astronaut = REAL_METERS.astronaut * SCENE_UNITS_PER_METER;
    expect(launcher / astronaut).toBeCloseTo(60, 6);
    expect(astronaut).toBeLessThan(launcher); // no giant astronaut
  });
});

describe("SITE_FRAMES (two-site surface, Epic 04 P2)", () => {
  it("DEFAULT_SITE_FRAME aliases the lunar site (back-compat)", () => {
    expect(DEFAULT_SITE_FRAME).toBe(SITE_FRAMES.lunar);
  });

  it("keeps the tuned worksiteUnitsToMeters (2.5) on both sites, not the stale 1.0", () => {
    expect(SITE_FRAMES.lunar.worksiteUnitsToMeters).toBeCloseTo(2.5, 9);
    expect(SITE_FRAMES.shackleton.worksiteUnitsToMeters).toBeCloseTo(2.5, 9);
  });

  it("recenters each site's own origin to the scene origin", () => {
    // siteMap(frame) projects the frame's (cx,cy) world point to the scene origin,
    // so each site composes to the same hero spot regardless of its world coords.
    for (const key of ["lunar", "shackleton"] as const) {
      const f = SITE_FRAMES[key];
      const center = siteMap(f).at({ X: f.cx, Y: f.cy });
      expect(center.x).toBeCloseTo(0, 6);
      expect(center.z).toBeCloseTo(0, 6);
    }
  });

  it("shackleton sits at a distinct world origin (cx≈400) from lunar", () => {
    expect(SITE_FRAMES.lunar.cx).toBe(0);
    expect(SITE_FRAMES.shackleton.cx).toBe(400);
  });

  it("shackleton reads dimmer + lower (grazing pole sun) than lunar", () => {
    expect(SITE_FRAMES.shackleton.sunIntensity).toBeLessThan(
      SITE_FRAMES.lunar.sunIntensity,
    );
    // Pole sun: low elevation (small Y vs large |X|,|Z|) → long raking light.
    const s = SITE_FRAMES.shackleton.sunDir;
    expect(s[1]).toBeLessThan(Math.abs(s[0]));
    expect(s[1]).toBeLessThan(Math.abs(s[2]));
  });

  it("each site carries its own scenery pieces (reusing GLBs, no empties)", () => {
    expect(SITE_FRAMES.lunar.pieces.length).toBeGreaterThan(0);
    expect(SITE_FRAMES.shackleton.pieces.length).toBeGreaterThan(0);
    // Same GLBs reused across sites (no new assets) — every Shackleton modelRef
    // also appears in the lunar set.
    const lunarRefs = new Set(SITE_FRAMES.lunar.pieces.map((p) => p.modelRef));
    for (const p of SITE_FRAMES.shackleton.pieces) {
      expect(lunarRefs.has(p.modelRef)).toBe(true);
    }
  });
});

describe("latLonToGlobePoint / latLonToGlobeNormal (orbit site markers, Epic 04 P3)", () => {
  const dist = (p: readonly number[], q: readonly number[]) =>
    Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

  it("seats every point exactly on the globe surface (radius from MOON_POSITION)", () => {
    for (const [lat, lon] of [
      [0, 0],
      [0.7, 23.5],
      [-35, 20],
      [45, -120],
      [89, 200],
    ] as const) {
      const p = latLonToGlobePoint(lat, lon);
      expect(dist(p, MOON_POSITION)).toBeCloseTo(MOON_RADIUS, 6);
    }
  });

  it("normal is a unit vector pointing from the globe centre to the point", () => {
    const lat = -35,
      lon = 20;
    const n = latLonToGlobeNormal(lat, lon);
    expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 9);
    const p = latLonToGlobePoint(lat, lon);
    // point = centre + normal * radius (exact inverse relation).
    expect(p[0]).toBeCloseTo(MOON_POSITION[0] + n[0] * MOON_RADIUS, 6);
    expect(p[1]).toBeCloseTo(MOON_POSITION[1] + n[1] * MOON_RADIUS, 6);
    expect(p[2]).toBeCloseTo(MOON_POSITION[2] + n[2] * MOON_RADIUS, 6);
  });

  it("maps the poles to the polar (y) axis regardless of longitude/offset", () => {
    const north = latLonToGlobeNormal(90, 137);
    expect(north[1]).toBeCloseTo(1, 9);
    expect(north[0]).toBeCloseTo(0, 9);
    expect(north[2]).toBeCloseTo(0, 9);
    const south = latLonToGlobeNormal(-90, -42);
    expect(south[1]).toBeCloseTo(-1, 9);
  });

  it("the global longitude offset rotates points about the polar axis (y fixed)", () => {
    const a = latLonToGlobeNormal(10, 0, 0);
    const b = latLonToGlobeNormal(10, 0, 90);
    // Same latitude → same y; longitude offset only swings x/z.
    expect(b[1]).toBeCloseTo(a[1], 9);
    expect(b[0]).not.toBeCloseTo(a[0], 3);
  });

  it("seats BOTH site markers on the lit AND camera-facing near hemisphere (#131)", () => {
    // The orbit camera berths up-and-right of the Moon; the decoupled orbit sun is
    // forward/up. A marker is visible+lit only if its normal has a positive dot with
    // BOTH the camera direction and the sun direction. This is the #131 lit-
    // hemisphere requirement, carried forward to both markers (this slice supersedes
    // the single-marker #131 reseat).
    const camDir = unit([264, 85, 26]); // ORBIT_POSE offset off MOON_POSITION
    const sunDir = unit([
      806 - MOON_POSITION[0],
      795 - MOON_POSITION[1],
      -6929 - MOON_POSITION[2],
    ]); // ORBIT_SUN_POSITION − MOON_POSITION
    const sites: [number, number][] = [
      [0.7, 23.5], // Lunar Base
      [-35, 20], // Shackleton (art-directed southern seat)
    ];
    for (const [lat, lon] of sites) {
      const n = latLonToGlobeNormal(lat, lon);
      expect(dot(n, camDir)).toBeGreaterThan(0.1); // camera-facing
      expect(dot(n, sunDir)).toBeGreaterThan(0.05); // lit
    }
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
