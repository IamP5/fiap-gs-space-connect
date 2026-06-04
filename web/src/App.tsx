// App — the SwarmBuild dashboard shell. Pure re-render of the latest snapshot:
// a connection indicator (header), the task ledger (top-left), the kill panel
// (top-right, when a rover is selected), and the 2D world canvas. No state
// libraries, no router — React + a canvas is enough. App owns only selection
// state; everything else is derived from the snapshot and pushed into small
// memoized presentational components (StatusIndicator, TaskLedger, KillPanel).

import { useCallback, useState } from "react";
import { useSnapshot } from "./hooks/useSnapshot";
import { connectionStatus } from "./lib/connection";
import { StatusIndicator } from "./components/StatusIndicator";
import { TaskLedger } from "./components/TaskLedger";
import { KillPanel } from "./components/KillPanel";
import { WorldCanvas } from "./components/WorldCanvas";
import "./styles/dashboard.css";

export default function App() {
  const { snapshot, wsOpen, url, send } = useSnapshot();

  // Selection is the ONLY new client state — the dashboard stays a pure
  // re-render of the snapshot otherwise (ADR-0004). Two-step kill: click a
  // rover to select, then click KILL, so a stray click never kills.
  const [selected, setSelected] = useState<string | null>(null);

  // The currently-selected rover, resolved against the LATEST snapshot. If it
  // has vanished from the snapshot, this is undefined → treated as deselected.
  const selectedRover = selected
    ? snapshot?.rovers.find((r) => r.id === selected)
    : undefined;

  // Stable handlers, so the memoized KillPanel only re-renders on rover change,
  // never on callback identity. The alive-guard lives in KillPanel (KILL is only
  // rendered for a live rover), so onKill can only fire for a killable rover.
  const kill = useCallback(
    (id: string) => {
      // Browser → server control frame; the gateway relays it onto NATS
      // `control.command` and the rover flag-flips dead (<100ms).
      send({ cmd: "kill", robot: id });
      setSelected(null);
    },
    [send],
  );
  const dismiss = useCallback(() => setSelected(null), []);

  // The header indicator: green ONLY when the WebSocket is open AND the latest
  // snapshot reports the coordinator's bus is healthy (pure derivation).
  const status = connectionStatus(wsOpen, snapshot?.connected === true);

  const tasks = snapshot?.tasks ?? [];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          SwarmBuild <span className="brand-sub">dashboard</span>
        </div>
        <StatusIndicator status={status} />
        <div className="meta">{url}</div>
      </header>

      <main className="stage">
        <TaskLedger
          tasks={tasks}
          roverCount={snapshot?.rovers.length ?? 0}
          hasSnapshot={snapshot !== null}
        />

        {selectedRover ? (
          <KillPanel rover={selectedRover} onKill={kill} onDismiss={dismiss} />
        ) : null}

        <WorldCanvas
          snapshot={snapshot}
          selected={selectedRover ? selected : null}
          onPick={setSelected}
        />
      </main>
    </div>
  );
}
