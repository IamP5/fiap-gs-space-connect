# Material tier polish: dome roughness, clearcoat metal, rock PBR, solar glint, emissive windows

- **Issue:** [#111](https://github.com/IamP5/fiap-gs-space-connect/issues/111)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK
- **Wave:** Cinematic beauty & immersion (3) · **Research:** [`cinematic-beauty-immersion.md`](../cinematic-beauty-immersion.md)

## What to build

Make built structures read as real materials, not uniform polygons. **Per-tier dome roughness** (cap ~0.75 / walls ~0.88 / foundation ~0.95). **Clearcoat on NASA metal** models (where `metalness > 0.3`: clearcoat ~0.5, clearcoatRoughness ~0.4) for factory-steel specular. Load **normal + roughness maps** on the `DecorRocks` boulders (currently diffuse-only flat spheres). **Anisotropic row-aligned glint** on solar panels (metalness 0.8, roughness 0.3). **Emissive habitat windows** (submeshes named `*window*` → warm `#FFD8A0` emissive ~0.2) placed on the bloom layer (from #99) so they glow at distance. Static — 0 idle fps preserved.

Research: `docs/02-realistic-3d-world/cinematic-beauty-immersion.md` (Wave 3).

## Acceptance criteria

- [x] Per-tier dome roughness (cap / walls / foundation distinct)
- [x] Clearcoat on NASA metal (`metalness > 0.3`)
- [x] Rock boulders get normal + roughness maps + anisotropy
- [x] Solar panels: anisotropic row-aligned specular glint
- [x] Emissive habitat windows on the bloom layer (warm glow at distance)
- [x] Material/primitive fallbacks preserved (ADR-0004); 0 idle fps preserved
- [x] lint+test+build green + surface screenshots

## Implementation notes

- **Per-tier dome roughness** lives in `TaskBlock`'s primitive path: cap `0.75` /
  walls `0.88` / foundation `0.95` (the rising habitat reads as distinct materials).
- **Clearcoat / solar glint / emissive windows** are centralised in a new
  `polishGltfMaterials()` (`lib/textureFidelity.ts`), run **once on the cached glTF
  source** in both loaders (`loadGLTF`, `loadScenery`) so every clone inherits it
  (clone(true) shares materials + copies the per-mesh bloom-layer mask). Materials
  with `metalness > 0.3` are upgraded to `MeshPhysicalMaterial` for the clearcoat;
  the originals are disposed once (textures are shared, not freed).
- **Solar glint** is keyed off the asset URL (`/solar|panel/`) because the vendored
  `solar-panel.glb` material is generically named (`PaletteMaterial001`); a name
  match alone would miss it.
- **Emissive windows** match `*window*` submesh/material names. The current vendored
  asset set has **no** window submeshes, so this is a latent, correct mechanism
  (graceful no-op, ADR-0004) until such an asset ships — wired and ready.
- **Rock PBR**: vendored the matching Poly Haven "Rock Boulder Dry" `nor_gl` +
  `rough` maps (512, CC0, credited) and loaded them onto the `DecorRocks` boulders
  with max anisotropy; the flat-grey / diffuse-only fallback still holds per channel.

## Blocked by

- #99 (Post-processing cinematic stack — emissive windows ride the celestial bloom layer)
