import { describe, expect, it } from "vitest";
import type { RoverView, TaskView } from "../types/wire";
import {
  missionStats,
  roversForSite,
  tasksForSite,
} from "./missionStats";

function task(id: string, status: TaskView["status"], site?: string): TaskView {
  return {
    id,
    type: "wall",
    pos: { X: 0, Y: 0 },
    status,
    version: 1,
    ...(site ? { site } : {}),
  };
}

function rover(id: string, alive: boolean, site?: string): RoverView {
  return {
    id,
    pos: { X: 0, Y: 0 },
    battery: 1,
    alive,
    load: 0,
    ...(site ? { site } : {}),
  };
}

describe("tasksForSite / roversForSite", () => {
  it("treats untagged entities as the default 'lunar' site (back-compat)", () => {
    const tasks = [task("t1", "DONE"), task("t2", "DONE", "shackleton")];
    expect(tasksForSite(tasks, "lunar").map((t) => t.id)).toEqual(["t1"]);
    expect(tasksForSite(tasks, "shackleton").map((t) => t.id)).toEqual(["t2"]);

    const rovers = [rover("r1", true), rover("r2", true, "shackleton")];
    expect(roversForSite(rovers, "lunar").map((r) => r.id)).toEqual(["r1"]);
    expect(roversForSite(rovers, "shackleton").map((r) => r.id)).toEqual(["r2"]);
  });
});

describe("missionStats", () => {
  it("scopes done/total and rover counts to the active site", () => {
    const tasks = [
      task("a", "DONE", "lunar"),
      task("b", "LEASED", "lunar"),
      task("c", "DONE", "shackleton"),
    ];
    const rovers = [
      rover("r1", true, "lunar"),
      rover("r2", false, "lunar"),
      rover("r3", true, "shackleton"),
    ];

    const lunar = missionStats(tasks, rovers, "lunar");
    expect(lunar).toEqual({ done: 1, total: 2, roversAlive: 1, roversTotal: 2 });

    const shack = missionStats(tasks, rovers, "shackleton");
    expect(shack).toEqual({ done: 1, total: 1, roversAlive: 1, roversTotal: 1 });
  });

  it("dips on a kill and recovers on revive (pure snapshot derivation)", () => {
    const tasks = [task("a", "DONE"), task("b", "LEASED")];

    const healthy = missionStats(tasks, [rover("r1", true), rover("r2", true)], "lunar");
    expect(healthy.roversAlive).toBe(2);

    const spiked = missionStats(
      [task("a", "DONE"), task("b", "UNCLAIMED")],
      [rover("r1", true), rover("r2", false)],
      "lunar",
    );
    expect(spiked.roversAlive).toBe(1);
    expect(spiked.done).toBe(1);

    const healed = missionStats(
      [task("a", "DONE"), task("b", "DONE")],
      [rover("r1", true), rover("r2", true)],
      "lunar",
    );
    expect(healed.roversAlive).toBe(2);
    expect(healed.done).toBe(2);
  });

  it("returns zeros for an empty snapshot", () => {
    expect(missionStats([], [], "lunar")).toEqual({
      done: 0,
      total: 0,
      roversAlive: 0,
      roversTotal: 0,
    });
  });
});
