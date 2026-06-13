import { describe, expect, it } from "vitest";
import {
  EXPOSURE_FAR,
  EXPOSURE_NEAR,
  IDLE_FADE_MS,
  IDLE_PERIOD_MS,
  IDLE_SWAY_RAD,
  PARALLAX_GAIN,
  PARALLAX_MAX_RAD,
  PARALLAX_SETTLE_EPS,
  advanceParallax,
  idleSwayOffset,
  isDrifting,
  zoomExposure,
} from "./cameraFeel";

describe("idleSwayOffset", () => {
  it("is zero before the drift starts (non-positive elapsed)", () => {
    expect(idleSwayOffset(0)).toBe(0);
    expect(idleSwayOffset(-100)).toBe(0);
  });

  it("starts near zero at the very start of the drift (sin(0))", () => {
    expect(idleSwayOffset(1)).toBeCloseTo(0, 3);
  });

  it("never exceeds the peak sway amplitude", () => {
    for (let t = IDLE_FADE_MS; t <= IDLE_FADE_MS + IDLE_PERIOD_MS * 3; t += 137) {
      expect(Math.abs(idleSwayOffset(t))).toBeLessThanOrEqual(IDLE_SWAY_RAD + 1e-9);
    }
  });

  it("reaches full amplitude at the quarter-period once faded in", () => {
    const peak = IDLE_PERIOD_MS / 4;
    expect(peak).toBeGreaterThanOrEqual(IDLE_FADE_MS);
    expect(idleSwayOffset(peak)).toBeCloseTo(IDLE_SWAY_RAD, 6);
  });

  it("ramps amplitude up during the fade-in window", () => {
    const half = IDLE_FADE_MS / 2;
    expect(Math.abs(idleSwayOffset(half))).toBeLessThanOrEqual(IDLE_SWAY_RAD * 0.5 + 1e-9);
  });
});

describe("isDrifting", () => {
  it("is false until idle time has elapsed", () => {
    expect(isDrifting(0)).toBe(false);
    expect(isDrifting(-1)).toBe(false);
  });
  it("is true once any idle time has elapsed", () => {
    expect(isDrifting(1)).toBe(true);
  });
});

describe("zoomExposure", () => {
  it("lifts to the near exposure when pushed all the way in", () => {
    expect(zoomExposure(10, 10, 40)).toBeCloseTo(EXPOSURE_NEAR, 6);
  });

  it("settles to the far exposure when pulled all the way out", () => {
    expect(zoomExposure(40, 10, 40)).toBeCloseTo(EXPOSURE_FAR, 6);
  });

  it("is monotonic: closer is never darker than farther", () => {
    const near = zoomExposure(15, 10, 40);
    const mid = zoomExposure(25, 10, 40);
    const far = zoomExposure(35, 10, 40);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
  });

  it("clamps distances outside the band", () => {
    expect(zoomExposure(-100, 10, 40)).toBeCloseTo(EXPOSURE_NEAR, 6);
    expect(zoomExposure(9999, 10, 40)).toBeCloseTo(EXPOSURE_FAR, 6);
  });

  it("returns the far exposure for a degenerate band", () => {
    expect(zoomExposure(50, 40, 40)).toBe(EXPOSURE_FAR);
    expect(zoomExposure(50, 40, 10)).toBe(EXPOSURE_FAR);
  });
});

describe("advanceParallax", () => {
  it("trails opposite the camera azimuth (sign flips)", () => {
    expect(advanceParallax(0, 0.1, 1 / 60)).toBeLessThan(0);
    expect(advanceParallax(0, -0.1, 1 / 60)).toBeGreaterThan(0);
  });

  it("decays toward neutral when the camera is still", () => {
    let off = 0.05;
    for (let i = 0; i < 5; i++) {
      const next = advanceParallax(off, 0, 1 / 60);
      expect(Math.abs(next)).toBeLessThan(Math.abs(off));
      off = next;
    }
  });

  it("settles below the epsilon after the camera stops", () => {
    let off = PARALLAX_MAX_RAD;
    for (let i = 0; i < 240; i++) off = advanceParallax(off, 0, 1 / 60);
    expect(Math.abs(off)).toBeLessThan(PARALLAX_SETTLE_EPS);
  });

  it("clamps to ±PARALLAX_MAX_RAD under a fast continuous spin", () => {
    let off = 0;
    for (let i = 0; i < 200; i++) off = advanceParallax(off, 0.2, 1 / 60);
    expect(off).toBeGreaterThanOrEqual(-PARALLAX_MAX_RAD);
    expect(off).toBeLessThanOrEqual(PARALLAX_MAX_RAD);
    expect(off).toBeCloseTo(-PARALLAX_MAX_RAD, 6);
  });

  it("treats a non-positive dt as no relax (pure nudge)", () => {
    expect(advanceParallax(0.01, 0.1, 0)).toBeCloseTo(0.01 - PARALLAX_GAIN * 0.1, 10);
    expect(advanceParallax(0.01, 0.1, -5)).toBeCloseTo(0.01 - PARALLAX_GAIN * 0.1, 10);
  });
});
