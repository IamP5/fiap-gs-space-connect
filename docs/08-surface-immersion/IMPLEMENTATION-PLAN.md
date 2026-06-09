# Epic 08 — Implementation Plan

File-level plan for the surface immersion overhaul. Each workstream is an
independently-shippable slice. Code references are `file:line` against the repo as
of 2026-06-08 (commit `1307883`).

**Key files**
- `web/src/components/Scene3D.tsx` — terrain, rovers, tasks, scene composition
- `web/src/components/SpaceEnvironment.tsx` — starfield, equirect, HDR
- `web/src/components/SkyBodies.tsx` — Moon/Earth/Sun
- `web/src/components/LaunchScenery.tsx` — set-piece GLTF rendering
- `web/src/lib/scene.ts` — scale constants, site frames, set-piece tables, `siteMap`
- `web/src/lib/blueprintCatalog.ts` — task definitions per blueprint
- `web/src/lib/assets.ts` — preload manifest
- `scripts/condition-asset.mjs` — Draco/recenter/fit pipeline for new GLBs

---

## WS-1 — Declutter the worksite *(fixes "random boxes in middle" + "remove default blueprint preview")*

**Diagnosis.** Every blueprint task with status `UNCLAIMED` renders as a
translucent box at opacity **0.28** (`Scene3D.tsx:1386`). At reel start the entire
blueprint footprint (13 / 25 / 38 tasks) is unclaimed, so the worksite is a field
of ghost boxes + a ghost hemisphere dome (`Scene3D.tsx:1389-1390`). This *is* the
"default preview that starts placed."

**Decision (recommended): ghosts are a build affordance, not set dressing.**
A real Moon base site doesn't have translucent holograms of unbuilt walls sitting
on it. Render the un-built footprint only when the build is *active* and keep it
subtle.

**Tasks**
1. **Gate the UNCLAIMED ghost render.** In `TaskBlock` (`Scene3D.tsx:1361-1497`),
   stop rendering a full opaque-ish box for `UNCLAIMED`. Options, in order of
   preference:
   - **(A) Footprint decal instead of a box.** For UNCLAIMED, render a flat
     ground decal / thin outline ring at `y≈0.02` (a "survey marker") instead of a
     0.28-opacity solid. Reads as "planned here" without cluttering volume. ~15 px
     footprint, no floating boxes.
   - **(B) Only show ghosts adjacent to active work.** Render the UNCLAIMED ghost
     only for tasks whose blueprint has at least one `LEASED`/in-progress sibling,
     or within N units of an alive rover. The rest of the footprint stays clean.
   - **(C) Drop opacity to ~0.10 and shrink** so it reads as a faint scribe line.
   Recommend **(A)** for the lunar hero site, fall back to (C) globally.
2. **Verify reel seeding.** The reel/headline replay drives the task list (not
   `MOCK_SNAPSHOT`, which is `VITE_MOCK=1` only — `hooks/useSnapshot.ts:40`).
   Confirm the reel starts the build at 0 done and that WS-1 changes how *those*
   ghosts read. No data change needed — purely a render gate.
3. **Keep the placement ghost untouched.** `BlueprintGhost` (drag-to-place,
   `Scene3D.tsx:2270-2308`) is a *deliberate* interaction and only renders when
   `ghost !== null`. Leave it. This WS is about the *resting* worksite only.

**DoD:** at reel start the worksite shows clean regolith (+ optional faint survey
markers), no floating translucent boxes/dome. Build-in-progress still legible.

---

## WS-2 — Compose a real base *(fixes "assets weirdly placed")*

**Diagnosis.** `LUNAR_SET_PIECES` (`scene.ts:82-123`) and `SHACKLETON_SET_PIECES`
(`scene.ts:134-192`) are hand-picked scattered coords with no compositional intent.
A 14.4 u mobile launcher, a 10.8 u gantry, and a 0.48 u base-station sit at
unrelated `[x,0,z]` points — lonely props, not a base. All share
`SCENE_UNITS_PER_METER = 0.12` (`scene.ts:33`) so scale is correct; *layout* is the
problem.

**Decision: author a deliberate base master-plan per site.** Treat the worksite
like a level designer would — zones, sightlines, negative space.

