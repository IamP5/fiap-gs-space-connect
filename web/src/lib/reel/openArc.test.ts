// openArc.test.ts — the pure path/easing math for the orbit-open camera-arc (#158).
//
// Asserts the "lost in the dark, found by the sun" shape: the camera starts BACK
// from ORBIT_POSE on the dark-limb side (sun off-frame), wanders during the drift
// phase, then ARCS monotonically back to the settled pose (offset 0) so the sun
// crests in — start ≠ mid ≠ end, end == 0. Runs in vitest's node env (no DOM, no
// three, no React).

import { describe, expect, it } from "vitest";
import {
  DRIFT_FRACTION,
  DRIFT_SWAY_RAD,
  OPEN_AZIMUTH_RAD,
  OPEN_CUE_KEY,
  OPEN_MS,
  SWAY_PEAK,
  alignOpenCameraElevation,
  isOpenCue,
  isRevealing,
  openAzimuthOffset,
} from "./openArc";

const noMods = { metaKey: false, ctrlKey: false, altKey: false };

describe("openArc — orbit-open camera-arc path", () => {
  it("uses the default orbit elevation while preserving the live horizontal berth", () => {
    const liveOffset = [310, 24, -75] as const;
    const defaultOffset = [264, 85, 26] as const;

    expect(alignOpenCameraElevation(liveOffset, defaultOffset)).toEqual([310, 85, -75]);
    expect(liveOffset).toEqual([310, 24, -75]);
  });

  it("starts back on the dark-limb side (negative offset, sun off-frame)", () => {
    // t=0: at/near the peak dark-limb offset (negative azimuth = away from the sun).
    expect(openAzimuthOffset(0)).toBeLessThan(0);
    // Magnitude is at least the configured peak (drift sub-sway may push it further).
    expect(Math.abs(openAzimuthOffset(0))).toBeGreaterThanOrEqual(OPEN_AZIMUTH_RAD - 1e-9);
  });

  it("settles EXACTLY on ORBIT_POSE (offset 0) at t=1", () => {
    expect(openAzimuthOffset(1)).toBeCloseTo(0, 10);
  });

  it("clamps an out-of-range t (never pushes past the framed pose)", () => {
    // Below 0 clamps to the t=0 value; above 1 clamps to the settled pose.
    expect(openAzimuthOffset(-1)).toBeCloseTo(openAzimuthOffset(0), 10);
    expect(openAzimuthOffset(2)).toBeCloseTo(0, 10);
  });

  it("drifts then arcs: start ≠ mid ≠ end (three distinct phases)", () => {
    const start = openAzimuthOffset(0);
    const mid = openAzimuthOffset((DRIFT_FRACTION + 1) / 2); // mid of the reveal arc
    const end = openAzimuthOffset(1);
    expect(start).not.toBeCloseTo(mid, 4);
    expect(mid).not.toBeCloseTo(end, 4);
    expect(start).not.toBeCloseTo(end, 4);
  });

  it("holds the wandering motion longer before its gentle turnaround", () => {
    const oldSymmetricPeak = DRIFT_FRACTION * 0.5;
    const latePeak = DRIFT_FRACTION * SWAY_PEAK;

    expect(SWAY_PEAK).toBeGreaterThan(0.5);
    expect(openAzimuthOffset(latePeak)).toBeCloseTo(
      -OPEN_AZIMUTH_RAD - DRIFT_SWAY_RAD,
      10,
    );
    expect(openAzimuthOffset(latePeak)).toBeLessThan(openAzimuthOffset(oldSymmetricPeak));
    expect(openAzimuthOffset(latePeak - 0.001)).toBeGreaterThan(openAzimuthOffset(latePeak));
    expect(openAzimuthOffset(latePeak + 0.001)).toBeGreaterThan(openAzimuthOffset(latePeak));
  });

  it("the reveal arc is monotone non-decreasing toward the settled pose", () => {
    // Across the reveal phase the (negative) offset rises monotonically toward 0,
    // so the sun crests in smoothly with no back-swing/overshoot.
    let prev = openAzimuthOffset(DRIFT_FRACTION);
    for (let i = 1; i <= 20; i++) {
      const t = DRIFT_FRACTION + ((1 - DRIFT_FRACTION) * i) / 20;
      const cur = openAzimuthOffset(t);
      expect(cur).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = cur;
    }
    // And it never overshoots past the settled pose (0) into the sun-ward side.
    expect(prev).toBeLessThanOrEqual(1e-9);
  });

  it("labels the two beats: wandering before DRIFT_FRACTION, revealing after", () => {
    expect(isRevealing(DRIFT_FRACTION / 2)).toBe(false);
    expect(isRevealing(DRIFT_FRACTION)).toBe(false);
    expect(isRevealing((DRIFT_FRACTION + 1) / 2)).toBe(true);
    expect(isRevealing(1)).toBe(true);
  });

  it("runs for a sane, slow duration", () => {
    expect(OPEN_MS).toBeGreaterThan(4000);
    expect(OPEN_MS).toBeLessThan(20000);
    expect(DRIFT_FRACTION).toBeGreaterThan(0);
    expect(DRIFT_FRACTION).toBeLessThan(1);
  });
});

describe("openArc — open-cue keybind", () => {
  it("matches the bare open key (either case)", () => {
    expect(isOpenCue({ key: OPEN_CUE_KEY, ...noMods })).toBe(true);
    expect(isOpenCue({ key: OPEN_CUE_KEY.toUpperCase(), ...noMods })).toBe(true);
  });

  it("ignores other keys and modifier combos", () => {
    expect(isOpenCue({ key: "k", ...noMods })).toBe(false);
    expect(isOpenCue({ key: OPEN_CUE_KEY, metaKey: true, ctrlKey: false, altKey: false })).toBe(
      false,
    );
    expect(isOpenCue({ key: OPEN_CUE_KEY, metaKey: false, ctrlKey: true, altKey: false })).toBe(
      false,
    );
  });

  it("does not collide with the other cinematic keys", () => {
    // The full taken set this slice must avoid (one source of truth per slice).
    const taken = ["r", "k", "h", "]", "[", "m", "b", "Escape", "l"];
    expect(taken).not.toContain(OPEN_CUE_KEY);
  });
});
