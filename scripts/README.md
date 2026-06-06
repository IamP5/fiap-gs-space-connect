# Asset conditioning runbook (Issue #52)

Offline pipeline that turns a source model into a web-light, render-ready,
self-hosted, **Draco-compressed** `.glb` under `web/public/assets/models/` that
loads **OFFLINE** — no gstatic CDN — because the Draco/meshopt decoders are
vendored under `web/public/draco/` and served from the same origin.

## Invariants this preserves

- **Pure-function-of-snapshot** — conditioning is offline/build-time; runtime
  still only interprets snapshot data.
- **Mandatory primitive fallback** — `Scene3D.tsx` keeps the non-Suspense
  load-then-swap flow and the box fallback. A missing/failed/undecodable asset
  falls back to plain geometry; the scene never breaks (ADR-0004).
- **Demand-loop perf budget** — compressed glb means smaller transfers; idle
  stays 0 fps (no animation loop added).

## One-shot conditioning

```bash
# from the repo root
node scripts/condition-asset.mjs <source.(glb|gltf)> <out-name> [options]
```

This does, in order:

1. **Geometry conditioning** (via the project's already-installed `three`):
   - **up-axis fix** — `--up=z` rotates Z-up (NASA/CAD default) to Y-up.
   - **normals** — `computeVertexNormals()` on any mesh missing a normal attribute.
   - **recenter to origin** — pivot moved to the bounding-box center.
   - **fit-to-unit** — uniform scale so the largest dimension == 1 world unit
     (a `fitToView`-style bake; per-placement envelope fit is the catalog's job, #59).
   - **strip NASA insignia** — drops nodes whose name matches the insignia/decal
     patterns (the NASA "meatball"/worm logo is **not** public domain). Add more
     with `--strip=<regex>`.
2. **Compression** — shells out to `npx @gltf-transform/cli optimize ... --compress draco`
   (and `--simplify` for inputs > 15 MB). `@gltf-transform/cli` is invoked via
   `npx` and is intentionally **NOT** a project dependency (stack is locked).

### Options

| Flag | Effect |
|------|--------|
| `--up=z` \| `--up=y` | Source up-axis. `z` bakes a -90deg X rotation to Y-up. Default `y`. |
| `--no-fit` | Skip fit-to-unit scaling. |
| `--no-recenter` | Skip recenter-to-origin. |
| `--strip=<regex>` | Extra case-insensitive node-name pattern to drop, in addition to the built-in insignia patterns. |
| `--simplify` | Force `gltf-transform simplify` (auto-on for inputs > 15 MB). |
| `--keep-intermediate` | Keep the pre-compression baked `.glb` for inspection. |

### Equivalent manual gltf-transform command

If you only need the compression step on an already-conditioned model:

```bash
npx --yes @gltf-transform/cli optimize in.glb out.glb --compress draco
# for big models (>15 MB) also decimate:
npx --yes @gltf-transform/cli optimize in.glb out.glb --compress draco --simplify true
```

## Vendored Draco decoder

`web/public/draco/` holds the glTF Draco **decoder** set copied from
`web/node_modules/three/examples/jsm/libs/draco/gltf/`:

- `draco_decoder.js`
- `draco_decoder.wasm`
- `draco_wasm_wrapper.js`

`Scene3D.tsx` wires `DRACOLoader.setDecoderPath('/draco/')` + meshopt onto the
shared module-level `GLTFLoader`. To refresh after a `three` upgrade, re-copy
those three files from the matching `node_modules` `draco/gltf/` directory.

## After conditioning

Record provenance/licence for every shipped asset in
`web/public/assets/CREDITS.md` (CC0 / CC-BY-with-attribution / NASA-PD only).
Commit the conditioned `.glb`; do **not** commit the source model.
