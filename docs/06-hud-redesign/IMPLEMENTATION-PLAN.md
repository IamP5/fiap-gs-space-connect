# Floating Game-like HUD — Implementation Plan

> Detailed, source-verified plan for the epic in [README.md](./README.md).
> Decisions locked (see README "Locked decisions"): view-gated HUD; solid game-UI
> panels; bottom hotbar with footprint-glyph icons + persistent `LLM Generated`
> toggle; placement gestures (L-place / R-drag-rotate / scroll-zoom / ESC-cancel,
> camera locked); Mission-HUD ledger; in-world NMS line-diamond markers; animated
> view transitions + `H` cinematic-hide.

## Architecture verdicts (pressure-tested against source)

- **Frontend-only.** No wire/back-end change. The `placeBlueprint` control already
  carries `mode: BuildMode` (`App.tsx:218`, `lib/placement.placeBlueprintControl`),
  so the `LLM Generated` toggle just feeds that existing field — Replay/Live plumbing
  is untouched.
- **App stays a pure re-render of the snapshot (ADR-0004).** New client state is
  minimal and additive: `hudHidden: boolean` (the `H` key) and `liveMode: boolean`
  (the persistent toggle, replacing the per-placement `mode` default). Everything
  else (`selected`, `placement`, `viewMode`, `activeSite`) already exists.
- **View-gating happens in `App.tsx`'s render**, not inside each panel. App already
  threads `viewMode`/`activeSite` to most panels; gating is `{viewMode === "surface"
  && <…>}` wrappers + an orbit branch for the markers. Keeps panels presentational.
- **Markers are in-world (R3F), not HTML.** Use drei `<Line>` (diamond) + `<Text>`
  (SDF) wrapped in `<Billboard>`, on `CELESTIAL_BLOOM_LAYER` (12) so they bloom and
  occlude with the globe — replacing the current `<Html>` label + ring/disc/beacon
  meshes in `SkyBodies.tsx`.
- **Solid game-UI skin is a CSS-token pass** over `styles/dashboard.css` — new panel
  base class (opaque bg, bevel border, drop shadow), not a per-component rewrite.

## Ground-truth confirmations (verified by reading source)

- `web/src/App.tsx` is the shell. It owns `selected`, `viewMode` (default `"orbit"`,
  `:65`), `activeSite` (default `"lunar"`, `:72`), `placement` (`:156`), and renders:
  `header.topbar` (brand + `StatusIndicator` + Reload + `meta` url, `:250–266`),
  `TaskLedger`, `BlueprintPalette`, `KillPanel` (conditional on `selectedRover`),
  `ControlsPanel`, `EarthPanel`, then the lazy `Scene3D` (`:268–334`). **All panels
  render in every view today** — no gating.
- `ControlsPanel.tsx` owns `failure`/`latency` slider state locally (`:41–42`) and
  sends `setFailureProb`/`setLatency`; it also hosts the **View** toggle (`:73–98`)
  and **Site** toggle (`:105–130`). The two toggles must be lifted out (View → top
  bar; Site → hotbar chip) and the sliders moved into hotbar popovers.
- `BlueprintPalette.tsx` renders the catalog list (`:65–80`) + a placement sub-panel
  with a **Replay/Live** toggle (`:98–115`), a **rotation slider** (`:118–137`),
  validity (`:139–147`), and **Place/Cancel** buttons (`:149–162`). This whole
  sub-panel is replaced by in-scene gestures; the catalog list becomes hotbar glyphs.
- `lib/blueprintCatalog.ts` `CATALOG` (3 entries: comms-mast, dome, solar-array) —
  each task has `rel: {X,Y}` + `envelope.size`. The **footprint glyphs** are derived
  from these `rel` positions (top-down), e.g. dome = 8-wall ring + 4 foundations,
  array = 2 pads, mast = 1 point.
- `TaskLedger.tsx` enumerates every task (`badge + id + type + assignee`) + a static
  `LEGEND` + a `counts` line. Props: `tasks`, `roverCount`, `hasSnapshot`. The
  Mission HUD needs **done/total** (derive from `tasks` status `DONE`) + **alive/total
  rovers** — rover alive count is NOT a current prop (TaskLedger only gets
  `roverCount`); App has `snapshot.rovers[].` with an `alive`/dead flag (see KillPanel
  + `roverHaloColor`). Thread `roversAlive`/`roversTotal` from App.
