
import type { WorldEvent } from "../types/wire";


export function ringFraction(expiry: number, at: number, fullSpan: number): number {
  if (!(fullSpan > 0)) return 1;
  const f = (expiry - at) / fullSpan;
  if (f < 0) return 0;
  if (f > 1) return 1;
  return f;
}

export function ringColor(fraction: number): string {
  if (fraction > 0.5) return "#2ecc71";
  if (fraction > 0.2) return "#f5a623";
  return "#e74c3c";
}


export function beatLifetimeMs(kind: string): number {
  switch (kind) {
    case "bid":
      return 800;
    case "won":
      return 700;
    case "solidify":
      return 600;
    case "revived":
      return 1100;
    case "expired":
      return 500;
    default:
      return 500;
  }
}

export type ActiveBeat = WorldEvent & { spawn: number };

export function activeBeats(beats: ActiveBeat[], nowMs: number): ActiveBeat[] {
  return beats.filter((b) => nowMs - b.spawn < beatLifetimeMs(b.kind));
}

export function beatProgress(beat: ActiveBeat, nowMs: number): number {
  const life = beatLifetimeMs(beat.kind);
  if (!(life > 0)) return 1;
  const p = (nowMs - beat.spawn) / life;
  if (p < 0) return 0;
  if (p > 1) return 1;
  return p;
}


export function activeBidders(beats: ActiveBeat[], nowMs: number): number {
  const ids = new Set<string>();
  for (const b of beats) {
    if (b.kind !== "bid") continue;
    if (nowMs - b.spawn >= beatLifetimeMs("bid")) continue;
    ids.add(b.robot_id ?? `anon:${b.spawn}`);
  }
  return ids.size;
}

export const BID_WAR_SATURATION = 4;
export function bidWarStrobe(bidders: number): number {
  if (bidders < 2) return 0;
  const t = (bidders - 1) / (BID_WAR_SATURATION - 1);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
