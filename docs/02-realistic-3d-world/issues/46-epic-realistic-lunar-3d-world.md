# Epic: Realistic lunar 3D world (Moon + robots + space construction)

- **Issue:** [#46](https://github.com/IamP5/fiap-gs-space-connect/issues/46)
- **Labels:** `area:frontend`, `type:epic`
- **ADR:** [0010 — live-mode curated Asset catalog](../../01-build-harness/adr/0010-live-mode-curated-asset-catalog.md)

## What to build

Make the `web/` R3F lunar scene (`Scene3D.tsx`) as realistic as possible: a full Moon viewable from **orbit** and from the **surface**, plus realistic rovers, habitats, ships/landers, a launch platform/gantry, and construction props the swarm assembles — without breaking the three invariants that make the renderer trustworthy (pure-function-of-snapshot, mandatory primitive fallback, demand-loop perf budget).

Full research lives in **`docs/02-realistic-3d-world/`** (`realistic-3d-world-assets.md` + the README index).

**Locked decisions (grill session):**
- **Licensing:** **CC0 + NASA/US-gov public-domain only** for what ships (zero attribution obligation; `CREDITS.md` is courtesy; no `/credits` overlay). CC-BY is break-glass only (lands only with an in-app credits affordance). Reject NC/ND/unknown. Self-host **all** assets in `web/public/assets/`.
- **Stack: stay on v8** (`@react-three/fiber` 8.18 / `@react-three/drei` 9.122 / `three` 0.169 / React 18.3). Keep `@react-three/postprocessing` at ^2.19.1. Skip `@react-three/rapier` and drei `PerformanceMonitor`/`AdaptiveDpr`.
- **Sky bodies:** the worksite is **on** the Moon — Moon globe for **orbit** view, **Earth** (Blue Marble, PD) for **surface** view, starfield in both. No Moon in the surface sky.
- **Scenery** (new `CONTEXT.md` term): Moon/Earth/stars + launch set-pieces are non-diegetic decoration, never World Model state.
- Realistic **Assets** flow through the **existing `model_ref` / `material.map` seam** with a primitive fallback.

**Architecture (ADR-0010):** live **and** replay Build modes place curated **Assets** from a closed, contract-carried **Asset catalog** by **key** (the Model never emits a free-form ref; the coordinator validates membership before the World Model fold).

**Downstream epic:** [#62](https://github.com/IamP5/fiap-gs-space-connect/issues/62) — Natural-language Blueprint authoring (Architect extension), built on this Asset catalog.

## Child issues

### Wave 1 — realistic scene foundation ✅ shipped to main (2026-06-07)

- [x] [#47](https://github.com/IamP5/fiap-gs-space-connect/issues/47) — Amend ADR-0004 + scope guard (docs) · PR #64
- [x] [#48](https://github.com/IamP5/fiap-gs-space-connect/issues/48) — glTF child raycast fix (click-to-kill safety) · PR #65
- [x] [#49](https://github.com/IamP5/fiap-gs-space-connect/issues/49) — Camera far-plane + orbit/surface view-mode toggle · PR #66
- [x] [#50](https://github.com/IamP5/fiap-gs-space-connect/issues/50) — `<SpaceEnvironment>`: starfield + HDR IBL backdrop · PR #68
- [x] [#51](https://github.com/IamP5/fiap-gs-space-connect/issues/51) — Sky bodies: Moon globe (orbit) + Earth (surface) · PR #77
- [x] [#52](https://github.com/IamP5/fiap-gs-space-connect/issues/52) — Asset conditioning pipeline (convert/normalize + DRACO/meshopt) · PR #69
- [x] [#53](https://github.com/IamP5/fiap-gs-space-connect/issues/53) — PBR SpecPrimitive + tiling regolith ground · PR #72
- [x] [#54](https://github.com/IamP5/fiap-gs-space-connect/issues/54) — Realistic rover model (RASSOR render swap) · PR #75
- [x] [#55](https://github.com/IamP5/fiap-gs-space-connect/issues/55) — Habitat/base Assets → populate the Asset catalog · PR #70
- [x] [#56](https://github.com/IamP5/fiap-gs-space-connect/issues/56) — Launch infrastructure set-pieces (Scenery) · PR #71
- [x] [#57](https://github.com/IamP5/fiap-gs-space-connect/issues/57) — Construction prop Assets (catalog) + PBR materials · PR #76
- [x] [#58](https://github.com/IamP5/fiap-gs-space-connect/issues/58) — Instancing/merging for repeated props + gantry · PRs #78 + #79
- [x] [#59](https://github.com/IamP5/fiap-gs-space-connect/issues/59) — Asset catalog + catalog-key Build op (ADR-0010) · PR #67
- [x] [#60](https://github.com/IamP5/fiap-gs-space-connect/issues/60) — Coordinator validates Asset keys before World Model fold · PR #73
- [x] [#61](https://github.com/IamP5/fiap-gs-space-connect/issues/61) — Live-mode Asset placement via catalog keys · PR #74

### Wave 2 — space-view realism (planned, from NASA SVS study)

See [`../space-view-realism.md`](../space-view-realism.md) for the research these derive from.

- [ ] [#81](https://github.com/IamP5/fiap-gs-space-connect/issues/81) — Space lighting re-grade (HITL) — [doc](./81-space-lighting-regrade.md)
- [ ] [#82](https://github.com/IamP5/fiap-gs-space-connect/issues/82) — Real Moon surface: CGI Moon Kit + baked LOLA normal — [doc](./82-moon-cgi-kit-textures.md)
- [ ] [#83](https://github.com/IamP5/fiap-gs-space-connect/issues/83) — Milky-Way star background (Deep Star Maps 2020) — [doc](./83-milky-way-star-background.md)
- [ ] [#84](https://github.com/IamP5/fiap-gs-space-connect/issues/84) — Cinematic orbit→surface descent (HITL) — [doc](./84-cinematic-descent.md)
- [ ] [#85](https://github.com/IamP5/fiap-gs-space-connect/issues/85) — Sun polish: limb darkening + chromatic glow — [doc](./85-sun-polish.md)
- [ ] [#86](https://github.com/IamP5/fiap-gs-space-connect/issues/86) — Day/night Earth + atmospheric rim — [doc](./86-day-night-earth.md)
- [ ] [#90](https://github.com/IamP5/fiap-gs-space-connect/issues/90) — Nebula/supernova hero sprite (Veil, blocked by #83) — [doc](./90-nebula-hero-sprite.md)
- [ ] [#91](https://github.com/IamP5/fiap-gs-space-connect/issues/91) — Star-field + material micro-polish (blocked by #83) — [doc](./91-starfield-material-polish.md)

### Wave 2 — model follow-ups (mostly already shipped in Wave 1; kept open)

- [ ] [#87](https://github.com/IamP5/fiap-gs-space-connect/issues/87) — RASSOR rover hero (⚠️ already on main, PR #75) — [doc](./87-rassor-rover-hero.md)
- [ ] [#88](https://github.com/IamP5/fiap-gs-space-connect/issues/88) — Launch set-pieces GLBs (⚠️ already on main, PR #71) — [doc](./88-launch-setpieces-glb.md)
- [ ] [#89](https://github.com/IamP5/fiap-gs-space-connect/issues/89) — Habitat/base GLBs (habitat shipped; Base Station + Astronaut pending) — [doc](./89-habitat-base-glb.md)

## Acceptance criteria

- [ ] All child slices merged
- [ ] Idle render stays at 0 fps after every slice (demand-loop budget preserved)
- [ ] Click-to-kill stays deterministic with glTF Assets present
- [ ] Every shipped Asset has a primitive fallback and a `CREDITS.md` entry
- [ ] Live + replay place Assets only by validated catalog key (ADR-0010)
