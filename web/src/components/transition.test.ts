
import { describe, expect, it } from "vitest";
import { poseFor, traverseEnvelope } from "./Scene3D";

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

  it("frames the Shackleton crater: a distinct above-ground pose aimed into the bowl", () => {
    const lunar = poseFor("surface", "lunar");
    const shk = poseFor("surface", "shackleton");
    expect(shk.position.equals(lunar.position)).toBe(false);
    expect(shk.position.y).toBeGreaterThan(0);
    expect(shk.target.z).toBeLessThan(0);
  });

  it("defaults the surface site to lunar", () => {
    expect(poseFor("surface").position.equals(poseFor("surface", "lunar").position)).toBe(true);
  });
});

describe("traverseEnvelope", () => {
  it("dust veil is zero at both ends and peaks at the t=0.5 swap", () => {
    expect(traverseEnvelope(0).veil).toBeCloseTo(0, 5);
    expect(traverseEnvelope(1).veil).toBeCloseTo(0, 5);
    const mid = traverseEnvelope(0.5).veil;
    expect(mid).toBeGreaterThan(traverseEnvelope(0.35).veil);
    expect(mid).toBeGreaterThan(traverseEnvelope(0.65).veil);
    expect(mid).toBeGreaterThanOrEqual(0.99);
  });

  it("swaps the site only at/after the veil peak (so the swap is hidden)", () => {
    expect(traverseEnvelope(0.49).swapped).toBe(false);
    expect(traverseEnvelope(0.5).swapped).toBe(true);
    expect(traverseEnvelope(0.8).swapped).toBe(true);
  });

  it("eases the path k monotonically 0→1 (settles cleanly, no overshoot)", () => {
    expect(traverseEnvelope(0).k).toBeCloseTo(0, 5);
    expect(traverseEnvelope(1).k).toBeCloseTo(1, 5);
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const k = traverseEnvelope(t).k;
      expect(k).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(k).toBeLessThanOrEqual(1 + 1e-9);
      expect(k).toBeGreaterThanOrEqual(-1e-9);
      prev = k;
    }
  });

  it("clamps t outside [0,1]", () => {
    expect(traverseEnvelope(-0.5).k).toBeCloseTo(0, 5);
    expect(traverseEnvelope(-0.5).veil).toBeCloseTo(0, 5);
    expect(traverseEnvelope(2).k).toBeCloseTo(1, 5);
    expect(traverseEnvelope(2).veil).toBeCloseTo(0, 5);
  });
});
