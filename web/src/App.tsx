
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSnapshot } from "./hooks/useSnapshot";
import { connectionStatus } from "./lib/connection";
import { TopBar } from "./components/TopBar";
import { MissionHud } from "./components/MissionHud";
import { KillPanel } from "./components/KillPanel";
import { EarthPanel } from "./components/EarthPanel";
import { Hotbar } from "./components/Hotbar";
import { LoadingScreen } from "./components/LoadingScreen";
import type { SiteId, ViewMode } from "./components/Scene3D";
import { blueprintById } from "./lib/blueprintCatalog";
import {
  ghostTasks,
  placeBlueprintControl,
  placementValid,
  type Footprint,
  type Ghost,
} from "./lib/placement";
import { missionStats, tasksForSite } from "./lib/missionStats";
import type { Vec2 } from "./types/wire";
import "./styles/dashboard.css";

const Scene3D = lazy(() =>
  import("./components/Scene3D").then((m) => ({ default: m.Scene3D })),
);

const SAFETY_TIMEOUT_MS = 9000;

export default function App() {
  const { snapshot, earth, wsOpen, url, send } = useSnapshot();

  const [selected, setSelected] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("orbit");

  const [activeSite, setActiveSite] = useState<SiteId>("lunar");


  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let settled = false;
    const reveal = () => {
      if (settled) return;
      settled = true;
      setReady(true);
    };
    const timer = window.setTimeout(reveal, SAFETY_TIMEOUT_MS);
    void import("./components/Scene3D");
    void import("./lib/assets")
      .then(({ preloadAllAssets }) =>
        preloadAllAssets((loaded, total) => {
          setProgress(total > 0 ? loaded / total : 1);
        }).then(reveal),
      )
      .catch((err) => {
        console.error("[asset] preload chunk failed to load:", err);
      });
    return () => window.clearTimeout(timer);
  }, []);

  const selectedRover = selected
    ? snapshot?.rovers.find((r) => r.id === selected)
    : undefined;

  const kill = useCallback(
    (id: string) => {
      send({ cmd: "kill", robot: id });
      setSelected(null);
    },
    [send],
  );
  const dismiss = useCallback(() => setSelected(null), []);

  const [placement, setPlacement] = useState<{
    blueprintId: string;
    origin: Vec2 | null;
    rotation: number;
  } | null>(null);

  const startPlacement = useCallback((blueprintId: string) => {
    setSelected(null);
    setPlacement((prev) =>
      prev?.blueprintId === blueprintId ? null : { blueprintId, origin: null, rotation: 0 },
    );
  }, []);

  const movePlacement = useCallback((origin: Vec2) => {
    setPlacement((p) => (p ? { ...p, origin } : p));
  }, []);
  const rotatePlacement = useCallback((rotation: number) => {
    setPlacement((p) => (p ? { ...p, rotation } : p));
  }, []);

  const cancelPlacement = useCallback(() => setPlacement(null), []);

  useEffect(() => {
    if (placement === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      cancelPlacement();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [placement, cancelPlacement]);

  const cycleSite = useCallback(
    () => setActiveSite((s) => (s === "lunar" ? "shackleton" : "lunar")),
    [],
  );

  const obstacles = useMemo<Footprint[]>(() => {
    const ts = snapshot?.tasks ?? [];
    return ts
      .filter((t) => (t.site ?? "lunar") === activeSite)
      .map((t) => ({ cx: t.pos.X, cy: t.pos.Y, halfX: 6, halfY: 6 }));
  }, [snapshot, activeSite]);

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
    send(
      placeBlueprintControl(placement.blueprintId, placement.origin, placement.rotation),
    );
    setPlacement(null);
  }, [placement, placementInvalidReason, send]);

  const status = connectionStatus(wsOpen, snapshot?.connected === true);

  const tasks = snapshot?.tasks ?? [];

  const siteTasks = useMemo(
    () => tasksForSite(tasks, activeSite),
    [tasks, activeSite],
  );
  const stats = useMemo(
    () => missionStats(tasks, snapshot?.rovers ?? [], activeSite),
    [tasks, snapshot, activeSite],
  );

  const ghost = useMemo<Ghost | null>(() => {
    if (!placement || !placement.origin) return null;
    const bp = blueprintById(placement.blueprintId);
    if (!bp) return null;
    return {
      tasks: ghostTasks(bp.tasks, placement.origin, placement.rotation),
      invalid: placementInvalidReason !== null,
    };
  }, [placement, placementInvalidReason]);

  const isSurface = viewMode === "surface";

  return (
    <div className="app">
      <TopBar
        status={status}
        url={url}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      <main className="stage">
        <div className={`hud-stage ${isSurface ? "hud--surface" : "hud--orbit"}`}>
          <MissionHud
            tasks={siteTasks}
            done={stats.done}
            total={stats.total}
            roversAlive={stats.roversAlive}
            roversTotal={stats.roversTotal}
            hasSnapshot={snapshot !== null}
          />

          <Hotbar
            activeBlueprintId={placement?.blueprintId ?? null}
            onPickBlueprint={startPlacement}
            activeSite={activeSite}
            onCycleSite={cycleSite}
            send={send}
          />

          {isSurface && placement !== null ? (
            <div className="place-hint" role="status">
              <b>L</b> place · <b>R-drag</b> rotate · <b>scroll</b> zoom · <b>ESC</b> cancel
            </div>
          ) : null}

          {isSurface && selectedRover ? (
            <KillPanel rover={selectedRover} onKill={kill} onDismiss={dismiss} />
          ) : null}

          <EarthPanel earth={earth} snapshotAt={snapshot?.at ?? null} />
        </div>

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
              placementRotation={placement?.rotation ?? 0}
              placementInvalidReason={placementInvalidReason}
              onPlaceMove={movePlacement}
              onPlaceConfirm={confirmPlacement}
              onPlaceRotate={rotatePlacement}
              onPlaceCancel={cancelPlacement}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              activeSite={activeSite}
              onActiveSiteChange={setActiveSite}
            />
          </Suspense>
        ) : null}
      </main>
    </div>
  );
}
