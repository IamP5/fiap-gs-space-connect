// App — the SwarmBuild dashboard shell. Pure re-render of the latest snapshot:
// a connection indicator (header), the task ledger (top-left), the kill panel
// (top-right, when a rover is selected), and the 2D world canvas. No state
// libraries, no router — React + a canvas is enough. App owns only selection
// state; everything else is derived from the snapshot and pushed into small
// memoized presentational components (StatusIndicator, TaskLedger, KillPanel).

import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSnapshot } from "./hooks/useSnapshot";
import { connectionStatus } from "./lib/connection";
import { StatusIndicator } from "./components/StatusIndicator";
import { TaskLedger } from "./components/TaskLedger";
import { KillPanel } from "./components/KillPanel";
import { ControlsPanel } from "./components/ControlsPanel";
import { EarthPanel } from "./components/EarthPanel";
import { PartitionPanel } from "./components/PartitionPanel";
import { EncorePanel } from "./components/EncorePanel";
import { BlueprintPalette } from "./components/BlueprintPalette";
import { WorldCanvas } from "./components/WorldCanvas";
import { blueprintById } from "./lib/blueprintCatalog";
import {
  ghostTasks,
  placementValid,
  type Footprint,
  type Ghost,
} from "./lib/placement";
import type { Vec2 } from "./types/wire";
import "./styles/dashboard.css";

