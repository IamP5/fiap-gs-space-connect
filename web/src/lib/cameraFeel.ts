

export const IDLE_DELAY_MS = 4000;

export const IDLE_SWAY_RAD = (3 * Math.PI) / 180;

export const IDLE_PERIOD_MS = 16000;

export const IDLE_FADE_MS = 2000;

export function idleSwayOffset(idleElapsed: number): number {
  if (!(idleElapsed > 0)) return 0;
  const fade = Math.min(1, idleElapsed / IDLE_FADE_MS);
  const phase = (idleElapsed / IDLE_PERIOD_MS) * Math.PI * 2;
  return IDLE_SWAY_RAD * fade * Math.sin(phase);
}

export function isDrifting(idleElapsed: number): boolean {
  return idleElapsed > 0;
}


export const EXPOSURE_NEAR = 1.28;
export const EXPOSURE_FAR = 1.04;

export const ORBIT_EXPOSURE_SCALE = 0.8;

export const SURFACE_EXPOSURE_SCALE = 1.15;

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
  return EXPOSURE_NEAR + (EXPOSURE_FAR - EXPOSURE_NEAR) * norm;
}


export const PARALLAX_GAIN = 0.08;

export const PARALLAX_RELAX_PER_S = 2.0;

export const PARALLAX_MAX_RAD = (5 * Math.PI) / 180;

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

export const PARALLAX_SETTLE_EPS = 1e-4;
