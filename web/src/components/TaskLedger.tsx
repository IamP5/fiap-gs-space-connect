// TaskLedger — the top-left task ledger: every task with its status badge and
// assignee, a static legend, and the rover/task counts.
//
// Memoized so it only re-renders when the tasks list or rover count changes —
// notably, selecting/deselecting a rover (App's `selected` state) no longer
// repaints the ledger. The legend is hoisted to a module-level element since it
// is fully static (rendering-hoist-jsx).

import { memo } from "react";
import type { TaskStatus, TaskView } from "../types/wire";

const STATUS_CLASS: Record<TaskStatus, string> = {
  UNCLAIMED: "st-unclaimed",
  LEASED: "st-leased",
  DONE: "st-done",
};

// Static legend — created once, never recreated on re-render.
const LEGEND = (
  <>
    <h3>Legend</h3>
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
  </>
);

export const TaskLedger = memo(function TaskLedger({
  tasks,
  roverCount,
  hasSnapshot,
}: {
  tasks: TaskView[];
  roverCount: number;
  hasSnapshot: boolean;
}) {
  return (
    <aside className="ledger">
      <h2>Task ledger</h2>
      {tasks.length === 0 ? (
        <p className="ledger-empty">no tasks yet</p>
      ) : (
        <ul>
          {tasks.map((t) => (
            <li key={t.id}>
              <span className={`badge ${STATUS_CLASS[t.status] ?? ""}`}>{t.status}</span>
              <span className="ledger-id">{t.id}</span>
              <span className="ledger-type">{t.type}</span>
              {t.assignee ? <span className="ledger-assignee">← {t.assignee}</span> : null}
            </li>
          ))}
        </ul>
      )}

      {LEGEND}

      <div className="counts">
        {hasSnapshot ? `${roverCount} rovers · ${tasks.length} tasks` : "—"}
      </div>
    </aside>
  );
});
