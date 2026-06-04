// format.test.ts — pure clamp/percentage helpers (vitest node env).

import { describe, expect, it } from "vitest";
import { batteryPercent, clamp01 } from "./format";

describe("clamp01", () => {
  it("passes through values already in range", () => {
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(1)).toBe(1);
  });

  it("clamps below 0 and above 1", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(1.7)).toBe(1);
  });

  it("treats NaN as empty (0), never NaN out", () => {
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe("batteryPercent", () => {
  it("rounds a clamped fraction to a whole percent", () => {
    expect(batteryPercent(0.824)).toBe(82);
    expect(batteryPercent(0.826)).toBe(83);
  });

  it("clamps out-of-range input before formatting", () => {
    expect(batteryPercent(-1)).toBe(0);
    expect(batteryPercent(2)).toBe(100);
    expect(batteryPercent(Number.NaN)).toBe(0);
  });
});
