// choreography.test.ts — pure logic for slice 06's TTL ring + transient beats.
//
// No DOM/canvas/rAF here: ringFraction/ringColor/activeBeats/beatLifetimeMs are
// pure math, so they run in vitest's node env exactly like hitTest.test.ts.

import { describe, expect, it } from "vitest";
import {
  type ActiveBeat,
  BID_WAR_SATURATION,
  activeBeats,
  activeBidders,
  beatLifetimeMs,
  beatProgress,
  bidWarStrobe,
  earthriseEnvelope,
  launchShake,
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

  it("maps the Wave-3 cinematic beats to their longer lifetimes (#108)", () => {
    expect(beatLifetimeMs("launch")).toBe(3200);
    expect(beatLifetimeMs("earthrise-hero")).toBe(4500);
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

describe("launchShake (#108)", () => {
  it("settles to exactly 0 at the end so the camera returns to its base pose", () => {
    expect(launchShake(1, 0)).toBe(0);
    expect(launchShake(1, 1)).toBe(0);
    expect(launchShake(2, 0)).toBe(0); // clamped past the end
  });

  it("decays: the peak amplitude early is larger than late", () => {
    // Compare envelope strength by sampling the same axis at a few phases; the
    // exponential×linear envelope must be monotonically weaker as p grows.
    const early = Math.abs(launchShake(0.05, 0));
    const late = Math.abs(launchShake(0.85, 0));
    // Envelope at 0.05 vs 0.85 differs by ~5x regardless of carrier phase, so the
    // bound holds across the sampled carrier values.
    expect(early).toBeGreaterThan(late);
  });

  it("gives uncorrelated waveforms per axis (x != y at the same progress)", () => {
    const x = launchShake(0.3, 0);
    const y = launchShake(0.3, 1);
    expect(x).not.toBeCloseTo(y);
  });

  it("stays bounded in roughly [-1, 1] (an amplitude scalar, never a huge jolt)", () => {
    for (let p = 0; p <= 1.0001; p += 0.013) {
      expect(Math.abs(launchShake(p, 0))).toBeLessThanOrEqual(1);
      expect(Math.abs(launchShake(p, 1))).toBeLessThanOrEqual(1);
    }
  });
});

describe("earthriseEnvelope (#108)", () => {
  it("is 0 at both ends so controls restore at the pose they left", () => {
    expect(earthriseEnvelope(0)).toBe(0);
    expect(earthriseEnvelope(1)).toBe(0);
    expect(earthriseEnvelope(-1)).toBe(0); // clamped
    expect(earthriseEnvelope(2)).toBe(0); // clamped
  });

  it("holds at full (1) through the middle of the beat", () => {
    expect(earthriseEnvelope(0.5)).toBe(1);
    expect(earthriseEnvelope(0.4)).toBe(1);
    expect(earthriseEnvelope(0.6)).toBe(1);
  });

  it("ramps in monotonically from 0 up to the hold", () => {
    const a = earthriseEnvelope(0.05);
    const b = earthriseEnvelope(0.1);
    const c = earthriseEnvelope(0.2);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(c).toBeLessThanOrEqual(1);
  });

  it("ramps out monotonically from the hold back to 0", () => {
    const a = earthriseEnvelope(0.8);
    const b = earthriseEnvelope(0.9);
    const c = earthriseEnvelope(0.98);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });
});

describe("activeBidders", () => {
  const bid = (robot_id: string | undefined, spawn: number): ActiveBeat => ({
    kind: "bid",
    robot_id,
    spawn,
    at: 0,
  });

  it("counts DISTINCT rovers with a live bid beat", () => {
    const beats = [bid("r1", 0), bid("r2", 0), bid("r1", 0)];
    expect(activeBidders(beats, 100)).toBe(2); // r1, r2 — r1 counted once
  });

  it("ignores non-bid beats", () => {
    const beats: ActiveBeat[] = [
      bid("r1", 0),
      { kind: "won", robot_id: "r2", spawn: 0, at: 0 },
      { kind: "revived", robot_id: "r3", spawn: 0, at: 0 },
    ];
    expect(activeBidders(beats, 100)).toBe(1);
  });

  it("drops expired bids (past the 800ms bid lifetime)", () => {
    const beats = [bid("r1", 0), bid("r2", 0)];
    expect(activeBidders(beats, 700)).toBe(2); // both live
    expect(activeBidders(beats, 800)).toBe(0); // both expired
  });

  it("counts an anonymous (no robot_id) bid as its own bidder", () => {
    const beats = [bid(undefined, 0), bid(undefined, 10)];
    expect(activeBidders(beats, 100)).toBe(2);
  });
});

describe("bidWarStrobe", () => {
  it("is 0 with no contention (0 or 1 bidder)", () => {
    expect(bidWarStrobe(0)).toBe(0);
    expect(bidWarStrobe(1)).toBe(0);
  });

  it("ramps in from 2 bidders and saturates at the cap", () => {
    expect(bidWarStrobe(2)).toBeGreaterThan(0);
    expect(bidWarStrobe(2)).toBeLessThan(1);
    expect(bidWarStrobe(BID_WAR_SATURATION)).toBe(1);
  });

  it("clamps a pile-on beyond the cap to 1", () => {
    expect(bidWarStrobe(BID_WAR_SATURATION + 10)).toBe(1);
  });

  it("increases monotonically with bidders", () => {
    const a = bidWarStrobe(2);
    const b = bidWarStrobe(3);
    expect(b).toBeGreaterThanOrEqual(a);
  });
});
