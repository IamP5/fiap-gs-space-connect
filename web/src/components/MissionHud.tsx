
import { memo, useState } from "react";
import type { TaskStatus, TaskView } from "../types/wire";

const STATUS_CLASS: Record<TaskStatus, string> = {
  UNCLAIMED: "st-unclaimed",
  LEASED: "st-leased",
  DONE: "st-done",
};

const LEGEND = (
  <ul className="legend">
    <li>
      <span className="badge st-unclaimed">UNCLAIMED</span> needs a rover
    </li>
    <li>
      <span className="badge st-leased">LEASED</span> a rover holds it
    </li>
    <li>
      <span className="badge st-done">DONE</span> complete
    </li>
  </ul>
);

export const MissionHud = memo(function MissionHud({
  tasks,
  done,
  total,
  roversAlive,
  roversTotal,
  hasSnapshot,
}: {
  tasks: TaskView[];
  done: number;
  total: number;
  roversAlive: number;
  roversTotal: number;
  hasSnapshot: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const fraction = total > 0 ? done / total : 0;
  const allRoversDown = roversTotal > 0 && roversAlive === 0;

  return (
    <aside className="mission-hud hud-surface-panel">
      <button
        type="button"
        className="mission-hud-summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="mission-hud-head">
          <span className="mission-hud-title">Mission</span>
          <span className="mission-hud-chevron" aria-hidden="true">
            {expanded ? "▾" : "▸"}
          </span>
        </div>

        <div className="mission-row">
          <span className="mission-row-label">Build</span>
          <span className="mission-row-value">
            {hasSnapshot ? `${done} / ${total}` : "—"}
          </span>
        </div>
        <div
          className="progress-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
        >
          <span
            className="progress-bar-fill"
            style={{ width: `${Math.round(fraction * 100)}%` }}
          />
        </div>

        <div className="mission-row">
          <span className="mission-row-label">Rovers</span>
          <span
            className={`mission-row-value ${allRoversDown ? "mission-row-value-down" : ""}`}
          >
            {hasSnapshot ? `${roversAlive} / ${roversTotal} alive` : "—"}
          </span>
        </div>
      </button>

      <div className="mission-hud-legend">
        <span className="mission-hud-help" tabIndex={0} aria-label="Status legend">
          ?
        </span>
        <div className="mission-hud-tooltip" role="tooltip">
          {LEGEND}
        </div>
      </div>

      {expanded ? (
        tasks.length === 0 ? (
          <p className="ledger-empty">no tasks yet</p>
        ) : (
          <ul className="mission-task-list">
            {tasks.map((t) => (
              <li key={t.id}>
                <span className={`badge ${STATUS_CLASS[t.status] ?? ""}`}>
                  {t.status}
                </span>
                <span className="ledger-id">{t.id}</span>
                <span className="ledger-type">{t.type}</span>
                {t.assignee ? (
                  <span className="ledger-assignee">← {t.assignee}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </aside>
  );
});
