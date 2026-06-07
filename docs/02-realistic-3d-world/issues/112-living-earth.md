# Living Earth: rotating cloud shell + city-light flicker

- **Issue:** [#112](https://github.com/IamP5/fiap-gs-space-connect/issues/112)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK
- **Wave:** Cinematic beauty & immersion (3) · **Research:** [`cinematic-beauty-immersion.md`](../cinematic-beauty-immersion.md)

## What to build

Sell a living Earth. Add a **cloud shell** (sphere at `EARTH_RADIUS × 1.005`, tileable cloud map, `transparent` opacity ~0.6, `depthWrite:false`) that rotates slowly. Add subtle **city-light flicker** on the night-side `emissiveMap`. Builds on the atmosphere shader (#102). Introduces a `useFrame` that rotates the clouds + drives the flicker and `invalidate()`s each tick; **pauses when the tab is hidden** (`document.hidden`).

Research: `docs/02-realistic-3d-world/cinematic-beauty-immersion.md` (Wave 3).

## Acceptance criteria

- [ ] Rotating cloud shell over Earth (transparent, `depthWrite:false`)
- [ ] Subtle city-light flicker on the night-side emissive
- [ ] `useFrame` drives rotation/flicker + `invalidate`; PAUSES on `document.hidden`
- [ ] Reuses the #102 Earth atmosphere; primitive fallback preserved
- [ ] lint+test+build green + orbit screenshot/clip

## Blocked by

- #102 (Earth atmosphere Fresnel shader — both modify the Earth body)
