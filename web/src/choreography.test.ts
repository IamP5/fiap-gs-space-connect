// choreography.test.ts — pure logic for slice 06's TTL ring + transient beats.
//
// No DOM/canvas/rAF here: ringFraction/ringColor/activeBeats/beatLifetimeMs are
// pure math, so they run in vitest's node env exactly like hitTest.test.ts.

import { describe, expect, it } from "vitest";
import {
  type ActiveBeat,
  activeBeats,
  beatLifetimeMs,
  beatProgress,
  ringColor,
  ringFraction,
} from "./choreography";

describe("ringFraction", () => {
  it("is 1 when the lease was just renewed (at == base, full span ahead)", () => {
    // expiry = at + span → full ring.
    expect(ringFraction(100, 0, 100)).toBe(1);
  });

  it("decreases monotonically as `at` approaches `expiry`", () => {
    const span = 100;
    const expiry = 100;
    const quarter = ringFraction(expiry, 25, span);
    const half = ringFraction(expiry, 50, span);
    const threeQuarter = ringFraction(expiry, 75, span);
    expect(quarter).toBeCloseTo(0.75);
    expect(half).toBeCloseTo(0.5);
    expect(threeQuarter).toBeCloseTo(0.25);
    expect(quarter).toBeGreaterThan(half);
    expect(half).toBeGreaterThan(threeQuarter);
  });

  it("drains full → empty across the span", () => {
    expect(ringFraction(100, 0, 100)).toBe(1); // full
    expect(ringFraction(100, 100, 100)).toBe(0); // empty at expiry
  });

  it("clamps to [0, 1] (past expiry stays 0, future-renewed stays 1)", () => {
    expect(ringFraction(100, 200, 100)).toBe(0); // long past expiry
    expect(ringFraction(200, 0, 100)).toBe(1); // expiry beyond one span
  });

  it("treats a non-positive span as a full ring (no divide-by-zero)", () => {
    expect(ringFraction(100, 50, 0)).toBe(1);
    expect(ringFraction(100, 50, -10)).toBe(1);
  });
});

describe("ringColor", () => {
  it("is green while plenty of lease remains", () => {
    expect(ringColor(1)).toBe("#2ecc71");
    expect(ringColor(0.51)).toBe("#2ecc71");
  });

  it("shifts to amber in the mid band", () => {
    expect(ringColor(0.5)).toBe("#f5a623");
    expect(ringColor(0.21)).toBe("#f5a623");
  });

  it("alarms red near empty", () => {
    expect(ringColor(0.2)).toBe("#e74c3c");
    expect(ringColor(0)).toBe("#e74c3c");
  });
});

describe("beatLifetimeMs", () => {
  it("maps each known kind to its display lifetime", () => {
    expect(beatLifetimeMs("bid")).toBe(800);
    expect(beatLifetimeMs("won")).toBe(700);
    expect(beatLifetimeMs("solidify")).toBe(600);
  });

  it("gives unknown kinds a short, finite default", () => {
    expect(beatLifetimeMs("killed")).toBe(500);
    expect(beatLifetimeMs("whatever")).toBe(500);
  });
});

describe("activeBeats", () => {
  const beat = (kind: string, spawn: number): ActiveBeat => ({
    kind,
    spawn,
    at: 0,
  });

  it("keeps a beat that is still within its lifetime", () => {
    const beats = [beat("bid", 0)]; // bid lives 800ms
    expect(activeBeats(beats, 799)).toHaveLength(1);
  });

  it("drops a beat once it is past its lifetime", () => {
    const beats = [beat("bid", 0)];
    expect(activeBeats(beats, 800)).toHaveLength(0);
    expect(activeBeats(beats, 1200)).toHaveLength(0);
  });

  it("filters per-kind: a fresh bid survives while an old solidify is dropped", () => {
    const now = 650;
    const beats = [
      beat("bid", 0), // age 650 < 800 → keep
      beat("solidify", 0), // age 650 >= 600 → drop
      beat("won", 100), // age 550 < 700 → keep
    ];
    const out = activeBeats(beats, now);
    expect(out.map((b) => b.kind).sort()).toEqual(["bid", "won"]);
  });

  it("does not mutate the input array", () => {
    const beats = [beat("bid", 0), beat("solidify", 0)];
    activeBeats(beats, 10_000);
    expect(beats).toHaveLength(2);
  });
});

describe("beatProgress", () => {
  it("runs 0 → 1 across a beat's lifetime and clamps beyond it", () => {
    const b: ActiveBeat = { kind: "bid", spawn: 0, at: 0 }; // 800ms
    expect(beatProgress(b, 0)).toBe(0);
    expect(beatProgress(b, 400)).toBeCloseTo(0.5);
    expect(beatProgress(b, 800)).toBe(1);
    expect(beatProgress(b, 5000)).toBe(1);
  });
});
