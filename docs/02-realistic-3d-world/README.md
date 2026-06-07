# Realistic lunar 3D world

Artifacts for making the `web/` React Three Fiber lunar scene (`Scene3D.tsx`) as
realistic as possible: a full Moon viewable from **orbit** and from the
**surface**, plus realistic rovers, habitats, ships/landers, a launch
platform/gantry, and construction props the swarm assembles — without breaking
the three invariants that make the renderer trustworthy.

## Contents

- [`realistic-3d-world-assets.md`](./realistic-3d-world-assets.md) — the full
  research & integration guide: asset tables (with licenses + verified URLs), the
  R3F v8 compatibility matrix, integration architecture, the ADR-0004 amendment,
  and a v8-annotated techniques cheat-sheet.
- [`space-view-realism.md`](./space-view-realism.md) — NASA SVS reference study
  (CGI Moon Kit 4720, near/far-side phases 14992, descent flythrough 4444):
  lighting re-grade, earthshine, Moon/Earth material, orbit→surface descent
  choreography, Milky-Way background + nebula hero, and a tiered implementation
  plan. Follow-on focused on the **space/orbit view** look-and-feel.
- [`cinematic-beauty-immersion.md`](./cinematic-beauty-immersion.md) — Wave 3
  technical-art-direction audit: post-FX stack, shadows, Earth/Moon shaders,
  material polish, and the living-sky / cinematic-moment ideas. Backs the Wave 3
  slices (#99–#112) and records the idle-fps invariant relaxation (opt-in motion,
  pause-when-hidden).
