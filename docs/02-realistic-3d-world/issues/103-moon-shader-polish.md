# Moon shader polish: terminator rim-glow + limb darkening (onBeforeCompile)

- **Issue:** [#103](https://github.com/IamP5/fiap-gs-space-connect/issues/103)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK
- **Wave:** Cinematic beauty & immersion (3) · **Research:** [`cinematic-beauty-immersion.md`](../cinematic-beauty-immersion.md)

## What to build

Add `onBeforeCompile` polish to the Moon near-material (`SkyBodies.tsx:155`): a **terminator rim-glow** (`rim = smoothstep(0.7, 1.0, 1 - abs(dot(viewDir, normal)))`, add a faint cool emissive) for the silver Apollo limb, plus **limb darkening** toward the edge with a warm grazing-light tint. Crater detail (normal map) stays untouched. Static — 0 idle fps preserved.

Research: `docs/02-realistic-3d-world/cinematic-beauty-immersion.md` (Wave 3).

## Acceptance criteria

- [ ] `onBeforeCompile` rim-glow on the Moon near-material (cool, faint)
- [ ] Limb darkening toward the edge + warm grazing tint
- [ ] Normal/crater detail unchanged; far material untouched (or matched)
- [ ] Not added to a bloom layer
- [ ] 0 idle fps preserved; lint+test+build green + orbit screenshot

## Blocked by

None - can start immediately
