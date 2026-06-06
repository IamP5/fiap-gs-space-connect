# Realistic Lunar 3D World — Research & Integration Guide

**Date:** 2026-06-06
**Scope:** Make the SwarmBuild worksite "as realistic as possible" — a Moon viewable from **orbit** and from the **surface**, plus realistic rovers, habitats, ships/landers, a launch platform/gantry, and construction props — without breaking the three things that make the renderer trustworthy.

## Executive summary

Everything the realism push needs already works on the **current pinned stack** (`@react-three/fiber` 8.18, `@react-three/drei` 9.122, `three` 0.169, React 18.3). There is **zero realism capability to gain by upgrading** to R3F v9 / React 19 — `drei` 10.0.0 is literally "9.122 + React 19 support" with no new components. We **stay on v8**. The plan: (1) amend ADR-0004 from "no hand-modelled art" to "no **unlicensed** art" while keeping three hard invariants (pure-function scene, mandatory primitive fallback, demand-loop perf budget); (2) add a snapshot-independent `<SpaceEnvironment>` (self-hosted HDR IBL + starfield + a decorative Moon with `<Detailed>` LOD); (3) raise the camera far plane and add an explicit orbit-vs-surface view mode; (4) close a real click-to-kill safety gap by raycast-suppressing loaded glTF children; (5) feed licensed assets through the **existing** `model_ref` / `material.map` seams. Best primary assets are CC0 Kenney/Quaternius kits and Poly Haven regolith for the surface, NASA public-domain models (crawler, mobile launcher, Apollo LM, rovers) for hero set-pieces, and the NASA SVS LROC color + LDEM (downscaled offline) for the orbital Moon.

## Locked licensing posture

