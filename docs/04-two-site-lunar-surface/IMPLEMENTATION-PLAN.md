# Two-Site Live Lunar Surface — Implementation Plan

> Detailed, pressure-tested plan for the epic in [README.md](./README.md).
> Decisions locked: both sites live from the snapshot; **direct** surface→surface
> glare swap (orbit kept as a 3rd view); consistent real-world meters→units scale,
> tight hero layout; real lunar coords + pole lighting for Shackleton.

## Architecture verdicts (pressure-tested against source)

- **Backend: one coordinator + a `SiteID` tag** (not two coordinators — that would
  duplicate bus/gateway/reload/Earth-uplink plumbing and break the single-snapshot
  contract the whole frontend + ADR-0004 rely on).
- **Scale: one fixed `SCENE_UNITS_PER_METER`** + a per-site fixed framing transform
  (recenter/rotate, no per-snapshot autoscale). Keeps `at`/`invert` exact and the
  hero composition stable.
- Honor **ADR-0004**: scene is a pure function of the snapshot; mandatory
  primitive/box fallbacks. **NB:** invariant (3)'s demand-loop / 0-idle-fps budget
  was **dropped** — the scene runs `frameloop="always"` and `useFrame` is
  unrestricted (Wave 4 "living orbit"; see `AGENTS.md`). So this plan no longer needs
  `invalidate()`-per-tween or "no `useFrame`" gymnastics; keep `dpr ≤ ~1.5` + bounded
  draw calls as hygiene instead.

## Ground-truth confirmations (verified by reading source)

- `web/src/lib/scene.ts` `sceneMap()` (≈114–136) autoscales the bbox into
  `GROUND_SPAN=20` every snapshot — the scale bug, and it jitters as the swarm
  (DomeRovers Y=−70) moves. `at` → `x=(X-cx)*scale, z=-(Y-cy)*scale`; `invert` is
  its exact inverse; `scale` is consumed by hit-proxies, lease beams, ghost.
- `web/src/components/LaunchScenery.tsx` `fitAndSeat()` (≈157–168) normalizes each
  model's max bbox dim to a hand-tuned `fit`, divorced from real proportions.
- Backend is flat: `wire.RoverView`/`TaskView`, `domain.Task`, `domain.RoverState`,
  one `state`, one `publishSnapshot` — **no site concept** anywhere.
- Auction path: coordinator `openAuction` → `wire.Announce{TaskID,Type,Pos,…}`;
  each agent `subscribeAnnounce` bids if eligible. **Bidding is agent-side** ⇒
  site-gating belongs on `Announce` + the agent check (cleanest).
- `st.pos[taskID]` is seeded from `cfg.Blueprint`. `Blueprint.Place(instance,
  origin, rotation, mode)` already prefixes ids `instance/<id>` and offsets
  positions — perfect for two sites.
- Transition machinery: `Scene3D` useEffect keyed on `[viewMode]`, glare DOM
  overlay driven imperatively, `shown` flips at glare peak (t=0.5), poseFor/
  lerpPose/rAF. `frameloop="always"` (was `"demand"` — Scene3D.tsx:2995), EffectComposer.
- Orbit marker: `LunarBaseMarker` in `SkyBodies.tsx`, seated on the globe near-face
  (`new THREE.Vector3(0, 80, 410).normalize()`, ~1177), click →
  `onViewModeChange("surface")`. **Epic 05 #131 reseats this to the lit hemisphere —
  P3 below supersedes it (two lat/lon markers).**
