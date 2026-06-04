// earth.test.ts — pure Earth-uplink derivations (vitest node env).

import { describe, expect, it } from "vitest";
import { earthLagMs, formatLag, taskProgress, LIVE_THRESHOLD_MS } from "./earth";
import type { TaskView } from "../types/wire";

function task(id: string, status: TaskView["status"]): TaskView {
  return { id, type: "wall", pos: { X: 0, Y: 0 }, status, version: 1 };
}

describe("earthLagMs", () => {
  it("is the positive difference snapshotAt - earthAt", () => {
    expect(earthLagMs(5000, 3200)).toBe(1800);
  });

  it("clamps to 0 when earth leads or matches the live world", () => {
    expect(earthLagMs(3000, 3000)).toBe(0);
    expect(earthLagMs(3000, 4000)).toBe(0);
  });

  it("treats missing stamps as live (0)", () => {
    expect(earthLagMs(null, 3000)).toBe(0);
    expect(earthLagMs(5000, null)).toBe(0);
    expect(earthLagMs(null, null)).toBe(0);
  });
});

describe("formatLag", () => {
  it("reads 'live' at or below the live threshold", () => {
    expect(formatLag(0)).toBe("live");
    expect(formatLag(LIVE_THRESHOLD_MS)).toBe("live");
  });

  it("shows sub-second lag in ms", () => {
    expect(formatLag(420)).toBe("+420ms behind");
  });

  it("shows >=1s lag in seconds with one decimal", () => {
    expect(formatLag(1800)).toBe("+1.8s behind");
    expect(formatLag(3000)).toBe("+3.0s behind");
  });
});

describe("taskProgress", () => {
  it("counts DONE tasks against the total", () => {
    expect(
      taskProgress([task("a", "DONE"), task("b", "LEASED"), task("c", "DONE")]),
    ).toEqual({ done: 2, total: 3 });
  });

  it("is {0,0} for an empty list", () => {
    expect(taskProgress([])).toEqual({ done: 0, total: 0 });
  });
});
