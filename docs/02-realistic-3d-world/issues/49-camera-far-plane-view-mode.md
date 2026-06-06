# Camera far-plane raise + orbit/surface view-mode toggle

- **Issue:** [#49](https://github.com/IamP5/fiap-gs-space-connect/issues/49)
- **Epic:** [#46](https://github.com/IamP5/fiap-gs-space-connect/issues/46)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK

## What to build

Raise the camera far plane from 200 to ~8000 so a distant parked Moon is in-frustum, keeping near=0.1. Add an explicit view-mode toggle (dashboard button) between the current clamped **surface** framing (target on the worksite, existing min/max distance + polar clamps per ADR-0004) and an **orbit** preset (target/distance suited to viewing the Moon). Implement by swapping OrbitControls clamps/target or adopting drei `<CameraControls>` + `setLookAt()`; the toggle handler must call `invalidate()` after the move. Do NOT widen the surface-mode maxDistance to reach the Moon — keep both framings distinct and clamped.

## Acceptance criteria

- [ ] Far plane raised (~8000); no z-fighting on near geometry
- [ ] A working toggle switches between surface and orbit framings, each clamped
- [ ] invalidate() called after each programmatic move; idle returns to 0 fps once settled
- [ ] SelectiveBloom halos still render correctly
- [ ] Default mode unchanged (surface, fixed default orbit angle per ADR-0004)

## Blocked by

None - can start immediately
