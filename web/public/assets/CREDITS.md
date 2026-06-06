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
