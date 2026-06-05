// choreography — pure, DOM-free helpers for slice 06's "make the heal legible".
//
// Two concerns live here, both pure so they're unit-testable in vitest's node
// env (no canvas, no rAF): the TTL drain-ring math (derived from durable task
// state) and the transient beat lifetime/filtering (derived from server
// events). The actual drawing happens in WorldCanvas; this is just the numbers.
//
// IMPORTANT: nothing here invents world state. The ring is a function of a
// task's lease_expiry vs. the snapshot clock; beats are a function of the
// server's events. Both strictly DECORATE the authoritative snapshot.

import type { WorldEvent } from "../types/wire";

// ---- TTL drain ring -------------------------------------------------------

// Fraction of a lease's TTL still remaining, clamped to [0, 1]. `fullSpan` is
// the inferred TTL (the largest (expiry - at) seen for this task while leased);
// see taskRingBase tracking in WorldCanvas. A non-positive span means we can't
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
// (e.g. "expired"/"killed" with no bespoke visual) get a short default so they
// are dropped quickly and never linger.
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
// cadence. Kept here (not just in WorldCanvas) so activeBeats is testable.
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
