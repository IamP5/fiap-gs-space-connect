# Epic: Realistic lunar 3D world (Moon + robots + space construction)

- **Issue:** [#46](https://github.com/IamP5/fiap-gs-space-connect/issues/46)
- **Labels:** `area:frontend`, `type:feature`
- **ADR:** [0010 — live-mode curated Asset catalog](../../build-harness/adr/0010-live-mode-curated-asset-catalog.md)

## What to build

Make the `web/` R3F lunar scene (`Scene3D.tsx`) as realistic as possible: a full Moon viewable from **orbit** and from the **surface**, plus realistic rovers, habitats, ships/landers, a launch platform/gantry, and construction props the swarm assembles — without breaking the three invariants that make the renderer trustworthy (pure-function-of-snapshot, mandatory primitive fallback, demand-loop perf budget).

Full research lives in **`docs/realistic-3d-world/`** (`realistic-3d-world-assets.md` + the README index).

**Locked decisions (grill session):**
- **Licensing:** **CC0 + NASA/US-gov public-domain only** for what ships (zero attribution obligation; `CREDITS.md` is courtesy; no `/credits` overlay). CC-BY is break-glass only (lands only with an in-app credits affordance). Reject NC/ND/unknown. Self-host **all** assets in `web/public/assets/`.
- **Stack: stay on v8** (`@react-three/fiber` 8.18 / `@react-three/drei` 9.122 / `three` 0.169 / React 18.3). Keep `@react-three/postprocessing` at ^2.19.1. Skip `@react-three/rapier` and drei `PerformanceMonitor`/`AdaptiveDpr`.
- **Sky bodies:** the worksite is **on** the Moon — Moon globe for **orbit** view, **Earth** (Blue Marble, PD) for **surface** view, starfield in both. No Moon in the surface sky.
- **Scenery** (new `CONTEXT.md` term): Moon/Earth/stars + launch set-pieces are non-diegetic decoration, never World Model state.
- Realistic **Assets** flow through the **existing `model_ref` / `material.map` seam** with a primitive fallback.

**Architecture (ADR-0010):** live **and** replay Build modes place curated **Assets** from a closed, contract-carried **Asset catalog** by **key** (the Model never emits a free-form ref; the coordinator validates membership before the World Model fold).

**Downstream epic:** [#62](https://github.com/IamP5/fiap-gs-space-connect/issues/62) — Natural-language Blueprint authoring (Architect extension), built on this Asset catalog.

## Child issues

- [ ] [#47](https://github.com/IamP5/fiap-gs-space-connect/issues/47) — Amend ADR-0004 + scope guard (docs)
- [ ] [#48](https://github.com/IamP5/fiap-gs-space-connect/issues/48) — glTF child raycast fix (click-to-kill safety)
- [ ] [#49](https://github.com/IamP5/fiap-gs-space-connect/issues/49) — Camera far-plane + orbit/surface view-mode toggle
- [ ] [#50](https://github.com/IamP5/fiap-gs-space-connect/issues/50) — `<SpaceEnvironment>`: starfield + HDR IBL backdrop
- [ ] [#51](https://github.com/IamP5/fiap-gs-space-connect/issues/51) — Sky bodies: Moon globe (orbit) + Earth (surface)
- [ ] [#52](https://github.com/IamP5/fiap-gs-space-connect/issues/52) — Asset conditioning pipeline (convert/normalize + DRACO/meshopt)
- [ ] [#53](https://github.com/IamP5/fiap-gs-space-connect/issues/53) — PBR SpecPrimitive + tiling regolith ground
- [ ] [#54](https://github.com/IamP5/fiap-gs-space-connect/issues/54) — Realistic rover model (Rover3D render swap)
- [ ] [#55](https://github.com/IamP5/fiap-gs-space-connect/issues/55) — Habitat/base Assets → populate the Asset catalog
- [ ] [#56](https://github.com/IamP5/fiap-gs-space-connect/issues/56) — Launch infrastructure set-pieces (Scenery)
- [ ] [#57](https://github.com/IamP5/fiap-gs-space-connect/issues/57) — Construction prop Assets (catalog) + PBR materials
- [ ] [#58](https://github.com/IamP5/fiap-gs-space-connect/issues/58) — Instancing/merging for repeated props + gantry
- [ ] [#59](https://github.com/IamP5/fiap-gs-space-connect/issues/59) — Asset catalog + catalog-key Build op (ADR-0010)
- [ ] [#60](https://github.com/IamP5/fiap-gs-space-connect/issues/60) — Coordinator validates Asset keys before World Model fold
- [ ] [#61](https://github.com/IamP5/fiap-gs-space-connect/issues/61) — Live-mode Asset placement via catalog keys

## Acceptance criteria

- [ ] All child slices merged
- [ ] Idle render stays at 0 fps after every slice (demand-loop budget preserved)
- [ ] Click-to-kill stays deterministic with glTF Assets present
- [ ] Every shipped Asset has a primitive fallback and a `CREDITS.md` entry
- [ ] Live + replay place Assets only by validated catalog key (ADR-0010)