- [`issues/`](./issues/) — the implementation plan as one markdown file per issue
  (epic [#46](./issues/46-epic-realistic-lunar-3d-world.md) + child slices
  [#47](./issues/47-amend-adr-0004-scope-guard.md)–[#61](./issues/61-live-mode-asset-placement.md)),
  mirroring the GitHub issues.

## Locked decisions

- **Licensing:** CC0 + CC-BY 4.0 (with attribution) + NASA/US-gov public-domain
  allowed; reject NC/ND/unknown. Self-host **all** assets in
  `web/public/assets/` — never CDN/Sketchfab at runtime.
- **Stack: stay on v8** (`@react-three/fiber` 8.18 / `@react-three/drei` 9.122 /
  `three` 0.169 / React 18.3). Every realism API already ships in the installed
  drei; upgrading to v9/React 19 is a forced multi-package cascade with no realism
  upside. Keep `@react-three/postprocessing` at ^2.19.1. Skip
  `@react-three/rapier` and drei `PerformanceMonitor`/`AdaptiveDpr` (incompatible
  with `frameloop="demand"`).
- **The three invariants** every slice must preserve: (1) the scene stays a pure
  function of the snapshot (decorative, snapshot-independent elements are
  permitted); (2) every glTF/texture has a mandatory primitive fallback; (3) the
  demand-loop perf budget is preserved (0 fps idle, dpr capped at 1.5, draw calls
  bounded).
- Realistic assets flow through the **existing `model_ref` / `material.map` seam**
  (`buildspec.ts` + `SpecModel`/`SpecPrimitive`).

## Implementation plan

Tracked on the issue tracker under epic
[#46](https://github.com/IamP5/fiap-gs-space-connect/issues/46) and mirrored
locally in [`issues/`](./issues/). All slices are AFK (independently grabbable);
blockers are noted.

| Issue | Slice | Blocked by |
|-------|-------|------------|
| [#47](https://github.com/IamP5/fiap-gs-space-connect/issues/47) | Amend ADR-0004 + scope guard (docs) | — |
| [#48](https://github.com/IamP5/fiap-gs-space-connect/issues/48) | glTF child raycast fix (click-to-kill safety) | — |
| [#49](https://github.com/IamP5/fiap-gs-space-connect/issues/49) | Camera far-plane + orbit/surface view-mode toggle | — |
| [#50](https://github.com/IamP5/fiap-gs-space-connect/issues/50) | `<SpaceEnvironment>`: starfield + HDR IBL backdrop | #47 |
| [#51](https://github.com/IamP5/fiap-gs-space-connect/issues/51) | Sky bodies: Moon globe (orbit) + Earth (surface) | #49, #50 |
| [#52](https://github.com/IamP5/fiap-gs-space-connect/issues/52) | Asset conditioning pipeline (convert/normalize + DRACO/meshopt) | #48 |
| [#53](https://github.com/IamP5/fiap-gs-space-connect/issues/53) | PBR `SpecPrimitive` + tiling regolith ground | #47 |
| [#54](https://github.com/IamP5/fiap-gs-space-connect/issues/54) | Realistic rover model (Rover3D render swap) | #48, #52 |
| [#55](https://github.com/IamP5/fiap-gs-space-connect/issues/55) | Habitat/base Assets → populate the Asset catalog | #48, #59 |
| [#56](https://github.com/IamP5/fiap-gs-space-connect/issues/56) | Launch infrastructure set-pieces (Scenery) | #48 |
| [#57](https://github.com/IamP5/fiap-gs-space-connect/issues/57) | Construction prop Assets (catalog) + PBR materials | #53, #59 |
| [#58](https://github.com/IamP5/fiap-gs-space-connect/issues/58) | Instancing/merging for repeated props + gantry | #57 |
| [#59](https://github.com/IamP5/fiap-gs-space-connect/issues/59) | Asset catalog + catalog-key Build op (ADR-0010) | — |
| [#60](https://github.com/IamP5/fiap-gs-space-connect/issues/60) | Coordinator validates Asset keys before World Model fold | #59 |
| [#61](https://github.com/IamP5/fiap-gs-space-connect/issues/61) | Live-mode Asset placement via catalog keys | #59, #60, #48 |

**Ready to start now (no blockers):** #47, #48, #49, #59.

### Architecture (ADR-0010)

Live **and** replay Build modes place curated **Assets** from a closed, contract-carried
**Asset catalog** by **key** — the Model never emits a free-form ref, and the coordinator
validates catalog membership before the World Model fold (see
[`docs/01-build-harness/adr/0010-live-mode-curated-asset-catalog.md`](../01-build-harness/adr/0010-live-mode-curated-asset-catalog.md)).
#55 (habitats) and #57 (task-placed props) **populate** the catalog; #54 (rover) is a
`Rover3D` render swap and #56 (launch) is **Scenery** — neither is a catalog Asset.

### Downstream epic

[#62 — Natural-language Blueprint authoring](https://github.com/IamP5/fiap-gs-space-connect/issues/62)
(Architect extension) is a **separate epic** downstream of this milestone — it composes Blueprints
from a stated goal using the Asset catalog. It has its own folder:
[`docs/03-nl-blueprint-authoring/`](../03-nl-blueprint-authoring/README.md). Not part of the realism slices.

## Wave 3 — Cinematic beauty & immersion polish

A pure look-and-feel wave: make the scene **prettier and more immersive** without
new gameplay. Research in
[`cinematic-beauty-immersion.md`](./cinematic-beauty-immersion.md). All slices are
AFK; blockers noted.

> **Invariant note:** Wave 3 relaxes the 0-idle-fps invariant for **opt-in
> motion** (twinkle, drift, rotating clouds, idle camera sway). The backend/robot
> data path is unaffected — snapshots reach the scene over the WebSocket → React
> state → repaint regardless of frameloop mode — so the only cost is GPU/battery
> while idle. Animated slices **pause when the tab is hidden**; snapshot-driven
> effects stay fully demand-safe. Static slices (post-FX, shaders, shadows,
> materials) preserve 0 idle fps as before.

| Issue | Slice | Phase | Blocked by |
|-------|-------|-------|------------|
| [#99](https://github.com/IamP5/fiap-gs-space-connect/issues/99) | Post-processing cinematic stack (bloom Sun+Earth, Vignette, SMAA, CA, grain, surface DoF) | static | — |
| [#100](https://github.com/IamP5/fiap-gs-space-connect/issues/100) | Texture fidelity pass (anisotropy, glTF colorspace, data-map filtering, Moon normalScale) | static | — |
| [#101](https://github.com/IamP5/fiap-gs-space-connect/issues/101) | Lighting & framing grade (FOV 50, rim/fill lights, earthshine falloff, fog dedupe+tint) | static | — |
| [#102](https://github.com/IamP5/fiap-gs-space-connect/issues/102) | Earth atmosphere Fresnel shader (sun-angle Rayleigh/Mie rim) | static shader | — |
| [#103](https://github.com/IamP5/fiap-gs-space-connect/issues/103) | Moon shader polish (terminator rim-glow + limb darkening) | static shader | — |
| [#104](https://github.com/IamP5/fiap-gs-space-connect/issues/104) | Soft shadows + contact shadows | static | — |
| [#105](https://github.com/IamP5/fiap-gs-space-connect/issues/105) | Terrain microrelief noise | static | ✅ 7caf185 |
| [#106](https://github.com/IamP5/fiap-gs-space-connect/issues/106) | Twinkling stars + meteor streaks | animated | — |
| [#107](https://github.com/IamP5/fiap-gs-space-connect/issues/107) | Snapshot-driven FX (rover dust, bid-war strobe, resurrection shockwave) | demand-safe | — |
| [#108](https://github.com/IamP5/fiap-gs-space-connect/issues/108) | Cinematic beats (intro fly-in, Earthrise hero, launch + shake) | animated | — |
| [#109](https://github.com/IamP5/fiap-gs-space-connect/issues/109) | Camera feel (idle drift, inertial damping, zoom exposure, parallax) | animated | — |
| [#110](https://github.com/IamP5/fiap-gs-space-connect/issues/110) | Sun GodRays + lens flare (orbit-gated) | static | #99 |
| [#111](https://github.com/IamP5/fiap-gs-space-connect/issues/111) | Material tier polish (dome roughness, clearcoat metal, rock PBR, solar glint, emissive windows) | static | #99 |
| [#112](https://github.com/IamP5/fiap-gs-space-connect/issues/112) | Living Earth (cloud shell + city-light flicker) | animated | #102 |

**Ready to start now (no blockers):** #99, #100, #101, #102, #103, #104, #105, #106, #107, #108, #109.
