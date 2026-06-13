
import type { RoverView, TaskView } from "../types/wire";

const DEFAULT_SITE = "lunar";

export type MissionStats = {
  done: number;
  total: number;
  roversAlive: number;
  roversTotal: number;
};

export function tasksForSite(tasks: TaskView[], site: string): TaskView[] {
  return tasks.filter((t) => (t.site ?? DEFAULT_SITE) === site);
}

export function roversForSite(rovers: RoverView[], site: string): RoverView[] {
  return rovers.filter((r) => (r.site ?? DEFAULT_SITE) === site);
}

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
