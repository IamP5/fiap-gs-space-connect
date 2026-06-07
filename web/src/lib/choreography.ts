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
    // ---- Wave 3 cinematic beats (#108) — longer, camera-driving set-pieces.
    case "launch":
      // A liftoff: exhaust + flare ramp-up, then a decaying screen shake that
      // needs room to settle smoothly back to zero (~3.2s reads as a real launch).
      return 3200;
    case "earthrise-hero":
      // A held hero shot: ~1s lerp IN to frame Earth, a hold, then lerp OUT and
      // restore. The whole arc lives inside this one beat's lifetime.
      return 4500;
    default:
      return 500;
  }
}

// ---- cinematic-beat shaping (#108) ----------------------------------------
//
// Pure, DOM-free curves for the Wave-3 camera beats, kept here so they stay
// unit-testable in vitest's node env (no canvas/rAF). Scene3D drives the actual
// camera/mesh refs in a useFrame from these numbers; nothing here invents world
// state — a beat only ever DECORATES the authoritative snapshot.

// Decaying camera-shake amplitude for the `launch` beat. A cheap, deterministic
// stand-in for Perlin: a couple of out-of-phase sines (so x/y read uncorrelated)
// modulated by an exponential envelope that is strong at ignition (p=0) and
// rolls to 0 by the end (p=1). `axis` selects an independent waveform per camera
// axis so the shake is 2D, not a diagonal wobble. Clamped progress in [0, 1];
// guaranteed 0 at p>=1 so the camera settles exactly back on its base pose.
export function launchShake(progress: number, axis: number): number {
  const p = progress <= 0 ? 0 : progress >= 1 ? 1 : progress;
  if (p >= 1) return 0;
  // Exponential decay multiplied by a linear (1 - p) so the tail reaches exactly
  // zero: a strong jolt at ignition, fully settled by the end (no residual drift).
  const envelope = Math.exp(-3.2 * p) * (1 - p);
  // High-frequency carrier; phase-offset per axis so axes don't move in lockstep.
  const phase = axis * 1.7;
  const carrier =
    Math.sin(p * 90 + phase) * 0.6 + Math.sin(p * 137 + phase * 2.3) * 0.4;
  return envelope * carrier;
}

// Eased 0→1 amplitude for the `earthrise-hero` beat: ramp the camera IN to the
// hero framing, HOLD at full (1), then ramp back OUT to 0 so controls restore at
// the same pose they left. `inFrac`/`outFrac` are the fractions of the beat spent
// ramping in / out; the middle is the hold. Clamped progress in [0, 1]; 0 at both
// ends. A smoothstep on each ramp keeps the move gentle (no velocity jump).
export function earthriseEnvelope(
  progress: number,
  inFrac = 0.22,
  outFrac = 0.24,
): number {
  const p = progress <= 0 ? 0 : progress >= 1 ? 1 : progress;
  const smooth = (x: number) => x * x * (3 - 2 * x);
  if (p < inFrac) return smooth(p / inFrac); // ramp in
  if (p > 1 - outFrac) return smooth((1 - p) / outFrac); // ramp out
  return 1; // hold at the hero framing
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
