# Space-View Realism — NASA SVS Reference Study

**Date:** 2026-06-06
**Scope:** Make the **orbit / space view** of the lunar scene read as photoreal by
studying three NASA Scientific Visualization Studio (SVS) productions and
distilling a concrete, demand-loop-safe recipe for our locked R3F v8 stack. Covers
Moon material, Earth+Moon illumination (earthshine), the orbit→surface descent
choreography, star/Milky-Way background, and a nebula/supernova "hero" element.
Follow-on to [`realistic-3d-world-assets.md`](./realistic-3d-world-assets.md);
same invariants and licensing posture apply.

## NASA references studied

| SVS | What it is | What we mined it for |
|-----|-----------|----------------------|
| [4720](https://svs.gsfc.nasa.gov/4720/) | **CGI Moon Kit** (Ernie Wright / Noah Petro) — LROC WAC color mosaic + LRO LOLA elevation, the canonical NASA Moon-rendering source | Moon albedo/relief, terminator, matte regolith, white-sun lighting |
| [14992](https://svs.gsfc.nasa.gov/14992/) | "Lunar Near & Far Side Phases" (Artemis II tie-in) — Moon hero + small Earth + rich Milky-Way background | Earthshine, Earth material, "space detail" background, color-temperature contrast |
| [4444](https://svs.gsfc.nasa.gov/4444/) | "Rima Prinz / Vera" flythrough — one continuous zoom from full globe to a low oblique surface close-up | Orbit→surface **descent choreography** for our transition |
| [14959](https://svs.gsfc.nasa.gov/14959/) | "Moon 3D Models for Web/AR/Animation" — GLB/USDZ globes (Flat / Grid / Topo) built on the *same* 4720 color map | Art-direction **reference** for relief strength + side-lighting (not a new texture) |
| [4851](https://svs.gsfc.nasa.gov/4851/) | **Deep Star Maps 2020** (Gaia DR2 + Hipparcos/Tycho) — all-sky equirectangular with Milky-Way band | The space/star **background** texture |
| [3D Resources](https://science.nasa.gov/3d-resources/) | NASA 3D model catalog (mirror: `github.com/nasa/NASA-3D-Resources`) — many re-exported to GLB in 2025 | **Hero set-piece models** (rover, lander, crawler, gantry, habitat) — see §7 |

## Executive summary

Three findings dominate. **(1) Our scene is currently over-lit and
over-saturated-blue** relative to NASA — the single biggest free win is a *lighting
re-grade*: dim + cool + desaturate the earthshine, darken the shadows, push the
void to near-black, keep the sun hard and white. NASA earthshine is a *whisper*,
not a glow. **(2) Real NASA data-driven textures** (CGI Moon Kit color map, Deep
Star Map 2020 with the Milky Way band, Blue Marble Earth) are all license-clean and
are the biggest asset upgrade available. **(3) The descent's cinematic punch is a
pitch ramp** — the camera rotates from looking straight *down* (nadir) to a low
oblique so the horizon rises into frame only at the very end, with slow-fast-*slow*
easing that decelerates hard into the landing. Everything below stays inside the v8
lock, the `frameloop="demand"` 0-idle-fps budget, the pick/click-to-kill invariant,
ADR-0004 fallbacks, and the admissible-license set. **Nothing touches the bloom
layer.**

---

## 1. Moon material (from SVS 4720)

The photorealism is almost entirely in the **data-driven albedo map**, not in the
geometry: real maria contrast (Imbrium/Serenitatis genuinely dark with faint
brown/blue-green tints), **baked-in ray systems** (Tycho, Copernicus, Kepler),
warm-grey highlands. The rest:

- **Crisp, hard terminator** — a thin transition, not a soft gradient (vacuum: no
  atmospheric scattering to soften it).
- **Matte regolith** — near-Lambertian, `roughness ≈ 0.95–1.0`, `metalness = 0`,
  `envMapIntensity = 0`. Any specular sheen kills realism.
- **Single hard white sun**, **no fill on the day side**, **pure black sky**.

**Recipe (R3F v8, all static / demand-safe):**
1. Swap to the NASA LROC color map (§Assets) — biggest single win (real maria +
   baked rays). Keep `SRGBColorSpace` on `map`.
2. Bake a normal map **from the LOLA height map** (offline) so relief lines up with
   the albedo; keep `NoColorSpace`. Raise `normalScale` 0.35 → **~0.6–0.8** (0.35
   is too timid for crater-rim definition at orbit distance).
3. `metalness 0`, `roughness ~0.95–1.0`, `envMapIntensity 0`.
4. Keep `displacementMap` **off** (silhouette cracks on equirect poles; the repo
   already forbids it) — the normal map is enough at our distances.
5. Bump texture `anisotropy` → `renderer.capabilities.getMaxAnisotropy()` (free at
   idle; sharpens the limb/terminator).

**Cross-check from SVS 14959 (the "Moon 3D Models" reference):** 14959 is NOT a new
texture — its color map *is* the 4720 map wrapped on geometry, shipped as GLB/USDZ
(Flat / Grid / Topo). **Do not adopt the GLBs** (the topo globe is 81 MB with baked
displaced vertices — over budget and against our normal-map-only rule); keep the
4720 texture on our sphere. Its value is the **Topo preview render** as an
art-direction target, which teaches two things:
- **Side / raking light is the #1 realism lever.** The "hero" look comes from the
  sun *across* the globe (3/4 side), throwing real shadows into craters and showing
  a soft terminator. A head-on sun gives the flat "sticker/decal" look (their Flat
  preview proves it). **Verify the orbit preset frames the Moon with a visible,
  gentle terminator** — the sun must be off-axis from the camera→Moon line. This is
  the single biggest win and costs nothing.
- **Relief is subtle, not knobbly**, and the terminator is a *soft gradient* over
  many degrees. So target `normalScale ≈ 0.5` on the near (L0) material (mid of the
  0.35→0.7 band), keep the far (L1) material at ~0.35 for clean distant frames, and
  keep the Moon mid-grey (don't push the sun above ~1.9 or the lit limb blows out).

---

## 2. Earth + Moon illumination / earthshine (from SVS 14992)

**The key correction:** NASA keeps earthshine *subtle*. The Moon's shadowed limb is
near-black charcoal with only a faint cool-grey wash on the Earth-facing terminator
— just enough that craters are *barely* readable. It is **not** a blue glow. The
realism comes from the contrast: brilliant warm-neutral sunlit crescent vs. an
almost-black shadow side.

**Tuning our earthshine `directionalLight` (currently too strong + too blue):**
- Intensity → **~0.10–0.18× the sun** (i.e. ~0.20–0.35, down from 0.7).
- Color → pale desaturated steel-blue `#A8BFDA`, **not** saturated `#4466ff`.
- Direction → from `EARTH_POSITION` toward the Moon (vector `moonPos − EARTH_POSITION`).
- Keep sun and earthshine ~opposing so the warm crescent and cool fill occupy
  different hemispheres.

**Color-temperature palette (concrete):**

| Light | Hex | Intensity | Note |
|-------|-----|-----------|------|
| Sun (directional) | `#FFF6EC` | ~1.9 | slightly warm white; keep |
| Earthshine (directional) | `#A8BFDA` | ~0.25–0.35 | cool, dim, **desaturated** |
| Hemisphere (sky/ground) | `#FFE9CC` / `#1A1814` | ~0.25 | down from 0.35; darker shadows |
| Ambient | `#0E1014` | ~0.10–0.15 | down from 0.17; keep void black |
| Earth emissive (city lights) | `#FFC061` | ~0.6 | warm gold, night side only |
| Atmosphere rim | `#5C8FD6` | — | cool-blue limb shell |

**Earth material:** day color map (Blue Marble) on `meshStandardMaterial`
(`roughness ~0.9`, `metalness 0`); optional warm-gold city lights via an
`emissiveMap` masked to the dark side; **atmospheric rim** via a back-side additive
shell (radius ×1.02–1.04, `meshBasicMaterial`/tiny fresnel shader,
`side: BackSide`, `transparent`, `AdditiveBlending`, `depthWrite: false`,
`#5C8FD6`, opacity ~0.25–0.4) — fully static. While Earth is a small marble the
current single-map self-lit disc is fine; the two-map day/night split only pays off
once Earth grows on screen.

**Space background:** the SVS "wow" is a real **Milky Way band** (warm brown dust,
not blue) + dense fine stars + faint nebulosity + true near-black void — baked into
the background texture, **not bloom**. See §4.

---

## 3. Orbit→surface descent (from SVS 4444)

Reconstructed from six frames (full globe → nadir plain → resolving rille →
pitching → low oblique → horizon + black sky):

- **#1 lever — pitch ramp.** Camera starts looking straight **down** (nadir) and
  rotates to a low oblique (~15–25° above horizontal); the **horizon rises into the
  upper third only in the final ~15%**. This rotation is what turns a flat map into
  a 3D place. Our current views both "look toward −Z" (same orientation) — adding
  the pitch ramp is the biggest cinematic upgrade.
- **Asymmetric easing** — slow-fast-*slow*: ease-in on departure, fast through the
  featureless middle, **hard ease-out into the landing** so the arrival settles
  gently (not a fall). e.g. `easeInQuad` → `easeOutQuint`, crossover near the swap.
- **Near-constant FOV** (telephoto-ish). Scale change comes from *translation +
  pitch*, not a dolly-zoom. An optional tiny FOV widen (+6–10°) during the fast
  mid-section reads as a subtle "whoosh" — keep it small or skip.
- **Subtle lateral arc / parallax** — a few units of X drift (not a straight
  Z-dive) makes foreground vs. background features shift → reads as real 3D space.
  Optional 1–3° roll during the fast section, zeroed by arrival.
- **Crisp vacuum look throughout** — no haze, sharp distant ridges, hard shadow
  edges. The fixed low sun goes from flat-lit (overhead) to raking shadows
  (oblique) as the camera pitches — that reveal is the "real place" payoff.
- **No flash/wipe** — NASA hides the LOD pop with *speed + gradual desaturation*.
  Our glare overlay is the equivalent safety net; keep it but **slim it** to a
  brief, off-center sun-bloom tied to the scene swap rather than a full-screen wash.

**Upgrades to our transition (keep the single ~1.5s rAF, demand-safe):**
1. Add the **pitch ramp** (slerp camera quaternion / lerp lookAt point from
   down-vector → surface forward-vector; nadir for t∈[0,~0.6], pitch up for
   [~0.6,1]).
2. **Asymmetric easing** (fast middle, slow arrival) instead of symmetric
   `easeInOutCubic`.
3. **Subtle arc + parallax** (small X offset; optional tiny roll).
4. **Slim the glare** to an off-center sun-bloom that only fully occludes for a few
   frames at the swap.
5. *(Optional)* small FOV ramp — requires `camera.updateProjectionMatrix()` each
   touched frame; skip if fiddly (pitch matters far more).

**Keep:** single rAF that stops after the move; glare-masked swap *concept*;
controls disabled during flight; `easeInOutCubic` as a baseline (just split it).

---

## 4. Star field, Milky Way & nebula hero (from SVS 14992 + R3F research)

Verified against installed `three@0.169` / `fiber@8.18` / `drei@9.122` /
`postprocessing@2.19.1`:

- **ACES Filmic tone mapping + sRGB output are ALREADY ON** (R3F v8 defaults; not
  `flat`/`linear`). It's the right choice for a black sky (0→0, highlight rolloff).
  Treat `toneMappingExposure ≈ 1.0–1.2` as a dial; keep emitters `toneMapped={false}`.
- **drei `<Stars>` is REJECTED** — its `useFrame` is ungated and `speed={0}` does
  not remove it; it also bakes shader twinkle. Keep the hand-rolled static
  `THREE.Points` field; add **per-vertex size/brightness variance** (power-law: a
  few bright, many faint — the single biggest realism jump for a point field) +
  slight color variance (mostly white, a few warm `#ffd8b0` / cool `#cfe0ff`). All
  baked once in `useMemo`, zero idle cost.
- **Milky Way band** → one self-hosted **equirectangular Deep Star Map** (SVS 4851)
  assigned to `scene.background` (`tex.mapping = EquirectangularReflectionMapping`,
  `colorSpace = SRGBColorSpace`, `anisotropy = max`). Renders once → `invalidate()`
  once → idle. Imperative loader beside `HdrBackdrop`; assign `background` only
  (never touch the IBL `environment`); on fail leave the black fallback. **Do not**
  route the equirect through bloom.
  - **Definitive file: `starmap_2020_8k_gal.exr`** — the `starmap_*` *composite*
    (Milky Way band **+** discrete stars in one file; `milkyway_*` is the band only,
    `hiptyc_*` is stars only) in **galactic** coords (`_gal`) so the band sits as a
    clean horizontal stripe with the bulge centered (celestial coords put it as a
    lopsided diagonal). No constellation/grid is ever baked in (those are separate
    TIF overlays) — so the file is clean. Convert offline → 4096×2048 JPG (§5).
  - **The equirect background ignores the 8000 far-plane** (it's the WebGLBackground
    pass, not geometry — always fills behind everything). This means once it ships
    you can **drop the hand-rolled ~4000-radius `THREE.Points` shell** if you want,
    or keep a *small* sparse points field in front for foreground twinkle-free depth
    (§2). Either is static-safe.
- **Nebula / supernova hero** → 2–4 layered additive `<sprite>`s using a
  self-hosted Hubble/ESA nebula cutout — directly the `SunBody` sprite pattern.
  `three.Sprite` billboards on the GPU with **no `useFrame`** (verified). Additive
  over black sky hides the image's black background. `toneMapped:false`,
  `depthWrite:false`, `fog:false`, `raycast={()=>null}`; radial-gradient
  CanvasTexture fallback (ADR-0004). Off the bloom layer. Gate orbit-only like
  `MoonGlobe` if used as a vista accent.
- **Sun polish** (current core + glow + ray sprites is already the right
  architecture): add a static **limb-darkening** gradient sprite (center bright →
  warmer/dimmer edge) and a faint **chromatic glow** (one warm `#fff0d8` + one
  faint cool, slightly offset). Keep core white. Skip true screen-space ghosts
  (camera-dependent → not static); `three` `Lensflare` (`onBeforeRender`,
  demand-safe) is a stretch option, not recommended over the CanvasTexture rays.

---

## 5. Assets to self-host (verified 2026-06-06)

All direct URLs HTTP-checked. Self-host every file in `web/public/assets/`.

| Asset | Direct URL | Size / format | License → required credit |
|-------|-----------|---------------|----------------------------|
| **Moon color** (CGI Moon Kit, LROC) | `https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg` | 448 KB, 2048×1024 JPG (no downscale needed) | NASA-PD → "NASA's Scientific Visualization Studio" |
| **Moon elevation** (LDEM, LOLA) → bake normal | `https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_4_uint.tif` | 2.0 MB, 1440×720, 16-bit TIFF | NASA-PD → "NASA's Scientific Visualization Studio" |
| **Star map / Milky Way** (Deep Star Maps 2020, Gaia DR2) — **pick: 8k galactic** | `https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/starmap_2020_8k_gal.exr` | 153 MB, 8192×4096 **EXR-only** → convert+downscale to 4096×2048 JPG offline | NASA-PD **+ ESA co-credit** → "NASA/Goddard SVS. Gaia DR2: ESA/Gaia/DPAC" |
| **Earth color** (Blue Marble: Next Gen) | `https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/january/world.topo.bathy.200401.3x5400x2700.jpg` | 2.6 MB, 5400×2700 JPG (→ 2K) | NASA-PD → "NASA's Goddard Space Flight Center (Blue Marble: Next Generation)" |
| **Sun** (Solar System Scope) — already in repo | `https://www.solarsystemscope.com/textures/download/2k_sun.jpg` | 822 KB, 2048×1024 JPG | **CC-BY 4.0** → "Solar System Scope (solarsystemscope.com), CC BY 4.0" |
| **Nebula hero** (ESA/Hubble Veil "Witch's Broom", heic0712a) | `https://cdn.esahubble.org/archives/images/large/heic0712a.jpg` | 557 KB JPG, **genuine black bg** (ideal additive) | **CC-BY 4.0** → "NASA, ESA, and the Hubble Heritage (STScI/AURA)-ESA/Hubble Collaboration. Acknowledgment: J. Hester (ASU)" |

**Gotchas:** the star map is **EXR-only** at usable resolution — the SVS `*.jpg`
404s and `*_print.jpg` are 1024×512 thumbnails; convert the EXR → JPG offline and
downscale. The star map carries a **mandatory ESA/Gaia co-credit** even though
NASA-hosted. ESA/Hubble & Solar System Scope are CC-BY → attribution mandatory
(snippet for `CREDITS.md` below). No NASA/ESA insignia in any file; never imply
endorsement. Bake the Moon normal map and convert the EXR at **build time** — no
runtime conversion (CPU spike + demand-loop juggling).

### EXR → web JPG conversion (build time)

EXR is scene-linear HDR; a naive convert crushes the faint Milky Way to black or
blows out the core. Lift exposure, then encode sRGB:

```sh
# oiiotool (preferred — explicit color management)
oiiotool starmap_2020_8k_gal.exr \
  --resize 4096x2048 \
  --cmul 6.0 \                   # exposure lift (~+2.6 stops); tune 4–8 to taste
  --colorconvert linear sRGB \   # don't ship linear data
  --ch R,G,B \
  -o starmap_2020_4k_gal.jpg

# ImageMagick v7 fallback
magick starmap_2020_8k_gal.exr -resize 4096x2048 \
  -evaluate multiply 6.0 -colorspace sRGB -quality 90 starmap_2020_4k_gal.jpg
```
Tune the multiplier against the preview — the band should read as soft grey-brown,
not a hard white smear. JPEG quality 88–92 (dark-sky banding shows below ~85);
expect ~400–800 KB at 4K. A 2048×1024 tier (<300 KB) is an acceptable low-end.

### R3F v8 integration (`scene.background`, demand-safe)

Mirror `HdrBackdrop` — a sibling loader that assigns `scene.background` imperatively
and `invalidate()`s once; the black `<color>` stays as the ADR-0004 fallback. Keep
this separate from the IBL `environment` (two independent slots).

```tsx
const STAR_BG = "/assets/starmap_2020_4k_gal.jpg";
function StarBackground() {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    let cancelled = false;
    const prev = scene.background;            // the black <color> fallback
    new THREE.TextureLoader().load(STAR_BG, (tex) => {
      if (cancelled) { tex.dispose(); return; }
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = gl.capabilities.getMaxAnisotropy();
      scene.background = tex;
      invalidate();                           // wake the demand loop ONCE
    }, undefined, () => {/* load failed → leave black (ADR-0004) */});
    return () => {
      cancelled = true;
      const cur = scene.background;
      scene.background = prev;
      if (cur instanceof THREE.Texture) cur.dispose();
    };
  }, [scene, gl, invalidate]);
  return null;
}
```

### CREDITS.md additions (CC-BY — attribution required)

```markdown
| File | Source | License | Required attribution |
|------|--------|---------|----------------------|
| textures/nebula_veil.jpg | ESA/Hubble Veil Nebula (heic0712a) | CC-BY 4.0 | NASA, ESA, and the Hubble Heritage (STScI/AURA)-ESA/Hubble Collaboration. Acknowledgment: J. Hester (ASU) |
```
(Sun / Solar System Scope already recorded; Moon, Earth, star map are NASA-PD →
courtesy credit only. Star map adds: "Gaia DR2: ESA/Gaia/DPAC".)

---

## 6. Implementation plan — tiered by impact-per-effort

> **SUPERSEDED 2026-06-07 (Wave 4, "living orbit").** The `frameloop="demand"` /
> 0-idle-fps budget is **dropped** (see ADR-0004 amendment): the scene is now
> `frameloop="always"` and `useFrame` animation is unrestricted. The "demand-safe",
> "load → invalidate() once → idle", and "No new useFrame" guidance throughout this
> doc is historical — ignore it for new work. Item 8 below (day/night Earth) shipped,
> extended with an animated living Earth (rotation, ocean sun-glint, drifting clouds)
> and a decoupled orbit sun (dark-side crescent Moon). The ADR-0004 fallback, bloom-
> layer, and `raycast={()=>null}` invariants still hold.

Each is independently shippable, keeps every decorative `raycast={()=>null}`, and
touches neither the bloom layer (HALO_BLOOM_LAYER 11) nor a second bloom pass.

**Tier 1 — highest impact, lowest risk**
1. **Lighting re-grade** (§2 palette) — dim/cool/desaturate earthshine, darken
   shadows + hemisphere + ambient, black void, hard white sun, Moon
   `normalScale → ~0.5`, and **verify the orbit preset shows a visible soft
   terminator** (sun off-axis from the camera→Moon line — §1's biggest free win).
   *Free, no new assets.*
2. **Real Moon color map** (CGI Moon Kit) + baked LOLA normal map (§1, §5).
3. **Milky Way equirect** as `scene.background` (§4) — imperative loader beside
   `HdrBackdrop`; the deep-space jump.

**Tier 2 — hero + descent**
4. **Descent pitch-ramp** + asymmetric easing + subtle arc/parallax + slimmed
   off-center glare (§3) — all in the existing single rAF.
5. **Nebula/supernova hero sprite** (Veil, additive, orbit-only) (§4).
6. **Sun polish** — limb darkening + faint chromatic glow sprites (§4).

**Tier 3 — micro-polish**
7. Star-field brightness/size/color variance (§4); Moon `anisotropy → max` (§1);
   explicit `toneMappingExposure ≈ 1.1` (verify black stays black).
8. *(Optional, only if Earth grows on screen)* two-map day/night Earth + atmosphere
   rim shell (§2).

### Invariants to assert in every PR
- ~~No new `useFrame`~~ **(dropped — `frameloop="always"`, animation is free).**
- Every new textured asset has a primitive fallback (ADR-0004).
- No new mesh on `HALO_BLOOM_LAYER` (11); no second full-screen bloom pass.
- All decoratives `raycast={()=>null}` (pick/click-to-kill intact).
- Perf hygiene only (no longer a hard gate): keep `dpr ≤ ~1.5`, bound draw calls via
  instancing/LOD. `useFrame` loops may still early-return on `document.hidden` to
  save battery, but it is no longer required.

### Explicitly rejected for this stack
drei `<Stars>` (ungated `useFrame` + shader twinkle), `<Sparkles>` / `<Cloud>`
(animated), `MeshPhysicalMaterial` for these bodies (cost, no benefit on airless
rock / distant Earth), `displacementMap` on the globe (silhouette cracks), routing
any of the above through selective bloom or a second bloom pass (not free at idle),
`NoToneMapping` (loses the Sun/Earth highlight rolloff).

---

## 7. NASA 3D Resources — hero set-piece models

[science.nasa.gov/3d-resources](https://science.nasa.gov/3d-resources/) is NASA's
3D-model catalog; the self-hostable mirror is `github.com/nasa/NASA-3D-Resources`
(models under `/3D Models/<Name>/`, raw URL form
`https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/3D%20Models/<Name>/<file>.glb`).
**Big win: NASA re-exported most relevant models to GLB in 2025** — web/three-ready
out of the box, no Blender/OBJ conversion. These feed the *surface*-scene hero
assets (rovers/landers/habitat/launch infra) via the existing `model_ref` seam in
[`realistic-3d-world-assets.md`](./realistic-3d-world-assets.md); listed here
because they came out of the same research pass.

**License (all picks):** NASA Public Domain — credit "NASA" + the per-model author;
**never the NASA insignia/meatball/worm** (those are *not* PD — strip any decals on
rockets/suits) and never imply endorsement. Every model verified credited only to
NASA centers/employees (no third-party/NC/ND terms).

**Shortlist — top 8 (all GLB-ready, URLs HTTP-200-verified, ≈12 MB total before optimization):**

| Scene role | Model | Size | Credit |
|------------|-------|------|--------|
| Rover (swarm hero) | **RASSOR** — regolith excavation robot, *ideal* for a construction swarm | 6.28 MB | NASA/D. Smith; NASA/J. Schuler |
| Lander / ship | **Apollo Lunar Module** — instantly reads as "ship on the surface" | 717 KB | NASA/M. Carbajal |
| Launch platform | **Mobile Launcher** (assembled) | 198 KB | NASA/S. Neblett |
| Gantry / tower | **Gantry** (LC-39 tower) | 1.39 MB | NASA/M. Carbajal |
| Crawler | **Crawler-Transporter** | 1.63 MB | NASA/M. Carbajal |
| Habitat / base | **Habitat Demonstration Unit** (part 1 + 2) | 1.23 MB | NASA/LaRC ACL |
| Base prop | **Base Station** (tiny filler structure) | 22 KB | NASA/Ames |
| Crew / scale | **Astronaut** (EVA figure) | 763 KB | NASA |

Other notable but heavier / deferred: Space Exploration Vehicle (22 MB, pressurized
crew rover), Mars 2020 Perseverance (5 MB GLB), Viking/InSight landers (GLB),
Gateway Core (66 MB — avoid), VAB (6.5 MB backdrop), Saturn V (927 KB — strip
insignia), Robonaut 2 (1.07 MB), Z2/Mark-III suits. Conversion-needed (skip v1):
Curiosity & MER rovers (.blend only), SLS Block 1 (.7z archives).

**Integration notes:** drop each GLB into `web/public/assets/`, run
`gltf-transform optimize --compress draco` + texture resize (NASA GLBs ship
uncompressed → expect 40–70% reduction); author a **primitive fallback** (box/
cylinder proxy sized to the GLB bbox) per model (ADR-0004); **instance** the RASSOR
for the swarm rather than loading N copies (bounded draw calls / demand loop);
inspect textures and remove any NASA insignia/flag decals before shipping.

---

## Relevant code
- `web/src/components/SpaceEnvironment.tsx` — star field + IBL backdrop (§4 lands here)
- `web/src/components/SkyBodies.tsx` — Sun / Moon / Earth (§1, §2, §4 sprites)
- `web/src/components/Scene3D.tsx` — Canvas `gl`/tone-mapping, lights, descent rAF, selective bloom (§2, §3, §7)
- `web/src/lib/scene.ts` — celestial positions/sizes (single source of truth)
- `web/public/assets/CREDITS.md` — provenance ledger to extend (§5)