// The 3D scene drags in three.js + drei + postprocessing (~300 kB gzipped), so
// it is code-split into its own chunk and loaded on demand. The lightweight 2D
// WorldCanvas (the rehearsed fallback, ADR-0004) stays eager, so the shell and
// the fallback path never pay to parse three.js up front.
const Scene3D = lazy(() =>
  import("./components/Scene3D").then((m) => ({ default: m.Scene3D })),
);

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

  // Reload-demo: a single global control frame that resets the board so the
  // swarm rebuilds the dome from scratch (the Coordinator re-seeds the
  // worksite). This is a CONTROL, not world state — it stays out of the
  // snapshot re-render path (ADR-0004). The only local state is a brief
  // disabled "Reloading…" pulse so the operator sees the click registered; the
  // authoritative result still arrives via the next snapshot.
  const [reloading, setReloading] = useState(false);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const reloadDemo = useCallback(() => {
    // Browser → server control frame; the gateway relays it onto NATS
    // `control.command` and the Coordinator resets the board → the dome rebuilds.
    send({ cmd: "reloadDemo" });
    setReloading(true);
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => setReloading(false), 1200);
  }, [send]);

  // Clear the feedback timer on unmount so a pending setState never fires on a
  // gone component.
  useEffect(
    () => () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
    },
    [],
  );

  // --- Drag-to-place (bh-05). The active placement is transient CLIENT state —
  // it never enters the snapshot re-render path; placed tasks appear via the next
  // snapshot once the coordinator validates + injects (ADR-0004). App owns the
  // blueprint id + cursor origin + rotation; the scene raycasts the origin and
  // draws the ghost. Confirm emits a placeBlueprint control. ---
  const [placement, setPlacement] = useState<{
    blueprintId: string;
    origin: Vec2 | null;
    rotation: number;
  } | null>(null);

  const startPlacement = useCallback((blueprintId: string) => {
    setSelected(null); // placing and rover-selection are mutually exclusive modes
    setPlacement((prev) =>
      // Clicking the active blueprint again cancels; clicking another switches.
      prev?.blueprintId === blueprintId
        ? null
        : { blueprintId, origin: null, rotation: 0 },
    );
  }, []);

  const rotatePlacement = useCallback((rotation: number) => {
    setPlacement((p) => (p ? { ...p, rotation } : p));
  }, []);

  const movePlacement = useCallback((origin: Vec2) => {
    setPlacement((p) => (p ? { ...p, origin } : p));
  }, []);

  const cancelPlacement = useCallback(() => setPlacement(null), []);

  // Existing structures' footprints, derived from the snapshot's task positions,
  // so the client can mirror the server's no-overlap gate. Each task gets a small
  // default footprint (the server uses a like default for tasks without an
  // envelope). Pure read of the snapshot.
  const obstacles = useMemo<Footprint[]>(() => {
    const ts = snapshot?.tasks ?? [];
    return ts.map((t) => ({ cx: t.pos.X, cy: t.pos.Y, halfX: 6, halfY: 6 }));
  }, [snapshot]);

  // The live validity of the current placement (client mirror of the server gate),
  // recomputed as the cursor/rotation move. Null origin ⇒ "move the cursor" hint
  // (treated as not-yet-valid). Pure derivation, never world state.
  const placementInvalidReason = useMemo<string | null>(() => {
    if (!placement) return null;
    if (!placement.origin) return "move the cursor onto the worksite";
    const bp = blueprintById(placement.blueprintId);
    if (!bp) return "unknown blueprint";
    const ghosts = ghostTasks(bp.tasks, placement.origin, placement.rotation);
    return placementValid(ghosts, obstacles);
  }, [placement, obstacles]);

  const confirmPlacement = useCallback(() => {
    if (!placement || !placement.origin || placementInvalidReason) return;
    // Browser → server control frame; the gateway relays it onto NATS
    // `control.command` and the coordinator validates + injects the DAG.
    send({
      cmd: "placeBlueprint",
      blueprint_id: placement.blueprintId,
      origin: placement.origin,
      rotation: placement.rotation,
    });
    setPlacement(null);
  }, [placement, placementInvalidReason, send]);

  // The header indicator: green ONLY when the WebSocket is open AND the latest
  // snapshot reports the coordinator's bus is healthy (pure derivation).
  const status = connectionStatus(wsOpen, snapshot?.connected === true);

  const tasks = snapshot?.tasks ?? [];

  // The ghost the scene draws while placing: the catalog blueprint's tasks
  // instantiated at the cursor origin + rotation, with validity, threaded to the
  // active renderer. Null when not placing or before the cursor hits the ground.
  const ghost = useMemo<Ghost | null>(() => {
    if (!placement || !placement.origin) return null;
    const bp = blueprintById(placement.blueprintId);
    if (!bp) return null;
    return {
      tasks: ghostTasks(bp.tasks, placement.origin, placement.rotation),
      invalid: placementInvalidReason !== null,
    };
  }, [placement, placementInvalidReason]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          SwarmBuild <span className="brand-sub">dashboard</span>
        </div>
        <StatusIndicator status={status} />
        <button
          type="button"
          className="reload-btn"
          onClick={reloadDemo}
          disabled={reloading}
          aria-disabled={reloading}
          title="Reset the board so the swarm rebuilds the dome"
        >
          {reloading ? "Reloading…" : "Reload demo"}
        </button>
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

        {/* Drag-to-place authoring (bh-05): list catalog Blueprints; a click
            starts a placement, the 3D scene previews the ghost, confirm emits a
            placeBlueprint control. */}
        <BlueprintPalette
          placement={
            placement
              ? { blueprintId: placement.blueprintId, rotation: placement.rotation, invalidReason: placementInvalidReason }
              : null
          }
          onStart={startPlacement}
          onRotate={rotatePlacement}
          onConfirm={confirmPlacement}
          onCancel={cancelPlacement}
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

        {/* Right-edge "lab" dock — explicitly opt-in, collapsible affordances that
            never auto-play and must never pre-empt the headline heal (ADR-0003).
            The PartitionPanel replays the proven CRDT merge as a local-state
            narrative; the EncorePanel triggers the real container kill (issue 11).
            Both stay OUT of the 10 Hz snapshot re-render path (memoized). */}
        <div className="encore-column">
          <PartitionPanel />
          <EncorePanel send={send} />
        </div>

        {/* Both renderers honor the SAME {snapshot, selected, onPick} contract,
            so the toggle swaps them with no other change. The 2D WorldCanvas is
            kept fully functional as the rehearsed fallback (ADR-0004). */}
        {renderer === "3d" ? (
          // Suspense covers the lazy three.js chunk; the fallback is the same 2D
          // canvas, so the worksite is visible instantly even before 3D loads.
          <Suspense
            fallback={
              <WorldCanvas
                snapshot={snapshot}
                selected={selectedRover ? selected : null}
                onPick={setSelected}
              />
            }
          >
            <Scene3D
              snapshot={snapshot}
              selected={selectedRover ? selected : null}
              onPick={setSelected}
              placing={placement !== null}
              ghost={ghost}
              onPlaceMove={movePlacement}
              onPlaceConfirm={confirmPlacement}
            />
          </Suspense>
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
