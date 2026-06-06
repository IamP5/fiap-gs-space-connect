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

## Textures

| File | Source asset | Authors | Source URL | License |
|------|--------------|---------|-----------|---------|
| `textures/rock_boulder_dry_diff_512.jpg` | "Rock Boulder Dry" — 1K diffuse, **resized to 512×512** | Dimitrios Savva (photography), Rico Cilliers (processing) | https://polyhaven.com/a/rock_boulder_dry | CC0 1.0 |

Original 1K download (resized down to 512 for bundle size; otherwise unmodified):
`https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rock_boulder_dry/rock_boulder_dry_diff_1k.jpg`

Poly Haven publishes all of its assets under CC0 1.0
(https://polyhaven.com/license); the asset's authors are confirmed via the Poly
Haven API (`https://api.polyhaven.com/info/rock_boulder_dry`).

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
