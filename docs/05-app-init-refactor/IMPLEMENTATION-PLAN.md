# App Initialization Refactor — Implementation Plan

> Detailed, pressure-tested plan for the epic in [README.md](./README.md).
> Decisions locked: 3D-only (remove 2D); preload **everything** behind a splash and
> mount the Canvas only when ready; **orbit** is the default view; idle camera drift
> starts immediately; base marker moves to the Moon's sunlit hemisphere.

## Architecture verdicts (pressure-tested against source)

- **3D-only.** `hitTest.ts` is used *only* by `WorldCanvas` (dead once removed);
  `choreography.ts` is shared with `Scene3D` (**keep it**). The lazy-`Scene3D`
  Suspense fallback currently *is* `WorldCanvas`, so removing 2D requires a
  replacement fallback — the new loading screen fills that gap.
- **"Load all assets" needs an explicit manifest.** Surface worksite assets (rover
  GLB, 6 launch-scenery GLBs, regolith/decor textures) mount only under
  `{onSurface && …}`, so in the default orbit view they never load. A
  `useProgress`-only "wait for what mounts" approach would therefore wait for the
  orbit set only — not "everything". An explicit `preloadAllAssets()` is the only
  well-defined way to honor the user's "truly all" choice.
- **Preload needs no GL context.** `TextureLoader`, `GLTFLoader` (+DRACO/meshopt),
  and `RGBELoader` fetch+decode without a renderer (GPU upload happens on first
  use). So preload can finish *before* the Canvas mounts — a literal "load all,
  then initialize", and it sidesteps drei `useProgress`'s 0/0-is-100 first-frame
  race entirely.
- Honor **ADR-0004**: scene is a pure function of the snapshot; mandatory
  primitive/box fallbacks remain. Per-asset preload failure must be tolerated (count
  done, never reject) and a **safety timeout** must always be able to reveal.

## Ground-truth confirmations (re-verified against current source)

> Line numbers refreshed; substance unchanged. Nothing in this epic has shipped yet:
> all new files are absent, `WorldCanvas`/`hitTest` still present, `viewMode` still
> defaults to `"surface"`, `renderer` state still `"3d"`.

- `web/src/App.tsx`: `Renderer` type (`type Renderer = "3d" | "2d"`, line 51);
  `renderer` state (`useState<Renderer>("3d")`, line 63); the header 3D/2D toggle
  (`<div className="renderer-toggle">`, ~226–243); the 2D render branch + the
  `WorldCanvas` Suspense fallback (~292–299); `import { WorldCanvas }` (line 25); and
  `viewMode` default `"surface"` (`useState<ViewMode>("surface")`, line 68).
- `web/src/components/Scene3D.tsx`: `frameloop="always"` (line 2995, already changed
  from `"demand"` — comment ~2989); rover GLB via module-level `gltfCache` +
  `loadGLTF()` (~1070–1103); worksite mounts gated by `{onSurface && …}`
  (`onSurface = viewMode === "surface"` at ~2415; mounts ~2426/2427/2445/2461); the
  intro fly-in effect early-returns unless surface
  (`if (introPlayed.current || viewMode !== "surface") return;`, ~2956); `CameraFeel`
  idle init calls `markInput()` at mount (~2700; `markInput` defined ~2658–2666).
- `web/src/lib/cameraFeel.ts`: `IDLE_DELAY_MS=4000` (line 19), `IDLE_FADE_MS=2000`
  (line 31), `idleSwayOffset()` (~37–42, the 2 s ease-in that prevents a snap).
- `web/src/components/LaunchScenery.tsx`: module-level `sceneryCache` + `loadScenery()`
  (~48–71); 6 GLB set-pieces in `SET_PIECES` (~99–156: crawler, mobile-launcher,
  gantry, lander, base-station, astronaut).
- `web/src/components/SkyBodies.tsx`: `LunarBaseMarker` seats on near-face normal
  `new THREE.Vector3(0, 80, 410).normalize()` (line 1177); first-paint textures (Moon,
  Earth, Sun, nebula) via per-component `new THREE.TextureLoader().load(...)`
  (uncached, ~324/376/1325).
- `web/src/components/SpaceEnvironment.tsx`: 8k starmap (`STAR_BG_FILE`, line 71) via
  `TextureLoader`; HDR via drei `<Environment files={HDR_FILE}>` (`HDR_FILE`, line 62;
  the one Suspense-throwing `useLoader(RGBELoader)`) — both route through
  `DefaultLoadingManager`.
- `web/src/components/DecorRocks.tsx`: rock diff/normal/rough via per-component
  `TextureLoader` (`ROCK_MAPS`, ~36–50) — also uncached.
- All loaders use the **default** `LoadingManager` (no custom manager anywhere), so
  `DefaultLoadingManager` sees every real network load.

---

