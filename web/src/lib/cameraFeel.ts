// cameraFeel — pure, DOM-free helpers for slice #109 ("camera feel").
//
// All the numeric feel of the camera lives here so it's unit-testable in
// vitest's node env (no canvas, no rAF, no three): the idle-drift sway angle,
// the zoom→exposure lift, and the drag→starfield parallax offset. The actual
// mutation of camera/material/scene happens in the <CameraFeel> component in
// Scene3D; this module is just the numbers.
//
// IMPORTANT: nothing here reads or invents world state. Camera feel is purely
// decorative — it never touches the snapshot — so it keeps ADR-0004's "scene is
// a pure function of the snapshot" invariant intact (same category as the static
// light rig / starfield: decorative, snapshot-independent).

// ---- idle drift -----------------------------------------------------------

// How long (ms) of no input before the gentle idle auto-drift kicks in. Any
// interaction resets the idle clock, so the sway only starts after the user has
// truly stopped touching the camera (~4s, per the issue).
export const IDLE_DELAY_MS = 4000;

// Peak azimuth sway, in radians (~3° per the issue): the drift is a slow sine
// sway of ±this around wherever the user left the orbit, never a full rotation.
export const IDLE_SWAY_RAD = (3 * Math.PI) / 180;

// Sway period in ms: one full back-and-forth. A long period reads as a calm,
// barely-perceptible breath rather than an obvious oscillation.
export const IDLE_PERIOD_MS = 16000;

// How long (ms) the sway takes to fade IN once idle begins, so it eases on
// smoothly instead of snapping to full amplitude at the 4s mark.
export const IDLE_FADE_MS = 2000;

// The idle azimuth offset (radians) to ADD to the camera's settled azimuth at a
// given time. `idleElapsed` is ms since the idle drift started (i.e. ms since
// the input-idle threshold was crossed); negative/zero means "not drifting yet"
// and returns 0. The amplitude eases in over IDLE_FADE_MS so it never pops.
export function idleSwayOffset(idleElapsed: number): number {
  if (!(idleElapsed > 0)) return 0;
  const fade = Math.min(1, idleElapsed / IDLE_FADE_MS);
  const phase = (idleElapsed / IDLE_PERIOD_MS) * Math.PI * 2;
  return IDLE_SWAY_RAD * fade * Math.sin(phase);
}

// True once enough idle time has elapsed that the drift should be running. Used
// to decide whether the loop needs to keep invalidating (drift active) or can
// settle back to 0 idle fps (no drift, nothing moving).
export function isDrifting(idleElapsed: number): boolean {
  return idleElapsed > 0;
}

// ---- zoom-coupled exposure ------------------------------------------------

// Tone-mapping exposure as a function of how far the camera is from its orbit
// target, normalised against the mode's [minDistance, maxDistance] clamp band.
// Pushing IN (closer → norm→0) lifts exposure toward `exposureNear`; pulling OUT
// (farther → norm→1) settles to `exposureFar`. The lift is gentle so the void
// still rolls to near-black under ACES; it just gives the sunlit subject a touch
// more presence as you move in (the "zoom = lean in, scene brightens" feel).
export const EXPOSURE_NEAR = 1.28; // pushed all the way in
export const EXPOSURE_FAR = 1.04; // pulled all the way out

// Map a raw distance + the active clamp band to an exposure value. Distances
// outside the band are clamped, so the exposure never runs away past the dolly
// limits. A degenerate band (max<=min) returns the far value.
export function zoomExposure(
  distance: number,
  minDistance: number,
  maxDistance: number,
): number {
  const span = maxDistance - minDistance;
  if (!(span > 0)) return EXPOSURE_FAR;
  let norm = (distance - minDistance) / span;
  if (norm < 0) norm = 0;
  if (norm > 1) norm = 1;
  // norm 0 (near) → EXPOSURE_NEAR, norm 1 (far) → EXPOSURE_FAR.
  return EXPOSURE_NEAR + (EXPOSURE_FAR - EXPOSURE_NEAR) * norm;
}

// ---- drag parallax --------------------------------------------------------

// Parallax gain: how much of the camera's azimuth travel the distant sky lags
// behind by. A subtle counter-rotation of the background as the camera azimuth
// moves under a drag, so the near foreground reads as moving against a more
// distant sky (a depth cue). Kept tiny — the sky must stay a backdrop, never
// visibly spin.
export const PARALLAX_GAIN = 0.06;

// Maximum parallax offset (radians), so a long continuous drag can't wind the
// sky off its framed orientation. The offset is clamped to ±this.
export const PARALLAX_MAX_RAD = (4 * Math.PI) / 180;

// The parallax yaw offset (radians) to apply to the background rotation given
// how far (radians) the camera azimuth has moved from its rest azimuth. Scaled
// by PARALLAX_GAIN and clamped to ±PARALLAX_MAX_RAD. A small negative sign makes
// the sky drift OPPOSITE the camera (true parallax: the far layer lags).
export function parallaxOffset(azimuthDelta: number): number {
  const raw = -PARALLAX_GAIN * azimuthDelta;
  if (raw > PARALLAX_MAX_RAD) return PARALLAX_MAX_RAD;
  if (raw < -PARALLAX_MAX_RAD) return -PARALLAX_MAX_RAD;
  return raw;
}
