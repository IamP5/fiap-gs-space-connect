# Milky-Way star background (Deep Star Maps 2020) on scene.background

- **Issue:** [#83](https://github.com/IamP5/fiap-gs-space-connect/issues/83)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK
- **Wave:** Space-view realism (2) · **Research:** [`space-view-realism.md`](../space-view-realism.md) §4–§5

## What to build

Add a self-hosted equirectangular **Deep Star Maps 2020 (SVS 4851)** background on `scene.background`. Convert **`starmap_2020_8k_gal.exr`** (galactic coords → horizontal band) to a ~4096×2048 sRGB JPG **offline** (exposure-lifted). Load imperatively (mirroring the HDR backdrop loader), **separate from the IBL environment**, with a black fallback. The equirect background ignores the far-plane, so the hand-rolled points shell can be reduced/dropped.

Offline convert: `oiiotool starmap_2020_8k_gal.exr --resize 4096x2048 --cmul 6.0 --colorconvert linear sRGB --ch R,G,B -o starmap_2020_4k_gal.jpg`

## Acceptance criteria

- [ ] `8k_gal` EXR converted offline to ~4096×2048 sRGB JPG, self-hosted
- [ ] Assigned to `scene.background` (EquirectangularReflectionMapping, SRGBColorSpace, max anisotropy)
- [ ] Kept separate from the IBL `environment`; black fallback on failure (ADR-0004)
- [ ] `invalidate()` once on load; 0 idle fps (no useFrame)
- [ ] ESA/Gaia co-credit recorded ("NASA/Goddard SVS. Gaia DR2: ESA/Gaia/DPAC")
- [ ] lint+test+build green + orbit & surface screenshots

## Blocked by

None — can start immediately
