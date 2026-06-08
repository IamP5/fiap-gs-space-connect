// cameraFeel — pure, DOM-free helpers for slice #109 ("camera feel").
//
// All the numeric feel of the camera lives here so it's unit-testable in
// vitest's node env (no canvas, no rAF, no three): the idle-drift sway angle,
// the zoom→exposure lift, and the trailing starfield parallax. The actual
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

// Orbit darkens the zoom-coupled exposure: in deep space the only key light is
// the raw sun, so the sunlit Moon limb + celestial bloom (Sun/Earth) otherwise
// read too hot against the near-black void. Scaling orbit exposure down keeps the
// vista cinematic and lets the void roll fully to black. Surface keeps full
// exposure (1.0) so the worksite stays legible under its fill/rim rig.
export const ORBIT_EXPOSURE_SCALE = 0.8;

// WS-5 (#172): the surface gets a small exposure LIFT (1.0 → 1.15) so the bright
// sunlit regolith reads premium-hot while ACES still rolls the crushed shadows to
// near-black — the high-contrast "10× more premium" lunar look. Surface-only (orbit
// keeps its own darker scale) so it never blows out the deep-space vista.
export const SURFACE_EXPOSURE_SCALE = 1.15;

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

// ---- starfield parallax ---------------------------------------------------
//
// A two-plane depth cue: the bright Milky-Way equirect band (scene.background)
// stays LOCKED, and only the dim points starfield shell is given a tiny trailing
// yaw as the camera azimuth turns. The near layer lags the band → parallax,
// without the bright band visibly sliding (the artifact that made #109's original
// background-rotation parallax read as a glitch).
//
// This is a VELOCITY/trailing model, not an anchor-delta one. Each frame the
// offset is nudged opposite the azimuth change and relaxed back toward neutral;
// there is no anchor to re-capture on gesture start, so the one-frame "snap" that
// plagued the original (re-anchor while a stale offset was still applied) cannot
// recur by construction. When motion stops, the offset eases to 0 and the stars
// settle back into register with the band.

// Fraction of each frame's azimuth turn the star layer lags by. Small — the
// parallax should be felt more than seen.
export const PARALLAX_GAIN = 0.08;

// Exponential relax rate (per second) pulling the offset back to neutral. ~2/s
// ⇒ a ~0.5s time constant, so the layer settles in roughly a second after you
// stop turning. Also what bounds the steady-state lag during a sustained drag
// (steady offset ≈ -GAIN · azimuthVelocity / RELAX).
export const PARALLAX_RELAX_PER_S = 2.0;

// Hard clamp (radians, ~5°) so a fast continuous spin can't wind the star layer
// far off its framed orientation.
export const PARALLAX_MAX_RAD = (5 * Math.PI) / 180;

// Advance the trailing parallax offset by one frame.
//   prev         — last frame's offset (radians)
//   azimuthDelta — signed azimuth change since last frame (radians)
//   dt           — frame duration (seconds); makes the relax frame-rate independent
// Returns the new offset, clamped to ±PARALLAX_MAX_RAD. With azimuthDelta 0 it
// decays geometrically toward 0; a non-finite dt is treated as 0 (no relax).
export function advanceParallax(
  prev: number,
  azimuthDelta: number,
  dt: number,
): number {
  const safeDt = dt > 0 ? dt : 0;
  const relax = Math.exp(-PARALLAX_RELAX_PER_S * safeDt);
  let next = prev * relax - PARALLAX_GAIN * azimuthDelta;
  if (next > PARALLAX_MAX_RAD) next = PARALLAX_MAX_RAD;
  if (next < -PARALLAX_MAX_RAD) next = -PARALLAX_MAX_RAD;
  return next;
}

// Below this absolute offset (radians) the parallax is treated as settled, so the
// demand loop can stop invalidating instead of chasing an ever-smaller decay.
export const PARALLAX_SETTLE_EPS = 1e-4;
