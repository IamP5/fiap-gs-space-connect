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
