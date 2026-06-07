# Earth atmosphere Fresnel shader: sun-angle Rayleigh/Mie scattering rim

- **Issue:** [#102](https://github.com/IamP5/fiap-gs-space-connect/issues/102)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK
- **Wave:** Cinematic beauty & immersion (3) · **Research:** [`cinematic-beauty-immersion.md`](../cinematic-beauty-immersion.md)

## What to build

Replace the flat `MeshBasicMaterial` BackSide rim shell on Earth (`SkyBodies.tsx:265–268`) with a proper atmosphere `ShaderMaterial`. Compute `fresnel = pow(1 - dot(normal, viewDir), 4)` and multiply by sun illumination `max(0, dot(normal, sunDir))`, so the rim glows bright at the limb, brightens on the sunlit side, and dims to nothing where the sun is behind. Tint with a **Rayleigh blue body** and a **warm Mie band** near the terminator. Upgrades the rim added in #86. Static (uniforms set once) — 0 idle fps preserved.

Research: `docs/02-realistic-3d-world/cinematic-beauty-immersion.md` (Wave 3).

## Acceptance criteria

- [ ] `ShaderMaterial` replaces the `MeshBasicMaterial` BackSide rim
- [ ] Fresnel × sun-angle: rim brightens edge-on + sunlit side, dims on the dark limb
- [ ] Rayleigh blue body + warm Mie terminator band
- [ ] Sun direction passed as a uniform (consistent with `SUN_POSITION`)
- [ ] Primitive/material fallback preserved (ADR-0004)
- [ ] 0 idle fps preserved; lint+test+build green + orbit screenshots (lit + terminator)

## Blocked by

None - can start immediately
