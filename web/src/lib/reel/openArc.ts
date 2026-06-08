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
// Beat-1 drift + Beat-2 reveal in the script run ~0:00–0:12 (~12s). The reveal now
// sweeps a much wider azimuth (the sun genuinely crests — see OPEN_AZIMUTH_RAD), so
// we run a touch longer than the old token-swing rig to keep the sweep gentle, not a
// whip, and still settle cleanly into ORBIT_POSE before the operator steps the copy.
export const OPEN_MS = 11000;

// Fraction of the open spent in the WANDERING hold (Beat 1) before the reveal ARC
// begins (Beat 2 "SUN REVEAL"). The hold sits on the dark limb with the sun just
// off-frame; the arc is the reveal. ~38% hold / ~62% sweep reads as a held loneliness
// that then commits to the light without dragging.
export const DRIFT_FRACTION = 0.38;

// Peak azimuth offset (radians, ~118°) the camera starts BACK from ORBIT_POSE at t=0.
// GEOMETRY (measured against the live scene, not assumed): the orbit Sun DISC sits at
// ORBIT_SUN_POSITION — high and to one side, ~91° off the settled ORBIT_POSE view axis
// AND well above it, so at the rest pose the sun is fully off-frame (top + behind) and
// no godrays read. A NEGATIVE azimuth offset swings the CAMERA toward the sun: by
// ~−50° the disc reaches the right frame edge, by ~−75° it blazes in the top-right,
// and by ~−118° it has risen off the upper-LEFT edge (sun off-frame again, Moon dark).
// So the open starts at −118° (dark, sun just off upper-left — Beat 1) and the reveal
// walks the offset to 0: the sun RISES across the top of frame (godrays + flare crest
// and sweep, Beat 2) and EXITS top-right exactly as the sunlit lunar crescent + both
// worksite markers rotate into the settled ORBIT_POSE establishing vista (offset 0).
// A "sunrise across the top," not the old imperceptible 26° token swing.
export const OPEN_AZIMUTH_RAD = (118 * Math.PI) / 180;

// Extra drift (radians, ~7°) layered onto the dark-limb hold during the WANDERING
// phase — a slow sub-sway that reads as aimless searching before the reveal commits.
// It eases fully back to 0 by the time the sweep hands off, so it never displaces the
// final ORBIT_POSE settle.
export const DRIFT_SWAY_RAD = (7 * Math.PI) / 180;

// easeInOutCubic — gentle accelerate-out, hard decelerate-in, for the reveal ARC so
// the sun crests in smoothly and the camera settles into ORBIT_POSE without overshoot.
const easeInOutCubic = (x: number) =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

// A single half-sine bump: 0 at both ends, 1 at the middle. Used for the searching
// sub-sway so it blooms and fully resolves within the drift window (no residual).
const halfSine = (x: number) => Math.sin(Math.min(1, Math.max(0, x)) * Math.PI);

// The CAMERA azimuth offset (radians) to ADD to the settled ORBIT_POSE azimuth at a
// given progress t∈[0,1]. The offset is NEGATIVE (swung toward the sun) and walks to
// 0 (settled ORBIT_POSE) by t=1:
//   · t∈[0, DRIFT_FRACTION]  — WANDERING: hold near the −118° peak (sun just off the
//     upper-left, Moon dark) with a slow searching sub-sway; no commitment yet.
//   · t∈[DRIFT_FRACTION, 1]  — SUN REVEAL: ease the azimuth from the peak back to 0,
//     so the sun rises across the top of frame (godrays/flare crest + sweep) and
//     exits top-right as the camera settles EXACTLY on ORBIT_POSE (offset 0) at t=1.
// Clamped, so an out-of-range t can't push the camera past its framed pose.
export function openAzimuthOffset(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  if (c <= DRIFT_FRACTION) {
    // WANDERING: hold at the dark peak, with a searching half-sine sub-sway that
    // blooms and fully resolves within the drift window.
    const local = DRIFT_FRACTION > 0 ? c / DRIFT_FRACTION : 1;
    return -OPEN_AZIMUTH_RAD - DRIFT_SWAY_RAD * halfSine(local);
  }
  // SUN REVEAL: arc from the dark peak back to the settled pose (offset 0).
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
