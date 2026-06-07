# Post-processing cinematic stack: bloom Sun+Earth, vignette, SMAA, chromatic aberration, grain, surface DoF

- **Issue:** [#99](https://github.com/IamP5/fiap-gs-space-connect/issues/99)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK
- **Wave:** Cinematic beauty & immersion (3) · **Research:** [`cinematic-beauty-immersion.md`](../cinematic-beauty-immersion.md)

## What to build

Replace the single `SelectiveBloom`-on-halos pipeline (`Scene3D.tsx:1117–1128`) with a full cinematic `EffectComposer` stack. Add a new `CELESTIAL_BLOOM_LAYER` and enable it on the **Sun core** (`SkyBodies.tsx:456`) and **Earth limb** so the brightest bodies actually bloom — today bloom is locked to `HALO_BLOOM_LAYER` only. Add **Vignette**, **SMAA** (the canvas runs `antialias:false`), a subtle **orbit-only ChromaticAberration**, and a faint **film-grain Noise** (SCREEN blend). Verify bloom uses SCREEN blend with smoothed luminance. Add a **surface-gated DepthOfField** so the distant Earth/horizon fall soft. All passes are static — they render only on `invalidate()`, so 0 idle fps is preserved.

Research: `docs/02-realistic-3d-world/cinematic-beauty-immersion.md` (Wave 3).

## Acceptance criteria

- [ ] New `CELESTIAL_BLOOM_LAYER`; Sun core + Earth rim enabled on it; second `SelectiveBloom` (luminanceThreshold ~0.08)
- [ ] Vignette (offset ~0.3, darkness ~0.4)
- [ ] SMAA as the first composer pass
- [ ] Subtle orbit-only ChromaticAberration (offset ~[0.001, 0.002])
- [ ] Film-grain Noise, SCREEN blend, opacity ~0.03
- [ ] Bloom blend = SCREEN; luminanceSmoothing ~0.35
- [ ] Surface-gated DepthOfField (distant softens; orbit stays deep-focus)
- [ ] 0 idle fps preserved (all passes static); pick/click-to-kill intact
- [ ] lint+test+build green + orbit & surface screenshots

## Blocked by

None - can start immediately
