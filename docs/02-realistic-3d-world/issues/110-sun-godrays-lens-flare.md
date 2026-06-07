# Sun GodRays + lens flare (orbit-gated)

- **Issue:** [#110](https://github.com/IamP5/fiap-gs-space-connect/issues/110)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK
- **Wave:** Cinematic beauty & immersion (3) · **Research:** [`cinematic-beauty-immersion.md`](../cinematic-beauty-immersion.md)

## What to build

Add volumetric **GodRays** shafts from the Sun, using the sun light/mesh as the occluder/light source, placed **after bloom** in the composer (the stack lands in #99). Orbit-gated — the sun is the orbit hero. Optionally add an anamorphic **lens-flare** streak when the sun enters frame. Static pass — 0 idle fps preserved.

Research: `docs/02-realistic-3d-world/cinematic-beauty-immersion.md` (Wave 3).

## Acceptance criteria

- [x] GodRays after bloom; sun as light source (density ~0.5, decay ~0.93, weight ~0.3, samples ~80)
- [x] Orbit-gated; graceful no-op if the sun ref is unavailable
- [x] Optional lens-flare streak when the sun is on-screen
- [x] 0 idle fps preserved; lint+test+build green + orbit screenshot

## Implementation notes

- A shared `sunRef` is surfaced from `SkyBodies`/`SunBody` (the core disc mesh) up
  through `SceneContents` into `CinematicFX`, where a `<GodRays>` pass sits **after**
  both bloom passes. Orbit-gated (`!onSurface`) and skipped until the ref resolves.
- The Wave-4 orbit hero is the **dark-side crescent Moon**, so the decoupled
  `ORBIT_SUN_POSITION` sits off-frame in the default pose — GodRays is correctly
  dormant there and reveals as the user orbits toward the Sun (the Moon's depth
  occludes the shafts for a true volumetric edge). Verified by screenshot.
- The "lens-flare streak" is a procedural **anamorphic streak sprite** added to the
  Sun's existing additive flare stack (orbit-gated via `showStreak`), rather than the
  heavyweight per-frame-raycasting `LensFlare` effect — it occludes correctly behind
  the Moon via depth and adds no per-frame work.

## Blocked by

- #99 (Post-processing cinematic stack — GodRays sits after bloom in the same composer)