- Placement wiring: `PlacementPlane` (`Scene3D.tsx:2295`) `onPointerMove` → `onMove`,
  `onPointerDown` → `onConfirm` (**fires on any button** — must gate to button 0).
  Rotation is currently the slider only (`rotatePlacement` in App `:173`). Camera
  `OrbitControls` stays **enabled** during placement today (only transitions disable
  it, `:3178/3309`). `placing` arms the plane (`Scene3D` props `:2011`).
- Markers: `SkyBodies.tsx` `SiteMarker` (`:1194–1317`) = invisible cylinder hit-proxy
  + flat `ringGeometry` + `circleGeometry` disc + additive beacon cylinder + `<Html>`
  label; `SITE_MARKERS` colors cyan/amber (`:1187–1188`); seated via
  `useSiteMarkerSeat` (lat/lon → globe point + normal quaternion). `SiteMarkers`
  rendered only `inOrbit && onSelectSite` (`:1514`). Click → `onSelectSite(site)` →
  App sets site + `surface` (the descent).
- Bloom: `HALO_BLOOM_LAYER = 11` (rover halos), `CELESTIAL_BLOOM_LAYER = 12` (Sun/
  Earth) — both `SelectiveBloom` passes (`Scene3D.tsx:122–134, 1786–1889`). Markers
  reuse layer 12.
- Render loop: `frameloop="always"` (demand-loop dropped) — a continuous marker pulse
  via `useFrame` is allowed; no `invalidate()` gymnastics needed.
- Transition driver: `Scene3D` useEffect keyed on `viewMode`/site, glare DOM overlay
  driven imperatively, `shown` flips at glare peak (t≈0.5). HUD slide/fade should hang
  off the **same** view change (a CSS class toggled on `viewMode`), timed to land as
  the descent settles — not a second independent animation clock.
- drei `^9.122` + three `^0.169` (`web/package.json`): `Text`, `Billboard`, `Line`
  all available. `SkyBodies.tsx` currently imports only `Detailed, Html`.

---

## Phase P0 — HUD foundation: view-gating + top bar + skin + hide-key

Frontend shell only; no scene change. Land first so every later phase drops into a
gated, reskinned frame.

- **Lift the View toggle** out of `ControlsPanel` into a new slim `TopBar` (or fold
  into the existing `header.topbar`): wordmark · `StatusIndicator` · Reload demo ·
  **Surface/Orbit** segmented toggle. Drop the raw `url` `meta` from view (keep it as
  a `title=` tooltip on the connection pill if wanted).
- **Gate panels by `viewMode`** in `App.tsx`'s `main.stage`: surface-only =
  `TaskLedger`→MissionHUD, `BlueprintPalette`→hotbar, stress sliders, `EarthPanel`,
  `KillPanel`. Orbit renders none of these. (Markers are inside `Scene3D` already and
  are orbit-gated there.)
- **`hudHidden` state + `H` key**: a window `keydown` listener in App toggles
  `hudHidden`; when true, add a `hud--hidden` class on the stage that fades all HUD
  layers (CSS `opacity`/`pointer-events`). The Canvas is unaffected.
- **Solid game-UI skin**: add a `.panel` base class in `dashboard.css` (opaque bg,
  beveled 1px border + inner highlight, rounded, drop shadow; cyan accent var, amber
  warning var) and apply it to every floating panel. Define `--hud-accent`,
  `--hud-warn`, `--panel-bg`, `--panel-edge` tokens.

**Done when:** orbit shows only the top bar (+ markers); surface shows the existing
panels reskinned; `H` fades all HUD in/out; View toggle works from the top bar.

## Phase P1 — Bottom hotbar + placement gesture rework

The biggest UX change. Replace `BlueprintPalette` with a `Hotbar` and move placement
into the scene.

- **`Hotbar` component** (bottom-center, surface-only): footprint-glyph blueprint
  buttons (P1a) · `☐ LLM Generated` checkbox · `⚠ Failure` + `⏱ Latency` icon buttons
  that toggle a slider **popover** above the bar · `📍 <site>` chip that cycles
  `activeSite` (triggering the existing site re-descent). Memoized.
- **P1a — Footprint glyphs**: a small pure helper `footprintGlyph(blueprint)` → inline
  SVG, projecting each task's `rel.{X,Y}` (and `envelope.size`) to a normalized
  top-down schematic (dots/squares). Lives next to `blueprintCatalog` or in the
  Hotbar. Tinted via `--hud-accent`; glow on hover/active.
