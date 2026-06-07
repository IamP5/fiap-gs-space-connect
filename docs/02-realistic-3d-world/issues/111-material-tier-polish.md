# Material tier polish: dome roughness, clearcoat metal, rock PBR, solar glint, emissive windows

- **Issue:** [#111](https://github.com/IamP5/fiap-gs-space-connect/issues/111)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK
- **Wave:** Cinematic beauty & immersion (3) · **Research:** [`cinematic-beauty-immersion.md`](../cinematic-beauty-immersion.md)

## What to build

Make built structures read as real materials, not uniform polygons. **Per-tier dome roughness** (cap ~0.75 / walls ~0.88 / foundation ~0.95). **Clearcoat on NASA metal** models (where `metalness > 0.3`: clearcoat ~0.5, clearcoatRoughness ~0.4) for factory-steel specular. Load **normal + roughness maps** on the `DecorRocks` boulders (currently diffuse-only flat spheres). **Anisotropic row-aligned glint** on solar panels (metalness 0.8, roughness 0.3). **Emissive habitat windows** (submeshes named `*window*` → warm `#FFD8A0` emissive ~0.2) placed on the bloom layer (from #99) so they glow at distance. Static — 0 idle fps preserved.

Research: `docs/02-realistic-3d-world/cinematic-beauty-immersion.md` (Wave 3).

## Acceptance criteria

- [ ] Per-tier dome roughness (cap / walls / foundation distinct)
- [ ] Clearcoat on NASA metal (`metalness > 0.3`)
- [ ] Rock boulders get normal + roughness maps + anisotropy
- [ ] Solar panels: anisotropic row-aligned specular glint
- [ ] Emissive habitat windows on the bloom layer (warm glow at distance)
- [ ] Material/primitive fallbacks preserved (ADR-0004); 0 idle fps preserved
- [ ] lint+test+build green + surface screenshots

## Blocked by

- #99 (Post-processing cinematic stack — emissive windows ride the celestial bloom layer)
