# [Epic] Two-site live lunar surface — Lunar Base + Shackleton Crater Base

- **Issue:** [#133](https://github.com/IamP5/fiap-gs-space-connect/issues/133) (epic)
- **Labels:** `area:frontend`, `area:backend`, `type:feature`
- **Type:** Epic (full-stack — backend SiteID + frontend scale/views/transition)
- **Builds on:** the [realistic-3d-world](../02-realistic-3d-world/README.md)
  milestone (orbit hero vista #81–91, vendored NASA Assets #54–#57, Asset catalog
  #59–#61) and [NL Blueprint authoring](../03-nl-blueprint-authoring/README.md)
- **ADR(s) to honor:** ADR-0004 (scene is a pure function of the snapshot; mandatory
  primitive/box fallbacks). NB: ADR-0004 invariant (3)'s demand-loop / 0-idle-fps
  budget was **dropped** (Wave 4 "living orbit") — the scene now runs
  `frameloop="always"` and `useFrame` is unrestricted (see `AGENTS.md` render-loop
  note). Anywhere this plan once said "demand-safe / idle at 0fps", read "always-on,
  keep `dpr ≤ ~1.5` + bounded draw calls as hygiene".
- **Runs in parallel with:** [Epic 05 — app-init refactor](../05-app-init-refactor/README.md)
  (#127–#131: 2D removed, loading-screen preload-everything, **orbit is the default
  view**, base marker on the sunlit hemisphere). The two epics **converge** — see
  "Coordination with Epic 05" below — and share heavy edits in `App.tsx`,
  `Scene3D.tsx`, and the orbit marker in `SkyBodies.tsx`.

## What to build

Replace the single, visually messy **surface** worksite with **two distinct,
live lunar base sites**:

1. **Lunar Base** — an established base, equatorial (≈ Mare Tranquillitatis), high
   sun.
2. **Shackleton Crater Base "in construction"** — south pole, low grazing sun, long
   dramatic shadows.

Both sites are **far apart at real lunar coordinates** (shown on the orbit Moon
globe) and **driven by live snapshot data**, each with its own rovers. All NASA
assets render at **one consistent real-world scale**, composed as clean hero shots.
A UI toggle swaps the surface view between the two sites with a smooth, **direct
surface→surface glare-masked transition**. The existing **orbit** vista stays as a
separate view, now showing two clickable site markers.

### Why

Running the app with mock data confirmed the surface view is the weak point: a
**giant astronaut** dominates the frame and every model sits at an inconsistent
size, with no spatial composition. Two compounding bugs cause it:

1. `web/src/lib/scene.ts` `sceneMap()` **auto-fits** the rover+task bounding box
   into a fixed 20-unit span *every snapshot* — arbitrary, and it jitters as the
   swarm (parked at world Y=−70) moves.
2. `web/src/components/LaunchScenery.tsx` sizes each model by a hand-picked `fit`
   (astronaut 0.9 vs launcher 8 ≈ 1:9; reality ≈ 1:60).

The orbit vista, by contrast, already looks great — so this epic is a surface-view
restructure, not a rewrite.

## Approach (decisions locked)

- **One coordinator + a `SiteID` tag** (not two coordinators) — keeps the
  single-snapshot contract the whole frontend + ADR-0004 rely on.
- **One fixed `SCENE_UNITS_PER_METER`** + per-site fixed framing transform
  (recenter/rotate, no per-snapshot autoscale).
- **Direct surface→surface** glare transition; orbit kept as a third view.
- **Consistent real proportions, hero composition** (real sizes, art-directed
  layout — not literal kilometre distances).
- **Real lunar coordinates** + **pole lighting** for Shackleton.

Full design, exact file/field edits, starting numeric values, risks, and phased
breakdown: see [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md).

## Acceptance criteria

- [ ] **P0** Scale unified on the existing single site — no giant astronaut;
      rover/astronaut/habitat/crawler at believable relative sizes; click-to-kill
      and drag-to-place still correct.
- [ ] **P1** Backend emits `site` on every rover/task; same-site healing; no
      cross-site bids; deterministic winner per site; Go tests green.
- [ ] **P2** Surface view renders the active site only; Lunar Base and Shackleton
      each frame cleanly with distinct lighting/tint; mock carries both sites.
- [ ] **P3** Orbit view shows two site markers at correct lat/long; clicking one
      descends to that site.
- [ ] **P4** Surface↔surface toggle plays a smooth ~900 ms glare match-cut and
      **settles cleanly on the destination pose** (tween stops, idle drift resumes —
      no 0fps requirement now that the loop is always-on); Shackleton long-shadow +
      "in construction" polish.
- [x] Broken into vertical slices via `/to-issues` (epic #133): #134 (P0 scale),
      #135 (P1 backend), #136 (P2 surface), #137 (P3 markers), #138 (P4 transition).

## Coordination with Epic 05 (parallel execution)

Epic 05 (#127–#131) is **frontend-only** and not yet implemented. It reshapes the
boot sequence; this epic restructures the surface. They **converge** into one
experience: boot → splash preloads **everything** → **orbit** vista with **two**
site markers → click either → pop-in-free descent to that site. Run them in
parallel with these guard-rails:

- **Backend P1 is fully independent** — Go only, zero overlap with Epic 05. Land it
  whenever.
- **P0 (scale) is near-independent** — `scene.ts` is ours alone; the `Scene3D.tsx` /
  `LaunchScenery.tsx` edits touch sizing regions, not Epic 05's preload/2D-removal
  regions. Safe to land early in parallel.
- **P2 threads `activeSite` through `App.tsx` _after_ #128** (2D removal simplifies
  `App.tsx` — rebasing onto the smaller file avoids a churned merge). Orbit is the
  default (#130), so the two-site surface is reached **via descent**, not on boot.
- **New assets must register in Epic 05's `lib/assets.ts` manifest** — preload-
  everything only covers what the manifest lists. We reuse the same dome twice
  (no new GLBs), but any Shackleton long-shadow decal / "in construction" texture
  must be added to the manifest or it will pop in on descent (defeating #129).
- **P3 supersedes #131.** Both reseat the orbit marker in `SkyBodies.tsx`. Our two
  lat/lon `SiteMarker`s replace the single `LunarBaseMarker`, but must inherit
  #131's lesson — **markers must land on the lit hemisphere**, not the terminator.
  Whichever lands first, the other rebases; ideally P3 absorbs #131 outright.

## Scope-balloon flags (OUT of v1)

Real shadow maps (faked instead — still deferred for cost/complexity, _not_ the old
demand-loop reason) · two coordinators (rejected) · distinct blueprints/asset sets
per site (reuse the same dome twice) · moon globe tilt (only if marker visibility
forces it) · multi-target scripted kills.
