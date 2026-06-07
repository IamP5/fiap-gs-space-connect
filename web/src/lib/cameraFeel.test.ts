import { describe, expect, it } from "vitest";
import {
  EXPOSURE_FAR,
  EXPOSURE_NEAR,
  IDLE_FADE_MS,
  IDLE_PERIOD_MS,
  IDLE_SWAY_RAD,
  PARALLAX_MAX_RAD,
  idleSwayOffset,
  isDrifting,
  parallaxOffset,
  zoomExposure,
} from "./cameraFeel";

describe("idleSwayOffset", () => {
  it("is zero before the drift starts (non-positive elapsed)", () => {
    expect(idleSwayOffset(0)).toBe(0);
    expect(idleSwayOffset(-100)).toBe(0);
  });

  it("starts near zero at the very start of the drift (sin(0))", () => {
    // Tiny positive elapsed → phase≈0 → sin≈0, so the sway eases on from 0.
    expect(idleSwayOffset(1)).toBeCloseTo(0, 3);
  });

  it("never exceeds the peak sway amplitude", () => {
    // Once faded in, |offset| ≤ IDLE_SWAY_RAD across a full period and beyond.
    for (let t = IDLE_FADE_MS; t <= IDLE_FADE_MS + IDLE_PERIOD_MS * 3; t += 137) {
      expect(Math.abs(idleSwayOffset(t))).toBeLessThanOrEqual(IDLE_SWAY_RAD + 1e-9);
    }
  });

  it("reaches full amplitude at the quarter-period once faded in", () => {
    // Pick an elapsed that is past the fade AND lands on a sine peak: phase=π/2
    // happens at t = IDLE_PERIOD_MS/4. With period 16s that is 4s ≥ fade (2s),
    // so the fade factor is 1 and sin = 1 → full amplitude.
    const peak = IDLE_PERIOD_MS / 4;
    expect(peak).toBeGreaterThanOrEqual(IDLE_FADE_MS);
    expect(idleSwayOffset(peak)).toBeCloseTo(IDLE_SWAY_RAD, 6);
  });

  it("ramps amplitude up during the fade-in window", () => {
    // Half-way through the fade, the envelope is ~0.5, so the offset magnitude is
    // at most half the peak regardless of the sine phase.
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

describe("parallaxOffset", () => {
  it("is zero at rest", () => {
    expect(parallaxOffset(0)).toBeCloseTo(0, 10);
  });

  it("moves the sky opposite the camera azimuth (negative sign)", () => {
    expect(parallaxOffset(0.1)).toBeLessThan(0);
    expect(parallaxOffset(-0.1)).toBeGreaterThan(0);
  });

  it("clamps to ±PARALLAX_MAX_RAD for large drags", () => {
    expect(parallaxOffset(100)).toBe(-PARALLAX_MAX_RAD);
    expect(parallaxOffset(-100)).toBe(PARALLAX_MAX_RAD);
  });
});
