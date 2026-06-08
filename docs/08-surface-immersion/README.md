# Milestone 08 — Lunar Surface Immersion Overhaul

> **Goal:** turn the lunar surface view from "muddy brown field with tiny boxes
> scattered around" into a **believable, beautiful, high-contrast Moon base** —
> coherent base composition, robotic-reading rovers, crisp regolith, real NASA
> structures, and cinematic lunar lighting.

Status: **PLANNED** · Created 2026-06-08 · Targets R3F v8 · Ships CC0 + NASA-PD only.
Tracking: **GitHub milestone #3** (`08 — Lunar Surface Immersion Overhaul`) — this
initiative is grouped by a milestone, not a `type:epic` issue (see
[`docs/harness/issue-tracking.md`](../harness/issue-tracking.md)).

## Slice checklist

Tick each on merge (`- [x] #NN … · PR #MM`) and flip its `feature_list.json`
feature to `passing`.

- [x] #169 — 08-P1 Declutter resting worksite (WS-1) · `r3d-169` · _branch `feat/08-surface-immersion`_
- [ ] #170 — 08-P2 Regolith overhaul: grey + 1K/2K + anti-tiling (WS-4) · `r3d-170` · _no blockers_
- [ ] #171 — 08-P4 Robotic rover readability: scale 2.5–3× + load-fix + material (WS-3) · `r3d-171` · _no blockers_
- [ ] #172 — 08-P3 Cinematic lunar lighting + exposure (WS-5) · `r3d-172` · _blocked by #170_
- [ ] #173 — 08-P6 Hero lava-tube cave skylight + boulder scatter (WS-4) · `r3d-173` · _blocked by #170_
- [ ] #174 — 08-P5 Composed base layout + NASA-PD assets [HITL] (WS-2+WS-6) · `r3d-174` · _blocked by #169_

---

## Why this epic exists (the complaint, decoded)

Four screenshots at `?reel=1` surfaced five concrete problems. Each maps to a
specific code path (traced — see [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md)):

| # | What the user sees | Root cause in code |
|---|--------------------|--------------------|
| 1 | "Moon visuals too bad" — muddy, brown, washed-out, repetitive ground | 512px regolith tiled ~210×; warm `#9a948c` tint (reads as dirt/Mars, not grey Moon); flat low-contrast lighting |
| 2 | "Rovers don't look like robots / too small" | Rover = **0.3 scene units** (2.5 m × 0.12). RASSOR drum-excavator reads as a blob at that size; dwarfed 48:1 by the 14.4 u mobile launcher |
| 3 | "Base & assets weirdly placed" | Set-pieces at hand-picked scattered `[x,0,z]` with no composition — lonely structures at the worksite edge, no pads/paths/grouping |
| 4 | "Random assets in the middle of the map" | The **UNCLAIMED TaskBlock ghost field** (opacity 0.28) — every un-built blueprint task renders as a translucent box across the center |
| 5 | "Remove the default blueprint preview that starts placed" | Same ghost field — the whole blueprint footprint shows ghosted before any build begins |

**The throughline:** the scene is *technically* correct (real proportions, real
NASA-PD textures, PBR) but *art-directionally* unfinished. Realism ≠ beauty. This
epic trades a little physical accuracy (rover scale) for readability, and invests
heavily in **art direction**: color, contrast, composition, density, and hero detail.

---

## The five workstreams

Ordered by **impact-per-effort** (do them roughly in this order; each ships independently):

### WS-1 — Declutter the worksite (fixes #4, #5) · *highest impact, lowest effort*
Stop rendering the full ghost-task field at rest. The Moon should start as a
**clean, real surface**; ghosts appear only for tasks actively being bid/built,
and far more subtly. Removes the "random boxes in the middle" instantly.

### WS-2 — Compose a real base (fixes #3)
Replace scattered hardcoded set-piece coords with a **designed master layout**:
a landing pad, a habitat cluster on a graded pad, a power farm (solar row), a
comms ridge, connected by rover tracks. Structures read as *one base*, not props.

### WS-3 — Rovers that read as robots (fixes #2)
Bump rover scale ~2.5–3× for game-readability, **verify the GLB actually loads**
(not silently falling back to primitive boxes), upgrade material fidelity, and
add subtle idle articulation. Optionally introduce a second clearly-robotic CC0
rover variant so the swarm doesn't look like 6 identical blobs.

### WS-4 — Regolith & terrain quality (fixes #1, "ground/rocks/craters/caves")
Higher-res regolith with detail-blend to kill tiling repetition; **correct lunar
color** (neutral grey, not warm brown); scattered boulders + a hero crater/rille
feature on the flat lunar site; near-field micro-detail. Make the ground itself
beautiful.

### WS-5 — Cinematic lunar light & sky (fixes #1)
High-contrast key/fill (bright sunlit regolith, near-black shadow), tuned
exposure/tonemapping and bloom, sharper Earth-over-horizon hero framing. This is
what makes a render feel "extreme quality."

### WS-6 (cross-cutting) — NASA asset pipeline
Pull web-ready NASA-PD GLBs (Apollo LM, Astronaut, EMU spacesuit, 70-m Dish,
Habitat parts) through the existing `scripts/condition-asset.mjs` Draco pipeline,
audit each for embedded NASA insignia, register in `lib/assets.ts` + `lib/scene.ts`.

---

## Asset research summary (NASA 3D sources)

Full findings in [ASSET-RESEARCH.md](./ASSET-RESEARCH.md). Headlines:

- **`nasa/NASA-3D-Resources` is the real source.** Newer models already ship as
  **web-ready `.glb`** — fetch straight from `raw.githubusercontent.com`, no
  conversion. Best picks (all < 3.5 MB): Apollo Lunar Module (717 KB), Astronaut
  (763 KB), EMU spacesuit (3.4 MB), Habitat Demo Unit parts 1 & 2 (~0.5–0.7 MB),
  70-meter Dish (2.2 MB).
- **The ArtechFuz3D viewer is just a browser, not a host.** It fetches the same
  NASA repo at runtime. Use its live site only as a **preview gallery**; download
  from the NASA repo.
- **Gaps NASA can't fill:** no good lunar *rover* (only Curiosity, `.blend` only),
  no solar array, no terrain mesh. Rover variety + solar must come from CC0
  third-party (Kenney / Poly Pizza / Quaternius) or stay procedural.
- **Licensing:** NASA-3D assets are public-domain / free. **One carve-out — the
  NASA insignia (meatball/worm/seal) is fenced off.** Audit each GLB's textures
  for baked-in logos before shipping. Credit line "3D models courtesy of NASA"
  covers attribution. Matches the project's CC0+NASA-PD ship rule.

---

## Definition of Done (epic-level)

- [ ] Worksite at rest shows **no translucent ghost-box field** — clean surface
      (WS-1).
- [ ] Set-pieces read as **one coherent base** with pad/cluster/power/comms zones
      (WS-2).
- [ ] Rovers are **immediately legible as robots** at default camera distance
      and don't fall back to primitive boxes (WS-3).
- [ ] Ground reads as **grey Moon regolith** (not brown dirt), no obvious texture
      tiling at working distance, with boulders + a hero crater on the lunar site
      (WS-4).
- [ ] Sunlit surface is bright with near-black shadows; Earth-over-horizon framing
      is a hero shot (WS-5).
- [ ] All new GLBs Draco-conditioned, insignia-audited, credited (WS-6).
- [ ] Headline replay reel + the Epic 07 cinematic still read correctly (no
      regressions to the 2:30 roteiro).

See [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) for file-level tasks,
slice breakdown, and risks.