- **Persistent `liveMode`**: App owns `liveMode: boolean` (default false). The hotbar
  checkbox sets it; `startPlacement` seeds `placement.mode = liveMode ? "live" :
  "replay"`. Remove the per-placement Replay/Live toggle from the (now-deleted) sub-panel.
- **Placement gestures** (in `Scene3D`):
  - Pick a glyph → `placing` arms `PlacementPlane` as today; ghost follows cursor.
  - **Lock the camera** while `placing`: `controls.enabled = false` on arm,
    restored on confirm/cancel (mirror the transition enable/disable at `:3178`).
  - `PlacementPlane.onPointerDown` → **gate to `e.button === 0`** for place.
  - **Right-drag rotate**: pointer-down (button 2) starts a rotate-drag; horizontal
    delta maps to radians → `onRotate`. Suppress `contextmenu` on the canvas while
    placing. Scroll = zoom (leave dolly enabled, or map wheel → small zoom).
  - **ESC** (or re-clicking the active glyph) cancels → `cancelPlacement`.
  - A tiny cursor-anchored validity tick (✓/✗ + `invalidReason`) + a one-line key
    hint near the hotbar replace the old sub-panel.
- **Stress popovers**: failure/latency slider state stays in the controls module
  (lifted to a small `StressControls` used inside the popover), still sending
  `setFailureProb`/`setLatency`.

**Done when:** placing a blueprint works fully via L-place / R-drag-rotate / scroll-
zoom / ESC-cancel with the camera locked; the `LLM Generated` toggle threads `mode`
into the emitted control; failure/latency adjustable from hotbar popovers; site chip
re-descends.

## Phase P2 — Mission HUD (Task ledger redesign)

- **`MissionHud` component** (top-left, surface-only) replacing `TaskLedger`:
  - Build progress bar `done/total` (derive `done = tasks.filter(DONE).length`,
    filtered to `activeSite` like `obstacles` in `App.tsx:191`).
  - `rovers N/M alive` (thread `roversAlive`/`roversTotal` from App; alive = the same
    flag KillPanel/`roverHaloColor` read).
  - Both visibly **dip + recover** under Failure (no extra wiring — they're pure
    snapshot derivations that already move).
  - **Expand** affordance → reveals the full per-task list (reuse the old row markup);
    collapsed by default. Legend → a hover tooltip on a small `?`.
- Keep it memoized on `tasks` + the two rover counts + an `expanded` UI flag.

**Done when:** the compact HUD reads at a glance, dips on a Failure spike, recovers on
heal, and expands to the full list on click.

## Phase P3 — NMS-style orbit markers

Replace `SiteMarker`'s ring/disc/beacon/`<Html>` with an in-world reticle.

- **Reticle**: a drei `<Line>` diamond (4 points, closed) — thin, emissive, on
  `CELESTIAL_BLOOM_LAYER` (12) for the bloom halo — wrapped in drei `<Billboard>` so
  it always faces camera. Seat it slightly **off** the globe surface along the local
  normal (reuse `useSiteMarkerSeat`). It occludes behind the limb naturally (real
  depth). Keep the invisible cylinder hit-proxy for the click target.
- **Label**: drei `<Text>` (SDF) under the diamond, billboarded with it: line 1 =
  name (`LUNAR BASE` / `SHACKLETON`), line 2 = status word (`operational` /
  `in construction`). Tint cyan/amber from `SITE_MARKERS`. No build numbers.
- **Pulse**: a subtle `useFrame` scale/emissive breathe (free under
  `frameloop="always"`).
- **Hover lock-on**: on `hover`, brighten + tighten a bracket reticle (scale the
  diamond down a touch + show corner ticks). Click → `onSelectSite` (unchanged).
- Delete the flat `ringGeometry`/`circleGeometry`/beacon meshes and the `<Html>`
  label + its import.

**Done when:** both markers render as crisp billboarded diamonds with in-world labels,
bloom, pulse, hover lock-on; they occlude behind the Moon; clicking still descends.

## Phase P4 — Motion + polish

- **View transitions**: a `hud--surface` / `hud--orbit` class on the stage (keyed on
  `viewMode`) drives slide/fade of the surface panels — timed to land as the glare-
  masked descent settles (hang off the same `viewMode` change the driver uses; a CSS
  transition is enough, no JS clock). Markers fade in on entering orbit.
- **Cinematic key polish**: ensure `H` cross-fades cleanly mid-transition and the
  pointer-events drop so a hidden HUD never eats clicks.
