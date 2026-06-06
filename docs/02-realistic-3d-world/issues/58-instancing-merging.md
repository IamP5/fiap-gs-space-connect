# Instancing/merging for repeated props + static gantry

- **Issue:** [#58](https://github.com/IamP5/fiap-gs-space-connect/issues/58)
- **Epic:** [#46](https://github.com/IamP5/fiap-gs-space-connect/issues/46)
- **Labels:** `area:frontend`, `type:refactor`
- **Type:** AFK

## What to build

Protect the draw-call budget now that realistic assets are in. Use drei `<Instances frames={1}>` for repeated props/rocks and `<Merged>`/`mergeGeometries` (named `mergeGeometries` on three 0.169) for the static gantry/crawler so each collapses to one draw call. Instanced decoratives must stay non-pickable (raycast suppressed). No behavior change — pure perf optimization over the assets landed in #57 and #56.

## Acceptance criteria

- [ ] Repeated props rendered via <Instances frames={1}> (one draw call), non-pickable
- [ ] Static gantry/crawler geometry merged to minimize draw calls
- [ ] Measured draw-call reduction vs per-mesh rendering
- [ ] Click-to-kill unaffected; idle stays 0 fps

## Blocked by

- [#57](https://github.com/IamP5/fiap-gs-space-connect/issues/57)