**Tasks**
1. **Define a layout schema.** Group set-pieces into named zones with intentional
   relationships. Proposed lunar layout (world units, origin = worksite center,
   camera looks down −Z):
   - **Landing pad** (far, −Z): lunar module + a graded circular pad decal, slight
     scorch. Crawler/gantry/mobile-launcher belong to a *launch complex* read —
     keep them clustered together on one side (e.g. all in the −X/−Z quadrant)
     rather than spread across the frame.
   - **Habitat cluster** (mid, slightly +X): habitat-demo-unit 1 & 2 + radome on a
     shared graded pad, connected by a short regolith-berm path.
   - **Power farm** (one flank): solar-panel row (3–5 instances in a line, not one
     lonely panel), facing the sun azimuth.
   - **Comms ridge** (a raised spot): comms-dish + comms-mast together, on the
     crater rim for Shackleton.
   - **Negative space** in the camera-center so rovers/tasks have a clean stage.
2. **Add ground-grading decals under clusters.** A subtle darker, flatter,
   compacted-regolith decal under each pad sells "this was prepared" and visually
   anchors structures to the ground (kills the "floating" read). Reuse the
   `ShackletonShadows` CanvasTexture-decal technique (`Scene3D.tsx:1711-1759`).
3. **Add connecting rover tracks.** Faint wheel-track decals between pad → habitat
   → power read as a *lived-in* base. Procedural, cheap, huge immersion payoff.
4. **Re-tune positions** in `scene.ts` tables. This is pure data — no new geometry.
   Keep `realMeters` (proportions stay real); only move `pos` and add `pad`/`track`
   metadata + a small decal renderer in `LaunchScenery.tsx`.

**DoD:** the surface reads as one designed base with clear zones; nothing looks
randomly dropped; structures are grounded by pad/track decals.

---

## WS-3 — Rovers that read as robots *(fixes "too small / not robots")*

**Diagnosis.** Rover = `REAL_METERS.rover (2.5) × 0.12 = 0.3 scene units`
(`scene.ts:40-53`). At that size against 4.8–14.4 u launch infra it's a speck, and
the RASSOR bucket-drum silhouette doesn't read as "robot." Risk: the GLB may be
**falling back to the primitive box+wheels** path (`Scene3D.tsx` fallback in
`Rover3D`) — the screenshots show boxy white shapes consistent with the fallback.

**Decision: prioritize readability over strict scale for the hero actors.**

**Tasks**
1. **Confirm GLB load, don't guess.** Instrument `Rover3D` / `loadGLTF` to log
   whether `rassor_rover.glb` (2.0 MB, present at
   `public/assets/models/rassor_rover.glb`) actually resolves or throws into the
   primitive fallback. If it falls back, fix the loader/material path first — a lot
   of the "looks bad" may simply be everyone seeing box-rovers.
2. **Introduce a readability scale multiplier.** Add `ROVER_HERO_SCALE` (~2.5–3×)
   applied on top of the real-meters scale so rovers land at ~**0.75–0.9 u** —
   clearly visible, still smaller than habitats. Keep the hit-proxy
   (`SphereGeometry(0.95)`) scaling with it (ADR-0004 no-missed-click). Document the
   intentional realism break in a comment next to `scene.ts:37-39`.
