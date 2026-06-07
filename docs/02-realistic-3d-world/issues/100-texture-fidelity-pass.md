# Texture fidelity pass: max anisotropy, glTF colorspace audit, data-map filtering, Moon normalScale

- **Issue:** [#100](https://github.com/IamP5/fiap-gs-space-connect/issues/100)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK
- **Wave:** Cinematic beauty & immersion (3) · **Research:** [`cinematic-beauty-immersion.md`](../cinematic-beauty-immersion.md)

## What to build

A correctness + crispness sweep across every texture. Apply `gl.capabilities.getMaxAnisotropy()` to **all** loaded textures (terrain already does this ~`Scene3D.tsx:1053`; extend to glTF scenes and `DecorRocks`). Traverse loaded glTF materials and fix `colorSpace` (base/emissive map → SRGB; normal/roughness/metalness/AO → NoColorSpace) to fix dark/desaturated imports. Set data maps (normal/rough/ao) to `LinearMipmapNearestFilter` so distant detail stays crisp. Bump the Moon near-material `normalScale` from 0.9 to ~1.1 (`SkyBodies.tsx:175`) for sharper crater rims up close.

Research: `docs/02-realistic-3d-world/cinematic-beauty-immersion.md` (Wave 3).

## Acceptance criteria

- [ ] Shared helper applies `getMaxAnisotropy()` to every loaded texture (glTF + rocks + terrain)
- [ ] glTF traverse: color maps SRGB, data maps NoColorSpace
- [ ] Normal/rough/ao maps use `LinearMipmapNearestFilter`
- [ ] Moon near `normalScale` ~1.1 (far material unchanged)
- [ ] No regression in primitive/texture fallbacks
- [ ] 0 idle fps preserved; lint+test+build green + grazing-angle before/after screenshots

## Blocked by

None - can start immediately
