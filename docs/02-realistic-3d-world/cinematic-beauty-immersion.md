# Cinematic beauty & immersion audit (Wave 3)

Technical-art-direction study for making the `web/` R3F lunar scene **prettier and
more immersive**, synthesized from a multi-agent audit of the rendering code
(`Scene3D.tsx`, `SkyBodies.tsx`, `SpaceEnvironment.tsx`, `LaunchScenery.tsx`,
`DecorRocks.tsx`). It is the research backing for **Wave 3** of epic
[#46](https://github.com/IamP5/fiap-gs-space-connect/issues/46). All file:line refs
were verified against the codebase at the time of writing.

## The one constraint that shapes the wave

The scene renders on a **demand loop** (`Canvas frameloop="demand"`,
`Scene3D.tsx:1784`). Static material/shader tweaks and post-process passes are
**free** — they paint only on `invalidate()`. Any *idle animation* (twinkle,
drift, rotating clouds, idle camera sway) needs a `useFrame` that calls
`invalidate()` each tick, which runs ~60 fps while mounted.

**Decision for Wave 3:** the idle-fps invariant is relaxed for opt-in motion. The
data path is unaffected — backend/robot snapshots reach the scene over the
WebSocket → React state → repaint regardless of frameloop mode, so connectivity,
rover updates, picking, and snapshot purity all keep working. The only cost of an
always-on loop is GPU/battery when nothing changes. Animated slices therefore
**pause when the tab is hidden** (`document.hidden`/`visibilitychange`).
Snapshot-driven effects (rover dust, strobes) stay fully demand-safe.

## TL;DR — biggest bang for the buck

- **Expand bloom beyond rover halos.** `SelectiveBloom` is locked to
  `HALO_BLOOM_LAYER` (`Scene3D.tsx:1117–1128`); the Sun core
  (`emissiveIntensity 1.7`, `SkyBodies.tsx:456`) and Earth's limb never bloom.
- **Turn on shadows** — the scene casts none. Soft sun shadow + `ContactShadows`.
- **Stack a real post-FX chain** — GodRays, Vignette, SMAA, ChromaticAberration.
- **Widen FOV 42→50** (`Scene3D.tsx:1789`).
- **Replace the flat Earth rim** (`MeshBasicMaterial` BackSide, `SkyBodies.tsx:265`)
  with a Fresnel × sun-angle atmosphere shader.
- **Make the sky alive** — twinkling stars + meteor streaks via the existing
  starfield `onBeforeCompile` (`SpaceEnvironment.tsx:244`).
- **Add a cinematic intro descent** — reuse the glare-masked orbit→surface
  transition for a deep-space arrival.

## Wave 3 slices

| # | Slice | Phase | Blocked by |
|---|-------|-------|------------|
| W3-1 | Post-processing cinematic stack (bloom Sun+Earth, Vignette, SMAA, CA, grain, surface DoF) | 1 static | — |
| W3-2 | Sun GodRays + lens flare (orbit-gated) | 1 static | W3-1 |
| W3-3 | Texture fidelity pass (anisotropy, glTF colorspace, data-map filtering, Moon normalScale) | 1 static | — |
| W3-4 | Lighting & framing grade (FOV 50, rim/fill lights, earthshine falloff, fog dedupe+tint) | 1 static | — |
| W3-5 | Earth atmosphere Fresnel shader (sun-angle Rayleigh/Mie rim) | 2 static shader | — |
| W3-6 | Moon shader polish (terminator rim-glow + limb darkening) | 2 static shader | — |
| W3-7 | Soft shadows + contact shadows | 2 static | — |
| W3-8 | Material tier polish (dome roughness, clearcoat metal, rock PBR, solar glint, emissive windows) | 2 static | W3-1 |
| W3-9 | Terrain microrelief noise | 2 static | — |
| W3-10 | Twinkling stars + meteor streaks | 3 animated | — |
| W3-11 | Living Earth (cloud shell + city-light flicker) | 3 animated | W3-5 |
| W3-12 | Snapshot-driven FX (rover dust, bid-war strobe, resurrection shockwave) | 3 demand-safe | — |
| W3-13 | Cinematic beats (intro fly-in, Earthrise hero, launch + shake) | 3 animated | — |
| W3-14 | Camera feel (idle drift, inertial damping, zoom exposure, parallax) | 3 animated | — |

## Key files

`Scene3D.tsx` (lighting `1499–1519`, post-FX `1117–1128`, camera `1789–1807`,
fog duplicated at `1470`+`1519`, terrain `~1007`) · `SkyBodies.tsx` (Sun
`446–591`, Earth rim `240–315`, Moon `136–224`) · `SpaceEnvironment.tsx`
(starfield `178–267`, bg intensity `71`) · `LaunchScenery.tsx` (set-piece
placement) · `DecorRocks.tsx` (rock materials) · `lib/scene.ts` (`EARTH_POSITION`)
· `lib/choreography.ts` (beat kinds — add `launch`/`earthrise-hero`).
