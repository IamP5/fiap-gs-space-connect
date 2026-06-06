# Third-party assets — provenance & licensing (bh-07b)

Every asset below is verified at its source against the admissible license set.
The Build spec's `model_ref` (glTF) and `material.map` (texture) slots are
exercised with these REAL assets; a missing/failed load falls back to the
existing primitive geometry, so the scene never depends on them (ADR-0004).

ADR-0004 forbids **unlicensed** art. The admissible license set is:
**CC0 1.0** (public-domain dedication, no attribution required) +
**CC-BY 4.0** (admissible with attribution recorded in this file) +
**NASA / US-gov public domain** (credit `NASA / <author>` as courtesy; never
imply NASA endorsement, never use the NASA insignia). All assets currently shipped
below are CC0 1.0.

Downloaded: 2026-06-06.

## Models (glTF binary, `.glb`)

| File | Source asset | Author | Source URL | License |
|------|--------------|--------|-----------|---------|
| `models/hangar_roundA.glb` | Space Kit 2.0 → `Models/GLTF format/hangar_roundA.glb` | Kenney (kenney.nl) | https://kenney.nl/assets/space-kit | CC0 1.0 |
| `models/machine_generator.glb` | Space Kit 2.0 → `Models/GLTF format/machine_generator.glb` | Kenney (kenney.nl) | https://kenney.nl/assets/space-kit | CC0 1.0 |

Kenney Space Kit pack download (the `.glb` files above are extracted verbatim from
it, unmodified):
`https://kenney.nl/media/pages/assets/space-kit/20874c75ac-1677698978/kenney_space-kit.zip`

The pack's bundled `License.txt` states verbatim:

> License: (Creative Commons Zero, CC0)
> http://creativecommons.org/publicdomain/zero/1.0/
> This content is free to use in personal, educational and commercial projects.
> Support us by crediting Kenney or www.kenney.nl (this is not mandatory)

## Conditioned models (Issue #52 — geometry-baked + Draco-compressed)

Produced OFFLINE by `scripts/condition-asset.mjs` (see `scripts/README.md`):
up-axis fix, `computeVertexNormals()` when missing, recenter-to-origin,
fit-to-unit, NASA-insignia strip, then `gltf-transform optimize --compress draco`.
These require the self-hosted Draco decoder under `web/public/draco/` to load
(no gstatic CDN). The conditioned `.glb` is committed; sources are not.

| File | Source asset | Author | Source URL | License | Conditioning |
|------|--------------|--------|-----------|---------|--------------|
| `models/machine_generator_draco.glb` | `models/machine_generator.glb` (Kenney Space Kit, CC0) | Kenney (kenney.nl) | https://kenney.nl/assets/space-kit | CC0 1.0 | recenter + fit-to-unit + `--compress draco` (28.3 KB → 3.1 KB). Proves the Draco decode path end-to-end. |

## Textures

| File | Source asset | Authors | Source URL | License |
|------|--------------|---------|-----------|---------|
| `textures/rock_boulder_dry_diff_512.jpg` | "Rock Boulder Dry" — 1K diffuse, **resized to 512×512** | Dimitrios Savva (photography), Rico Cilliers (processing) | https://polyhaven.com/a/rock_boulder_dry | CC0 1.0 |

Original 1K download (resized down to 512 for bundle size; otherwise unmodified):
`https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rock_boulder_dry/rock_boulder_dry_diff_1k.jpg`