- **Earth + Kill restyle**: apply the `.panel` skin; Earth bottom-right, Kill
  top-right (contextual). Verify Kill still only renders for a live selected rover.
- Screenshot pass (lunar + shackleton + orbit, HUD-on and `H`-off) into `.screenshots/`.

**Done when:** crossing orbit↔surface animates the HUD without fighting the descent;
`H` gives a clean pure-scene capture; all panels share the game-UI skin.

---

## Risks (mitigations)

1. **Right-drag rotate vs OrbitControls / context menu.** OrbitControls binds RIGHT
   to pan and the browser opens a context menu. → Lock `controls.enabled=false` while
   placing and `preventDefault` the canvas `contextmenu`; restore on confirm/cancel.
2. **Camera lock leaves controls disabled on interrupt.** → Mirror the transition
   pattern (`Scene3D.tsx:3248/3371`): always re-enable in a cleanup/catch so an
   aborted placement never traps the camera.
3. **`onPointerDown` places on any button.** → Gate to `e.button === 0`; route
   button 2 to rotate-drag.
4. **Marker SDF text legibility / draw cost.** → One `<Text>` per marker (2 total),
   static strings; billboarded; cap font size; reuse the celestial bloom pass (no new
   EffectComposer pass).
5. **HUD transition fighting the glare descent.** → Drive HUD motion from the same
   `viewMode` flip via CSS only; do not add a second imperative animation loop.
6. **View-gating regressions** (a panel that assumed it was always mounted). →
   Panels are already memoized/presentational; gate at the App render boundary, not
   inside components.

## Scope-balloon flags (OUT of v1)

- Live 3D thumbnail icons (chose footprint glyphs).
- Earth "mission status" readout in orbit (chose to hide it — preserves the surface
  latency payoff).
- A second surface→surface site toggle in the top bar (site chip on the hotbar only).
- Distance readouts / minimap / objective markers beyond the two sites.
- Reworking the stress controls into discrete notches/dials (keep sliders, reskinned).
- Backend/wire changes of any kind.

## Critical files

- `web/src/App.tsx` — view-gating, lift View toggle, `hudHidden`+`H`, `liveMode`,
  thread rover alive counts.
- `web/src/components/ControlsPanel.tsx` — split: View→top bar, Site→hotbar chip,
  sliders→hotbar popovers (likely becomes `StressControls` + retired).
- `web/src/components/BlueprintPalette.tsx` → replaced by `Hotbar.tsx`
  (+ footprint-glyph helper).
- `web/src/components/TaskLedger.tsx` → replaced by `MissionHud.tsx`.
- `web/src/components/Scene3D.tsx` — placement gestures (camera lock, button-gated
  place, right-drag rotate, contextmenu suppress, ESC), `placing` plumbing.
- `web/src/components/SkyBodies.tsx` — `SiteMarker` reticle rewrite (Line+Text+
  Billboard, bloom layer 12, pulse, hover lock-on), drop Html/ring/disc/beacon.
- `web/src/components/EarthPanel.tsx`, `KillPanel.tsx`, `StatusIndicator.tsx` — skin.
- `web/src/styles/dashboard.css` — `.panel` base, tokens, hotbar, popover, mission
  HUD, hide-fade, view-transition classes.
- `web/src/lib/blueprintCatalog.ts` — source for footprint glyph geometry (no change,
  read-only).

## Verification (end-to-end)

1. **Orbit declutter**: load (default orbit) → only top bar + two markers; no ledger/
   blueprints/stress/Earth in the DOM.
2. **Markers**: both diamonds crisp + billboarded + bloom; orbit-drag so one passes
   the limb → it occludes; hover → lock-on; click → descends to that site.
3. **Surface HUD**: hotbar (glyphs + LLM toggle + ⚠/⏱ popovers + site chip), Mission
   HUD top-left, Earth bottom-right appear (animated in).
4. **Placement**: pick a glyph → camera locks, ghost tracks cursor; right-drag
   rotates; left-click on a valid spot places (next snapshot shows the structure);
   ESC cancels and restores the camera; `LLM Generated` checked → emitted control
   carries `mode:"live"`.
5. **Self-heal story**: raise Failure → Mission HUD build bar + rover count dip, then
   recover; Earth panel lags as Latency climbs.
6. **Site chip**: click → re-descends to the other worksite.
7. **Cinematic key**: `H` fades all HUD out (pure scene, no click-eating) and back.
8. `pnpm/npm test` + typecheck green; screenshots captured.
