// reel/openArc — the pure path/easing math for the orbit-open camera-arc (Epic 07
// S5 · #158, Beats 1–2 "WANDERING" + "SUN REVEAL").
//
// The film opens "lost in the dark, found by the sun": the camera drifts laterally
// along the Moon's dark limb (sun off-frame) and then ARCS so the *fixed* sun's
// godrays + celestial bloom crest into frame, easing into the resting ORBIT_POSE.
//
// CAMERA-ARC, NOT SUN-ARC (load-bearing — grilling outcome 5): the sun stays at its
// fixed ORBIT_SUN_POSITION. Moving the sun would be physically wrong AND snapshot-
// independent motion that fights the rest of the scene. So this module produces a
// CAMERA azimuth offset (radians, added to the settled ORBIT_POSE azimuth) over the
// open's progress t∈[0,1]; the <CinematicOpen> rig rotates the rest offset by that
// angle around the target's up-axis to reposition the camera while the look target
// stays on the Moon. The sun never moves.
//
// Everything here is pure + DOM-free (no three, no rAF, no React) so it unit-tests
// in vitest's node env: the shape is just numbers. This keeps ADR-0004's purity
// intact — the open is decorative Scenery, it never reads or invents world state
// (same category as the static light rig / CameraFeel sway).

// ── Open-cue keybind ─────────────────────────────────────────────────────────
// `o` (mnemonic: OPEN) triggers the orbit-open camera-arc. Chosen to avoid the keys
// already taken: `r` (arm), `k` (cueKill), `h` (HUD hide), `]`/`[` (copy step),
// `m`/`b` (marker cues), `Escape` (cancel placement), `l`/`L` (place while placing).
// Kept next to the path math so the App's keydown handler + the test agree on one
// source of truth, and so a future slice sees what's taken at a glance.
export const OPEN_CUE_KEY = "o";

// True iff a keyboard event is the bare open-cue keystroke (no modifiers, so it
// never hijacks a browser/OS shortcut — mirrors the arm/cue/copy/marker guards).
// The caller gates this on the `cinematic` arm flag so a disarmed press is a no-op.
export function isOpenCue(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  return e.key.toLowerCase() === OPEN_CUE_KEY;
}

// How long (ms) the whole open runs: a slow, unhurried "lost then found" arc. The
// Beat-1 drift + Beat-2 reveal in the script run ~0:00–0:12 (~12s); we run the rig
// a touch shorter so it settles cleanly into ORBIT_POSE with headroom before the
// operator steps the stakes copy (Beat 3).
export const OPEN_MS = 9000;

// Fraction of the open spent in the lateral DRIFT phase (Beat 1 "WANDERING") before
// the ARC toward the sun begins (Beat 2 "SUN REVEAL"). The drift is the cold, lost
// wander along the dark limb; the arc is the reveal. ~42% drift / ~58% arc reads as
// a held loneliness that then commits to the light.
export const DRIFT_FRACTION = 0.42;

// Peak azimuth offset (radians, ~26°) the camera starts BACK from ORBIT_POSE, on the
// dark-limb side (negative = away from the sun). At t=0 the camera sits here with the
// sun off-frame; the arc walks this back to 0 (the settled ORBIT_POSE azimuth) so the
// sun's godrays crest in as it closes. Tuned so the sun is genuinely out of frame at
// the start (the orbit fov is 50°, and ORBIT_POSE already sits ~88° in azimuth from
// the sun heading) yet the swing is a gentle reveal, not a whip.
export const OPEN_AZIMUTH_RAD = (26 * Math.PI) / 180;

// Extra lateral drift (radians, ~5°) layered ONTO the dark-limb side during the
// WANDERING phase — a slow sub-sway that reads as aimless searching before the
// reveal commits. It eases fully back to 0 by the time the arc hands off, so it
// never displaces the final ORBIT_POSE settle.
export const DRIFT_SWAY_RAD = (5 * Math.PI) / 180;

// easeInOutCubic — gentle accelerate-out, hard decelerate-in, for the reveal ARC so
// the sun crests in smoothly and the camera settles into ORBIT_POSE without overshoot.
const easeInOutCubic = (x: number) =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

// A single half-sine bump: 0 at both ends, 1 at the middle. Used for the searching
// sub-sway so it blooms and fully resolves within the drift window (no residual).
const halfSine = (x: number) => Math.sin(Math.min(1, Math.max(0, x)) * Math.PI);

// The CAMERA azimuth offset (radians) to ADD to the settled ORBIT_POSE azimuth at a
// given progress t∈[0,1]. The offset is NEGATIVE (dark-limb side, sun off-frame) and
// walks to 0 (settled ORBIT_POSE, sun cresting in) by t=1:
//   · t∈[0, DRIFT_FRACTION]  — WANDERING: hold near the dark-limb peak with a slow
//     searching sub-sway (the lost lateral drift); no commitment to the light yet.
//   · t∈[DRIFT_FRACTION, 1]  — SUN REVEAL: ease the azimuth from the peak back to 0,
//     arcing the camera so the fixed sun's godrays/bloom crest into frame and the
//     camera settles EXACTLY on ORBIT_POSE (offset 0) at t=1.
// Clamped, so an out-of-range t can't push the camera past its framed pose.
export function openAzimuthOffset(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  if (c <= DRIFT_FRACTION) {
    // WANDERING: hold at the dark-limb peak, with a searching half-sine sub-sway
    // that blooms and fully resolves within the drift window.
    const local = DRIFT_FRACTION > 0 ? c / DRIFT_FRACTION : 1;
    return -OPEN_AZIMUTH_RAD - DRIFT_SWAY_RAD * halfSine(local);
  }
  // SUN REVEAL: arc from the dark-limb peak back to the settled pose (offset 0).
  const span = 1 - DRIFT_FRACTION;
  const local = span > 0 ? (c - DRIFT_FRACTION) / span : 1;
  const eased = easeInOutCubic(local);
  return -OPEN_AZIMUTH_RAD * (1 - eased);
}

// True once the open has progressed past the drift phase into the reveal arc — the
// point at which the sun begins cresting into frame. A small convenience for the
// rig / tests to label the two beats; not load-bearing for the motion itself.
export function isRevealing(t: number): boolean {
  return t > DRIFT_FRACTION;
}
