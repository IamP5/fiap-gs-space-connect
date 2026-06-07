# Living Earth: rotating cloud shell + city-light flicker

> **Wave 4 update (2026-06-07):** shipped as part of the "living orbit" pass and
> expanded well beyond the original gated `useFrame`. ADR-0004's demand-loop budget
> is dropped (`frameloop="always"`), so the `document.hidden` pause is now optional,
> not required. Delivered: rotating Earth body + independently drifting cloud shell,
> a custom day/night + masked-city-lights + warm-terminator shader, an **ocean sun-
> glint** ("sun waves reflecting"), city-light flicker, and a **decoupled orbit sun**
> giving the reference's dark-side crescent Moon (SVS #14992).

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