3. **Upgrade rover material fidelity.** Ensure max anisotropy, correct colorSpace,
   metalness/roughness so it catches the sun and reads as machined metal, not matte
   plastic (the #111 polish path already exists — apply it to the rover).
4. **Add idle articulation.** A subtle per-rover sensor-mast sway / wheel-settle /
   status-light blink (driven by the existing per-frame ref mutation, no
   re-renders) makes them read as *active robots* rather than parked props.
5. **(Optional) a second rover silhouette.** Source one CC0 robotic rover (Kenney
   "Space Kit" rover, Poly Pizza, or Quaternius — all CC0) so the swarm isn't 6
   identical drums. Condition through the same pipeline. Strictly optional polish.

**DoD:** rovers are unmistakably robots at default camera distance, visibly metal,
subtly alive, and never silently rendered as primitive boxes.

---

## WS-4 — Regolith & terrain quality *(fixes "moon too bad / ground / rocks / craters / caves")*

**Diagnosis.** Ground = displaced 700×700 plane with **512px** regolith tiled
~210× (`Scene3D.tsx:1500-1664`, repeat at `:1535`) and a **warm `#9a948c` tint**
(`:` per-site color) that reads as *brown dirt / Mars*, not the **neutral grey** of
real lunar regolith. Only Shackleton gets a carved crater; the flat lunar site is
featureless. Tiling repetition is visible.

**Tasks**
1. **Correct the lunar color.** Shift the lunar base tint from warm `#9a948c`
   toward neutral/cool grey (~`#8a8a88` → highlights near `#b8b8b4`). Real regolith
   is grey; the warm cast is the single biggest "this looks like dirt" tell.
2. **Kill tiling repetition.** Two cheap, high-impact options:
   - **Detail-blend / triplanar-ish macro variation:** multiply the tiled diffuse
     by a large-scale low-frequency noise (or a second very-low-repeat macro
     texture) so the ~210× tile doesn't read as a grid. Add a `near-field` detail
     map at high repeat for the foreground only.
   - **Upgrade regolith to 1K/2K** (current diffuse is a *16 KB* 512 — extremely
     low). Poly Haven "Moon"/"Lunar" surfaces ship CC0 at 2K/4K. Bump diffuse +
     normal + rough + ao to 1K (or 2K with Draco/KTX2). Biggest single quality win
     for the ground.
3. **Scatter boulders + rocks on the lunar site.** A `DecorRocks`-style instanced
   scatter already exists (rock textures present:
   `rock_boulder_dry_*_512.jpg`). Extend it to the flat lunar worksite with varied
   scale/rotation, clustered realistically (more near crater rims, sparse on plains)
   and **excluded from the base/pad footprints** so they don't collide with
   structures.
4. **Add a hero crater (and/or rille/cave-mouth) to the lunar site.** The crater
   profile machinery exists (`craterProfile`, `scene.ts:493-496`, used by
   Shackleton). Add one off-center hero crater (or a collapsed lava-tube /
   skylight cave-mouth — the user explicitly mentioned "caves") to the lunar site
   for a focal landform. A cave skylight = a dark recessed disc with a carved rim;
   reads as a lunar lava-tube entrance and is a striking immersion beat.
5. **Near-field micro-detail.** Increase displacement segment density / add a
   high-freq normal detail only within the camera's working radius so the
   foreground regolith has crunch (pebbles, footprints) while the far plane stays
   cheap.

**DoD:** ground reads as grey Moon, no obvious tiling at working distance,
boulders + at least one hero landform (crater or cave-mouth) on the lunar site,
crunchy foreground.

---

## WS-5 — Cinematic lunar light & sky *(fixes "too bad / washed out")*

**Diagnosis.** Surface lighting is low-contrast and muddy. Real lunar light is
*brutal*: a single hard sun, blinding sunlit regolith, and shadows that fall to
near-black (no atmosphere to scatter fill). The current ambient/hemisphere fill
(`SpaceLights`, `Scene3D.tsx:179-253`) lifts shadows too much, flattening everything
into grey mud.

**Tasks**
1. **Raise key, crush fill.** Increase sun directional intensity and *lower*
   ambient/hemisphere fill on the lunar site so sunlit faces are bright and shadows
   go deep. Keep a whisper of earthshine fill (`#a8bfda`) so shadow detail isn't
   pure black, but much less than now. This single change reads as "10× more
   premium."
2. **Tune tonemapping / exposure.** Verify ACES/AgX tonemapping and a slightly
   higher exposure so the bright regolith doesn't clip to flat white while shadows
   stay rich. Check `EffectComposer` (`Scene3D.tsx` post chain) ordering.
3. **Bloom discipline.** Confine bloom to the sun disc + status halos (selective
   bloom layers already exist — `HALO_BLOOM_LAYER`, `CELESTIAL_BLOOM_LAYER`); make
   sure the terrain itself isn't blooming into haze.
4. **Hero the Earth-over-horizon.** The Earth (`SkyBodies.tsx`, Fresnel atmosphere
   shader `:117-170`) is the money shot. Frame the surface camera so Earth sits low
   over the regolith horizon; ensure the equirect Milky Way rotation
   (`SpaceEnvironment.tsx`, surface yaw 106°) puts the dust band behind it. Small
   camera/rotation tweaks, big payoff.
5. **Subtle ground fog at the horizon** (already per-site fog) tuned so the far
   plane dissolves cleanly instead of showing the texture-tile horizon line.

**DoD:** bright sunlit surface, deep shadows, no muddy mid-grey wash, Earth reads
as a hero element.

---

## WS-6 — NASA asset pipeline *(cross-cutting enabler)*

**Diagnosis.** The project already ships conditioned NASA GLBs
(`public/assets/models/`). New structures should come through the same
`scripts/condition-asset.mjs` (Draco + recenter + fit-to-unit) path.

**Tasks**
1. **Download web-ready NASA-PD GLBs** (raw URLs in
   [ASSET-RESEARCH.md](./ASSET-RESEARCH.md)): Apollo Lunar Module, Astronaut, EMU
   spacesuit, 70-meter Dish, Habitat Demo Unit parts 1 & 2. All < 3.5 MB.
2. **Condition each** through `scripts/condition-asset.mjs` (Draco, recenter,
   fit-to-unit). Gateway Core (66 MB) is **out of budget** — skip or decimate hard.
3. **Insignia audit.** Inspect each GLB's textures for baked-in NASA
   meatball/worm/seal. Strip or avoid showing any that carry it (licensing
   carve-out). Geometry is fine; only the marks are fenced.
4. **Register** in `lib/assets.ts` preload manifest and `lib/scene.ts` set-piece
   tables with correct `realMeters` and the WS-2 layout positions.
5. **Credit** in `public/assets/CREDITS.md` ("3D models courtesy of NASA").

**DoD:** new structures conditioned, insignia-clean, preloaded, credited, placed
per WS-2 layout.

---

## Slice / sequencing

Recommended issue breakdown (tracer-bullet vertical slices):

1. **08-P1** WS-1 ghost declutter — *smallest, biggest immediate "it looks
   intentional now" win.* No new assets.
2. **08-P2** WS-4 regolith color + tiling + 1K textures — *biggest ground-quality
   win.* No layout dependency.
3. **08-P3** WS-5 lighting/exposure pass — *pairs with P2; together they fix
   "muddy."*
4. **08-P4** WS-3 rover readability (scale + load-fix + material). Independent.
5. **08-P5** WS-6 asset download/condition + WS-2 base layout — *the big one; do
   after the surface itself looks good so structures land on a beautiful ground.*
6. **08-P6** WS-4 hero crater/cave + boulder scatter — *polish landform pass.*

P1–P4 are pure code/data + texture swaps (no new GLB downloads), so they can land
fast. P5 carries the NASA download/condition/audit work.

### Carry-over hardening (from the #171 glTF-pipeline audit)

The #171 fix (`f56fb92`, `a7a6465`) closed the silent cache-poisoning crash class
and added asset-fallback logging. A two-agent sweep surfaced three LOW-severity,
non-crashing follow-ups — all touch files the remaining slices already edit, so
they ride along rather than getting their own issue:

- **#174 (touches `LaunchScenery.tsx` for the base layout):**
  - `fitAndSeat` / `fitAndSeatRover` silently no-op on an empty bounding box (a
    points/lines-only glTF) → model left at raw native coords/scale. Add a
    fallback: seat at origin + target scale so a degenerate asset still lands
    sanely. (also in `Scene3D.tsx`)
  - `mergeSetPiece` pairs geometry slices to materials by sequential index, not
    `geometry.groups[g].materialIndex` → wrong material on a non-sequential glTF.
    Switch to `group.materialIndex` lookup while reworking set-pieces.
- **#173 (touches `Scene3D.tsx` for the cave/boulder landform):**
  - The resurrection-flash clone is cast `as MeshStandardMaterial` unsoundly;
    guard the `.emissive` write on `isMeshStandardMaterial` (latent unsafe-read
    landmine) when next editing that region.

Each is a small guard; fold into the slice's commits, not a standalone PR.

---

## Risks & guardrails

- **Don't regress the Epic 07 cinematic.** The 2:30 roteiro hardcodes the climax at
  `lunar / wall-1`, the orbit bookend, and specific camera beats. Any worksite
  re-layout (WS-2) or ghost change (WS-1) must keep `wall-1` and the demo beats
  valid. Re-run the headline replay after each slice.
- **Stay on R3F v8** (memory constraint) — no R3F v9 APIs.
- **Performance budget.** 2K/4K textures + more instanced rocks + a second rover
  model add GPU/VRAM cost. Use KTX2/Draco, keep the instanced-draw discipline, and
  re-check the demand/`frameloop="always"` cost. Cap rock instances; LOD the hero
  crater.
- **Realism break is intentional & scoped.** Only the *rover* scale bends (WS-3);
  structure proportions stay real (`realMeters × 0.12`). Document it so a future
  agent doesn't "fix" it back.
- **Licensing.** CC0 + NASA-PD only ship; CC-BY is break-glass (memory). Audit
  every new GLB for NASA insignia before shipping.
- **Two sites.** Lunar (origin) and Shackleton (cx≈400) both need the treatment;
  Shackleton already has a crater + cool tint — keep its identity (darker, polar,
  grazing sun) distinct from the lunar hero site.
