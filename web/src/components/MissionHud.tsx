// MissionHud — the compact, game-like mission readout (Epic 06 P2), top-left,
// surface-only. It replaces the verbose TaskLedger: instead of enumerating every
// task id/assignee by default, it tells the self-heal story at a glance —
//   · a build-progress bar `done / total`
//   · a `rovers N / M alive` readout
// BOTH scoped to the active worksite, BOTH pure snapshot derivations (App passes
// them in via lib/missionStats), so they visibly DIP when a Failure spike kills
// rovers / re-opens tasks and RECOVER as the swarm re-auctions and heals — no
// extra wiring (ADR-0004).
//
// Click the widget to EXPAND the full per-task list (the old ledger rows: badge +
// id + type + assignee), collapsed by default. The static LEGEND is demoted from
// an always-visible block to a hover tooltip on a small `?`.
//
// Memoized on `tasks` + the two rover counts + the local `expanded` flag; App's
// `selected` changes never repaint it.

import { memo, useState } from "react";
import type { TaskStatus, TaskView } from "../types/wire";

const STATUS_CLASS: Record<TaskStatus, string> = {
  UNCLAIMED: "st-unclaimed",
  LEASED: "st-leased",
  DONE: "st-done",
};

// Static legend content — created once (rendering-hoist-jsx). Lives inside the
// `?` hover tooltip now rather than as an always-visible block.
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
  // The active-site task list (App filters to activeSite before passing it down),
  // used for the expandable detail rows.
  tasks: TaskView[];
  // Site-scoped build progress + rover health (derived in App via missionStats).
  done: number;
  total: number;
  roversAlive: number;
  roversTotal: number;
  hasSnapshot: boolean;
}) {
  // Local UI flag only — never global client state (ADR-0004). Collapsed default.
  const [expanded, setExpanded] = useState(false);

  // 0..1 build fraction; an empty worksite reads as 0 (nothing to build yet).
  const fraction = total > 0 ? done / total : 0;
  const allRoversDown = roversTotal > 0 && roversAlive === 0;

  return (
    <aside className="mission-hud panel hud-surface-panel">
      {/* The whole compact summary is the expand toggle (a button for keyboard +
          a11y); the detail list reveals below it. */}
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

      {/* Legend demoted to a hover/focus tooltip on a small `?` (Epic 06 P2). */}
      <div className="mission-hud-legend">
        <span className="mission-hud-help" tabIndex={0} aria-label="Status legend">
          ?
        </span>
        <div className="mission-hud-tooltip" role="tooltip">
          {LEGEND}
        </div>
      </div>

      {/* Expanded detail: the full per-task list (the old ledger row markup). */}
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
