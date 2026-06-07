# Sun GodRays + lens flare (orbit-gated)

- **Issue:** [#110](https://github.com/IamP5/fiap-gs-space-connect/issues/110)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK
- **Wave:** Cinematic beauty & immersion (3) · **Research:** [`cinematic-beauty-immersion.md`](../cinematic-beauty-immersion.md)

## What to build

Add volumetric **GodRays** shafts from the Sun, using the sun light/mesh as the occluder/light source, placed **after bloom** in the composer (the stack lands in #99). Orbit-gated — the sun is the orbit hero. Optionally add an anamorphic **lens-flare** streak when the sun enters frame. Static pass — 0 idle fps preserved.

Research: `docs/02-realistic-3d-world/cinematic-beauty-immersion.md` (Wave 3).

## Acceptance criteria

- [ ] GodRays after bloom; sun as light source (density ~0.5, decay ~0.93, weight ~0.3, samples ~80)
- [ ] Orbit-gated; graceful no-op if the sun ref is unavailable
- [ ] Optional lens-flare streak when the sun is on-screen
- [ ] 0 idle fps preserved; lint+test+build green + orbit screenshot

## Blocked by

- #99 (Post-processing cinematic stack — GodRays sits after bloom in the same composer)
