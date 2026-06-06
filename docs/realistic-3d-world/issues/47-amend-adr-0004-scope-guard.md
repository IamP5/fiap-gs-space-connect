# Amend ADR-0004: "no unlicensed art" + update scope guard

- **Issue:** [#47](https://github.com/IamP5/fiap-gs-space-connect/issues/47)
- **Epic:** [#46](https://github.com/IamP5/fiap-gs-space-connect/issues/46)
- **Labels:** `area:docs`, `type:refactor`
- **Type:** AFK

## What to build

Amend ADR-0004 (`docs/mvp/adr/0004-react-three-fiber-3d-built-2d-first.md`) to replace "no custom physics, no hand-modelled art" with **"no UNLICENSED art"** — licensed glTF/PBR/HDR assets (CC0, CC-BY 4.0 with attribution, NASA/US-gov PD) ARE admissible, provided three invariants hold: (1) the scene stays a pure function of the snapshot (decorative snapshot-independent elements are permitted); (2) every glTF/texture has a mandatory primitive fallback; (3) the demand-loop perf budget is preserved. Update the HARD SCOPE GUARD comment block at the top of `Scene3D.tsx` to match, and broaden `web/public/assets/CREDITS.md` to mention CC-BY/NASA-PD. Docs-only, no runtime change. See `docs/realistic-3d-world/realistic-3d-world-assets.md` for the exact before/after wording.

## Acceptance criteria

- [ ] ADR-0004 Decision bullet updated to the "no unlicensed art" posture with the 3 invariants spelled out
- [ ] Scene3D.tsx header scope-guard comment updated to match (no stale "no glTF available / primitive only" wording)
- [ ] CREDITS.md notes CC0 + CC-BY 4.0 + NASA-PD as the admissible set
- [ ] No code/behavior change; build + lint pass

## Blocked by

None - can start immediately