Poly Haven publishes all of its assets under CC0 1.0
(https://polyhaven.com/license); the asset's authors are confirmed via the Poly
Haven API (`https://api.polyhaven.com/info/rock_boulder_dry`).

## Habitat & base models (NASA-PD)

Habitat/base Assets vendored for the realism Asset catalog (issue #55). These are
US-government public-domain works from NASA's 3D Resources repository. Credited as
`NASA / <author>` as a courtesy; this project is **not** affiliated with or
endorsed by NASA, and the NASA insignia is **not** used. Each file was verified to
be a real glTF binary (starts with the ASCII magic `glTF`) and contains no
insignia. Downloaded: 2026-06-06.

| File | Source asset | Author | Source URL | License |
|------|--------------|--------|-----------|---------|
| `models/radome.glb` | NASA 3D Resources → `3D Models/Radome/Radome.glb` | NASA / NASA 3D Resources | https://github.com/nasa/NASA-3D-Resources/blob/master/3D%20Models/Radome/Radome.glb | NASA / US-gov public domain |
| `models/habitat-demo-unit-1.glb` | NASA 3D Resources → `3D Models/Habitat Demonstration Unit/Habitat Demonstration Unit (part 1).glb` | NASA / NASA 3D Resources | https://github.com/nasa/NASA-3D-Resources/blob/master/3D%20Models/Habitat%20Demonstration%20Unit/Habitat%20Demonstration%20Unit%20%28part%201%29.glb | NASA / US-gov public domain |
| `models/habitat-demo-unit-2.glb` | NASA 3D Resources → `3D Models/Habitat Demonstration Unit/Habitat Demonstration Unit (part 2).glb` | NASA / NASA 3D Resources | https://github.com/nasa/NASA-3D-Resources/blob/master/3D%20Models/Habitat%20Demonstration%20Unit/Habitat%20Demonstration%20Unit%20%28part%202%29.glb | NASA / US-gov public domain |

NASA 3D Resources content is in the public domain
(https://nasa3d.arc.nasa.gov/detail/nasa-3d-resources); see also NASA's media
usage guidelines (https://www.nasa.gov/nasa-brand-center/images-and-media/). The
`.glb` files above are vendored verbatim from the repository's `master` branch,
unmodified.

## Launch scenery (NASA-PD)

Static, non-diegetic launch-infrastructure set-pieces rendered as decorative
**Scenery** by `web/src/components/LaunchScenery.tsx` (Issue #56) — a crawler, a
mobile launcher, a gantry, and a lander parked at the edge of the worksite. They
are NOT snapshot-driven Assets; they are knowingly decorative. Each `.glb` is
self-hosted in `models/` and verified as real glTF (`head -c 4` prints `glTF`).
All four are from NASA's official 3D Resources, which NASA releases into the
**public domain** (NASA media usage guidelines). No NASA insignia is displayed
and no endorsement is implied.

| File | Source asset | Author | Source URL | License |
|------|--------------|--------|-----------|---------|
| `models/nasa_crawler.glb` | NASA 3D Resources → `3D Models/Crawler/Crawler.glb` | NASA | https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Crawler | Public Domain (NASA-PD) |
| `models/nasa_mobile_launcher.glb` | NASA 3D Resources → `3D Models/Mobile Launcher/Mobile Launcher (assembled).glb` | NASA | https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Mobile%20Launcher | Public Domain (NASA-PD) |
| `models/nasa_gantry.glb` | NASA 3D Resources → `3D Models/Gantry/Gantry.glb` | NASA | https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Gantry | Public Domain (NASA-PD) |
| `models/nasa_lunar_module.glb` | NASA 3D Resources → `3D Models/Apollo Lunar Module/Apollo Lunar Module.glb` | NASA | https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Apollo%20Lunar%20Module | Public Domain (NASA-PD) |

Source repository (the `.glb` files above are fetched verbatim from branch
`master`, unmodified): `https://github.com/nasa/NASA-3D-Resources`.

NASA's image and media usage guidelines state NASA content is generally not
copyrighted and may be used for educational/informational purposes; the NASA
insignia/logo and flags are excluded and are NOT used here. See
https://www.nasa.gov/nasa-brand-center/images-and-media/.

## PBR texture sets — regolith (CC0)

The lunar terrain (and the PBR `SpecPrimitive` slot) is clothed with Poly Haven's
**Moon 01** set (issue #53): the full diffuse / normal (OpenGL) / roughness / AO
maps, downloaded as 1K jpg and **resized to 512×512** for bundle size (otherwise
unmodified). The jpg `nor_gl` normal map is used (no EXR dependency).

| File | Source map | Authors | Source URL | License |
|------|-----------|---------|-----------|---------|
| `textures/regolith_diff_512.jpg` | "Moon 01" — 1K diffuse, resized to 512 | Greg Zaal, Rico Cilliers, Jenelle van Heerden (photography), Dario Barresi (processing) | https://polyhaven.com/a/moon_01 | CC0 1.0 |
| `textures/regolith_nor_gl_512.jpg` | "Moon 01" — 1K normal (OpenGL), resized to 512 | Greg Zaal, Rico Cilliers, Jenelle van Heerden (photography), Dario Barresi (processing) | https://polyhaven.com/a/moon_01 | CC0 1.0 |
| `textures/regolith_rough_512.jpg` | "Moon 01" — 1K roughness, resized to 512 | Greg Zaal, Rico Cilliers, Jenelle van Heerden (photography), Dario Barresi (processing) | https://polyhaven.com/a/moon_01 | CC0 1.0 |
| `textures/regolith_ao_512.jpg` | "Moon 01" — 1K ambient occlusion, resized to 512 | Greg Zaal, Rico Cilliers, Jenelle van Heerden (photography), Dario Barresi (processing) | https://polyhaven.com/a/moon_01 | CC0 1.0 |

Original 1K downloads (resized down to 512; otherwise unmodified):

- `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/moon_01/moon_01_diff_1k.jpg`
- `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/moon_01/moon_01_nor_gl_1k.jpg`
- `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/moon_01/moon_01_rough_1k.jpg`
- `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/moon_01/moon_01_ao_1k.jpg`

Poly Haven publishes all of its assets under CC0 1.0
(https://polyhaven.com/license); the set's authors are confirmed via the Poly
Haven API (`https://api.polyhaven.com/info/moon_01`).

## HDR environments

Used by `<SpaceEnvironment>` (issue #50) as the self-hosted skybox + image-based
lighting (IBL) source — it provides both the backdrop and the PBR reflections on
metallic glTFs. Loaded via `files=` (self-hosted in `/public`), never a CDN
`preset=`. A failed load falls back to the Canvas's black background.

| File | Source asset | Author | Source URL | License |
|------|--------------|--------|-----------|---------|
| `hdr/moonless_golf_2k.hdr` | "Moonless Golf" — 2K HDRI (neutral night sky, suits a space scene) | Greg Zaal | https://polyhaven.com/a/moonless_golf | CC0 1.0 |

2K download (unmodified):
`https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/moonless_golf_2k.hdr`

Poly Haven publishes all of its assets under CC0 1.0
(https://polyhaven.com/license); the asset's author is confirmed via the Poly
Haven API (`https://api.polyhaven.com/info/moonless_golf`).

## Construction props & PBR skins (NASA-PD + CC0)

Construction-prop Assets the swarm assembles, wired into the closed Asset catalog
(`internal/harness/asset`, ADR-0010, issue #57) and resolved server-side to these
self-hosted `model_ref` URLs; a missing/failed load falls back to the primitive,
so the scene never depends on them (ADR-0004). Each prop is a NASA 3D Resources
public-domain work, conditioned OFFLINE by `scripts/condition-asset.mjs` (up-axis
fix → recenter → fit-to-unit → insignia strip → `gltf-transform optimize
--compress draco`) and verified as real glTF (`head -c 4` prints `glTF`). No NASA
insignia is displayed and no endorsement is implied; credited `NASA / <author>`
as a courtesy. Downloaded: 2026-06-06.

| File | Catalog key | Source asset | Author | Source URL | License | Conditioning |
|------|-------------|--------------|--------|-----------|---------|--------------|
| `models/solar-panel.glb` | `solar-panel` | NASA 3D Resources → `3D Models/Solar Sail Concept/Solar Sail Concept.glb` | NASA / NASA 3D Resources | https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Solar%20Sail%20Concept | NASA / US-gov public domain | up=z + recenter + fit-to-unit + `--compress draco` (238 KB → 54 KB) |
| `models/comms-mast.glb` | `comms-mast` | NASA 3D Resources → `3D Models/Tether/Tether.glb` | NASA / NASA 3D Resources | https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Tether | NASA / US-gov public domain | up=z + recenter + fit-to-unit + `--compress draco` (492 KB → 14 KB) |
| `models/comms-dish.glb` | `comms-dish` | NASA 3D Resources → `3D Models/70-meter Dish/70 meter dish.glb` | NASA / NASA 3D Resources | https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/70-meter%20Dish | NASA / US-gov public domain | textures detached (no embedded images at runtime) + up=z + recenter + fit-to-unit + `--compress draco` (2.2 MB → 90 KB) |

Source repository (the `.glb` files above are fetched verbatim from branch
`master`, then conditioned offline as noted): `https://github.com/nasa/NASA-3D-Resources`.

NASA's image and media usage guidelines state NASA content is generally not
copyrighted and may be used for educational/informational purposes; the NASA
insignia/logo and flags are excluded and are NOT used here. See
https://www.nasa.gov/nasa-brand-center/images-and-media/.

### PBR skins on the deterministic panel/mast build ops (CC0)

The deterministic panel/mast build ops (`internal/agent/opsource.go`, issue #57)
carry these self-hosted CC0 PBR skins via the `material.map` / `normal_map` /
`roughness_map` wire slots — solar-panel cells get the solar set, metal mast
segments and the panel mount get the metal set. The renderer's `SpecPrimitive`
loads them with the correct colorSpace and falls back SILENTLY to the flat base
color if any map is missing/fails (ADR-0004). From ambientCG; downloaded as 1K
JPG and **resized to 512×512** for bundle size (otherwise unmodified). The OpenGL
(`NormalGL`) normal map is used.

| File | Source map | Author | Source URL | License |
|------|-----------|--------|-----------|---------|
| `textures/solar_diff_512.jpg` | "Solar Panel 002" — 1K Color, resized to 512 | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=SolarPanel002 | CC0 1.0 |
| `textures/solar_nor_gl_512.jpg` | "Solar Panel 002" — 1K NormalGL, resized to 512 | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=SolarPanel002 | CC0 1.0 |
| `textures/solar_rough_512.jpg` | "Solar Panel 002" — 1K Roughness, resized to 512 | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=SolarPanel002 | CC0 1.0 |
| `textures/metal_diff_512.jpg` | "Metal Plates 006" — 1K Color, resized to 512 | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=MetalPlates006 | CC0 1.0 |
| `textures/metal_nor_gl_512.jpg` | "Metal Plates 006" — 1K NormalGL, resized to 512 | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=MetalPlates006 | CC0 1.0 |
| `textures/metal_rough_512.jpg` | "Metal Plates 006" — 1K Roughness, resized to 512 | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=MetalPlates006 | CC0 1.0 |

Original 1K downloads (resized down to 512; otherwise unmodified):

- `https://ambientcg.com/get?file=SolarPanel002_1K-JPG.zip`
- `https://ambientcg.com/get?file=MetalPlates006_1K-JPG.zip`

ambientCG publishes all of its assets under CC0 1.0 (https://ambientcg.com/license).

## Sky bodies — Moon & Earth (NASA-PD)

Decorative, snapshot-independent sky bodies rendered by
`web/src/components/SkyBodies.tsx` (issue #51): the Moon globe in orbit view, the
"Earthrise" Earth in the black surface sky. These are **Scenery** (ADR-0004
allows snapshot-independent decoration), never snapshot-driven Assets; a
failed/missing texture falls back to the sphere's flat material color (ADR-0004
mandatory fallback). All source images are US-government public-domain works from
NASA's 3D Resources repository (`master` branch). Credited as `NASA` as a
courtesy; this project is **not** affiliated with or endorsed by NASA, and the
NASA insignia is **not** used. Each download was verified as a real JPEG
(`file <path>` reports `JPEG image data`). Downloaded: 2026-06-06.

| File | Source asset | Author | Source URL | License |
|------|--------------|--------|-----------|---------|
| `textures/moon_color_1024.jpg` | NASA 3D Resources → `Images and Textures/Moon/Moon.jpg`, resized to 1024 | NASA | https://github.com/nasa/NASA-3D-Resources/blob/master/Images%20and%20Textures/Moon/Moon.jpg | Public Domain (NASA-PD) |
| `textures/moon_normal_1024.jpg` | Baked OFFLINE from `Moon.jpg` (grayscale heightfield → Sobel-gradient OpenGL normal map, 1024) | NASA (derived) | https://github.com/nasa/NASA-3D-Resources/blob/master/Images%20and%20Textures/Moon/Moon.jpg | Public Domain (NASA-PD) |
| `textures/moon_rough_512.jpg` | Baked OFFLINE from `Moon.jpg` (grayscale, clamped to a high-roughness band, 512) | NASA (derived) | https://github.com/nasa/NASA-3D-Resources/blob/master/Images%20and%20Textures/Moon/Moon.jpg | Public Domain (NASA-PD) |
| `textures/earth_color_512.jpg` | NASA 3D Resources → `Images and Textures/Earth (A)/Earth (A).jpg`, resized to 1024×512 | NASA | https://github.com/nasa/NASA-3D-Resources/blob/master/Images%20and%20Textures/Earth%20(A)/Earth%20(A).jpg | Public Domain (NASA-PD) |

Original downloads (raw `master`, the `.jpg` not the huge `.tif`):

- `https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/Images%20and%20Textures/Moon/Moon.jpg`
- `https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/Images%20and%20Textures/Earth%20(A)/Earth%20(A).jpg`

The Moon color/Earth color were downscaled (ImageMagick `magick … -resize`) for
bundle size; otherwise the photometry is unmodified. The Moon normal + roughness
maps are baked offline from the same Moon photo (a heightfield-derived OpenGL
normal map for crater relief — relief is applied as a **normal map, never a
displacementMap**) and so are derivative NASA-PD works. NASA's image and media
usage guidelines state NASA content is generally not copyrighted and may be used
for educational/informational purposes; the NASA insignia/logo and flags are
excluded and are NOT used here. See
https://www.nasa.gov/nasa-brand-center/images-and-media/ and
https://github.com/nasa/NASA-3D-Resources.

## Rover model (NASA-PD)

Used by `<Rover3D>` (issue #54) as the realistic worker-entity render — every
rover swaps its primitive box body for this one configured glTF. It is NOT a
Build-spec catalog Asset; the model is fixed for all rovers. A missing/failed
load falls back FOREVER to the primitive rover (box body + sensor mast + 4
wheels), so the scene never blanks (ADR-0004). Self-hosted, conditioned +
Draco-compressed by `scripts/condition-asset.mjs` (recentered, fit-to-unit);
fitted + ground-seated at load. The loaded tree is raycast-suppressed so the
rover's invisible hit-proxy sphere stays the SOLE pickable surface.

| File | Source asset | Author | Source URL | License |
|------|--------------|--------|-----------|---------|
| `models/rassor_rover.glb` | "Regolith Advanced Surface Systems Operations Robot (RASSOR)" — NASA's lunar regolith excavation/construction robot. Draco-decompressed, decimated (~2.1M → render-light), conditioned (Y-up, recentered, fit-to-unit), then Draco-recompressed (6.3 MB → 2.0 MB). | NASA | https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Regolith%20Advanced%20Surface%20Systems%20Operations%20Robot%20(RASSOR) | NASA-PD |

NASA's 3D Resources are released into the public domain (NASA-PD); see
https://github.com/nasa/NASA-3D-Resources (Usage Guidelines). No NASA insignia
("meatball"/worm logo) is included — `condition-asset.mjs` strips insignia/decal
nodes. This use does not imply NASA endorsement.

Original download (Draco-compressed source; conditioned, not committed as-is):
`https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/3D%20Models/Regolith%20Advanced%20Surface%20Systems%20Operations%20Robot%20%28RASSOR%29/Regolith%20Advanced%20Surface%20Systems%20Operations%20Robot%20%28RASSOR%29.glb`
