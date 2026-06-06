# Asset conditioning pipeline: convert/normalize + DRACO/meshopt + vendored /draco/

- **Issue:** [#52](https://github.com/IamP5/fiap-gs-space-connect/issues/52)
- **Epic:** [#46](https://github.com/IamP5/fiap-gs-space-connect/issues/46)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK

## What to build

Establish the **offline pipeline** that turns source assets into web-light, render-ready `.glb` self-hosted in `web/public/assets/`. Most NASA picks are already `.glb` on the **`master`** branch of `nasa/NASA-3D-Resources`, fetched via `https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/<url-encoded path>` (no git-LFS). Two parts:

1. **Geometry conditioning (the NASA-model gap the viewer research surfaced).** NASA assets have arbitrary units, off-origin pivots, wrong up-axis, and sometimes missing normals. Bake fixes offline: correct up-axis, `computeVertexNormals()` where missing, recenter to origin, fit-to-unit (a `fitToView`-style bake). **Strip any NASA insignia** decal (not PD). Per-asset PD spot-check before adding.
2. **Compression/decode.** Vendor the DRACO decoder under `web/public/draco/`, wire `DRACOLoader` onto the existing module-level GLTFLoader (`setDecoderPath('/draco/')`), add meshopt; run `gltf-transform optimize --compress draco` (+ `simplify` on >15 MB models). Keep the non-Suspense load-then-swap + box fallback.

Per-placement normalization beyond the geometry bake (fit to a specific Build envelope) is carried by the catalog entry (#59).

## Acceptance criteria

- [ ] /draco/ decoder vendored + self-hosted (no gstatic CDN fetch)
- [ ] DRACOLoader + meshopt wired onto the existing loader; box fallback intact
- [ ] Conditioning bakes: up-axis fixed, normals recomputed when missing, recentered, fit-to-unit; insignia stripped
- [ ] A Draco-compressed conditioned glb loads and renders; existing Kenney assets still load
- [ ] Repeatable documented command/script: source asset → conditioned, optimized glb in web/public/assets/
- [ ] Idle stays 0 fps

## Blocked by

- [#48](https://github.com/IamP5/fiap-gs-space-connect/issues/48)
