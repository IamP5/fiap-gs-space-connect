// transition.test.ts — pure camera-transition math for the unified driver (Epic 04
// P4). The driver itself owns the live camera (untestable in node), but its SHAPE is
// pure: poseFor picks the canonical settled pose for a (view, site), and
// matchCutEnvelope describes the surface→surface glare whip. Both are load-bearing —
// a wrong dest pose snaps the camera, a wrong envelope reveals the site swap — so we
// pin their contracts here.

import { describe, expect, it } from "vitest";
import { matchCutEnvelope, poseFor } from "./Scene3D";

describe("poseFor", () => {
  it("returns the same orbit pose regardless of site (orbit is site-agnostic)", () => {
    const a = poseFor("orbit", "lunar");
    const b = poseFor("orbit", "shackleton");
    expect(a.position.equals(b.position)).toBe(true);
    expect(a.target.equals(b.target)).toBe(true);
  });

  it("picks a distinct surface pose per site", () => {
    const lunar = poseFor("surface", "lunar");
    const shk = poseFor("surface", "shackleton");
    expect(lunar.position.equals(shk.position)).toBe(false);
  });

  it("seats the Shackleton camera lower + further back than lunar (shadows rake toward camera)", () => {
    const lunar = poseFor("surface", "lunar");
    const shk = poseFor("surface", "shackleton");
    expect(shk.position.y).toBeLessThan(lunar.position.y); // lower
    expect(shk.position.z).toBeGreaterThan(lunar.position.z); // further back (+z)
  });

  it("defaults the surface site to lunar", () => {
    expect(poseFor("surface").position.equals(poseFor("surface", "lunar").position)).toBe(true);
  });
});

describe("matchCutEnvelope", () => {
  it("glare is zero at both ends and peaks at the t=0.5 swap", () => {
    expect(matchCutEnvelope(0).glare).toBeCloseTo(0, 5);
    expect(matchCutEnvelope(1).glare).toBeCloseTo(0, 5);
    const mid = matchCutEnvelope(0.5).glare;
    expect(mid).toBeGreaterThan(matchCutEnvelope(0.35).glare);
    expect(mid).toBeGreaterThan(matchCutEnvelope(0.65).glare);
    expect(mid).toBeGreaterThan(0.9);
  });

  it("swaps the site only at/after the glare peak (so the swap is hidden)", () => {
    expect(matchCutEnvelope(0.49).swapped).toBe(false);
    expect(matchCutEnvelope(0.5).swapped).toBe(true);
    expect(matchCutEnvelope(0.8).swapped).toBe(true);
  });

  it("eases the path k monotonically 0→1 (settles cleanly, no overshoot)", () => {
    expect(matchCutEnvelope(0).k).toBeCloseTo(0, 5);
    expect(matchCutEnvelope(1).k).toBeCloseTo(1, 5);
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const k = matchCutEnvelope(t).k;
      expect(k).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(k).toBeLessThanOrEqual(1 + 1e-9);
      expect(k).toBeGreaterThanOrEqual(-1e-9);
      prev = k;
    }
  });

  it("lateral whip is exactly zero at both ends (camera never left off-axis)", () => {
    expect(matchCutEnvelope(0).whip).toBeCloseTo(0, 5);
    expect(matchCutEnvelope(1).whip).toBeCloseTo(0, 5);
    expect(Math.abs(matchCutEnvelope(0.5).whip)).toBeGreaterThan(0);
  });

  it("scales the whip by the whipUnits argument", () => {
    expect(matchCutEnvelope(0.5, 10).whip).toBeCloseTo(10, 5);
    expect(matchCutEnvelope(0.5, 4).whip).toBeCloseTo(4, 5);
  });

  it("clamps t outside [0,1]", () => {
    expect(matchCutEnvelope(-0.5).k).toBeCloseTo(0, 5);
    expect(matchCutEnvelope(2).k).toBeCloseTo(1, 5);
  });
});
