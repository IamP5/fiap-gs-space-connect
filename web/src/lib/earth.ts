// earth — pure derivations for the Earth-uplink panel (issue 09). Kept DOM-free
// and pure so they unit-test in vitest's node env, matching the format/scene
// helpers' ethos. The Earth feed is a DELAYED copy of the world; these helpers
// turn its `at` and task list into the two things the panel shows: how far
// behind Earth is, and what Earth *thinks* the swarm has built so far.

import type { TaskView } from "../types/wire";

// How far Earth's view lags the live world, in milliseconds. Both stamps are
// world-time ticks (the snapshot's `at` and the earth frame's `at`). Clamped at
// ≥ 0 so clock skew or an earth frame that briefly leads never shows a negative
// lag. Null stamps (no snapshot / no earth yet) → 0 (treated as "live").
export function earthLagMs(snapshotAt: number | null, earthAt: number | null): number {
  if (snapshotAt == null || earthAt == null) return 0;
  const lag = snapshotAt - earthAt;
  return lag > 0 ? lag : 0;
}

// Human label for an Earth lag in ms. Under a threshold Earth is effectively
// "live"; above it we show how far behind it is — sub-second in ms, otherwise in
// seconds with one decimal (e.g. "+1.8s behind"). The LIVE_THRESHOLD_MS keeps a
// tiny transport jitter from flickering the label off "live".
export const LIVE_THRESHOLD_MS = 150;

export function formatLag(lagMs: number): string {
  if (lagMs <= LIVE_THRESHOLD_MS) return "live";
  if (lagMs < 1000) return `+${Math.round(lagMs)}ms behind`;
  return `+${(lagMs / 1000).toFixed(1)}s behind`;
}

// Earth-side blueprint progress: how many tasks Earth believes are DONE out of
// the total it can see. At high latency this trails the live TaskLedger — that
// gap is what makes "Earth never knew" legible.
export function taskProgress(tasks: TaskView[]): { done: number; total: number } {
  let done = 0;
  for (const t of tasks) {
    if (t.status === "DONE") done += 1;
  }
  return { done, total: tasks.length };
}
