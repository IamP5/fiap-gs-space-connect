// choreography — pure, DOM-free helpers for slice 06's "make the heal legible".
//
// Two concerns live here, both pure so they're unit-testable in vitest's node
// env (no canvas, no rAF): the TTL drain-ring math (derived from durable task
// state) and the transient beat lifetime/filtering (derived from server
// events). The actual drawing happens in Scene3D; this is just the numbers.
//
// IMPORTANT: nothing here invents world state. The ring is a function of a
// task's lease_expiry vs. the snapshot clock; beats are a function of the
// server's events. Both strictly DECORATE the authoritative snapshot.

import type { WorldEvent } from "../types/wire";

// ---- TTL drain ring -------------------------------------------------------

// Fraction of a lease's TTL still remaining, clamped to [0, 1]. `fullSpan` is
// the inferred TTL (the largest (expiry - at) seen for this task while leased);
// see taskRingBase tracking in Scene3D. A non-positive span means we can't
// tell, so we treat the ring as full (1) rather than dividing by zero.
export function ringFraction(expiry: number, at: number, fullSpan: number): number {
  if (!(fullSpan > 0)) return 1;
  const f = (expiry - at) / fullSpan;
  if (f < 0) return 0;
  if (f > 1) return 1;
  return f;
}

// Ring color shifts green → amber → red as the lease drains. Full/healthy at the
// top of the range; alarm-red near empty (the "orphan about to re-auction" cue).
export function ringColor(fraction: number): string {
  if (fraction > 0.5) return "#2ecc71"; // green — plenty of lease left
  if (fraction > 0.2) return "#f5a623"; // amber — draining
  return "#e74c3c"; // red — about to expire / orphaned
}

// ---- transient beats ------------------------------------------------------

// How long each beat kind's decoration stays on screen, in ms. Unknown kinds
// (with no bespoke visual) get a short default so they are dropped quickly and
// never linger.
export function beatLifetimeMs(kind: string): number {
  switch (kind) {
    case "bid":
      return 800;
    case "won":
      return 700;
    case "solidify":
      return 600;
    case "revived":
      return 1100; // a deliberate, legible recovery pulse — the in-place comeback
    case "expired":
      return 500;
    default:
      return 500;
  }
}

// A beat enriched with the wall-clock time it was received (performance.now()),
// so its age — and thus its animation progress — is independent of snapshot
// cadence. Kept here (not just in Scene3D) so activeBeats is testable.
export type ActiveBeat = WorldEvent & { spawn: number };

// Drop beats whose age has exceeded their per-kind lifetime; keep the fresh
// ones. `nowMs` is a performance.now()-style timestamp. Pure: returns a new
// array, never mutates the input.
export function activeBeats(beats: ActiveBeat[], nowMs: number): ActiveBeat[] {
  return beats.filter((b) => nowMs - b.spawn < beatLifetimeMs(b.kind));
}

// Normalized 0..1 progress through a beat's lifetime (0 = just spawned, 1 =
// expiring). Clamped, so a slightly-overdue beat still reads as done rather than
// overshooting an animation. Used by the renderer to drive fades/scales.
export function beatProgress(beat: ActiveBeat, nowMs: number): number {
  const life = beatLifetimeMs(beat.kind);
  if (!(life > 0)) return 1;
  const p = (nowMs - beat.spawn) / life;
  if (p < 0) return 0;
  if (p > 1) return 1;
  return p;
}

// ---- bid-war contention (#107) --------------------------------------------

// How many DISTINCT rovers have a still-live "bid" beat right now. Two or more
// rovers bidding at once is "contention" — an auction tug-of-war — which the
// renderer escalates into a higher-frequency halo strobe + a brief bloom spike.
// Pure: a function of the live beat list + clock, so it's unit-testable and the
// strobe stays a deterministic read of the snapshot's events (never random).
export function activeBidders(beats: ActiveBeat[], nowMs: number): number {
  const ids = new Set<string>();
  for (const b of beats) {
    if (b.kind !== "bid") continue;
    if (nowMs - b.spawn >= beatLifetimeMs("bid")) continue; // expired
    // Fall back to a synthetic key for the rare bid beat with no robot_id, so
    // each still counts as one bidder rather than collapsing to a single id.
    ids.add(b.robot_id ?? `anon:${b.spawn}`);
  }
  return ids.size;
}

// Strobe intensity 0..1 from the number of concurrent bidders. 0/1 bidder is no
// contention (0 — the normal single-rover bid flash carries it); 2 bidders ramp
// in and it saturates at BID_WAR_SATURATION+ rovers, so a big pile-on doesn't
// keep escalating without bound. Drives both the halo strobe depth and the
// bloom-intensity spike, so the heat reads proportional to the tug-of-war.
export const BID_WAR_SATURATION = 4;
export function bidWarStrobe(bidders: number): number {
  if (bidders < 2) return 0;
  const t = (bidders - 1) / (BID_WAR_SATURATION - 1);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
