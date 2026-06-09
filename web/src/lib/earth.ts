
import type { TaskView } from "../types/wire";

export function earthLagMs(snapshotAt: number | null, earthAt: number | null): number {
  if (snapshotAt == null || earthAt == null) return 0;
  const lag = snapshotAt - earthAt;
  return lag > 0 ? lag : 0;
}

export const LIVE_THRESHOLD_MS = 150;

export function formatLag(lagMs: number): string {
  if (lagMs <= LIVE_THRESHOLD_MS) return "live";
  if (lagMs < 1000) return `+${Math.round(lagMs)}ms behind`;
  return `+${(lagMs / 1000).toFixed(1)}s behind`;
}

export function taskProgress(tasks: TaskView[]): { done: number; total: number } {
  let done = 0;
  for (const t of tasks) {
    if (t.status === "DONE") done += 1;
  }
  return { done, total: tasks.length };
}
