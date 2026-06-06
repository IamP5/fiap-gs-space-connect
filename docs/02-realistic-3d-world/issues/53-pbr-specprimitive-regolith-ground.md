# PBR SpecPrimitive (normal/roughness/ao) + tiling regolith ground

- **Issue:** [#53](https://github.com/IamP5/fiap-gs-space-connect/issues/53)
- **Epic:** [#46](https://github.com/IamP5/fiap-gs-space-connect/issues/46)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK

## What to build

Extend `SpecPrimitive` (and the `PrimitiveDesc` material slots in `buildspec.ts`) beyond a single diffuse `map` to a PBR set — normalMap, roughnessMap, optional aoMap — each loaded with explicit colorSpace (map=SRGB; normal/rough/ao=NoColorSpace), falling back to flat color on any miss. Retexture `LunarTerrain` with a tileable CC0 regolith set (Poly Haven Moon 01) using RepeatWrapping + repeat.set + max anisotropy (clone shared/cached textures before mutating). Skip displacement.

## Acceptance criteria

- [ ] SpecPrimitive renders a full PBR map set with correct colorSpace per map
- [ ] Missing maps fall back to flat color (scene never breaks)
- [ ] Lunar terrain uses a tiled regolith PBR material (seamless, anisotropic)
- [ ] Regolith textures self-hosted, downscaled, credited
- [ ] Idle stays 0 fps

## Blocked by

- [#47](https://github.com/IamP5/fiap-gs-space-connect/issues/47)
