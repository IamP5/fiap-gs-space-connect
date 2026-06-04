// App — the SwarmBuild dashboard shell. Pure re-render of the latest snapshot:
// a connection indicator (header), the task ledger (top-left), and the 2D
// world canvas. No state libraries, no router — React + a canvas is enough.

import { useSnapshot } from "./useSnapshot";
import { WorldCanvas } from "./WorldCanvas";
import type { TaskStatus } from "./types";
import "./App.css";

const STATUS_CLASS: Record<TaskStatus, string> = {
  UNCLAIMED: "st-unclaimed",
  LEASED: "st-leased",
  DONE: "st-done",
};

export default function App() {
  const { snapshot, wsOpen, url } = useSnapshot();

  // The "all systems connected" indicator: green ONLY when the WebSocket is
  // open AND the latest snapshot reports the coordinator's bus is healthy
  // (connected: true). Anything else is degraded.
  const worldConnected = snapshot?.connected === true;
  const allConnected = wsOpen && worldConnected;

  let statusLabel: string;
  let statusKind: "ok" | "warn" | "down";
  if (allConnected) {
    statusLabel = "all systems connected";
    statusKind = "ok";
  } else if (wsOpen) {
    // Socket up but the world says it is not (yet) healthy.
    statusLabel = "gateway up · world not connected";
    statusKind = "warn";
  } else {
    statusLabel = "disconnected · reconnecting…";
    statusKind = "down";
  }

  const tasks = snapshot?.tasks ?? [];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          SwarmBuild <span className="brand-sub">dashboard</span>
        </div>
        <div className={`status status-${statusKind}`}>
          <span className="status-dot" />
          <span className="status-label">{statusLabel}</span>
        </div>
        <div className="meta">{url}</div>
      </header>

      <main className="stage">
        <aside className="ledger">
          <h2>Task ledger</h2>
          {tasks.length === 0 ? (
            <p className="ledger-empty">no tasks yet</p>
          ) : (
            <ul>
              {tasks.map((t) => (
                <li key={t.id}>
                  <span className={`badge ${STATUS_CLASS[t.status] ?? ""}`}>
                    {t.status}
                  </span>
                  <span className="ledger-id">{t.id}</span>
                  <span className="ledger-type">{t.type}</span>
                  {t.assignee && <span className="ledger-assignee">← {t.assignee}</span>}
                </li>
              ))}
            </ul>
          )}

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

          <div className="counts">
            {snapshot
              ? `${snapshot.rovers.length} rovers · ${tasks.length} tasks`
              : "—"}
          </div>
        </aside>

        <WorldCanvas snapshot={snapshot} />
      </main>
    </div>
  );
}
