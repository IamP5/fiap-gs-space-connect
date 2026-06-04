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
import { ControlsPanel } from "./components/ControlsPanel";
import { EarthPanel } from "./components/EarthPanel";
import { WorldCanvas } from "./components/WorldCanvas";
import { Scene3D } from "./components/Scene3D";
import "./styles/dashboard.css";

// Which renderer draws the worksite. Both are PURE functions of the same
// snapshot (ADR-0004), so toggling between them can never change World Model
// state — the 3D scene is the headline; the 2D canvas is the rehearsed fallback.
type Renderer = "3d" | "2d";

export default function App() {
  const { snapshot, earth, wsOpen, url, send } = useSnapshot();

  // Selection is the ONLY new client state — the dashboard stays a pure
  // re-render of the snapshot otherwise (ADR-0004). Two-step kill: click a
  // rover to select, then click KILL, so a stray click never kills.
  const [selected, setSelected] = useState<string | null>(null);

  // The renderer toggle. Defaults to the 3D diorama (the pitch); the 2D canvas
  // stays a one-click fallback if 3D ever misbehaves on the projector.
  const [renderer, setRenderer] = useState<Renderer>("3d");

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
        <div className="renderer-toggle" role="group" aria-label="Renderer">
          <button
            type="button"
            className={`renderer-btn ${renderer === "3d" ? "is-active" : ""}`}
            aria-pressed={renderer === "3d"}
            onClick={() => setRenderer("3d")}
          >
            3D
          </button>
          <button
            type="button"
            className={`renderer-btn ${renderer === "2d" ? "is-active" : ""}`}
            aria-pressed={renderer === "2d"}
            onClick={() => setRenderer("2d")}
          >
            2D
          </button>
        </div>
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

        {/* Stress dials, bottom-left. The latency slider is wired here so it can
            be promoted into the demo arc with a one-line change (issue 09). */}
        <ControlsPanel send={send} />

        {/* The DELAYED Earth view, bottom-right — it lags the live TaskLedger
            (top-left) as latency climbs, proving "Earth never knew" (issue 09). */}
        <EarthPanel earth={earth} snapshotAt={snapshot?.at ?? null} />

        {/* Both renderers honor the SAME {snapshot, selected, onPick} contract,
            so the toggle swaps them with no other change. The 2D WorldCanvas is
            kept fully functional as the rehearsed fallback (ADR-0004). */}
        {renderer === "3d" ? (
          <Scene3D
            snapshot={snapshot}
            selected={selectedRover ? selected : null}
            onPick={setSelected}
          />
        ) : (
          <WorldCanvas
            snapshot={snapshot}
            selected={selectedRover ? selected : null}
            onPick={setSelected}
          />
        )}
      </main>
    </div>
  );
}
