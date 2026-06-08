// missionStats — pure, site-scoped derivations for the Mission HUD (Epic 06 P2).
//
// The Mission HUD tells the self-heal story at a glance: a build-progress bar
// (done/total) and a rovers-alive readout (N/M), BOTH scoped to the active
// worksite. Every value here is a pure read of the latest snapshot — no client
// state — so the readouts visibly DIP when a Failure spike kills rovers / re-opens
// tasks, then RECOVER as the swarm re-auctions and finishes (ADR-0004). Kept
// DOM-/three-free so it is unit-testable in vitest's node env, mirroring the
// site-filtering convention App already uses for `obstacles` (App.tsx).

import type { RoverView, TaskView } from "../types/wire";

// Untagged rovers/tasks belong to the single default site (back-compat with
// pre-two-site snapshots), matching App's `(t.site ?? "lunar")` obstacle filter.
const DEFAULT_SITE = "lunar";

export type MissionStats = {
  // Build progress over the active site's tasks.
  done: number;
  total: number;
  // Rover health over the active site's swarm.
  roversAlive: number;
  roversTotal: number;
};

// Tasks belonging to `site` (untagged ⇒ default site), the SAME slice the
// drag-to-place obstacle filter uses, so the HUD counts exactly the worksite the
// surface view is showing.
export function tasksForSite(tasks: TaskView[], site: string): TaskView[] {
  return tasks.filter((t) => (t.site ?? DEFAULT_SITE) === site);
}

// Rovers stationed at `site` (untagged ⇒ default site).
export function roversForSite(rovers: RoverView[], site: string): RoverView[] {
  return rovers.filter((r) => (r.site ?? DEFAULT_SITE) === site);
}

// Build-progress + rover-health for the active worksite. `done` counts DONE
// tasks; `roversAlive` counts rovers with `alive === true` — the SAME flag
// KillPanel and roverHaloColor read — so a kill drops the count immediately and a
// revive raises it back, all from the snapshot alone.
export function missionStats(
  tasks: TaskView[],
  rovers: RoverView[],
  site: string,
): MissionStats {
  const siteTasks = tasksForSite(tasks, site);
  const siteRovers = roversForSite(rovers, site);
  let done = 0;
  for (const t of siteTasks) if (t.status === "DONE") done += 1;
  let roversAlive = 0;
  for (const r of siteRovers) if (r.alive === true) roversAlive += 1;
  return {
    done,
    total: siteTasks.length,
    roversAlive,
    roversTotal: siteRovers.length,
  };
}
