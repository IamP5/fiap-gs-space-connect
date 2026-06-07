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
