// App — the SwarmBuild dashboard shell. Pure re-render of the latest snapshot:
// a connection indicator (header), the task ledger (top-left), the kill panel
// (top-right, when a rover is selected), and the 3D worksite scene. No state
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
import { BlueprintPalette } from "./components/BlueprintPalette";
import { LoadingScreen } from "./components/LoadingScreen";
// Type-only — erased at build time, so referencing the camera view-mode type
// here does NOT pull the lazy three.js Scene3D chunk into the eager shell bundle.
import type { ViewMode } from "./components/Scene3D";
import { blueprintById } from "./lib/blueprintCatalog";
import {
  ghostTasks,
  placeBlueprintControl,
  placementValid,
  type Footprint,
  type Ghost,
} from "./lib/placement";
import type { BuildMode, Vec2 } from "./types/wire";
import "./styles/dashboard.css";

// The 3D scene drags in three.js + drei + postprocessing (~300 kB gzipped), so
// it is code-split into its own chunk and loaded on demand. The shell stays
// lightweight so it never pays to parse three.js up front; in-scene primitive
// fallbacks (ADR-0004) cover any per-asset failure once the scene mounts.
const Scene3D = lazy(() =>
  import("./components/Scene3D").then((m) => ({ default: m.Scene3D })),
);

// Reveal no later than this even if a load hangs entirely (ADR-0004 safety
// backstop): preloadAllAssets settles per-asset (never rejects), but a load that
// never settles at all must not trap the user behind the splash.
const SAFETY_TIMEOUT_MS = 9000;

export default function App() {
  const { snapshot, earth, wsOpen, url, send } = useSnapshot();

  // Selection is the ONLY new client state — the dashboard stays a pure
  // re-render of the snapshot otherwise (ADR-0004). Two-step kill: click a
  // rover to select, then click KILL, so a stray click never kills.
  const [selected, setSelected] = useState<string | null>(null);

  // Camera view-mode (issue #49). Defaults to "surface" — the rehearsed fixed
  // worksite framing (ADR-0004). The operator can flip to "orbit" to pull the
  // camera back and take in the distant parked Moon; both framings stay clamped.
  const [viewMode, setViewMode] = useState<ViewMode>("surface");

  // --- Preload-everything-behind-a-splash (Epic 05 P1). On mount we kick the
  // explicit asset preload (lib/assets) AND warm the lazy Scene3D chunk, both via
  // DYNAMIC import() so the three.js-pulling manifest never lands in the light
  // shell bundle. The Canvas is gated on `ready`, which latches true when the
  // preload resolves OR a safety timeout fires — ONE-WAY, so the splash never
  // re-shows on later on-demand loads (ADR-0004). `progress` (0..1) drives the bar.
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let settled = false; // one-way reveal guard
    const reveal = () => {
      if (settled) return;
      settled = true;
      setReady(true);
    };
    // Safety backstop: reveal even if a load hangs forever (ADR-0004).
    const timer = window.setTimeout(reveal, SAFETY_TIMEOUT_MS);
    // Warm the lazy Scene3D JS chunk in parallel with the asset decode so the
    // chunk parse doesn't add a stall after the bar fills.
    void import("./components/Scene3D");
    // Kick the asset preload via a dynamic import (keeps three out of the shell).
    void import("./lib/assets").then(({ preloadAllAssets }) =>
      preloadAllAssets((loaded, total) => {
        setProgress(total > 0 ? loaded / total : 1);
      }).then(reveal),
    );
    return () => window.clearTimeout(timer);
  }, []);

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
    mode: BuildMode; // per-placement build mode (bh-08c): "replay" (default) | "live"
  } | null>(null);

  const startPlacement = useCallback((blueprintId: string) => {
    setSelected(null); // placing and rover-selection are mutually exclusive modes
    setPlacement((prev) =>
      // Clicking the active blueprint again cancels; clicking another switches.
      prev?.blueprintId === blueprintId
        ? null
        : { blueprintId, origin: null, rotation: 0, mode: "replay" },
    );
  }, []);

  const rotatePlacement = useCallback((rotation: number) => {
    setPlacement((p) => (p ? { ...p, rotation } : p));
  }, []);

  const setPlacementMode = useCallback((mode: BuildMode) => {
    setPlacement((p) => (p ? { ...p, mode } : p));
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
    send(
      placeBlueprintControl(
        placement.blueprintId,
        placement.origin,
        placement.rotation,
        placement.mode, // per-placement replay/live choice (bh-08c)
      ),
    );
    setPlacement(null);
  }, [placement, placementInvalidReason, send]);

  // The header indicator: green ONLY when the WebSocket is open AND the latest
  // snapshot reports the coordinator's bus is healthy (pure derivation).
  const status = connectionStatus(wsOpen, snapshot?.connected === true);

  const tasks = snapshot?.tasks ?? [];

  // The ghost the scene draws while placing: the catalog blueprint's tasks
  // instantiated at the cursor origin + rotation, with validity, threaded to the
  // 3D scene. Null when not placing or before the cursor hits the ground.
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
              ? { blueprintId: placement.blueprintId, rotation: placement.rotation, mode: placement.mode, invalidReason: placementInvalidReason }
              : null
          }
          onStart={startPlacement}
          onRotate={rotatePlacement}
          onModeChange={setPlacementMode}
          onConfirm={confirmPlacement}
          onCancel={cancelPlacement}
        />

        {selectedRover ? (
          <KillPanel rover={selectedRover} onKill={kill} onDismiss={dismiss} />
        ) : null}

        {/* Stress dials, bottom-left. The latency slider is wired here so it can
            be promoted into the demo arc with a one-line change (issue 09). */}
        <ControlsPanel
          send={send}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />

        {/* The DELAYED Earth view, bottom-right — it lags the live TaskLedger
            (top-left) as latency climbs, proving "Earth never knew" (issue 09). */}
        <EarthPanel earth={earth} snapshotAt={snapshot?.at ?? null} />

        {/* The 3D scene is the sole renderer (ADR-0004). Everything preloads
            behind the branded splash; the Canvas mounts only once `ready` (preload
            resolved OR safety timeout), so nothing pops in later — even on descent.
            The lazy chunk's Suspense fallback is the same splash, so a slow chunk
            parse is covered by the same branded screen. */}
        <LoadingScreen progress={progress} revealed={ready} />
        {ready ? (
          <Suspense
            fallback={<LoadingScreen progress={progress} revealed={false} />}
          >
            <Scene3D
              snapshot={snapshot}
              selected={selectedRover ? selected : null}
              onPick={setSelected}
              placing={placement !== null}
              ghost={ghost}
              onPlaceMove={movePlacement}
              onPlaceConfirm={confirmPlacement}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
            />
          </Suspense>
        ) : null}
      </main>
    </div>
  );
}
