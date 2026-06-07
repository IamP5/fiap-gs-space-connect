// format — tiny pure presentation helpers shared by the React chrome (App) and
// the 3D renderer (Scene3D), so battery is clamped and shown the same way in
// both. Kept DOM-free and pure so they're unit-testable in vitest's node env,
// matching the choreography helpers' ethos.

// Clamp a 0..1 value into range. A rover's battery is nominally 0..1 but a
// malformed frame must never produce an out-of-range arc or percentage.
export function clamp01(v: number): number {
  if (!(v > 0)) return 0; // also catches NaN
  if (v > 1) return 1;
  return v;
}

// Battery as a whole-number percentage (0..100) for display.
export function batteryPercent(battery: number): number {
  return Math.round(clamp01(battery) * 100);
}