- Mock: `web/src/mocks/snapshot.ts` is flat (must carry both sites for dev).
- **Epic 05 (#127–#131, not yet built) is in flight in parallel** and changes the
  ground under P2–P4: 2D `WorldCanvas`/`hitTest` are deleted (#128); `App.tsx` gains
  a loading-gate + `<LoadingScreen>` and `viewMode` defaults to `"orbit"` (#129/#130);
  a new `lib/assets.ts` preload manifest + `lib/textureCache.ts` warm **all** assets
  before the Canvas mounts (#129); `CameraFeel` starts idle-drift immediately (#130).
  None of these files/states exist yet on `main` (verified: `assets.ts`,
  `textureCache.ts`, `LoadingScreen.tsx` absent; `viewMode` still `"surface"`;
  `WorldCanvas`/`hitTest` present). See "Coordination with Epic 05" at the end.

---

## Phase P0 — Scale unification (single site, frontend only)

Land this first, on the existing single site, and tune on screen. Do **not**
combine with the two-site work — changing the scale cascades through every size
constant.

**`web/src/lib/scene.ts`:**
- Add `export const SCENE_UNITS_PER_METER = 0.12;` (1 unit ≈ 8.3 m; tune on screen).
- Add a real-meter size table (replaces ad-hoc `fit`s):
  `rover 2.5, astronaut 2.0, habitat 6.0, baseStation 4.0, crawler 40,
  mobileLauncher 120, gantry 90, lander 7.0, solarPanel 10, commsMast 12,
  commsDish 6, radome 5`. Scene size = `REAL_METERS[k] * SCENE_UNITS_PER_METER`.
  (Check: launcher 120·0.12 = 14.4 u vs astronaut 2·0.12 = 0.24 u → 60:1, real.)
- Replace `sceneMap(rovers, tasks)` with a fixed `siteMap(frame)`:

  ```ts
  export function siteMap(site: SiteFrame): SceneMap {
    const s = SCENE_UNITS_PER_METER * site.worksiteUnitsToMeters;
    const { cx, cy, rot } = site;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    return {
      scale: s,
      at: (p, h = 0) => {
        const dx = p.X - cx, dy = p.Y - cy;
        const rx = dx*cos - dy*sin, ry = dx*sin + dy*cos;
        return { x: rx*s, y: h, z: -ry*s };
      },
      invert: (x, z) => {
        const rx = x/s, ry = -z/s;
        const dx = rx*cos + ry*sin, dy = -rx*sin + ry*cos;
        return { X: dx + cx, Y: dy + cy };
      },
    };
  }
  ```
  `at`/`invert` stay **exact inverses** (drag-to-place + raycast hit-proxy depend on
  it). Keep `computeBounds` exported for tests but it no longer drives scale.
  - `worksiteUnitsToMeters` (the dome ring radii 24/46 are abstract units, not
    meters) is the single remaining free knob — start 1.0 (dome ~92 m), drop to 0.5
    if too large next to literally-scaled set-pieces.

**`web/src/components/LaunchScenery.tsx`:**
- `SetPiece.fit` → `realMeters`; `fitAndSeat(obj, realMeters * SCENE_UNITS_PER_METER)`
  (body unchanged — only the target source changes). Fallback box/capsule sizing
  reads the same computed scene size.

**`web/src/components/Scene3D.tsx`:**
- Rover visual size **and** invisible hit-proxy sphere radius → both from
  `REAL_METERS.rover * SCENE_UNITS_PER_METER` (fixed scene size), not `map.scale`.
  Proxy must still exactly cover the visible rover (ADR-0004 no-missed-click).
- Build-spec models (`SpecModel`/`TaskBlock`) + `tierHeight` (0.15/0.9/1.9) read the
  new fixed map scale; retune `tierHeight`, camera poses, and fog on screen.

**Tension — literal scale vs hero composition:** keep **sizes** literal (the fix)
but **compose positions** deliberately (set-piece + worksite-origin positions are
art-directed, not literal). Honest: real sizes, staged layout — what every NASA
press render does.

---

## Phase P1 — Backend SiteID (Go, ships independently)

All new JSON fields are `omitempty`/optional ⇒ an old frontend keeps working
(treats everything as the default site). Safe incremental deploy.

**Struct/field additions:**
- `internal/core/domain/domain.go`: `Task.SiteID string`, `RoverState.SiteID string`.
- `internal/wire/wire.go`: `RoverView.Site` + `TaskView.Site` (`json:"site,omitempty"`);
  `Announce.SiteID`; add `Site` to `Telemetry`.
- `internal/coordinator/coordinator.go`: `BlueprintTask.SiteID`; new
  `state.taskSite map[TaskID]string` (seeded in the blueprint loop + placeBlueprint);
  `agent.Config.SiteID`.
- `web/src/types/wire.ts`: mirror `RoverView.site?` / `TaskView.site?` (field
  names/JSON in lockstep with `wire.go`).

**Snapshot tagging (`publishSnapshot`):** `TaskView.Site = st.taskSite[t.ID]`;
`RoverView.Site = tm.Site` (rover reports site via telemetry; agent sets
`Telemetry.Site = cfg.SiteID`).

**Two sites in `internal/demo/demo.go`:** make `DomeScenario` a two-site builder
(keep a thin back-compat wrapper or update `cmd/coordinator/main.go`). Reuse
`Blueprint.Place` (it already id-prefixes + offsets):
- Lunar: `domeBlueprint().Place("lunar", origin=(0,0), 0, "")`, tag `SiteID="lunar"`.
- Shackleton: `domeBlueprint().Place("shackleton", origin=(400,0), 0, "")`, tag
  `SiteID="shackleton"` (origin 400 keeps them far in world coords; frontend
  `siteMap` recenters each to scene origin). Add an adapter to stamp `SiteID` onto
  the `[]BlueprintTask` built from `Place` output.
- Two rover groups (6+6) via `siteRovers("lunar", …)` / `siteRovers("shackleton", …)`,
  each setting `agent.Config.SiteID`; deterministic batteries per group.

**Auction gate (load-bearing change):**
- `openAuction`: set `Announce.SiteID = st.taskSite[t.ID]`.
- `subscribeAnnounce` (agent), first line after alive/recovering checks:
  `if a.SiteID != "" && a.SiteID != cfg.SiteID { return }` — a rover only bids on
  its own site. `closeAuction`/`pickWinner` unchanged (only same-site bids arrive).

**Deterministic kill→heal:** retarget the scripted kill to `lunar/wall-1` (prefixed
id). Same-site standby heals it (no rover drives 400 units across the map — *more*
correct). Keep a single scripted kill for v1.

**Go tests:** same-site healing; no cross-site bids; deterministic winner per site.

---

## Phase P2 — Frontend two-site surface

**State (`web/src/App.tsx`):** add `activeSite: "lunar" | "shackleton"` beside
`viewMode` (orthogonal: orbit shows both markers, surface shows one site). Thread
`activeSite` + setter into `Scene3D` and `ControlsPanel`. The obstacles/placement
derivation must also filter to `activeSite` (else drag-to-place collides with the
other site's tasks). **Rebase onto the post-#128 `App.tsx`** (2D toggle/state/branch
removed) and note `viewMode` now defaults to `"orbit"` (#130) — so the surface mounts
only after a descent, and `activeSite` must already be set when the descent fires
(the orbit marker click sets both; default `activeSite="lunar"`).

**`SceneContents` filtering:** slice the snapshot by site
(`(r.site ?? "lunar") === activeSite`, same for tasks); build `map` from
`siteMap(SITE_FRAMES[activeSite])`; map rovers/tasks/lease-beams over the filtered
arrays. `?? "lunar"` preserves single-site/back-compat.

**Per-site framing (`SITE_FRAMES` in `scene.ts`):**
`{ cx, cy, rot, worksiteUnitsToMeters, sunDir, sunIntensity, terrainTint, fog, pieces }`.

```
lunar:      { cx:0,   cy:0, rot:0,   worksiteUnitsToMeters:1,
              sunDir:[2300,1265,-6490], sunIntensity:1.9,  terrainTint:"#9a948c",
              fog:["#000",   180, 680], pieces: LUNAR_SET_PIECES }
shackleton: { cx:400, cy:0, rot:0.3, worksiteUnitsToMeters:1,
              sunDir:[6490,90,-2300],   sunIntensity:1.25, terrainTint:"#6f6a66",
              fog:["#05060a",120, 520], pieces: SHACKLETON_SET_PIECES }
```
- Shackleton sun: low grazing (small Y vs large X|Z) → long shadows, dim. Lunar:
  high (existing `SUN_POSITION`).
- Surface lighting in `SceneContents` reads sun/intensity/earthshine from
  `SITE_FRAMES[activeSite]`; the orbit Sun **body** stays at global `SUN_POSITION`
  (surface only uses an off-screen directional light). `LunarTerrain` takes a
  `terrainTint` prop; fog becomes per-site.

**Shadows:** still **fake** Shackleton's long shadows with static blob/gradient
decals oriented opposite the grazing sun — but the reason is now **cost/complexity**,
not the render loop (the old "they fight `frameloop="demand"`" rationale is void;
the loop is always-on). Real shadow maps remain a flagged follow-up because per-site
shadow-camera framing on a grazing pole sun balloons, and shadow passes fight the
EffectComposer pipeline + the `dpr ≤ ~1.5` hygiene budget. Decals stay
snapshot-independent regardless.

**Mock (`web/src/mocks/snapshot.ts`):** add `site` to every rover/task; include
**both** sites in the one snapshot so `VITE_MOCK=1` dev shows both.

**Assets:** any new Shackleton decal/"in construction" texture **must be registered
in Epic 05's `lib/assets.ts` manifest** and loaded via `lib/textureCache.ts`, or it
pops in on descent (defeating #129's preload-everything). The dome GLBs are reused
(already in the manifest); no new GLBs.

**UI:** add a Surface **site toggle** (Lunar Base / Shackleton) in
`web/src/components/ControlsPanel.tsx` near the existing Surface/Orbit toggle.

---

## Phase P3 — Orbit markers + descend-to-site

> **Supersedes Epic 05 #131** (single-marker reseat to the lit hemisphere). This
> phase replaces the one `LunarBaseMarker` with two lat/lon markers — but must carry
> #131's lesson forward: **both markers must land on the lit hemisphere**, not the
> terminator (the near-face seat under orbit lighting falls dark). Coordinate so only
> one of {#131, P3} lands; if #131 ships first, P3 rebases on top and removes the
> blend-hack.

- Add `latLonToGlobePoint(lat, lon)` (sphere param around `MOON_POSITION`,
  `MOON_RADIUS`). Coords: Shackleton `lat −89.9, lon 0`; Lunar Base `lat 0.7,
  lon 23.5`. Verify markers land on the visible **and lit** near face for the default
  orbit camera (tune a global lon offset to the moon texture seam by eye; cross-check
  against `ORBIT_SUN_POSITION` so neither marker sits in shadow — this is the #131
  requirement, now applied to both).
- Generalize `LunarBaseMarker` (`SkyBodies.tsx`) → `SiteMarker({ position,
  quaternion, color, label, onSelect })`, oriented to the local surface normal.
  Render two: lunar (cyan), Shackleton (amber, "in construction").
- Click → set **both** `activeSite=siteId` and `viewMode="surface"` → the combined
  "descend to that site" transition (P4). With orbit as the default view (#130), this
  is now the **primary** entry into the surface — not a secondary toggle.

---

## Phase P4 — Transition + polish

**Single transition driver** keyed on `[viewMode, activeSite]` (generalize `shown`
to `{view, site}` to avoid two racing effects). Branches:
- view changed (orbit↔surface): existing glare-masked descent/ascent.
- same view (surface) + site changed: **new lateral glare match-cut** (~900 ms) —
  no fly-to-Moon; a short dolly/whip toward the new site, flip `shownSite` under the
  glare peak (t=0.5), settle into `SITE_FRAMES[newSite]` surface pose (reuse
  `lerpPose` with `pitchHold=1`).
- both changed (orbit marker click): descend and land on the target site.
- Add `LUNAR_SURFACE_POSE` / `SHACKLETON_SURFACE_POSE` (Shackleton lower/back so
  shadows rake toward camera); `poseFor(view, site)`.
- Driver disables `controls` during the tween and settles exactly on the dest pose at
  t=1, then hands back to `CameraFeel` idle-drift. The loop is **always-on** now, so
  drop the old `invalidate()`-per-tick + "no `useFrame`" constraints — a `useFrame`
  tween (or the existing rAF) is fine; just guard against fighting `CameraFeel`
  (suspend its input clock while the tween owns the camera, resume at t=1). Beware the
  #130 immediate-idle-drift change: the surface↔surface tween must take the camera
  cleanly from a drifting state and return it to one.

**Polish:** Shackleton long-shadow fakes, amber "in construction" styling, marker
labels.

---

## Risks (mitigations)

1. **Scale retune cascade** (high): land P0 alone and tune on screen before sites.
2. **Hit-proxy / click-to-kill drift** (high, ADR-0004): rover size + proxy radius
   switch to the fixed scale together; keep/extend the proxy-covers-rover test;
   verify drag-to-place `invert`.
3. **Transition driver race** (med): one driver keyed `[viewMode, activeSite]`.
4. **Camera-feel handoff** (med, replaces the old demand-loop risk): the loop is
   always-on, so the risk is no longer idle-fps regressions but the tween **fighting
   `CameraFeel`** (esp. with #130's immediate idle-drift). Suspend the input clock
   during the tween, resume at t=1; keep `dpr ≤ ~1.5` + bounded draws as hygiene.
5. **Parallel-merge churn with Epic 05** (med): `App.tsx`, `Scene3D.tsx`, and the
   `SkyBodies.tsx` marker are edited by both epics. Sequence per "Coordination with
   Epic 05"; P1 (Go) and P0 (`scene.ts`) are the safe-to-parallelize beachheads.
6. **South-pole marker visibility / lighting** (low-med): lat −89.9 may hide near the
   lower limb **or fall in shadow** — nudge marker / slight globe tilt, and honor the
   #131 lit-hemisphere requirement.
7. **Wire desync** (low): TS `wire.ts` and Go `wire.go` in lockstep; new fields
   omitempty/optional.
8. **Manifest drift** (low): new Shackleton textures absent from Epic 05's
   `lib/assets.ts` → pop-in on descent. Register them with the manifest + a dupe check.

## Scope-balloon flags (OUT of v1)

Real shadow maps (faked — deferred for cost/complexity, not the old demand-loop
reason) · two coordinators (rejected) · distinct blueprints/asset sets per site
(reuse the same dome twice) · moon globe tilt (only if marker visibility forces it) ·
multi-target scripted kills.

---

## Coordination with Epic 05 (#127–#131, parallel)

Epic 05 is frontend-only and **not yet built**. Both epics land on `main` in
parallel; the convergence target is: **boot → splash preloads everything → orbit
vista with two site markers → click → pop-in-free descent to that site.**

**File-overlap matrix** (◆ = heavy edit, • = light/region-disjoint):

| File | This epic (04) | Epic 05 | Collision? |
|---|---|---|---|
| `internal/**` (Go) | ◆ P1 | — | none — land anytime |
| `web/src/lib/scene.ts` | ◆ P0/P2 (`siteMap`, `SITE_FRAMES`) | • reads `ORBIT_SUN_POSITION` | low |
| `web/src/App.tsx` | ◆ P2 (`activeSite`) | ◆ #128/#129/#130 (2D removal, loading-gate, orbit default) | **high — rebase P2 after #128** |
| `web/src/components/Scene3D.tsx` | ◆ P0/P2/P4 | ◆ #129/#130 (export URLs, texture cache, immediate idle) | **high — disjoint regions, merge carefully** |
| `web/src/components/SkyBodies.tsx` | ◆ P3 (two `SiteMarker`s) | ◆ #131 (marker reseat) | **high — P3 supersedes #131** |
| `web/src/components/LaunchScenery.tsx` | • P0 (`fit`→`realMeters`) | • #129 (export `loadScenery`/URLs) | low |
| `web/src/components/ControlsPanel.tsx` | • P2 (site toggle) | • #128 (drop 2D-fallback comment) | low |
| `web/src/styles/dashboard.css` | • P2 (site-toggle styles) | • #128/#129 (drop renderer-toggle, add loading styles) | low |
| `web/src/mocks/snapshot.ts` | ◆ P2 | — | none |
| `web/src/lib/assets.ts` (new, Epic 05) | • register Shackleton textures | ◆ #129 (manifest) | **dependency — add our assets to it** |

**Recommended landing order:** (1) **04-P1 backend** + **04-P0 scale** (independent
beachheads, parallel with all of Epic 05); (2) **Epic 05 #128** (2D removal shrinks
`App.tsx`); (3) **04-P2** rebased on the slimmer `App.tsx`, alongside Epic 05
#129/#130; (4) **Epic 05 #131 absorbed into 04-P3** (one marker change, not two);
(5) **04-P4** transition, honoring #130's immediate idle-drift handoff.

**Hard coordination rules:**
- New surface textures → **register in `lib/assets.ts`** (#129) or they pop in on
  descent.
- Only **one** of {#131, 04-P3} edits the orbit marker — P3 is the superset.
- `viewMode` default is `"orbit"` (#130); 04-P2 must not assume a surface-first boot.
- Don't reintroduce `frameloop="demand"` / `invalidate()` / "no `useFrame`" framing —
  that budget is retired repo-wide.

---

## Critical files

- `web/src/lib/scene.ts`
- `web/src/components/Scene3D.tsx`
- `web/src/components/LaunchScenery.tsx`
- `web/src/components/SkyBodies.tsx`
- `web/src/components/ControlsPanel.tsx`
- `web/src/App.tsx`
- `web/src/types/wire.ts`
- `web/src/mocks/snapshot.ts`
- `internal/core/domain/domain.go`
- `internal/wire/wire.go`
- `internal/coordinator/coordinator.go`
- `internal/demo/demo.go`
- `internal/blueprint/blueprint.go`
- `cmd/coordinator/main.go`

---

## Verification (end-to-end)

**Per phase:** `cd web && npm run typecheck && npm run lint && npm run test`;
backend `go build ./... && go test ./...` (+ `make` targets if present).

**Visual (Chrome DevTools MCP):** run mock dev `VITE_MOCK=1 npx vite --port 5188`,
navigate, hide UI panels via injected CSS, screenshot:
- **P0:** single site — believable relative sizes; no giant astronaut; click a
  rover (kill) registers; drag-to-place ghost tracks the cursor.
- **P2:** toggle Lunar Base ↔ Shackleton — each frames cleanly; Shackleton reads
  darker with long raking shadows; both show live rovers/tasks.
- **P3/P4:** orbit shows two markers at the right spots **on the lit hemisphere**;
  clicking one descends to that site; the surface↔surface toggle plays a smooth
  ~900 ms glare match-cut and **settles on the destination pose** (tween stops, idle
  drift resumes). No 0fps check — the loop is always-on; instead confirm the camera
  comes to rest on the dest pose and `CameraFeel` resumes without a snap.

**Backend (real coordinator, not mock):** snapshot carries `site` on every
rover/task; a lunar standby heals `lunar/wall-1`; no rover bids on the other site's
tasks.
