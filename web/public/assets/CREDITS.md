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
| `textures/rock_boulder_dry_nor_gl_512.jpg` | "Rock Boulder Dry" — 1K OpenGL normal, **resized to 512×512** | Dimitrios Savva (photography), Rico Cilliers (processing) | https://polyhaven.com/a/rock_boulder_dry | CC0 1.0 |
| `textures/rock_boulder_dry_rough_512.jpg` | "Rock Boulder Dry" — 1K roughness, **resized to 512×512** | Dimitrios Savva (photography), Rico Cilliers (processing) | https://polyhaven.com/a/rock_boulder_dry | CC0 1.0 |

Original 1K downloads (resized down to 512 for bundle size; otherwise unmodified) —
the normal + roughness maps back the DecorRocks boulder PBR (#111):
`https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rock_boulder_dry/rock_boulder_dry_diff_1k.jpg`
`https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rock_boulder_dry/rock_boulder_dry_nor_gl_1k.jpg`
`https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rock_boulder_dry/rock_boulder_dry_rough_1k.jpg`

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

The lunar terrain is clothed with Poly Haven's **Moon 01** set (issue #53; upgraded
to 2K in milestone 08 / #170): the full diffuse / normal (OpenGL) / roughness / AO
maps. WS-4 (#170) upgraded the terrain set from 512 to **true 2048×2048**; the heavy
normal + AO maps are **re-encoded at jpg quality ≈68** (resolution unchanged) so the
full set lands ≈5 MB instead of ~10 MB. The jpg `nor_gl` normal map is used (no EXR
dependency). The small 512 set below is retained for the low-detail `SpecPrimitive`
block slot (mock scene), which does not need 2K.

| File | Source map | Authors | Source URL | License |
|------|-----------|---------|-----------|---------|
| `textures/regolith_diff_2k.jpg` | "Moon 01" — 2K diffuse | Greg Zaal, Rico Cilliers, Jenelle van Heerden (photography), Dario Barresi (processing) | https://polyhaven.com/a/moon_01 | CC0 1.0 |
| `textures/regolith_nor_gl_2k.jpg` | "Moon 01" — 2K normal (OpenGL), re-encoded jpg q≈68 | Greg Zaal, Rico Cilliers, Jenelle van Heerden (photography), Dario Barresi (processing) | https://polyhaven.com/a/moon_01 | CC0 1.0 |
| `textures/regolith_rough_2k.jpg` | "Moon 01" — 2K roughness | Greg Zaal, Rico Cilliers, Jenelle van Heerden (photography), Dario Barresi (processing) | https://polyhaven.com/a/moon_01 | CC0 1.0 |
| `textures/regolith_ao_2k.jpg` | "Moon 01" — 2K ambient occlusion, re-encoded jpg q≈68 | Greg Zaal, Rico Cilliers, Jenelle van Heerden (photography), Dario Barresi (processing) | https://polyhaven.com/a/moon_01 | CC0 1.0 |
| `textures/regolith_diff_512.jpg` | "Moon 01" — 1K diffuse, resized to 512 | Greg Zaal, Rico Cilliers, Jenelle van Heerden (photography), Dario Barresi (processing) | https://polyhaven.com/a/moon_01 | CC0 1.0 |
| `textures/regolith_nor_gl_512.jpg` | "Moon 01" — 1K normal (OpenGL), resized to 512 | Greg Zaal, Rico Cilliers, Jenelle van Heerden (photography), Dario Barresi (processing) | https://polyhaven.com/a/moon_01 | CC0 1.0 |
| `textures/regolith_rough_512.jpg` | "Moon 01" — 1K roughness, resized to 512 | Greg Zaal, Rico Cilliers, Jenelle van Heerden (photography), Dario Barresi (processing) | https://polyhaven.com/a/moon_01 | CC0 1.0 |
| `textures/regolith_ao_512.jpg` | "Moon 01" — 1K ambient occlusion, resized to 512 | Greg Zaal, Rico Cilliers, Jenelle van Heerden (photography), Dario Barresi (processing) | https://polyhaven.com/a/moon_01 | CC0 1.0 |

Original 2K downloads (normal + AO re-encoded at jpg q≈68; otherwise unmodified):

- `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/moon_01/moon_01_diff_2k.jpg`
- `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/moon_01/moon_01_nor_gl_2k.jpg`
- `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/moon_01/moon_01_rough_2k.jpg`
- `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/moon_01/moon_01_ao_2k.jpg`

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
| `models/nasa_dish_70m.glb` | `comms-dish` / `dish-70m` | NASA 3D Resources → `3D Models/70-meter Dish/70 meter dish.glb` | NASA / NASA 3D Resources | https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/70-meter%20Dish | NASA / US-gov public domain | Milestone 08: re-conditioned WITH its baseColor texture kept (the prior `comms-dish.glb` detached it → flat grey) via `gltf-transform optimize --compress draco --texture-compress webp` (2.2 MB → 207 KB). Shared by the lunar comms ridge (hero) + Shackleton, scaled per site. Replaces `comms-dish.glb`. |

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
`web/src/components/SkyBodies.tsx` (issues #51, #82, #86): the Moon globe in orbit
view, the day/night Earth marble in both views. These are **Scenery** (ADR-0004
allows snapshot-independent decoration), never snapshot-driven Assets; a
failed/missing texture falls back to the sphere's flat material color (ADR-0004
mandatory fallback). All source images are US-government public-domain works from
NASA. Credited as `NASA` as a courtesy; this project is **not** affiliated with or
endorsed by NASA, and the NASA insignia is **not** used. Each download was verified
as a real JPEG (`file <path>` reports `JPEG image data`). Wave-2 realism upgrade
(space-view-realism.md §1, §2, §5) — downloaded: 2026-06-07.

The Moon now uses the NASA **CGI Moon Kit (SVS 4720)** data — the canonical NASA
Moon-rendering source: the LROC WAC colour mosaic for albedo (real maria contrast +
baked-in ray systems), and a normal map baked OFFLINE from the LOLA LDEM elevation
so crater relief lines up with the albedo (relief is applied as a **normal map,
never a displacementMap**). The Earth now uses NASA **Blue Marble: Next Generation**
(day) + **Black Marble** (city-lights, night-side emissive).

| File | Source asset | Author | Source URL | License |
|------|--------------|--------|-----------|---------|
| `textures/moon_color_4096.jpg` | NASA CGI Moon Kit (SVS 4720) → `lroc_color_poles_8k.tif` (LROC WAC colour mosaic), 8192×4096 → 4096×2048, neutral-graded (desaturate to ~38% so it reads cool grey, not warm-brown) | NASA's Scientific Visualization Studio | https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_8k.tif | Public Domain (NASA-PD) |
| `textures/moon_normal_4096.jpg` | Baked OFFLINE from the CGI Moon Kit LOLA elevation `ldem_16_uint.tif` (16-bit LDEM heightfield, 5760×2880 → 4096×2048 → Sobel-gradient OpenGL normal map) | NASA's Scientific Visualization Studio (derived) | https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16_uint.tif | Public Domain (NASA-PD) |
| `textures/earth_day_2048.jpg` | NASA Blue Marble: Next Generation (Dec 2004 topo+bathy), resized 5400×2700 → 2048×1024 | NASA's Goddard Space Flight Center (Blue Marble: Next Generation) | https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x5400x2700.jpg | Public Domain (NASA-PD) |
| `textures/earth_night_2048.jpg` | NASA Black Marble (2016 night lights), resized 13500×6750 → 2048×1024 | NASA's Earth Observatory (Black Marble) | https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg | Public Domain (NASA-PD) |
| `textures/earth_clouds_2048.jpg` | NASA Blue Marble cloud composite (MODIS), `cloud_combined_2048.tif` → grayscale JPG 2048×1024 | NASA's Goddard Space Flight Center (Blue Marble: Next Generation, clouds) | https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_2048.tif | Public Domain (NASA-PD) |

The Earth colour maps were downscaled (ImageMagick `magick … -resize`) to 2K for
bundle size; the Moon colour map is the 8K LROC mosaic downscaled to 4K and
neutral-graded for a reference-accurate cool grey (desaturate to ~38%). The Moon
normal map is baked offline from the LOLA LDEM-16 elevation TIFF (a heightfield-derived
OpenGL normal map for crater relief) and so is a derivative NASA-PD work; the bake
step is reproducible via ImageMagick (16-bit grey raster extract) + a small node
Sobel script (see the PR for the recipe). NASA's image
and media usage guidelines state NASA content is generally not copyrighted and may
be used for educational/informational purposes; the NASA insignia/logo and flags
are excluded and are NOT used here. See
https://www.nasa.gov/nasa-brand-center/images-and-media/, NASA's Scientific
Visualization Studio (https://svs.gsfc.nasa.gov/4720/), and NASA's Earth
Observatory.

## Sun (Solar System Scope — CC-BY 4.0)

Decorative, snapshot-independent sky body rendered by
`web/src/components/SkyBodies.tsx` (`SunBody`): the scene's single light emitter
(Scene3D's `directionalLight` shares its `SUN_POSITION`). It is a **Scenery**
element (ADR-0004), never a snapshot-driven Asset; a failed/missing texture falls
back to the sphere's flat near-white material color (ADR-0004 mandatory fallback).
The disc is rendered **white-hot** (strong white `emissive`, `toneMapped:false`),
so the colour map is wired only as a faint diffuse `map` for subtle granulation —
the body reads white, never yellow. Downloaded: 2026-06-06; verified as a real
JPEG (`file <path>` reports `JPEG image data`).

| File | Source asset | Author | Source URL | License |
|------|--------------|--------|-----------|---------|
| `textures/sun_color_1024.jpg` | "2K Sun" texture, resized to 1024×512 | Solar System Scope (INOVE) | https://www.solarsystemscope.com/textures/ | CC-BY 4.0 |

Original download (resized down for bundle size; otherwise unmodified):
`https://www.solarsystemscope.com/textures/download/2k_sun.jpg`

Solar System Scope publishes its texture pack under **CC-BY 4.0**
(https://www.solarsystemscope.com/textures/) — admissible with attribution, which
is recorded here. **Attribution:** Solar System Scope (solarsystemscope.com),
licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).

## Nebula hero — ESA/Hubble Veil Nebula (CC-BY 4.0)

Decorative, snapshot-independent deep-space vista accent rendered by
`web/src/components/SkyBodies.tsx` (`NebulaHero`, issue #90): a 2–4 layer additive
sprite stack shown ONLY in the orbit view. It is a **Scenery** element (ADR-0004),
never a snapshot-driven Asset; a failed/missing image falls back to a procedural
radial-gradient `CanvasTexture` cloud (ADR-0004 mandatory fallback). The source is
the ESA/Hubble Veil Nebula "Witch's Broom" (heic0712a). The raw image has a BRIGHT,
busy background (corner luminance ≈ 116/255), so for additive sprite use it is
conditioned OFFLINE: black-point crush (`-level 46%,100%`) drops the background to
true black so additive adds nothing there, and a radial vignette (multiply by a
sigmoidal radial-gradient) fades the sprite-quad edges to black so the square never
reads as a hard rectangle. Downloaded: 2026-06-07; resized 1493×751 → 1024-wide.

| File | Source asset | Author | Source URL | License |
|------|--------------|--------|-----------|---------|
| `textures/nebula_veil_1024.jpg` | ESA/Hubble Veil Nebula "Witch's Broom" (heic0712a), resized to 1024 wide, black-crushed + radial-vignetted for additive sprite use | ESA/Hubble (see attribution below) | https://cdn.esahubble.org/archives/images/large/heic0712a.jpg | CC-BY 4.0 |

ESA/Hubble publishes its images under **CC-BY 4.0**
(https://esahubble.org/copyright/) — admissible with attribution, which is recorded
here verbatim. **Attribution:** NASA, ESA, and the Hubble Heritage
(STScI/AURA)-ESA/Hubble Collaboration. Acknowledgment: J. Hester (ASU).

## Rover model (NASA-PD — milestone 08 / #171)

Used by `<Rover3D>` (issue #54) as the realistic worker-entity render — every
rover swaps its primitive box body for this one configured glTF. It is NOT a
Build-spec catalog Asset; the model is fixed for all rovers. A missing/failed
load falls back FOREVER to the primitive rover (box body + sensor mast + 4
wheels), so the scene never blanks (ADR-0004). Self-hosted, conditioned +
Draco-compressed by `scripts/condition-asset.mjs` (recentered, fit-to-unit);
fitted + ground-seated at load. The loaded tree is raycast-suppressed so the
rover's invisible hit-proxy sphere stays the SOLE pickable surface.

WS-3 (#171) swapped the **active** rover to NASA's iconic **Mars 2020
Perseverance** — the featureless `rassor_rover.glb` "shrinkwrap" hull read as a
smooth pod, and a stop-gap low-poly CC0 rover read as a toy, so neither sold
"real rover." Perseverance is the genuine NASA rover silhouette. The RASSOR row
is retained below for provenance (file still present, no longer referenced).

| File | Source asset | Author | Source URL | License |
|------|--------------|--------|-----------|---------|
| `models/rover_nasa.glb` | "Mars 2020 Perseverance Rover" — NASA's iconic 6-wheel rover (detailed chassis + rocker-bogie suspension + Mastcam-Z/NavCam camera mast + robotic arm + antennas). **Body PBR textures KEPT** (real white/tan livery via the `mars_2020_*` atlases). Draco-decoded, then `gltf-transform optimize --compress draco --texture-compress webp --texture-size 1024` (Y-up, no recenter/fit — the renderer's `fitAndSeatRover` fits + seats at load): 4.76 MB source → 1.47 MB. 44 meshes / ~126k verts, 22 webp textures embedded — NOT a flat-grey blob. **Insignia painted out (ImageMagick, astronaut.glb method):** the `blade` atlas's US flag + NASA meatball + JPL logo and the `arm_graphics` atlas's NASA meatball + JPL logo were flat-filled with the surrounding panel colour before re-packing; science calibration targets/fiducials and the "MARS 2020/PERSEVERANCE" mission text retained. No insignia/worm/seal/flag in the shipped `.glb` (re-verified post-encode). | NASA / Brian Kumanchik, NASA/JPL-Caltech | https://science.nasa.gov/3d-resources/mars-2020-perseverance-rover/ | NASA-PD |
| `models/rassor_rover.glb` | "Regolith Advanced Surface Systems Operations Robot (RASSOR)" — NASA's lunar regolith excavation/construction robot. Draco-decompressed, decimated (~2.1M → render-light), conditioned (Y-up, recentered, fit-to-unit), then Draco-recompressed (6.3 MB → 2.0 MB). _Retained for provenance; no longer the active rover (#171)._ | NASA | https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Regolith%20Advanced%20Surface%20Systems%20Operations%20Robot%20(RASSOR) | NASA-PD |

Original download (Perseverance; conditioned, not committed as-is):
`https://assets.science.nasa.gov/content/dam/science/cds/3d/resources/model/mars-2020-perseverance-rover/Mars%202020%20Perseverance%20Rover.glb`

NASA's 3D Resources are released into the public domain (NASA-PD); see
https://github.com/nasa/NASA-3D-Resources (Usage Guidelines). No NASA insignia
("meatball"/worm logo) is included — `condition-asset.mjs` strips insignia/decal
nodes. This use does not imply NASA endorsement.

Original download (Draco-compressed source; conditioned, not committed as-is):
`https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/3D%20Models/Regolith%20Advanced%20Surface%20Systems%20Operations%20Robot%20%28RASSOR%29/Regolith%20Advanced%20Surface%20Systems%20Operations%20Robot%20%28RASSOR%29.glb`

## Milky-Way star background (Deep Star Maps 2020 — NASA-PD + ESA/Gaia co-credit)

Used by `<SpaceEnvironment>` (issue #83) as the equirectangular Milky-Way
background assigned to `scene.background` (`EquirectangularReflectionMapping`,
`SRGBColorSpace`, max anisotropy) — kept SEPARATE from the IBL `environment`. It
is a **Scenery** element (ADR-0004 allows snapshot-independent decoration), never
a snapshot-driven Asset; a failed/missing load leaves the Canvas's black
`<color attach="background">` fallback untouched (ADR-0004 mandatory fallback).

The source is the SVS 4851 **galactic-coordinate** composite (`_gal`: Milky-Way
band sits as a clean horizontal stripe with the bulge centered) — the
`starmap_*` file is the *composite* (Milky-Way band **+** discrete stars in one
file). No constellation/grid overlay is baked in. The source is **EXR-only** at
usable resolution (the SVS `.jpg` 404s; `_print.jpg` is a 1024×512 thumbnail),
so the 8k EXR was converted OFFLINE to a **full 8192×4096** sRGB JPG (kept at
source resolution — 4× the linear detail of the prior 4k — so the stars read as
crisp pinpoints and the dust band stays smooth). The galactic `_gal` projection
lays the band horizontally; the renderer rolls/yaws it via `scene.backgroundRotation`
so the bright galactic-centre dust runs diagonally through the orbit frame.
Downloaded & converted: 2026-06-07.

| File | Source asset | Author | Source URL | License |
|------|--------------|--------|-----------|---------|
| `starmap_2020_8k_gal.jpg` | Deep Star Maps 2020 (SVS 4851) → `starmap_2020_8k_gal.exr`, converted offline to 8192×4096 sRGB JPG (warm-graded) | NASA/Goddard SVS (Gaia DR2: ESA/Gaia/DPAC) | https://svs.gsfc.nasa.gov/4851/ | Public Domain (NASA-PD) + ESA/Gaia co-credit |
| `starmap_2020_16k_gal.ktx2` | SAME Deep Star Maps 2020 source at **16384×8192**, GPU-compressed to Basis-LZ/ETC1S KTX2 (tone-matched to the 8k JPG above) | NASA/Goddard SVS (Gaia DR2: ESA/Gaia/DPAC) | https://svs.gsfc.nasa.gov/4851/ | Public Domain (NASA-PD) + ESA/Gaia co-credit |

Original download (8192×4096 EXR; converted offline, not committed as-is):
`https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/starmap_2020_8k_gal.exr`

Offline conversion (ImageMagick v7; EXR linear HDR → sRGB JPEG, warm grade to
bring out the brown dust band):

```sh
magick starmap_2020_8k_gal.exr -set colorspace RGB -colorspace sRGB \
  -modulate 112,125,100 -depth 8 -quality 82 \
  web/public/assets/starmap_2020_8k_gal.jpg
```

### 16k KTX2 upgrade (`starmap_2020_16k_gal.ktx2`) — PRIMARY backdrop

The PRIMARY space backdrop is now the **16k** Deep Star Maps render, GPU-compressed
to a Basis-LZ/ETC1S `.ktx2` so the 4× linear resolution (crisp pinpoint stars +
finer dust) ships **without** a VRAM cost: on desktop it transcodes to BC7
(~1 byte/texel), so 16384×8192 with mips is ~179 MB on the GPU — the same as the
8k RGBA8 it replaces. The real saving comes from HOW it renders: the starmap is
sampled directly on a sky-sphere mesh (`SpaceEnvironment.tsx <SkySphere>`), NOT
via `scene.background` — three r169 converts equirect backgrounds to a cubemap
render target sized `image.height` (8192³×6 ≈ 1.6 GB for this map, and the RT
inherits a mipmap filter with no mipmaps from the CompressedTexture, so it samples
black), meaning the background slot is both broken for KTX2 and was silently
costing the old 8k JPG path a ~536 MB cubemap. The 8k JPG above stays as the
ADR-0004 fallback (used if the GPU can't transcode KTX2). The transcoder
(`basis_transcoder.js` + `.wasm`, three's copy) is vendored to `assets/basis/`.

Original download (16384×8192 EXR, 366 MB; ImageMagick can't decode its
compression, so ffmpeg does the EXR→PNG step):
`https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/starmap_2020_16k_gal.exr`

Offline conversion (ffmpeg applies the linear→sRGB transfer the EXR carries; the
`-gamma 1.30` is tuned so the result's luminance/contrast/saturation MATCH the 8k
JPG above, so the per-view `backgroundIntensity` grades need no re-tuning; `basisu`
= Basis Universal v2.10):

```sh
# 1. EXR (linear half-float) → 16k sRGB PNG
ffmpeg -apply_trc iec61966_2_1 -i starmap_2020_16k_gal.exr starmap_16k_srgb.png
# 2. tone-match the established 8k look
magick starmap_16k_srgb.png -gamma 1.30 -depth 8 starmap_16k_final.png
# 3. ETC1S KTX2 + mipmaps (sRGB-correct mip filtering), y-flipped for equirect
basisu -q 255 -comp_level 2 -mipmap -mip_srgb -ktx2 -y_flip \
  -output_file starmap_2020_16k_gal.ktx2 starmap_16k_final.png
```

NASA's Deep Star Maps are derived from ESA's Gaia DR2 (plus Hipparcos/Tycho)
catalogs and carry a **mandatory ESA/Gaia co-credit** even though NASA-hosted.
NASA content is generally not copyrighted (NASA media usage guidelines); the NASA
insignia/logo is **not** used and no endorsement is implied. See
https://svs.gsfc.nasa.gov/4851/ and
https://www.nasa.gov/nasa-brand-center/images-and-media/.

**Required attribution:** NASA/Goddard SVS. Gaia DR2: ESA/Gaia/DPAC
## Scale props — Base Station + Astronaut (NASA-PD)

Decorative, snapshot-independent **Scenery** scale props rendered by
`web/src/components/LaunchScenery.tsx` (Issue #89, rescoped) — a small **Base
Station** filler structure and an EVA **Astronaut** placed at the near edge of
the worksite complex to give the scene human scale. They are NOT snapshot-driven
Assets; each carries a mandatory primitive fallback (box / capsule sized to the
model bbox, ADR-0004) and the loaded tree is raycast-suppressed so it is never
pickable. Both are US-government public-domain works from NASA's 3D Resources
repository (`master` branch). Credited as `NASA / <author>` as a courtesy; this
project is **not** affiliated with or endorsed by NASA, and **no NASA insignia
or flag is displayed** (see the insignia-strip note below). Each conditioned
`.glb` is self-hosted in `models/` and verified as real glTF (`head -c 4` prints
`glTF`). Downloaded: 2026-06-07.

| File | Source asset | Author | Source URL | License | Conditioning |
|------|--------------|--------|-----------|---------|--------------|
| `models/base-station.glb` | NASA 3D Resources → `3D Models/Base Station/Base Station.glb` | NASA / Ames | https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Base%20Station | Public Domain (NASA-PD) | external texture ref (`BASE_UV.JPG`, not distributed in the repo) stripped → material uses its grey baseColorFactor; then `gltf-transform optimize --compress draco` (21.7 KB → 1.8 KB) |
| `models/astronaut.glb` | NASA 3D Resources → `3D Models/Astronaut/Astronaut.glb` | NASA | https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Astronaut | Public Domain (NASA-PD) | **insignia/flag decals stripped** (two US flags + the NASA "meatball" painted out of the suit baseColor texture with ImageMagick); re-packed + `gltf-transform optimize --compress draco --texture-compress webp` (763 KB → 59 KB) |

Source repository (the `.glb` files above are fetched verbatim from branch
`master`, then conditioned offline as noted): `https://github.com/nasa/NASA-3D-Resources`.

Original downloads (raw `master`; conditioned, not committed as-is):

- `https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/3D%20Models/Base%20Station/Base%20Station.glb`
- `https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/3D%20Models/Astronaut/Astronaut.glb`

**Insignia-strip note (required by §7 of the space-view-realism study):** the
NASA insignia/meatball/worm and the US flag are **not** public domain and must
not be shipped. The raw Astronaut suit texture carried two US-flag patches and a
NASA meatball; all three were painted over with the neutral suit colour before
re-packing, so the shipped `.glb` displays no insignia or flag. The Base Station
carried no insignia (its only decal was an undistributed external diffuse map,
which was stripped). The Astronaut's remaining grey patches are mechanical EVA
suit hardware (chest controls / valves), not insignia. NASA's image and media
usage guidelines: https://www.nasa.gov/nasa-brand-center/images-and-media/.

## Composed base — EVA suit + comms dish (NASA-PD — milestone 08 / #174)

Two NASA 3D Resources models added (the EMU) / re-conditioned (the 70-m dish) for
the composed lunar base layout (Milestone 08, WS-2/WS-6). Both are decorative,
snapshot-independent **Scenery** rendered by `LaunchScenery.tsx`, each with a
mandatory primitive fallback (ADR-0004) and raycast-suppressed (non-pickable). US
public-domain works; this project is **not** affiliated with or endorsed by NASA,
and **no NASA insignia or US flag is displayed**. Downloaded & conditioned 2026-06-08.

| File | Source asset | Author | Source URL | License | Conditioning |
|------|--------------|--------|-----------|---------|--------------|
| `models/nasa_emu.glb` | NASA 3D Resources → `3D Models/Extravehicular Mobility Unit/Extravehicular Mobility Unit.glb` (EVA spacesuit, a scale figure near the worksite) | NASA / NASA 3D Resources | https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Extravehicular%20Mobility%20Unit | NASA / US-gov public domain | **ALL textures stripped** (the source baseColor atlases carried a US flag + a mission patch + EVA-control labels; per §7 the flag/insignia must not ship, so every texture slot was removed and the suit renders from a neutral grey baseColorFactor — same approach as `base-station.glb`); then `gltf-transform optimize --compress draco` (3.45 MB → 352 KB). Shipped `.glb` has **0 textures** (re-verified post-encode). |
| `models/nasa_dish_70m.glb` | NASA 3D Resources → `3D Models/70-meter Dish/70 meter dish.glb` | NASA / NASA 3D Resources | https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/70-meter%20Dish | NASA / US-gov public domain | Textured re-condition of the dish that previously shipped (with textures detached → flat grey) as `comms-dish.glb`: kept its baseColor texture via `gltf-transform optimize --compress draco --texture-compress webp` (2.2 MB → 207 KB). Its single texture is the antenna's metal/structure surface (no insignia/flag). **Replaces `comms-dish.glb`**; shared by the lunar comms ridge (hero, scaled large) + Shackleton. See the props table above. |

Original downloads (raw `master`; conditioned, not committed as-is):

- `https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/3D%20Models/Extravehicular%20Mobility%20Unit/Extravehicular%20Mobility%20Unit.glb`
- `https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/3D%20Models/70-meter%20Dish/70%20meter%20dish.glb`

NASA's 3D Resources are released into the public domain; the NASA insignia/worm/
seal and US flag are excluded and are NOT shipped here. See
https://www.nasa.gov/nasa-brand-center/images-and-media/.