## Phase P0 — Remove the 2D scene (frontend only)

Land this first; it is mechanical and unblocks the loading-screen wiring.

- **Delete** `web/src/components/WorldCanvas.tsx`, `web/src/lib/hitTest.ts`,
  `web/src/lib/hitTest.test.ts`. Keep `choreography.ts` + `choreography.test.ts`.
- **`web/src/App.tsx`:** remove the `WorldCanvas` import, the `Renderer` type, the
  `renderer` state, the header 3D/2D toggle block, and the 2D render branch.
  `Scene3D` becomes the sole renderer (loading-gated in P1).
- **`web/src/styles/dashboard.css`:** remove `.renderer-toggle` / `.renderer-btn`.
- Tidy stale "2D is the fallback" comments: `App.tsx` header, `ControlsPanel.tsx:30`,
  the "Drop-in swap for WorldCanvas" notes in `Scene3D.tsx` (cosmetic, keep light).
- **Docs truthfulness** (repo is system of record): ADR-0004 / `AGENTS.md` note the
  2D rehearsed-fallback is retired (primitive in-scene fallbacks remain). Update
  `feature_list.json` / `PROGRESS.md` per the session lifecycle.

**Verify:** `grep -rn "WorldCanvas\|hitTest" web/src` is clean; `npm run build` TS-clean.

---

## Phase P1 — Loading screen + preload-everything

**New `web/src/lib/assets.ts` — manifest + `preloadAllAssets`:**
- Centralize every asset URL. **Export** the URL constants from their modules
  (`ROVER_MODEL_REF` + buildspec/terrain texture paths in `Scene3D.tsx`, the 6
  scenery refs in `LaunchScenery.tsx`, `HDR_FILE` + starmap in `SpaceEnvironment.tsx`,
  the Moon/Earth/Sun/nebula/decor texture paths in `SkyBodies.tsx`/`DecorRocks.tsx`)
  so the manifest can't drift from the components.
- `preloadAllAssets(onProgress: (loaded: number, total: number) => void): Promise<void>`
  loads each URL with the correct loader (`GLTFLoader`+DRACO/meshopt for `.glb`,
  `RGBELoader` for `.hdr`, shared `loadTexture` for images). **Settles** on all (a
  failed asset counts done, never rejects — ADR-0004).
- Warm the existing module-level GLB caches by delegating GLB preloads to the
  exported `loadGLTF` (`Scene3D.tsx` `gltfCache`) and `loadScenery`
  (`LaunchScenery.tsx` `sceneryCache`) — the descent then reuses decoded models with
  zero rework.

**New `web/src/lib/textureCache.ts` — shared URL-keyed texture cache:**
- `loadTexture(url): THREE.Texture` returning a memoized texture per URL, so preload
  and the surface components share one decoded texture (crisp descent, no pop-in).
- Repoint the ~handful of `new THREE.TextureLoader().load(...)` call sites in
  `SkyBodies.tsx`, `DecorRocks.tsx`, and `Scene3D.tsx` (terrain/spec PBR maps) to it.
  Per-URL config (colorSpace/wrap/anisotropy via `textureFidelity.ts`) is still
  applied by each consumer at use — safe since each URL has one consumer/config and
  the fidelity pass is idempotent.

**New `web/src/components/LoadingScreen.tsx`:**
- Branded SwarmBuild splash + progress bar styled off `dashboard.css` tokens.
- Drives the bar from `preloadAllAssets`'s `onProgress` (deterministic).
- One-way **reveal latch**: reveal when the promise resolves **or** a **safety
  timeout** (~8–10 s) fires; never re-show on later on-demand loads. Fade out via CSS
  opacity, then unmount.

**`web/src/App.tsx` wiring:**
- On mount, kick `preloadAllAssets` (no Canvas needed) **and** trigger the lazy
  `Scene3D` dynamic `import()` so the JS chunk is warm too.
- Render `<LoadingScreen>`; mount the lazy `Scene3D` only once `ready` (preload
  resolved or timeout). The chunk `<Suspense>` fallback is the same `<LoadingScreen>`.

**Verify:** throttle network in DevTools → splash shows a filling bar; the Canvas
mounts only after it completes.

---

## Phase P2 — Orbit default + immediate idle drift

- **`web/src/App.tsx:68`:** `useState<ViewMode>("orbit")` (was `"surface"`). The
  intro fly-in (`Scene3D.tsx:~2956`) early-returns unless surface, so it won't
  auto-run — matching the chosen "settle in orbit, no auto push-in". Leave that code
  as-is (harmless); the base-marker → surface descent (`runDescent`) is unchanged.