| Status | Licenses |
|---|---|
| **SHIP** | CC0 1.0; NASA / US-gov public domain |
| **BREAK-GLASS** | CC-BY 4.0 — admissible only as a documented fallback, and **only in the same PR that adds an in-app credits affordance** (so attribution can't drift) |
| **REJECT** | CC-NC, CC-ND, GPL-for-art, "free for personal use only", unknown/unstated |

**Operative posture: CC0 + NASA-PD only for what ships.** Every realism goal has a CC0 or NASA-PD primary (see the asset tables), so the plan carries **zero attribution obligation** — `web/public/assets/CREDITS.md` is a **courtesy/provenance** record, not a legal requirement, and **no `/credits` in-app overlay is in scope**. NASA assets are PD: credit `NASA / <author>` as courtesy, **never imply NASA endorsement**, **never use the NASA insignia**.

CC-BY is kept documented below as break-glass only (e.g. Solar System Scope moon, Sketchfab rovers). If a CC-BY asset ever proves irreplaceable, the in-app credits affordance must land in the same PR — and note the NASA CGI Moon Kit on Sketchfab additionally carries a **NoAI** flag (accept consciously or skip).

---

## R3F stack reality check

**Verdict: STAY ON v8.** Ground truth from `node_modules`: `fiber@8.18.0` peerDeps `react '>=18 <19'` (hard ceiling), `drei@9.122.0` peerDeps `{fiber:'^8', react:'^18'}`, `postprocessing@2.19.1` peerDeps `{fiber:'^8.0', react:'^18.0'}`. Upgrading is a forced 3-package cascade (fiber 9 + drei 10 + postprocessing 3) + React 19 codemods + JSX-type rewrites + the v9 sRGB-auto-conversion removal — pure risk, no realism upside.

| API / technique | Works on v8.18 / drei 9.122 / three 0.169? | Notes for THIS repo |
|---|---|---|
| `useLoader(GLTFLoader)` / raw `GLTFLoader` | ✅ works-as-is | Repo's current SpecModel path; keep it |
| drei `useGLTF` + `.preload` / `.setDecoderPath` | ✅ works-as-is | **Suspense-based** — adopting it changes the deliberate "render fallback, swap on `.then()`" flow. Keep the manual loader; just add DRACO to it |
| drei `<Clone>` (SkeletonUtils-aware) | ✅ works-as-is | Safer than the repo's `clone(true)` for **rigged** models (remaps skeletons). Recommended swap |
| drei `<Gltf>` | ✅ works-as-is | Wraps `<Clone>` + Suspense; same restructuring caveat |
| `gltfjsx --transform` codegen | ✅ build-time | Output uses `useGLTF`; DRACO+meshopt+KTX2 decodable by drei 9.122 |
| DRACO + meshopt compression | ⚠️ needs-flag | DRACO default decoder is a **gstatic CDN fetch** — fails offline on the projector. **Vendor `/draco/`** and `setDecoderPath`/wire `DRACOLoader` |
| drei `<Merged>` / `mergeGeometries` | ✅ works-as-is | On 0.169 it's `mergeGeometries` (renamed from `mergeBufferGeometries` in r144). For the static gantry/crawler |
| drei `<Instances frames={1}>` / `<Instance>` | ✅ works-as-is | `frames={1}` avoids per-frame matrix re-upload under demand loop. Keep instanced decoratives non-pickable |
| drei `useTexture` (multi-map) | ✅ works-as-is | Does **NOT** auto-set `colorSpace` in 9.122 — set it yourself |
| Explicit `colorSpace` (SRGB color / NoColorSpace data) | ✅ correctness requirement | Repo already does this for the diffuse map (Scene3D.tsx:496). Extend for normal/rough/ao |
| `RepeatWrapping` + `repeat.set` + anisotropy | ✅ works-as-is | For tiling regolith ground; clone shared cached textures before mutating |
| drei `useKTX2` / GPU-compressed textures | ⚠️ needs-flag | Default basis transcoder is a CDN; **self-host `/basis/`**. Defer until an asset pipeline exists |
| drei `<Environment files=…>` (HDR/EXR IBL) | ✅ works-as-is | Use **self-hosted `files=`**, NOT `preset=` (CDN). Renders cubemap once → demand-safe |
| drei `<Stars>` | ✅ works-as-is | Twinkles via `useFrame` → would spin the loop. Use static config or hand-rolled `THREE.Points` |
| drei `<Detailed>` (THREE.LOD) | ✅ works-as-is | The orbit↔surface answer. LOD re-evaluates only on rendered frames → `invalidate()` after programmatic camera moves |
| drei `<CameraControls>` | ✅ works-as-is | Smoothed `setLookAt` for orbit↔surface fly; confirm it stops invalidating once settled |
| drei `<Bvh>` | ⚠️ needs separate install | `three-mesh-bvh` not bundled (use ~0.8.x). Low priority — hit-proxy design already minimizes raycast cost |
| drei `<PerformanceMonitor>` / `<AdaptiveDpr>` | ❌ design-incompatible | Assume a continuous loop; misfire under `frameloop="demand"`. **Keep the manual dpr cap [1,1.5]** |
| drei `<Sky>` | ❌ wrong planet | Renders a blue Preetham daytime sky. Use Stars/Environment |
| `@react-three/postprocessing` `<SelectiveBloom>` | ✅ works-as-is (pinned 2.19.1) | **Do NOT bump to v3** (fiber-9, reorders EffectComposer, breaks halo bloom) |
| `@react-three/rapier` | ❌ avoid | Breaks pure-snapshot + demand invariants; would force the v1 line. Skip |

---

## Recommended assets

Only **KEEP** and **CAUTION** verdicts are listed. Rejected items are noted under each table. Self-host **all** files in `web/public/assets/` — never rely on Sketchfab/Wikimedia/CDN URLs at runtime.

### Moon — orbital / full-sphere view

| Asset | Author | License | Attr? | Format / Size | Verdict | Source | Integration |
|---|---|---|---|---|---|---|---|
| NASA SVS CGI Moon Kit — LROC color 8k + LDEM displacement (16ppd) | NASA SVS (LROC/LOLA) | NASA-PD | Yes (courtesy) | 8k TIFF ~232 MB (4k ~59 MB); ldem_16 ~32-63 MB / ldem_4 ~2-4 MB | **KEEP** | svs.gsfc.nasa.gov/4720 | **Offline bake required.** Downscale color → 4k WebP/KTX2; convert LDEM → **normalMap**. Ship via `<OrbitalMoon>` (decor, not build_spec) |
| Solar System Scope — 8k Moon albedo | Solar System Scope (NASA-derived) | CC-BY 4.0 | Yes | 8k JPG ~14.3 MB | **CAUTION** | solarsystemscope.com/textures | Easiest drop-in diffuse via `material.map` on a sphere. 8k only via Wikimedia mirror (not the SSS page); self-host. Artistically color-tweaked |
| NASA SVS color 16k / float-EXR + ldem_64 | NASA SVS | NASA-PD | Yes (courtesy) | color 16k ~909 MB; ldem_64 ~0.5-1 GB | **KEEP** | svs.gsfc.nasa.gov/4720 | **Offline source tier only** — never load in-browser. Bake small derivatives |
| NASA CGI Moon Kit — ready glTF globe | Thomas Flynn (@nebulousflynn) | CC-BY 4.0 **+ NoAI** | Yes | glb, ~1M tris (heavy) | **CAUTION** | sketchfab.com/.../nasa-cgi-moon-kit-1c496b3b… | Turnkey but **decimate**; NoAI flag must be accepted; Sketchfab login to download |
| RenderX — "moon" glTF globe | RenderX | CC-BY 4.0 | Yes | glb, ~520k tris | **CAUTION** | sketchfab.com/.../moon-26cc0b7878bb… | Lighter CC-BY alternative; artist-made "based on mission data"; verify texture res post-download |

**Recommended combo:** SSS or LROC 4k color as diffuse + an SVS-LDEM-derived **normal map** (baked offline) on a `<Detailed>` sphere. The current `PrimitiveDesc` (buildspec.ts) carries only `map` (no normal/displacement) — bake into a `.glb` (clean fit, no schema change) **or** extend PrimitiveDesc. Moon is **decor → `<OrbitalMoon>` component, not a Task BuildOp**.
**Rejected:** Poly Haven "moon" assets (surface regolith/HDRI, not orbital spheres — see surface category).

### Moon — surface / regolith ground (tileable PBR)

| Asset | Author | License | Attr? | Format / Size | Verdict | Source | Integration |
|---|---|---|---|---|---|---|---|
| Poly Haven — **Moon 01** | Poly Haven (Zaal/Cilliers/van Heerden) | CC0 1.0 | No | jpg PBR set; 1k ~0.3-1.7 MB/map | **KEEP** | polyhaven.com/a/moon_01 | **Primary worksite floor.** Same seam as the shipped rock texture. Use 1k jpg (downscale to 512), prefer jpg `nor_gl` over exr |
| Poly Haven — Moon Track 02 (with tyre tracks) | Poly Haven | CC0 1.0 | No | jpg PBR set; 1k | **KEEP** | polyhaven.com/a/moon_track_02 | Great as a rover-path decal/secondary tile; jpg normals (no EXR dep) |
| Poly Haven — Moon Macro 01 (close-up) | Poly Haven | CC0 1.0 | No | jpg PBR set; 1k | **KEEP** | polyhaven.com/a/moon_macro_01 | Near-camera/detail tile for surface view; Moon 01 reads better at distance |
| ambientCG — Rock 030 (grey rock) | Lennart Demes / ambientCG | CC0 1.0 | No | zip jpg PBR; 1k ~9 MB | **CAUTION** | ambientcg.com/view?id=Rock030 | Generic stone, **not** lunar — secondary/outcrop fallback only; unzip + per-map extract |

Pack the AO+Rough+Metal `arm` jpg to cut three maps to one. The `material.map` seam wires **only** diffuse today; full PBR depth needs the SpecPrimitive extension (Slice 6). Displacement only helps a subdivided plane — prefer a normal map.
**Rejected:** ambientCG Ground037/030 (forest/grass), Poliigon (paywalled).

### Robots & rovers

| Asset | Author | License | Attr? | Format / Size | Verdict | Source | Integration |
|---|---|---|---|---|---|---|---|
| Quaternius — LowPoly Animated Robot (14 anims) | Quaternius | CC0 1.0 | No | glb ~6.6 MB zip | **KEEP** | quaternius.itch.io/lowpoly-robot (glb via poly.pizza/m/QCm7qe9uNJ) | **Best swarm bot.** Static placement = drop-in. Animation needs `AnimationMixer.update` in `useFrame` + `invalidate()` gated to active beats |
| Kenney — Space Kit (already vendored) | Kenney | CC0 1.0 | No | glb, ~10-30 KB each | **KEEP** | kenney.nl/assets/space-kit | Lowest-risk fallback-tier stand-ins; already proven through the seam |
| NASA — Robonaut 2 | NASA / JSC | NASA-PD | No (courtesy) | glb ~1.02 MB | **CAUTION** | science.nasa.gov/3d-resources/robonaut-2/ | Mid-fidelity humanoid, light. **Correct download:** `assets.science.nasa.gov/.../robonaut-2/Robonaut 2.glb` (the GitHub tree link is wrong) |
| Quaternius — Ultimate Space Kit (92 models) | Quaternius | CC0 1.0 | No | glTF, small each | **CAUTION** | quaternius.com/packs/ultimatespacekit.html | Inspect actual contents — "mechs/robots" claim unverified. Extract only what you need; copy sibling `.bin`/textures for `.gltf` |
| NASA — Perseverance Rover | NASA/JPL-Caltech | NASA-PD | No (courtesy) | glb 11.15 MB | **CAUTION** | science.nasa.gov/resource/mars-perseverance-rover-3d-model/ | **Hero rover only** (not swarm). Decimate/Draco before vendoring; if Draco, wire DRACOLoader |
| NASA — Curiosity Rover | NASA/JPL-Caltech | NASA-PD | No (courtesy) | glb 11.31 MB | **CAUTION** | science.nasa.gov/resource/curiosity-rover-3d-model/ | Interchangeable hero; **pick ONE** of Curiosity/Perseverance (~22 MB otherwise) |
| Sketchfab — "Moon Rover" by Danil Mishatkin | Danil Mishatkin (@mishdanil) | CC-BY 4.0 | Yes | glb, 141.6k tris | **CAUTION** | sketchfab.com/.../moon-rover-67764dac… | Mid-fidelity; Sketchfab login; CREDITS.md row; decimate before swarm-instancing |
| Sketchfab — "Lunokhod 1" by sheffrator | sheffrator | CC-BY 4.0 | Yes | glb, 264.6k tris | **CAUTION** | sketchfab.com/.../lunokhod-1-3f5a5f02… | Historical landmark, single decorative use; NASA-PD heroes are cheaper (no attribution) |

**Recommended composition:** Quaternius low-poly robot + Kenney extras for the **swarm** (CC0, cheap); Robonaut 2 (1 MB) as a mid-fidelity worksite bot; **one** NASA Curiosity/Perseverance as the hero rover.
**Rejected:** Sketchfab "Lunar Rover" by Versal/ferdur (909k tris — too heavy); TurboSquid/CGTrader (paid/unverified).

### Bases / habitats / domes

| Asset | Author | License | Attr? | Format / Size | Verdict | Source | Integration |
|---|---|---|---|---|---|---|---|
| Quaternius Ultimate Space Kit — Geodesic Dome | Quaternius | CC0 1.0 | No | glb <100 KB | **KEEP** | poly.pizza/bundle/Ultimate-Space-Kit-YWh743lqGX | Best `dome` build-op match; per-model glb via poly.pizza |
| Kenney — Space Station Kit (90 modular pieces) | Kenney | CC0 1.0 | No | zip ~1.8 MB; glb 10-40 KB each | **KEEP** | kenney.nl/assets/space-station-kit | Matches shipped art; modules/connectors/cupola → wall/foundation/module/dome ops. **Verify `Models/GLTF format/` glb exist in zip** |
| Quaternius — Base Large / House Cylinder / House Pod | Quaternius | CC0 1.0 | No | glb ~20-80 KB | **KEEP** | poly.pizza/bundle/Ultimate-Space-Kit-YWh743lqGX | Companion foundation/module pieces, cohesive style |
| Kenney — Space Kit (original 150-asset, vendored) | Kenney | CC0 1.0 | No | glb ~10-30 KB | **KEEP** | kenney.nl/assets/space-kit | Extra hangar/structure pieces; provenance already in CREDITS.md |
| NASA — ISS (B) | NASA / M. Carbajal | NASA-PD | No (courtesy) | glb 465.81 KB | **CAUTION** | science.nasa.gov/3d-resources/international-space-station-iss-b/ | Small orbital prop, loads as-is. Loose category fit (ISS, not lunar) |
| NASA — Gateway Lunar Space Station (Core) | NASA / JSC Gateway | NASA-PD | No (courtesy) | glb **63.15 MB** | **CAUTION** | science.nasa.gov/3d-resources/gateway-lunar-space-station/ | **Must compress** (<5 MB) via gltfpack/Draco → then requires wiring DRACOLoader/MeshoptDecoder (NOT a drop-in). Orbital hero only |

**Rejected:** NASA high-res ISS (C) (Lightwave-only, not glTF); unfiltered Sketchfab habitats (license unconfirmed). Use CC0 Kenney/Quaternius for surface swarm-built structures; reserve NASA Gateway/ISS for the orbital view.

### Ships, landers, rockets + launch platform / gantry / crawler

| Asset | Author | License | Attr? | Format / Size | Verdict | Source | Integration |
|---|---|---|---|---|---|---|---|
| NASA — Crawler-Transporter | NASA / M. Carbajal | NASA-PD | No (courtesy) | glb 1.55 MB | **KEEP** | science.nasa.gov/3d-resources/crawler/ | **THE requested crawler.** Static set-piece; scale tuning needed |
| NASA — Mobile Launcher (assembled + pad-only) | NASA / S. Neblett | NASA-PD | No (courtesy) | assembled glb 193.83 KB; pad 145.91 KB | **KEEP** | science.nasa.gov/3d-resources/mobile-launcher/ | **The requested gantry/tower.** Tiny, demand-loop friendly; pair with a rocket |
| NASA — Apollo Lunar Module (LEM) | NASA / M. Carbajal | NASA-PD | No (courtesy) | glb 700.04 KB | **KEEP** | science.nasa.gov/3d-resources/apollo-lunar-module/ | Best real lander; landed set-piece near the swarm |
| Kenney — Space Kit 2.0 (rockets/pads) | Kenney | CC0 1.0 | No | glb tens of KB each | **CAUTION** | kenney.nl/assets/space-kit | Stylized rockets + structures. **Verify exact filenames** (no confirmed discrete `launchPad.glb`) |
| Quaternius — Ultimate Space Kit (ships) | Quaternius | CC0 1.0 | No | glb tens of KB | **CAUTION** | quaternius.com/packs/ultimatespacekit.html | **Poor fit** — pack is characters/mechs/planets, not ships. Prefer Quaternius "Ultimate Spaceships Pack" (10 ships, CC0) |
| NASA — SLS Block 1 rocket | NASA / Marshall SFC | NASA-PD | No (courtesy) | **STL** 13.09 MB (no glb) | **CAUTION** | science.nasa.gov/3d-resources/space-launch-system-sls-block-1/ | **STL-only** → Blender decimate + glTF export required; no PBR materials. Only if a real modern rocket is essential |

NASA crawler + mobile launcher are the direct answer to "ship launching platform / gantry / crawler". Large NASA set-pieces are best as **static components** in Scene3D (still through `model_ref` with a fallback); swarm-assembled launch infra (Kenney rocket + pad) fits the op-by-op fold log.
**Rejected:** Sketchfab "Lunar Module (LEM)" by Grotex (Royalty-Free/paid); TurboSquid/CGTrader/STLFinder (paid/unknown); NASA Orion (STL-only, excluded).

### Construction materials & props

| Asset | Author | License | Attr? | Format / Size | Verdict | Source | Integration |
|---|---|---|---|---|---|---|---|
| Kenney — Space Kit (150 models: solar/antenna/dish/pipe) | Kenney | CC0 1.0 | No | glb sub-MB each | **KEEP** | kenney.nl/assets/space-kit | **Best staged props.** Matches recent panel+mast task types; vendored source |
| Kenney — Space Station Kit (90 industrial parts) | Kenney | CC0 1.0 | No | glb sub-MB | **KEEP** | kenney.nl/assets/space-station-kit | Corridors/junctions/struts for multi-step build sequences |
| Quaternius — Modular Sci-Fi MegaKit (270+) | Quaternius | CC0 1.0 | No | glb <1 MB each (atlas) | **KEEP** | quaternius.com/packs/modularscifimegakit.html | Largest CC0 prop source; verify per-file poly counts before bulk-add |
| Quaternius — Sci-Fi Essentials Kit (60+) | Quaternius | CC0 1.0 | No | small glb | **KEEP** | quaternius.com/packs/scifiessentialskit.html | Crates/containers for "material delivered" staging |
| ambientCG — Solar Panel 002 (PBR) | Lennart Demes / ambientCG | CC0 1.0 | No | zip jpg; 2k few MB | **KEEP** | ambientcg.com/view?id=SolarPanel002 | **Best solar-array skin** — tiles onto a box far cheaper than a glb. `material.map`; resize to 512-1k |
| ambientCG — Metal Plates 006 (PBR) | Lennart Demes / ambientCG | CC0 1.0 | No | zip jpg; 2k ~12 MB | **KEEP** | ambientcg.com/view?id=MetalPlates006 | Metal skin for beams/decking/crates; add metalness/roughness in BuildOp |
| Poly Haven — Barrel 02 | Jorge Camacho / Poly Haven | CC0 1.0 | No | glTF 3k tris; 18.75 MB@4k | **KEEP** | polyhaven.com/a/Barrel_02 | Hero "material delivered" prop; **downscale textures to 1k**, few placements only |
| Poly Haven — Wooden Crate 02 / Cardboard Box 01 | J. Ray Cock / J. Burger (crate); PH (box) | CC0 1.0 | No | crate 5k tris / box 17k tris; ~40-50 MB@4k | **CAUTION** | polyhaven.com/a/wooden_crate_02 · /a/cardboard_box_01 | Prefer the **5k-tri crate** for repeats; box is one-off. Use per-asset `/a/` URLs (the `/models/props/containers` link is stale) |

ambientCG `/get?file=…zip` works via a clean 302 redirect (a plain GET is fine — the "token/cookie" caveat is overstated). The `material.map` seam wires diffuse only; normal/roughness/metalness need the SpecPrimitive extension (Slice 6).
**Rejected:** non-CC0 marketplace props.

---

## NASA 3D Resources — primary catalog source & viewer patterns

Deep-dive (2026-06-06) into `github.com/nasa/NASA-3D-Resources` and the
`ArtechFuz3D/NASA-3D-Model-Viewer` reference viewer.

### `nasa/NASA-3D-Resources` — fetch mechanics

- **Branch is `master`** (not `main`). **No git-LFS.** ~5.3 GB whole repo — never clone it.
- It already ships **257 ready `.glb` files** (~609 MB; most <3 MB). The `.stl/.blend/.3ds/.lwo/.fbx`
  files are mostly redundant alternate exports of models that already have a `.glb` sibling, so
  **format conversion is rarely needed** — the real work is Draco/decimate on the few big ones.
- **Fetch a single asset** (verified 200, `octet-stream`):
  `https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/<URL-encoded path>`
  (spaces and `()` must be encoded). `curl` the specific `.glb` into `web/public/assets/`.
- **License:** no `LICENSE` file; `meta.json` names NOSA 1.3 (a *software* license). Per the NASA
  media guidelines the **assets are PD** (fits our posture). **Caveats:** strip any NASA
  **insignia** decal (not PD), never imply endorsement, and **per-asset PD spot-check** the
  `science.nasa.gov/3d-resources/<slug>/` page (occasional third-party content).

### NASA picks per goal (all already `.glb` on `master`)

| Goal | Pick | Path (under `3D Models/`) | Size |
|---|---|---|---|
| **#54 rover** | **RASSOR** (lunar regolith/construction robot — most on-theme) | `Regolith Advanced Surface Systems Operations Robot (RASSOR)/…glb` | 6.3 MB |
| #54 rover (alt) | Perseverance / Curiosity / Robonaut 2 | `Mars 2020 Perseverance Rover/…`, `Robonaut 2/Robonaut 2.glb` | 5.0 / 1.1 MB |
| **#55 habitat** | **Habitat Demonstration Unit** (parts 1+2) | `Habitat Demonstration Unit/…(part 1).glb`,`(part 2).glb` | 0.5 / 0.7 MB |
| #55 habitat | Radome (dome), Base Station, ESAS Crew Module | `Radome/Radome.glb`, … | 0.8 / 0.02 / 0.01 MB |
| **#56 launch (Scenery)** | **Mobile Launcher** + **Crawler** + **Gantry** | `Mobile Launcher/…(assembled).glb`, `Crawler/Crawler.glb`, `Gantry/Gantry.glb` | 0.2 / 1.6 / 1.4 MB |
| #56 lander | Apollo LM / InSight (panels deployed) / Viking | `Apollo Lunar Module/…`, `InSight Cruise Lander/…` | 0.7 / 4.0 / 1.9 MB |
| **#57 props** | Tall Dish (separable parts), 70-meter Dish, Solar Sail, Tether | `Tall Dish/…`, `70-meter Dish/…` | ~1.7 / 2.2 / 0.2 / 0.5 MB |
| **#51 sky bodies** | Moon + Earth **textures** (not models) | `Images and Textures/Moon/Moon.jpg`, `Earth (A)/Earth (A).jpg` | 3.0 / 1.4 MB |

NASA Moon/Earth `.jpg` textures are a simpler alternative to the SVS LROC/LDEM bake for #51 — use
the `.jpg` (skip the 11–50 MB `.tif`). Catalog mapping (#59): one folder ≈ one Asset; slugify the
folder name → `key`; treat each `.glb` variant as a **distinct** key; author `task_types` by hand.

### Viewer patterns (`NASA-3D-Model-Viewer`) — borrow vs avoid

The viewer is **vanilla Three.js + Vite (three 0.183), not R3F**, and unlicensed/branded — *look,
don't copy*. It confirms our raw-loader + cache + clone + **primitive-fallback** `SpecModel` is the
right shape (and strictly better than theirs: they have no cache, no fallback, CDN Draco, and a
continuous rAF loop). Net takeaways:

- **BORROW — a `fitToView` normalize helper:** `Box3` → scale largest dim to a unit size, then
  `position.sub(center * scale)` to recenter on origin. Solves NASA models' arbitrary units +
  off-origin pivots in ~6 lines. Run it in our raw-loader `onLoad`, then **`invalidate()`** (demand loop).
- **THE GAP WE MUST CLOSE:** NASA assets also have **wrong up-axis and missing normals** for any
  non-glTF source — the viewer just tolerates sideways/flat shading because its hologram shader
  hides it. A realistic worksite cannot. **Bake up-axis fix + `computeVertexNormals()` + recenter +
  fit-to-unit at conversion time** (extends #52), and **carry a per-Asset normalization transform
  `{scale, offset, rotation}` in the catalog entry** (#59) so the placement fits its Build envelope.
- **AVOID:** their CDN Draco (`gstatic`) → self-host `/draco/`; their raw `RGBELoader` env (no PMREM)
  → use drei `<Environment>`; their continuous rAF loop → stay on `frameloop="demand"` + `invalidate()`;
  their runtime GitHub-API model enumeration from `raw.githubusercontent.com` → the **inverse** of our
  closed, self-hosted Asset catalog (ADR-0010) — keep only the *shape* (a typed curated array).

## Integration architecture

All references are to real files: `web/src/components/Scene3D.tsx`, `web/src/lib/buildspec.ts`, `web/src/lib/scene.ts`, `web/public/assets/`.

### `<SpaceEnvironment>` — new snapshot-independent decoration

**File:** `web/src/components/SpaceEnvironment.tsx`, rendered inside `<Canvas>` in SceneContents, **before** the snapshot guard (so it shows when snapshot is null) and **outside** the snapshot-derived `<group>`. It takes **no** snapshot-derived props and never reads `map`/rovers/tasks.

**Why this respects the pure-function rule:** the invariant is that every mesh representing *world state* derives from the snapshot via `lib/scene.ts`. A starfield, an HDRI backdrop, and a decorative Moon carry **no authoritative meaning** — they're the same category as the existing `LunarTerrain()` and the ambient/hemisphere/directional light rig, which are already static, unconditional decoration. `<SpaceEnvironment>` is the backdrop/IBL equivalent.

Contents:
1. **Starfield** — prefer a hand-rolled `THREE.Points` (positions in a `useMemo`, no `useFrame`) over drei `<Stars>`, because `<Stars>` twinkles via `useFrame` and would pin the demand loop. If `<Stars>` is used, static config + no `invalidate()`.
2. **`<Environment files="/assets/hdr/space_2k.hdr">`** (self-hosted, **not** `preset=`). Double duty: skybox background **and** PBR image-based lighting for the realistic glTFs (biggest realism win on metal surfaces). Renders the cubemap **once** → static → demand-safe. Replace the current `<color attach="background" args={["#000000"]}>` with the Environment background, keeping black as graceful-degradation fallback if the HDR fails. Keep the 3-light rig — the directional light still drives SelectiveBloom (`HaloBloom` reads `lightRef`).
3. **Two sky bodies, one per view mode** (below): the **Moon globe** for orbit view, **Earth** for surface view.

**Demand-loop rule:** the component renders only on `invalidate()` (mount, HDR load complete, orbit interaction). The HDR onLoad path calls `invalidate()` once — exactly like SpecPrimitive's texture onLoad does today.

### Sky bodies — Moon globe (orbit) + Earth (surface)

**The worksite is ON the Moon, so the Moon is never in the surface sky.** Two distinct bodies, swapped with the view mode (#49), both NASA-PD:

**Moon globe — orbit view only.** The body the worksite sits on, seen from space as an establishing shot. A decorative sphere at a fixed far position, **not** snapshot-driven, with drei `<Detailed distances={[…]}>` (THREE.LOD) sized for **orbit zoom distances** (not "shrinks to a dot at the surface"):
- **L0 (orbit close):** `SphereGeometry(R, 128, 64)` + color map (`SRGBColorSpace`) + **normal map** (`NoColorSpace`, crater relief) + roughness map. NASA-PD LROC color + SVS-LDEM-derived normal.
- **L1 (orbit mid/pull-back):** `SphereGeometry(R, 64, 32)` + color + normal.
- The Moon is **hidden in surface mode** (you're standing on it).

**Earth — surface view only.** A small body hanging in the black surface sky (the Apollo *Earthrise* read). A low-segment sphere + NASA *Blue Marble* color map (PD), no LOD needed, no normal map required. Fixed position in the surface-sky direction; hidden in orbit mode.

**Starfield** (from `<SpaceEnvironment>`) shows in **both** views.

**Use a NORMAL MAP for craters, never `displacementMap`** (heavy tessellation fights the projector budget). Optionally bake a low-frequency displacement into the Moon L0 geometry once at `useMemo` time (like `LunarTerrain`'s sine displacement) for a silhouette bump — default is normal-map-only.

**Caveat:** THREE.LOD re-evaluates only on a rendered frame. The **programmatic** orbit↔surface toggle MUST call `invalidate()` after moving the camera (and after swapping which body is visible) or the LOD level / visibility sticks.

### Camera changes

- **Far plane:** raise from **200 → ~5000-8000** (Scene3D.tsx:1090) so the parked Moon is in-frustum from the orbital pull-back. Keep `near=0.1`. If z-fighting appears on the distant Moon, enable `logarithmicDepthBuffer` on the Canvas `gl` prop — but **ship without it first** (small fixed perf cost; can interact with postprocessing depth — re-verify SelectiveBloom).
- **Orbit-vs-surface view mode:** add an explicit mode toggle, not just a wider zoom range. Surface view wants camera low + target on the worksite; orbit view wants camera far + target on the **Moon** — one set of clamps can't serve both, and ADR-0004 mandates a fixed default orbit angle for stage safety. Keep the current clamped worksite OrbitControls (`minDistance` 10, `maxDistance` **34**, current polar clamps — Scene3D.tsx:1119) as the default surface mode; add a separate orbit preset. Implement by swapping OrbitControls clamps/target, **or** (cleaner) adopt drei `<CameraControls>` and `setLookAt()` to fly between framings — confirm it returns to 0 fps once settled. A dashboard `<button>` toggles mode; the handler calls `invalidate()` after the move (for `<Detailed>`). **Do NOT** raise the worksite-mode `maxDistance` to reach the Moon — keep both framings distinct and clamped.

### Raycast click-to-kill fix (MUST-FIX safety gap)

**Problem:** the code disables raycast on every primitive child via `raycast={() => null}` (Scene3D.tsx:271, 280, 297, …), leaving only the invisible hit-proxy sphere (`geo.hit`) pickable per rover — that's what makes click-to-kill deterministic. But a glTF placed via `<primitive object={scene}>` in SpecModel brings its **own** child meshes, none carrying `raycast={() => null}`, so they would steal selection or block the empty-space deselect (`onPointerMissed`).

**Fix — single chokepoint in SpecModel's `loadGLTF().then()`** (around Scene3D.tsx:569-575, where `clone(true)` lives): suppress raycast on the **cached source once** so every clone inherits it (cheaper than per-placement, and safe because suppression is global to the asset):

```ts
// after the GLTF loads, before caching the source scene:
source.traverse((o) => { (o as THREE.Mesh).raycast = () => null; });
// then clones inherit non-pickability:
setScene(source.clone(true)); // or drei <Clone object={source} />
```

The hit-proxy sphere stays the sole pickable surface per rover; deterministic click-to-kill is preserved exactly. The same rule applies if rovers themselves become glTF (keep the `geo.hit` proxy sized generously around the model). If adopting drei `<Clone>` for rigged models, suppress on the source before cloning. Add an assertion that only hit-proxies are pickable.

### Perf budget

Protect the two already-correct techniques first: `frameloop="demand"` + disciplined `invalidate()`, and shared-geometry reuse/dispose (`makeSceneGeo`/`disposeSceneGeo`). Keep `dpr` at **[1, 1.5]**. **Do NOT add PerformanceMonitor/AdaptiveDpr** (design-incompatible with the demand loop).

1. **Instancing:** drei `<Instances frames={1}>` for repeated props/rocks; `<Merged>`/`mergeGeometries` (on 0.169) for the static gantry/crawler → one draw call. Instanced decoratives stay **non-pickable** (same raycast rule). Instances can't each be a different glb — keep SpecModel clones for hero models.
2. **LOD:** `<Detailed>` on the Moon (and optionally hero structures).
3. **Compression:** DRACO+meshopt (`gltfjsx --transform` / `gltfpack`). **Vendor `/draco/`** and configure on the **existing** module-level loader: `gltfLoader.setDRACOLoader(new DRACOLoader().setDecoderPath('/draco/'))`. Keep the non-Suspense load-then-swap + box fallback — do NOT switch to `useGLTF`/Suspense.
4. **Textures:** extend SpecPrimitive to a PBR set (normal + roughness, optionally ao) with explicit `colorSpace` (map=SRGB; normal/rough/ao=NoColorSpace). Skip displacement. Tiling regolith ground: one texture set with `RepeatWrapping` + `repeat.set` + `anisotropy=getMaxAnisotropy()`, cloning if shared. Defer KTX2 (self-host `/basis/` when adopted).
5. **HDR Environment** renders once → demand-safe; keep the `.hdr` small (2k).
6. Every animated/decorative element `invalidate()`s only during interaction/active beats and returns to 0 fps — verify idle is zero fps after each slice.
7. Keep `@react-three/postprocessing` at **^2.19.1** (no v3). Skip `@react-three/rapier`. No R3F v9 / React 19.

---

## ADR-0004 amendment

**Before** (Decision bullet):

> Ship react-three-fiber 3D, scope-guarded hard: one CC0 rover glTF + primitive geometry, a fixed default orbit-camera angle, bloom only on status halos, no custom physics, no hand-modelled art.

**After** — replace the trailing `"no custom physics, no hand-modelled art"` with:

> no custom physics, and **NO UNLICENSED ART** — licensed glTF models and PBR/HDR textures (CC0, CC-BY 4.0 with attribution, or NASA/US-gov public-domain) **ARE** admissible, provided three invariants hold: **(1)** the scene remains a **PURE FUNCTION OF THE SNAPSHOT** — every mesh that represents world state derives from the authoritative snapshot via `lib/scene.ts`; decorative, snapshot-independent elements (terrain, lighting, the SpaceEnvironment moon/stars/backdrop) are permitted because they encode no world state; **(2)** every glTF/texture has a **MANDATORY PRIMITIVE FALLBACK** so a missing/slow/failed asset never breaks the render (the SpecModel box fallback and SpecPrimitive flat-color fallback); **(3)** the **DEMAND-LOOP PERF BUDGET** is preserved — `frameloop="demand"` stays at zero idle fps, dpr capped at 1.5, draw calls bounded via instancing/LOD, and any animated/decorative element `invalidate()`s only during active beats or interaction.

**Also:** update the HARD SCOPE GUARD comment block at the top of Scene3D.tsx (~lines 26-34): replace "Rover is PRIMITIVE geometry … no glTF was available" with the new posture, and "No custom physics, no hand-modelled art" with "No custom physics; only LICENSED art (CC0/CC-BY/NASA-PD), each with a mandatory primitive fallback." `web/public/assets/CREDITS.md` already anticipates this ("ADR-0004 forbids unlicensed art") — it stays consistent; broaden it to mention CC-BY/NASA-PD as CC-BY/NASA assets land. Keep the Consequences click-to-kill hardening note (reinforced by the glTF raycast-suppression fix).

---

## Implementation slices

Ordered, each independently shippable.

- **Slice 0 — ADR + scope-guard (docs only).** Amend ADR-0004, update Scene3D header comment + CREDITS.md. No runtime change; unblocks everything.
- **Slice 1 — glTF raycast-suppression MUST-FIX.** Suppress raycast on the cached glTF source in SpecModel/loadGLTF; add an assertion that only hit-proxies are pickable. Hardens click-to-kill **before** new models land. Pure safety fix.
- **Slice 2 — Camera far plane + view modes.** Raise far 200→~8000; add the orbit-vs-surface toggle (swap OrbitControls clamps/target, or adopt `<CameraControls>` + `setLookAt`), each clamped per ADR-0004; toggle calls `invalidate()`; verify idle returns to 0 fps.
- **Slice 3 — `<SpaceEnvironment>` backdrop.** New static component (hand-rolled `THREE.Points` starfield + self-hosted `<Environment files=.hdr>` for skybox + IBL), mounted unconditionally, snapshot-independent, `invalidate()` once on HDR load. Big realism jump (PBR reflections), zero world-state coupling.
- **Slice 4 — Moon with `<Detailed>` LOD.** Decorative Moon (3 sphere levels, color+normal+roughness, NO displacement, NASA-PD textures) at a fixed far position; tune distances for orbit(L0/L1) vs surface(L2); `invalidate()` on programmatic camera moves. Delivers the orbit-AND-surface Moon goal.
- **Slice 5 — DRACO/meshopt pipeline + vendored decoder.** Compress glb assets, vendor `/draco/`, wire DRACOLoader onto the existing loader (keep non-Suspense fallback). Enables larger realistic hero models offline. Testable against existing Kenney assets.
- **Slice 6 — PBR SpecPrimitive + tiling regolith ground.** Extend SpecPrimitive to normal/roughness(/ao) with explicit colorSpace; retexture LunarTerrain with a tileable PBR regolith set (RepeatWrapping/anisotropy). Fallback preserved.
- **Slice 7 — Realistic hero models via the buildspec seam (ModelDesc).** Swap licensed rover/base/habitat/lander/gantry `model_ref`s through buildspec.ts (data-only; each carries its primitive fallback). No Scene3D change beyond Slice 1. Ship category-by-category (rovers → bases → ships/gantry → props).
- **Slice 8 — Instancing/merging for repeated props + launch gantry.** `<Instances frames={1}>` for repeated props/rocks, `<Merged>`/`mergeGeometries` for the static gantry/crawler; keep instanced decoratives non-pickable. Draw-call protection; last because it optimizes Slice 7 assets.

---

## R3F techniques cheat-sheet (v8-annotated)

```ts
// glTF loading — KEEP the manual non-Suspense loader + box fallback (Scene3D SpecModel).
// Add DRACO to the EXISTING loader; vendor the decoder for offline projector use.
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
gltfLoader.setDRACOLoader(new DRACOLoader().setDecoderPath('/draco/')); // self-hosted, no CDN
// after load, suppress raycast on the cached source (click-to-kill fix), then clone per placement:
source.traverse((o) => { (o as THREE.Mesh).raycast = () => null; });
setScene(source.clone(true)); // or drei <Clone object={source} /> for RIGGED models (skeleton-safe)
```

```ts
// Textures — colorSpace is a CORRECTNESS requirement on three 0.169 (drei useTexture does NOT auto-set it)
map.colorSpace        = THREE.SRGBColorSpace;   // color / emissive
normalMap.colorSpace  = THREE.NoColorSpace;     // data maps
roughnessMap.colorSpace = THREE.NoColorSpace;
// Tiling regolith ground (clone if the texture is shared/cached before mutating):
tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
tex.repeat.set(40, 40);
tex.anisotropy = gl.capabilities.getMaxAnisotropy();
// frameloop="demand": call invalidate() once when the texture/HDR arrives, or it won't appear.
```

```tsx
// LOD — the orbit↔surface answer (drei <Detailed> = THREE.LOD). NORMAL map, not displacement.
<Detailed distances={[0, 60, 400]}>
  <mesh geometry={moonHi} material={moonPBR} />   {/* L0 near/orbit: color+normal+rough */}
  <mesh geometry={moonMid} material={moonLit} />  {/* L1 mid: color+normal */}
  <mesh geometry={moonLo} material={moonFlat} />  {/* L2 far/surface: color only */}
</Detailed>
// invalidate() AFTER any programmatic camera move or the level sticks under frameloop="demand".
```

```tsx
// Instancing — repeated props/rocks. frames={1} avoids per-frame matrix re-upload under demand loop.
<Instances limit={rocks.length} frames={1} geometry={geo.rock} material={rockMat}>
  {rocks.map((r) => <Instance key={r.id} position={r.pos} rotation={r.rot} scale={r.s} />)}
</Instances>
// keep instanced decoratives non-pickable (raycast suppressed) — preserves the hit-proxy design.
```

```tsx
// Environment + Stars — self-hosted HDR (NOT preset=, which fetches a CDN). Static cubemap = demand-safe.
<Environment files="/assets/hdr/space_2k.hdr" background environmentIntensity={0.4} />
// Prefer a hand-rolled THREE.Points starfield (no useFrame) over <Stars> to guarantee zero idle frames.
```

---

## Sources

- https://r3f.docs.pmnd.rs/tutorials/loading-models
- https://r3f.docs.pmnd.rs/tutorials/loading-textures
- https://r3f.docs.pmnd.rs/getting-started/community-r3f-components
- https://r3f.docs.pmnd.rs/advanced/scaling-performance
- https://r3f.docs.pmnd.rs/advanced/pitfalls
- https://r3f.docs.pmnd.rs/tutorials/v9-migration-guide
- https://github.com/pmndrs/drei
- https://drei.docs.pmnd.rs/loaders/gltf-use-gltf
- https://drei.docs.pmnd.rs/loaders/texture-use-texture
- https://drei.docs.pmnd.rs/loaders/ktx2-use-ktx2
- https://drei.docs.pmnd.rs/abstractions/clone
- https://drei.docs.pmnd.rs/performances/merged
- https://drei.docs.pmnd.rs/performances/instances
- https://drei.docs.pmnd.rs/performances/detailed
- https://drei.docs.pmnd.rs/performances/performance-monitor
- https://drei.docs.pmnd.rs/performances/bvh
- https://drei.docs.pmnd.rs/staging/environment
- https://drei.docs.pmnd.rs/staging/stars
- https://drei.docs.pmnd.rs/staging/lightformer
- https://drei.docs.pmnd.rs/controls/camera-controls
- https://raw.githubusercontent.com/pmndrs/drei/v9.122.0/src/core/Gltf.tsx
- https://raw.githubusercontent.com/pmndrs/drei/v9.122.0/src/core/Clone.tsx
- https://github.com/pmndrs/drei/releases (v10.0.0 — "BREAKING CHANGE: React 19 support")
- https://github.com/pmndrs/drei/issues/1739 (PerformanceMonitor onFallback misfire)
- https://github.com/pmndrs/react-postprocessing
- https://react-postprocessing.docs.pmnd.rs/selection
- https://www.npmjs.com/package/@react-three/rapier
- https://www.npmjs.com/package/@react-three/drei
- https://discourse.threejs.org/t/updates-to-color-management-in-three-js-r152/50791
- https://threejs.org/docs/#api/en/textures/Texture.colorSpace
- https://threejs.org/docs/pages/KTX2Loader.html
- https://github.com/pmndrs/react-three-fiber/issues/3386
- https://github.com/mrdoob/three.js/issues/27760
- https://github.com/gkjohnson/three-mesh-bvh/blob/master/CHANGELOG.md
- https://svs.gsfc.nasa.gov/4720
- https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_16bit_srgb_8k.tif
- https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_16bit_srgb_16k.tif
- https://www.solarsystemscope.com/textures/
- https://upload.wikimedia.org/wikipedia/commons/d/d1/Solarsystemscope_texture_8k_moon.jpg
- https://sketchfab.com/3d-models/nasa-cgi-moon-kit-1c496b3b57304526b5b9d1cf9c1087fc
- https://sketchfab.com/3d-models/moon-26cc0b7878bb4d919b68e2be399db466
- https://polyhaven.com/a/moon_01
- https://polyhaven.com/a/moon_track_02
- https://polyhaven.com/a/moon_macro_01
- https://polyhaven.com/a/Barrel_02
- https://polyhaven.com/a/wooden_crate_02
- https://polyhaven.com/a/cardboard_box_01
- https://polyhaven.com/license
- https://ambientcg.com/view?id=Rock030
- https://ambientcg.com/view?id=SolarPanel002
- https://ambientcg.com/view?id=MetalPlates006
- https://quaternius.itch.io/lowpoly-robot
- https://poly.pizza/m/QCm7qe9uNJ
- https://quaternius.com/packs/ultimatespacekit.html
- https://quaternius.com/packs/modularscifimegakit.html
- https://quaternius.com/packs/scifiessentialskit.html
- https://poly.pizza/bundle/Ultimate-Space-Kit-YWh743lqGX
- https://kenney.nl/assets/space-kit
- https://kenney.nl/assets/space-station-kit
- https://science.nasa.gov/3d-resources/robonaut-2/
- https://science.nasa.gov/resource/mars-perseverance-rover-3d-model/
- https://science.nasa.gov/resource/curiosity-rover-3d-model/
- https://sketchfab.com/3d-models/moon-rover-67764dac0c2a4597be079092e8b5dd73
- https://sketchfab.com/3d-models/lunokhod-1-3f5a5f02ad53447b9dff335e42d2469c
- https://science.nasa.gov/3d-resources/gateway-lunar-space-station/
- https://science.nasa.gov/3d-resources/international-space-station-iss-b/
- https://science.nasa.gov/3d-resources/crawler/
- https://science.nasa.gov/3d-resources/mobile-launcher/
- https://science.nasa.gov/3d-resources/apollo-lunar-module/
- https://science.nasa.gov/3d-resources/space-launch-system-sls-block-1/
- https://www.nasa.gov/nasa-brand-center/images-and-media
- https://github.com/nasa/NASA-3D-Resources
- /Users/tuba/Dev/projects/gs-fiap-space/web/src/components/Scene3D.tsx
- /Users/tuba/Dev/projects/gs-fiap-space/web/src/lib/buildspec.ts
- /Users/tuba/Dev/projects/gs-fiap-space/web/public/assets/CREDITS.md
