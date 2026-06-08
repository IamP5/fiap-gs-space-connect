// App — the SwarmBuild dashboard shell. Pure re-render of the latest snapshot:
// a connection indicator (header), the task ledger (top-left), the kill panel
// (top-right, when a rover is selected), and the 3D worksite scene. No state
// libraries, no router — React + a canvas is enough. App owns only selection
// state; everything else is derived from the snapshot and pushed into small
// memoized presentational components (StatusIndicator, MissionHud, KillPanel).

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
import { TopBar } from "./components/TopBar";
import { MissionHud } from "./components/MissionHud";
import { KillPanel } from "./components/KillPanel";
import { EarthPanel } from "./components/EarthPanel";
import { Hotbar } from "./components/Hotbar";
import { LoadingScreen } from "./components/LoadingScreen";
import { CinematicCopy } from "./components/CinematicCopy";
// Type-only — erased at build time, so referencing the camera view-mode type
// here does NOT pull the lazy three.js Scene3D chunk into the eager shell bundle.
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
import {
  armedFromSearch,
  isArmToggle,
  isCueKill,
  isTypingTarget,
} from "./lib/cinematicArm";
import { copyStepDir, stepCursor } from "./lib/reel/copy";
import {
  cycleLockOn,
  isMarkerFlip,
  isMarkerLockOn,
  type MarkerSite,
} from "./lib/reel/markerCue";
import { isOpenCue } from "./lib/reel/openArc";
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

  // Camera view-mode (issue #49). Defaults to "orbit" — on reveal the scene
  // settles in the distant parked-Moon vista (no auto push-in; the surface intro
  // fly-in self-disables off-surface). Clicking the base marker flies the descent
  // to the rehearsed worksite framing (ADR-0004); both framings stay clamped.
  const [viewMode, setViewMode] = useState<ViewMode>("orbit");

  // Active surface site (Epic 04 P2). The surface renders ONE worksite at a time;
  // this picks which. Defaults to "lunar" so the existing single base marker
  // descends to the lunar site and the snapshot's untagged rovers/tasks (?? "lunar")
  // are shown. Orthogonal to viewMode: orbit is site-agnostic, surface shows this
  // site. (Two orbit markers + descend-to-site are a later slice, #137.)
  const [activeSite, setActiveSite] = useState<SiteId>("lunar");

  // --- Persistent "LLM Generated" build mode (Epic 06 P1). The bottom hotbar's
  // checkbox owns this flag (default false = deterministic Replay); when checked,
  // the NEXT placement is seeded as "live" (the Build harness generates it inline).
  // This is the ONLY new global client state this slice adds (additive per
  // ADR-0004): a persistent UI preference, NOT world state. It REPLACES the old
  // per-placement Replay/Live toggle — `startPlacement` seeds `placement.mode`
  // from it, so the existing `mode` field on the placeBlueprint control is
  // threaded with NO wire/back-end change.
  const [liveMode, setLiveMode] = useState(false);

  // --- Cinematic HUD hide (Epic 06 P0). `H` fades ALL HUD out (and back) for a
  // clean, panel-free screenshot of the 3D scene. This is the ONLY new global
  // client state this slice adds (additive per ADR-0004); it's a pure UI flag,
  // never world state. A window keydown listener toggles it; when true the stage
  // wrapper gets a `hud--hidden` class that drops both opacity AND pointer-events
  // so a hidden HUD never eats clicks. The Canvas lives OUTSIDE the faded wrapper,
  // so the scene is unaffected. We ignore the key while typing in a field so it
  // can never hijack text entry.
  const [hudHidden, setHudHidden] = useState(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "h" && e.key !== "H") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      setHudHidden((v) => !v);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // --- Cinematic arming (Epic 07 S2 · #155, ADR-0011). `cinematic` is an
  // ADDITIVE client-only UI flag — the same ADR-0004 carve-out as `hudHidden`
  // above; it invents ZERO snapshot/wire fields and the dashboard stays a pure
  // re-render of the server snapshot. It has two entry points: the `?reel=1` URL
  // param seeds the INITIAL value on load (capture tooling, not a domain concept
  // — the layer is "interactive Choreography", CONTEXT.md), and the `R` key
  // toggles it live during a take. While DISARMED every cue handler below no-ops,
  // so the normal app is byte-for-byte unchanged. Later slices (#156/#157/#158)
  // gate their Scenery cues on this same flag, so it's threaded as a prop-ready
  // piece of App state. We read the URL ONCE at mount (lazy useState init) — it's
  // a one-shot seed, not reactive to history changes.
  const [cinematic, setCinematic] = useState(() =>
    armedFromSearch(typeof window === "undefined" ? "" : window.location.search),
  );

  // The cinematic copy-overlay cursor (Epic 07 S3 · #156). Another ADDITIVE
  // client-only UI flag (ADR-0004 carve-out) — it invents ZERO snapshot/wire
  // fields. -1 = clean stage (no copy burned in); the operator steps it through
  // the ordered script §6 beats (lib/reel/copy) with `]`/`[`. Stepping back past
  // the first beat returns to -1 (clean stage). Only mutated while armed; disarm
  // never resets it, so re-arming resumes where the take left off.
  const [copyCursor, setCopyCursor] = useState(-1);

  // The cinematic marker cues (Epic 07 S4 · #157). Two more ADDITIVE client-only
  // UI flags (the ADR-0004 carve-out) — they invent ZERO snapshot/wire fields and
  // only DRIVE Scenery visuals the orbit markers already own:
  //   · `lockedSite` forces the lock-on look on a chosen marker without a mouse
  //     hover (`M` cycles null → lunar → shackleton → null) — Beats 3/6.
  //   · `markerFlip` flips the Shackleton marker cyan/"operational" over the close
  //     (`B` toggles) — Beat 15. A Scenery transition: asserts no World Model state.
  // Only mutated while armed; disarm never resets them, so re-arming resumes the
  // take. `MarkerSite` is the lib's site union (identical to Scene3D's `SiteId`).
  const [lockedSite, setLockedSite] = useState<MarkerSite | null>(null);
  const [markerFlip, setMarkerFlip] = useState(false);

  // The orbit-open camera-arc cue (Epic 07 S5 · #158, Beats 1–2). One more ADDITIVE
  // client-only UI flag (the ADR-0004 carve-out) — it invents ZERO snapshot/wire
  // fields and only DRIVES Scenery the Scene3D <CinematicOpen> rig owns: while true
  // the camera drifts the dark lunar limb then ARCS so the *fixed* sun's godrays
  // crest in, easing into ORBIT_POSE ("lost in the dark, found by the sun"). `O`
  // toggles it (mnemonic: open) — press once to run the open; pressing again cancels
  // mid-arc (the rig settles cleanly into ORBIT_POSE). The SUN never moves (camera-
  // arc, not sun-arc). Only mutated while armed; disarm never resets it. FALLBACK-
  // READY: if never fired, the orbit is byte-for-byte unchanged (a cold ORBIT_POSE
  // hold + the descent glare carries "found by light"), so the cue never blocks.
  const [cinematicOpen, setCinematicOpen] = useState(false);

  // One-shot disarm for the orbit-open arc: the <CinematicOpen> rig calls this when
  // its arc finishes (or is interrupted) so the cue plays EXACTLY once. Stable
  // (setState identity) — it's an effect dependency inside the rig. Without it the
  // flag stayed latched and the arc re-fired on every return to orbit (the ascent
  // bookend), capturing a mid-ascent pose and fighting the ascent driver.
  const disarmCinematicOpen = useCallback(() => setCinematicOpen(false), []);

  // The single cinematic cue this slice owns: the climax kill. While armed, one
  // `K` press emits exactly `{cmd:"cueKill"}` once (the keydown handler ignores
  // OS key-repeat via `e.repeat`, so holding the key still fires only once per
  // physical press — the acceptance criterion). The browser carries NO "which
  // Rover / when" logic: the
  // Coordinator releases the held `lunar/wall-1`, positions a Rover, and fires the
  // in-process kill (Expiry → Re-auction → a survivor seals the dome). cmd-only,
  // matching the `cueKill` verb #154 added to types/wire.ts.
  const cueKill = useCallback(() => {
    send({ cmd: "cueKill" });
  }, [send]);

  // One window keydown listener owns BOTH cinematic keys (dedup'd per
  // vercel client-event-listeners). `R` toggles arm at any time; `K` fires the
  // cue ONLY while armed (disarmed ⇒ no-op, normal app unchanged). Both yield to
  // text-entry contexts so they never hijack typing. We ignore OS key-repeat
  // (`e.repeat`) so HOLDING a key can't flicker the arm flag or fire the cue more
  // than ONCE per physical press (the acceptance criterion). Re-subscribes when
  // `armed` or the stable `cueKill` change so the closure reads fresh values.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (isTypingTarget(e.target as HTMLElement | null)) return;
      if (isArmToggle(e)) {
        setCinematic((v) => !v);
        return;
      }
      if (cinematic && isCueKill(e)) {
        cueKill();
        return;
      }
      // Copy-overlay step (#156): `]`/`[` advance/retreat the burned-in copy
      // cursor through the script §6 beats — armed-only, so disarmed presses are
      // a no-op (normal app unchanged). Scenery: no World Model state touched.
      if (cinematic) {
        const dir = copyStepDir(e);
        if (dir !== 0) {
          setCopyCursor((c) => stepCursor(c, dir));
          return;
        }
      }
      // Marker cues (#157): `M` cycles the lock-on target, `B` toggles the
      // Shackleton bookend flip — armed-only, so disarmed presses are a no-op.
      // Pure Scenery: drives the markers' existing visuals, touches no World Model.
      if (cinematic && isMarkerLockOn(e)) {
        setLockedSite((s) => cycleLockOn(s));
        return;
      }
      if (cinematic && isMarkerFlip(e)) {
        setMarkerFlip((v) => !v);
        return;
      }
      // Orbit-open camera-arc (#158): `O` toggles the open cue — armed-only, so a
      // disarmed press is a no-op (normal app unchanged). Pure Scenery: it drives
      // the Scene3D <CinematicOpen> rig (camera-arc, the sun never moves), touches
      // no World Model. ALSO gated on `viewMode === "orbit"`: the rig only runs in
      // orbit, so a surface press must not LATCH the flag true — otherwise it stays
      // armed and the arc fires on the next return to orbit (the ascent bookend),
      // capturing a mid-ascent pose and fighting the ascent driver. Fallback-ready:
      // never firing it leaves the orbit unchanged.
      if (cinematic && viewMode === "orbit" && isOpenCue(e)) {
        setCinematicOpen((v) => !v);
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cinematic, cueKill, viewMode]);

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

  const startPlacement = useCallback(
    (blueprintId: string) => {
      setSelected(null); // placing and rover-selection are mutually exclusive modes
      setPlacement((prev) =>
        // Clicking the active blueprint again cancels; clicking another switches.
        prev?.blueprintId === blueprintId
          ? null
          : // Seed the build mode from the persistent hotbar toggle (Epic 06 P1):
            // the placeBlueprint control's `mode` field is threaded from liveMode,
            // replacing the old per-placement Replay/Live picker.
            { blueprintId, origin: null, rotation: 0, mode: liveMode ? "live" : "replay" },
      );
    },
    [liveMode],
  );

  // `mode` is seeded ONCE in startPlacement from the persistent `liveMode` toggle.
  // `movePlacement` tracks the cursor origin; `rotatePlacement` is the in-scene
  // right-drag-rotate mutator (#151) — the scene maps a horizontal drag delta to an
  // absolute rotation (radians) and pushes it here, replacing the old slider.
  const movePlacement = useCallback((origin: Vec2) => {
    setPlacement((p) => (p ? { ...p, origin } : p));
  }, []);
  const rotatePlacement = useCallback((rotation: number) => {
    setPlacement((p) => (p ? { ...p, rotation } : p));
  }, []);

  // Explicit cancel (#151): ESC, or re-picking the active glyph, drops the
  // placement. Re-picking is handled by startPlacement (toggles to null); this is
  // the ESC / interrupt path. Restoring the camera is automatic — `placing` flips
  // false, so the OrbitControls camera-lock + contextmenu suppression in Scene3D
  // release in their own cleanup effects (no camera handle to touch from here).
  const cancelPlacement = useCallback(() => setPlacement(null), []);

  // ESC cancels an active placement (#151). A window keydown listener so the key
  // works regardless of canvas focus; ignored while typing in a field so it never
  // hijacks text entry. Armed only while placing, so it never swallows ESC at rest.
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

  // Surface site chip (Epic 06 P1): the hotbar cycles the active worksite
  // Lunar ↔ Shackleton, triggering the EXISTING site re-descent (the same
  // setActiveSite the old ControlsPanel Site toggle drove + Scene3D reacts to).
  const cycleSite = useCallback(
    () => setActiveSite((s) => (s === "lunar" ? "shackleton" : "lunar")),
    [],
  );

  // Existing structures' footprints, derived from the snapshot's task positions,
  // so the client can mirror the server's no-overlap gate. Each task gets a small
  // default footprint (the server uses a like default for tasks without an
  // envelope). Pure read of the snapshot.
  const obstacles = useMemo<Footprint[]>(() => {
    const ts = snapshot?.tasks ?? [];
    // Filter to the active site (Epic 04 P2): drag-to-place must only collide with
    // THIS site's tasks, else placing on the lunar surface would conflict with
    // Shackleton's worksite (and vice versa). `?? "lunar"` keeps untagged tasks on
    // the default site (back-compat).
    return ts
      .filter((t) => (t.site ?? "lunar") === activeSite)
      .map((t) => ({ cx: t.pos.X, cy: t.pos.Y, halfX: 6, halfY: 6 }));
  }, [snapshot, activeSite]);

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

  // --- Mission HUD derivations (Epic 06 P2). The top-left HUD reads the self-heal
  // story at a glance for the ACTIVE worksite only: a build-progress bar
  // `done/total` and a `rovers N/M alive` count. Both are PURE site-scoped reads
  // of the snapshot (lib/missionStats), filtered to `activeSite` the same way
  // `obstacles` is, so a kill / Failure spike dips them and a re-auction heals them
  // with no extra wiring (ADR-0004). `siteTasks` also feeds the HUD's expandable
  // per-task detail list, so the expanded view shows only this site's tasks.
  const siteTasks = useMemo(
    () => tasksForSite(tasks, activeSite),
    [tasks, activeSite],
  );
  const stats = useMemo(
    () => missionStats(tasks, snapshot?.rovers ?? [], activeSite),
    [tasks, snapshot, activeSite],
  );

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

  // View-gating (Epic 06 P0): in ORBIT the only HUD is the top bar — the ledger,
  // blueprints, stress sliders, and Earth panel are all dead weight there, so
  // they are not mounted at all. They render in SURFACE as before. (The orbit
  // site markers live inside Scene3D and are orbit-gated there.)
  const isSurface = viewMode === "surface";

  return (
    <div className="app">
      <TopBar
        status={status}
        url={url}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        reloading={reloading}
        onReload={reloadDemo}
      />

      <main className="stage">
        {/* Cinematic "armed" affordance (Epic 07 S2 · #155). A subtle, non-diegetic
            capture-tooling badge that shows ONLY while armed, telling the operator
            the cue keys are hot. It sits as a SIBLING of `.hud-stage` (outside it)
            so it is NOT faded by the `H` HUD-hide — the operator must still see the
            armed state during a clean-stage take. It's pointer-inert (decorative)
            and aria-live so a screen reader announces the arm/disarm. Disarmed ⇒
            not mounted, so the normal app is byte-for-byte unchanged. */}
        <div className="reel-arm" role="status" aria-live="polite">
          {cinematic ? (
            <span className="reel-arm__badge">
              <span className="reel-arm__dot" aria-hidden="true" />
              REEL ARMED · <b>K</b> cue · <b>]</b>/<b>[</b> copy · <b>M</b> lock · <b>B</b> flip · <b>R</b> disarm
            </span>
          ) : null}
        </div>

        {/* Cinematic copy overlay (Epic 07 S3 · #156). The burned-in PT-BR copy
            layer — Scenery (non-diegetic; encodes no World Model state). Like the
            badge above it sits as a SIBLING of `.hud-stage` (NOT a child), so the
            `H` HUD-fade hides the panels but the bookend wordmark/CTA survives
            over the orbit vista (Beats 14–15). Mounted ONLY while armed (#155) and
            stepped by `]`/`[` via the single keydown listener above; disarmed ⇒
            not mounted, normal app byte-for-byte unchanged. */}
        {cinematic ? <CinematicCopy cursor={copyCursor} /> : null}

        {/* The HUD stage: every floating panel lives here. Two CSS effects compose
            on this one wrapper, and they MUST NOT fight:
              (a) `hud--surface`/`hud--orbit` (keyed on `viewMode`) drives the
                  animated view transition — surface panels slide+fade IN as the
                  glare-masked descent settles, and OUT as you return to orbit. It's
                  a PURE CSS transition off the same `viewMode` flip the Scene3D
                  driver consumes — NO second JS/imperative animation clock
                  (Epic 06 P4, Risk #5). Per-panel `transition-delay` lands the IN
                  fade just AFTER the glare peak (descent ≈1500ms, swap ≈750ms).
              (b) `hud--hidden` (the `H` cinematic key) fades the WHOLE wrapper to
                  opacity:0 and drops pointer-events. Because it sits on the PARENT,
                  its opacity multiplies the children's — so a hidden HUD always wins
                  regardless of the surface/orbit state mid-transition, and never
                  eats a click. The Canvas sits OUTSIDE this wrapper (below), so the
                  3D scene is never faded by `H`. */}
        <div
          className={`hud-stage ${isSurface ? "hud--surface" : "hud--orbit"} ${
            hudHidden ? "hud--hidden" : ""
          }`}
        >
          {/* Compact Mission HUD (Epic 06 P2) — replaces the verbose TaskLedger.
              A site-scoped build-progress bar + rovers-alive readout that dip on
              a Failure spike and recover as the swarm heals; click to expand the
              full per-task list. Surface-only — kept mounted across views so it can
              animate OUT on return-to-orbit (visibility is the `hud--orbit` class;
              it's fully faded + pointer-inert in orbit, per the README success
              criterion). */}
          <MissionHud
            tasks={siteTasks}
            done={stats.done}
            total={stats.total}
            roversAlive={stats.roversAlive}
            roversTotal={stats.roversTotal}
            hasSnapshot={snapshot !== null}
          />

          {/* Unified bottom hotbar (Epic 06 P1) — replaces the old BlueprintPalette
              card list AND the bottom-left stress slider panel. Footprint-glyph
              blueprint icons (a click arms a placement; the 3D scene previews the
              ghost and the EXISTING confirm path places it) · persistent
              LLM-Generated toggle (seeds placement.mode) · ⚠/⏱ stress popovers ·
              📍 site chip (re-descent). Surface-only (faded out in orbit). */}
          <Hotbar
            activeBlueprintId={placement?.blueprintId ?? null}
            onPickBlueprint={startPlacement}
            liveMode={liveMode}
            onLiveModeChange={setLiveMode}
            activeSite={activeSite}
            onCycleSite={cycleSite}
            send={send}
          />

          {/* One-line placement key hint (Epic 06 P1, #151) — docked just above the
              hotbar while a blueprint is armed, replacing the old sub-panel's
              instructions. The cursor-anchored ✓/✗ validity tick lives in-scene
              (Scene3D PlacementTip). Surface-only + only while placing (transient,
              so it stays conditionally mounted — no view-transition needed). */}
          {isSurface && placement !== null ? (
            <div className="place-hint" role="status">
              <b>L</b> place · <b>R-drag</b> rotate · <b>scroll</b> zoom · <b>ESC</b> cancel
            </div>
          ) : null}

          {/* The Kill panel stays contextual (a live selected rover) — it renders
              ONLY for a live selection (#147/#149 gate, preserved) AND only on the
              surface, since selection only happens at the worksite. */}
          {isSurface && selectedRover ? (
            <KillPanel rover={selectedRover} onKill={kill} onDismiss={dismiss} />
          ) : null}

          {/* The DELAYED Earth view, bottom-right — it lags the live Mission HUD
              (top-left) as latency climbs, proving "Earth never knew" (issue 09).
              Surface-only (faded out in orbit; kept mounted to animate in/out). */}
          <EarthPanel earth={earth} snapshotAt={snapshot?.at ?? null} />
        </div>

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
              // Cinematic marker cues (#157) — only ever non-default while armed.
              // `lockedSite` is the lib's MarkerSite union, identical to SiteId;
              // null ⇒ undefined (no cue, manual hover only).
              lockedSite={lockedSite ?? undefined}
              statusOverride={markerFlip}
              // Orbit-open camera-arc (#158) — only ever true while armed + cued.
              // The Scene3D rig runs it in orbit only; false ⇒ the orbit is unchanged
              // (the cold-hold fallback). Additive Scenery, zero snapshot fields.
              cinematicOpen={cinematicOpen}
              // One-shot disarm: the rig calls this when the arc finishes or is
              // interrupted, so the open plays exactly once and never replays on a
              // later return to orbit (the ascent bookend) — which used to re-fire
              // the arc mid-ascent (flicker + camera stuck close on the Moon).
              onCinematicOpenDone={disarmCinematicOpen}
            />
          </Suspense>
        ) : null}
      </main>
    </div>
  );
}