- **`web/src/components/Scene3D.tsx` `CameraFeel` mount effect (~2700):** replace the
  initial `markInput()` (which arms a fresh 4 s countdown) with an immediate-idle
  init — set `lastInputRef.current = performance.now() - IDLE_DELAY_MS` so
  `idleElapsed > 0` from the first frame. `IDLE_FADE_MS` (2 s) still eases the sway
  on smoothly (no snap). **Only the initial behavior changes** — leave
  `onStart`/`onEnd`/`markInput` so post-interaction the normal 4 s delay still
  applies. Since `Scene3D` now mounts only after the splash, "scene starts" == the
  reveal moment, so the drift begins exactly when the user first sees the vista.

**Verify:** on reveal the app is in the orbit vista and the camera is already
drifting — no 4 s wait.

---

## Phase P3 — Base mark on the light side

- **`web/src/components/SkyBodies.tsx` `LunarBaseMarker` (~1177):** import
  `ORBIT_SUN_POSITION` from `lib/scene.ts` and re-seat the marker normal as a
  normalized blend of the orbit-sun direction and the near-face dir — enough to land
  the marker clearly on the lit (right) hemisphere while keeping it camera-facing and
  clickable (the orbit sun is ~perpendicular to camera, so a pure sun-normal would
  push it to the limb). Keep the surface-normal quaternion so the ring lies flat.
  Blend weight is **tuned by eye** during verification.

**Verify:** in orbit the marker sits on the sunlit hemisphere and clicking it flies
the descent to the surface.

---

## Risks (mitigations)

1. **"Wait for all" hangs** (was the trap): solved by an explicit preload manifest +
   settle-not-reject + a mandatory safety timeout — never block on a load that won't
   start or won't finish.
2. **Surface pop-in on descent** (the user's main concern): warm the GLB module
   caches via the existing loaders **and** share decoded textures via
   `textureCache.ts`; orbit-visible textures are already mounted.
3. **StrictMode double-mount** (dev only): module-level GLB caches dedupe; the
   deterministic promise-driven bar + one-way reveal latch absorb the flicker.
4. **HDR Suspense vs. splash** (low): the HDR is counted by preload; on 404 the error
   boundary swallows it and the promise still settles — reveal must not require
   `errors.length === 0`.
5. **Manifest drift** (low): export URL constants from their modules rather than
   re-typing; add `assets.test.ts` (manifest non-empty, no duplicate URLs).

## Scope-balloon flags (OUT of v1)

Auto cinematic push-in on orbit reveal (rejected) · refactor of the GLB caches
(reuse the module-level maps) · per-asset retry/back-off (timeout instead) · changing
the surface intro fly-in machinery (self-disables under orbit default).

---

## Critical files

| File | Change |
|---|---|
| `web/src/App.tsx` | remove 2D toggle/state; orbit default; loading-gate + `<LoadingScreen>` |
| `web/src/components/LoadingScreen.tsx` | **new** — splash + progress + reveal latch + timeout |
| `web/src/lib/assets.ts` | **new** — asset manifest + `preloadAllAssets` |
| `web/src/lib/textureCache.ts` | **new** — shared URL-keyed texture cache |
| `web/src/lib/assets.test.ts` | **new** — manifest non-empty / no dupes |
| `web/src/components/Scene3D.tsx` | export `loadGLTF`/URLs; immediate-idle init; texture loads via cache |
| `web/src/components/LaunchScenery.tsx` | export `loadScenery`/scenery URLs |
| `web/src/components/SkyBodies.tsx` | base marker → light side; texture loads via cache |
| `web/src/components/DecorRocks.tsx` | texture load via cache |
| `web/src/components/SpaceEnvironment.tsx` | export `HDR_FILE`/starmap URL |
| `web/src/styles/dashboard.css` | drop renderer-toggle CSS; add loading-screen styles |
| delete | `WorldCanvas.tsx`, `lib/hitTest.ts`, `lib/hitTest.test.ts` |
| docs | ADR-0004 / `AGENTS.md` note 2D retired; `feature_list.json` / `PROGRESS.md` |

---

## Verification (end-to-end)

**DoD (web):** `cd web && npm run build && npm test` — TS-clean and green (delete
`hitTest.test.ts`; keep `choreography.test.ts`; add `assets.test.ts`).

**Visual (Chrome DevTools MCP):** `cd web && VITE_MOCK=1 npm run dev`, then:
1. **P1:** throttle network → loading screen with a filling progress bar; the Canvas
   mounts only after it completes.
2. **P2:** on reveal, the app is in the orbit Moon vista (no surface, no 2D toggle in
   the header) and the idle camera drift is already moving — no 4 s wait.
3. **P3:** the base marker sits on the sunlit hemisphere and is clickable; clicking
   it flies the descent and the worksite (rover, scenery, regolith) renders crisp
   with no box/placeholder pop-in.
4. `grep -rn "WorldCanvas\|hitTest" web/src` is clean.
5. `./deploy/smoke.sh` if the change is exercised end-to-end across components.
</content>
