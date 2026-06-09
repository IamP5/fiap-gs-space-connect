
import { memo } from "react";
import { earthLagMs, formatLag, taskProgress, LIVE_THRESHOLD_MS } from "../lib/earth";
import type { EarthUplink } from "../types/wire";

export const EarthPanel = memo(function EarthPanel({
  earth,
  snapshotAt,
}: {
  earth: EarthUplink | null;
  snapshotAt: number | null;
}) {
  if (earth === null) {
    return (
      <aside className="earth-panel hud-surface-panel">
        <div className="earth-eyebrow">Earth uplink</div>
        <p className="earth-empty">awaiting earth uplink</p>
      </aside>
    );
  }

  const lag = earthLagMs(snapshotAt, earth.at);
  const live = lag <= LIVE_THRESHOLD_MS;
  const { done, total } = taskProgress(earth.tasks);
  const aliveRovers = earth.rovers.reduce((n, r) => (r.alive ? n + 1 : n), 0);

  return (
    <aside className="earth-panel hud-surface-panel">
      <div className="earth-eyebrow">Earth uplink</div>
      <div className={`earth-lag ${live ? "is-live" : "is-lagging"}`}>{formatLag(lag)}</div>
      <dl className="earth-stats">
        <div className="earth-stat">
          <dt>Blueprint</dt>
          <dd>
            {done}/{total} done
          </dd>
        </div>
        <div className="earth-stat">
          <dt>Rovers</dt>
          <dd>{aliveRovers} alive</dd>
        </div>
      </dl>
      <p className="earth-caption">what earth thinks the swarm has built</p>
    </aside>
  );
});
