
export function clamp01(v: number): number {
  if (!(v > 0)) return 0;
  if (v > 1) return 1;
  return v;
}

export function batteryPercent(battery: number): number {
  return Math.round(clamp01(battery) * 100);
}
