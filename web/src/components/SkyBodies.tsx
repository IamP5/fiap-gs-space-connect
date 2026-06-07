// SkyBodies — two STATIC, snapshot-independent decorative sky bodies for the
// lunar diorama (issue #51), in the same Scenery category as <SpaceEnvironment>
// and <LaunchScenery>: they encode NO world state, so they respect ADR-0004's
// "scene is a pure function of the snapshot" invariant (decorative,
// snapshot-INDEPENDENT elements are allowed). Mounted unconditionally.
//
// The worksite is ON the Moon, so:
//   • Moon globe — ORBIT view ONLY. A drei <Detailed> (THREE.LOD) sphere sized
//     to read as a real globe at orbit zoom distances (the orbit preset TARGETS
//     this globe; far plane ~8000). Crater relief comes from a NORMAL map (never
//     a displacementMap). L0 (orbit-close): color + normal + roughness. L1
//     (pulled back): color + normal. Hidden in surface mode — the Moon must never
//     hang in the surface sky (you are standing on it).
//   • Earth — BOTH views. A distant marble (small angular size) hung high in the
//     black sky with just an Earth color map (self-illuminated, the Apollo
//     "Earthrise" read). No LOD, no normal map. A distant Earth belongs in the
//     orbit space-vista as much as in the surface sky.
// The starfield (from <SpaceEnvironment>, issue #50) shows in BOTH views.
//
// The `viewMode` passed here is the RENDERED mode (Scene3D's `shown`), which
// flips at the glare peak of the descent transition — so the Moon appearing/
// vanishing is hidden behind the flash, never seen as a pop.
//
// DEMAND-LOOP SAFETY (non-negotiable): NO useFrame of our own. Textures load
// imperatively via THREE.TextureLoader (NOT a Suspense that can throw); each
// successful load calls invalidate() once so the demand loop paints it, then
// returns to 0 idle fps. We also invalidate() whenever the visible body swaps on
// a view-mode change, or the LOD/visibility would stick under the demand loop.
//
// MANDATORY FALLBACK (ADR-0004): a missing/failed texture leaves the sphere
// rendered with its flat material color — never blank, never thrown. Geometry +
// materials are built in useMemo and disposed on unmount; loaded textures are
// detached from their material and disposed on unmount.
//
// Both bodies are raycast={() => null} (non-pickable) so click-to-kill / pick is
// unaffected.

import { useEffect, useMemo, useState } from "react";
import { Detailed } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

import type { ThreeEvent } from "@react-three/fiber";

import type { ViewMode } from "./Scene3D";
import {
  EARTH_POSITION,
  EARTH_RADIUS,
  MOON_POSITION,
  MOON_RADIUS,
  SUN_POSITION,
  SUN_RADIUS,
} from "../lib/scene";

// Self-hosted textures (see public/assets/CREDITS.md). Downscaled jpgs.
//   • Moon  — NASA CGI Moon Kit (SVS 4720): LROC WAC colour mosaic + a normal map
//     baked OFFLINE from the LOLA LDEM elevation (NASA-PD).
//   • Earth — NASA Blue Marble (day) + Black Marble (city lights, night) (NASA-PD).
//   • Sun   — Solar System Scope colour map (CC-BY 4.0).
//   • Nebula — ESA/Hubble Veil Nebula "Witch's Broom" (heic0712a) (CC-BY 4.0).
const MOON_COLOR = "/assets/textures/moon_color_4096.jpg";
const MOON_NORMAL = "/assets/textures/moon_normal_4096.jpg";
const EARTH_DAY = "/assets/textures/earth_day_2048.jpg";
const EARTH_NIGHT = "/assets/textures/earth_night_2048.jpg";
const SUN_COLOR = "/assets/textures/sun_color_1024.jpg";
const NEBULA_VEIL = "/assets/textures/nebula_veil_1024.jpg";

// --- Moon globe (orbit view) ------------------------------------------------
// Placement + size: the orbit preset TARGETS this berth and frames the globe as
// the hero of the space vista (see VIEW_PRESETS.orbit + the descent transition in
// Scene3D, which both import these constants so the camera and the globe can never
// drift apart). We berth the globe out along -Z, comfortably inside the far plane,
// and size it so it reads as a real globe (not a dot) across the orbit zoom band.
// MOON_RADIUS + MOON_POSITION are the single source of truth in lib/scene.ts so
// Scene3D's orbit preset + descent transition target the globe exactly.

// LOD switch distances (camera→object). L0 detail is shown until the camera is
// MOON_LOD_SWITCH units away, then L1 (the cheaper material) takes over on
// pull-back. Tuned to the orbit zoom band.
const MOON_LOD_SWITCH = 420;

// --- Earth (both views) -----------------------------------------------------
// A distant marble hung high in the black sky to give the sense of deep space.
// SIZED PROPORTIONALLY to the Moon (EARTH_RADIUS = MOON_RADIUS × 3.67, the real
// diameter ratio) and hung beyond the Moon's upper-right limb so the orbit vista
// matches the NASA reference: the Moon is the close hero (~38°) and Earth the
// smaller-but-farther marble (~13°). Shown in BOTH views. Self-illuminated so it glows on its own
// with no per-frame work. EARTH_RADIUS + EARTH_POSITION live in lib/scene so
// Scene3D's earthshine light can share Earth's position.

// Imperatively load a texture and apply it to a material slot, demand-safely.
// Returns a cleanup that detaches + disposes. A failed load is swallowed (the
// flat material color stays — ADR-0004 fallback).
function loadTexture(
  url: string,
  material: THREE.MeshStandardMaterial,
  key: "map" | "normalMap" | "roughnessMap" | "emissiveMap",
  colorSpace: THREE.ColorSpace,
  invalidate: () => void,
  anisotropy = 4,
): () => void {
  let disposed = false;
  let texture: THREE.Texture | null = null;
  const loader = new THREE.TextureLoader();
  loader.load(
    url,
    (t) => {
      if (disposed) {
        t.dispose();
        return;
      }
      t.colorSpace = colorSpace;
      t.anisotropy = anisotropy;
      texture = t;
      material[key] = t;
      material.needsUpdate = true;
      invalidate(); // wake the demand loop so the texture shows, then idle again
    },
    undefined,
    () => {
      // Missing/failed ⇒ keep the flat color for this channel (never crash).
    },
  );
  return () => {
    disposed = true;
    if (texture) {
      if (material[key] === texture) material[key] = null;
      texture.dispose();
    }
  };
}

// Terminator rim-glow + limb darkening shader patch (#103). A STATIC
// onBeforeCompile tweak to the Moon's MeshStandardMaterial (same pattern as the
// starfield's pointsMaterial patch in SpaceEnvironment.tsx:244) — no useFrame, so
// it paints only on invalidate() and the globe stays at 0 idle fps.
//
// Two cheap, purely view-dependent effects evaluated in the fragment shader, just
// before tone-mapping is applied to the accumulated lit colour:
//   • LIMB DARKENING — the silvery Apollo limb dims toward the silhouette edge,
//     where the line of sight grazes the regolith at a glancing angle (more
//     intervening shadowed micro-relief). `rim` rises from 0 at disc-centre to 1
//     at the edge via smoothstep on (1 - |dot(viewDir, normal)|); the lit colour
//     is multiplied DOWN toward the edge, with a faint WARM grazing tint so the
//     darkened limb reads as sunlit silver rock, not a grey vignette.
//   • TERMINATOR RIM-GLOW — a faint COOL emissive added at that same grazing edge,
//     a thin silver halo around the limb (the soft scattered light along the
//     Apollo terminator). Kept faint and additive so it never blooms (the Moon is
//     NOT on a bloom layer) and never washes out the crater relief.
//
// Crater detail is the NORMAL map, untouched: we read `normal` (the per-fragment
// normal three has ALREADY perturbed by the normal map) only to compute the limb
// factor, and we touch only the final `gl_FragColor.rgb` — diffuse/normal/
// roughness inputs are left exactly as the stock shader assembled them.
const MOON_RIM_GLOW_COLOR = new THREE.Color("#8fb4ff"); // faint cool silver halo
const MOON_LIMB_WARM_TINT = new THREE.Color("#fff1dc"); // warm grazing-light tint

function patchMoonLimbShader(material: THREE.MeshStandardMaterial) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: MOON_RIM_GLOW_COLOR };
    shader.uniforms.uWarmTint = { value: MOON_LIMB_WARM_TINT };
    // `vViewPosition` (the view-space → camera vector) and `normal` (the
    // normal-mapped per-fragment normal) are both already in scope in the standard
    // fragment shader; we declare our two uniforms then add the limb maths just
    // before tone-mapping.
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "void main() {",
        ["uniform vec3 uRimColor;", "uniform vec3 uWarmTint;", "", "void main() {"].join("\n"),
      )
      .replace(
        "#include <tonemapping_fragment>",
        [
          "{",
          "  vec3 vDir = normalize( vViewPosition );",
          "  float ndv = abs( dot( vDir, normalize( normal ) ) );",
          "  float rim = smoothstep( 0.7, 1.0, 1.0 - ndv );",
          "  // Limb darkening: dim toward the edge, with a faint warm grazing tint.",
          "  float darken = mix( 1.0, 0.62, rim );",
          "  gl_FragColor.rgb *= mix( vec3( 1.0 ), uWarmTint, rim * 0.5 ) * darken;",
          "  // Terminator rim-glow: a faint cool silver halo at the grazing edge.",
          "  gl_FragColor.rgb += uRimColor * ( rim * rim ) * 0.14;",
          "}",
          "#include <tonemapping_fragment>",
        ].join("\n"),
      );
  };
}

// The Moon globe, shown ONLY in orbit view. Two LOD levels (drei <Detailed> =
// THREE.LOD): L0 color+normal+roughness, L1 color+normal. Relief is the normal
// map (NEVER displacementMap).
function MoonGlobe({ visible }: { visible: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);

  // Geometry + the two materials, built once. Higher segments for the close LOD,
  // fewer for the pulled-back LOD.
  const { geomNear, geomFar, matNear, matFar } = useMemo(() => {
    const geomNear = new THREE.SphereGeometry(MOON_RADIUS, 96, 96);
    const geomFar = new THREE.SphereGeometry(MOON_RADIUS, 48, 48);
    // Flat fallback color: a believable regolith gray, used if textures fail.
    // fog:false — celestial bodies sit far beyond the surface horizon fog (and
    // are only shown in orbit, which has no fog anyway), so they must never be
    // tinted toward the fog color.
    //
    // Matte regolith (CGI Moon Kit recipe — space-view-realism.md §1): near-
    // Lambertian airless rock. roughness ~0.97, metalness 0, and envMapIntensity 0
    // so the IBL never paints a specular sheen on the globe (any sheen kills the
    // realism). Relief is the LOLA-baked normal map ONLY — never a displacementMap
    // (silhouette cracks on equirect poles).
    const matNear = new THREE.MeshStandardMaterial({
      color: "#c2c2c2",
      roughness: 0.97,
      metalness: 0,
      envMapIntensity: 0,
      fog: false,
    });
    const matFar = new THREE.MeshStandardMaterial({
      color: "#c2c2c2",
      roughness: 0.97,
      metalness: 0,
      envMapIntensity: 0,
      fog: false,
    });
    // Normal-map strength. With the orbit fill light crushed (Scene3D), crater
    // relief now has to come from the normal map under the raking sun — so the
    // near (L0) material is pushed to ~0.9 for strong crater-rim definition at
    // orbit-close distance; the far (L1) material stays softer (~0.6) so distant
    // frames don't over-shade near the terminator. (Baked from the LOLA LDEM-16
    // tier and delivered at 4096×2048 — 4× the prior linear detail.)
    matNear.normalScale.set(0.9, 0.9);
    matFar.normalScale.set(0.6, 0.6);
    // Terminator rim-glow + limb darkening (#103). Patched onto BOTH LOD materials
    // (the far/L1 is MATCHED to the near/L1) so the limb reads identically across
    // the LOD switch — no pop at MOON_LOD_SWITCH. Static shader: 0 idle fps.
    patchMoonLimbShader(matNear);
    patchMoonLimbShader(matFar);
    return { geomNear, geomFar, matNear, matFar };
  }, []);

  // Load the maps imperatively (no Suspense throw). L0 = color+normal,
  // L1 = color+normal. Both maps get max anisotropy (free at idle; sharpens the
  // limb/terminator). Roughness is the flat matte material value (the CGI Moon Kit
  // ships no roughness map — airless regolith is uniformly matte).
  useEffect(() => {
    const aniso = gl.capabilities.getMaxAnisotropy();
    const cleanups = [
      loadTexture(MOON_COLOR, matNear, "map", THREE.SRGBColorSpace, invalidate, aniso),
      loadTexture(MOON_NORMAL, matNear, "normalMap", THREE.NoColorSpace, invalidate, aniso),
      loadTexture(MOON_COLOR, matFar, "map", THREE.SRGBColorSpace, invalidate, aniso),
      loadTexture(MOON_NORMAL, matFar, "normalMap", THREE.NoColorSpace, invalidate, aniso),
    ];
    return () => cleanups.forEach((c) => c());
  }, [matNear, matFar, invalidate, gl]);

  // Dispose geometry + materials on unmount.
  useEffect(
    () => () => {
      geomNear.dispose();
      geomFar.dispose();
      matNear.dispose();
      matFar.dispose();
    },
    [geomNear, geomFar, matNear, matFar],
  );

  // Toggling visibility under the demand loop must wake one frame so the change
  // (and the LOD re-evaluation) is painted; otherwise the body sticks.
  useEffect(() => {
    invalidate();
  }, [visible, invalidate]);

  if (!visible) return null;

  return (
    <group position={MOON_POSITION} raycast={() => null}>
      <Detailed distances={[0, MOON_LOD_SWITCH]}>
        {/* L0 — orbit-close: color + normal + roughness. */}
        <mesh geometry={geomNear} material={matNear} raycast={() => null} />
        {/* L1 — pulled back: color + normal. */}
        <mesh geometry={geomFar} material={matFar} raycast={() => null} />
      </Detailed>
    </group>
  );
}

// Earth, shown in BOTH views (space-view-realism.md §2). A two-map day/night
// marble + a cheap atmospheric rim, far away. No LOD, no normal map.
//
// Day/night material: the Blue Marble day colour map lights the sun-facing
// hemisphere; the Black Marble city-lights map is wired as a WARM-GOLD emissive
// that only shows on the DARK side. We get the dark-side-only behaviour for free
// from the lighting: the emissiveMap is added uniformly, but the day map on the
// LIT side is far brighter than the gold lights, so the city glow only reads where
// the sun does not — the standard cheap day/night trick (no custom shader, no
// useFrame). emissiveIntensity is kept low (~0.6) so the lights stay a whisper.
//
// The flat `color` deep-ocean-blue is the ADR-0004 fallback if the day map fails —
// still a visible blue disc. (`visible` stays a prop for symmetry with MoonGlobe,
// but SkyBodies always mounts Earth visible.)
function EarthBody({ visible }: { visible: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);

  const { geometry, material, rimGeometry, rimMaterial } = useMemo(() => {
    const geometry = new THREE.SphereGeometry(EARTH_RADIUS, 48, 48);
    const material = new THREE.MeshStandardMaterial({
      color: "#2a4a8c",
      roughness: 0.9,
      metalness: 0,
      // Warm-gold city lights (#FFC061), kept dim so they read as a whisper on the
      // night side only. emissive is the tint multiplied onto the night emissiveMap;
      // with no map it stays effectively off (gold × black ≈ nothing) so a failed
      // night-map load leaves a clean lit/unlit marble (ADR-0004).
      emissive: "#FFC061",
      emissiveIntensity: 0.6,
      // fog:false — Earth is a distant body well beyond the surface horizon fog;
      // without this it would be tinted to black in surface view and vanish.
      fog: false,
    });

    // Atmospheric rim — a back-side additive shell (radius ×1.03) that paints a
    // cool-blue limb glow around the planet's edge. BackSide + AdditiveBlending +
    // depthWrite:false so it reads as a thin halo of atmosphere, fully static.
    const rimGeometry = new THREE.SphereGeometry(EARTH_RADIUS * 1.03, 48, 48);
    const rimMaterial = new THREE.MeshBasicMaterial({
      color: "#5C8FD6",
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    return { geometry, material, rimGeometry, rimMaterial };
  }, []);

  useEffect(() => {
    // Day map → diffuse (SRGB); night city-lights → emissive map (SRGB colour data).
    // A failed load on either channel leaves the flat fallback for that channel.
    // Earth now reads at ~1/3 the Moon's apparent size in orbit (it sits just off
    // the Moon's limb), so its maps get MAX anisotropy too — the day/night
    // terminator + coastlines stay crisp at the grazing limb angle.
    const aniso = gl.capabilities.getMaxAnisotropy();
    const cleanups = [
      loadTexture(EARTH_DAY, material, "map", THREE.SRGBColorSpace, invalidate, aniso),
      loadTexture(EARTH_NIGHT, material, "emissiveMap", THREE.SRGBColorSpace, invalidate, aniso),
    ];
    return () => cleanups.forEach((c) => c());
  }, [material, invalidate, gl]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      rimGeometry.dispose();
      rimMaterial.dispose();
    },
    [geometry, material, rimGeometry, rimMaterial],
  );

  useEffect(() => {
    invalidate();
  }, [visible, invalidate]);

  if (!visible) return null;

  return (
    <group position={EARTH_POSITION} raycast={() => null}>
      <mesh geometry={geometry} material={material} raycast={() => null} />
      {/* Atmospheric rim shell (cool-blue limb glow). */}
      <mesh geometry={rimGeometry} material={rimMaterial} raycast={() => null} />
    </group>
  );
}

// --- Sun (both views) — the scene's light emitter ---------------------------
// The Sun is the SINGLE light source: Scene3D's directionalLight sits at the same
// SUN_POSITION, so the key light literally comes FROM here. It is built from three
// camera-facing, additive, snapshot-independent layers so it reads as a brilliant
// DISTANT emitter throwing rays of light, not a near solid ball:
//   1. core disc — a small white-hot sphere (the body itself; ADR-0004 fallback,
//      always rendered even if the sprite textures somehow fail);
//   2. glow — a soft radial-gradient sprite that fades smoothly to nothing (no
//      hard ring);
//   3. rays — a starburst sprite (alternating long/short spokes) giving the
//      "shine waves" radiating outward.
// Sprites always face the camera, so the flare looks right from any orbit angle.
// All WHITE (sunlight in vacuum is white — no atmosphere to redden it) and
// toneMapped:false so they stay white-hot. The glow/ray textures are generated
// procedurally on a <canvas> (no external asset, no licensing) and disposed on
// unmount. No per-frame work — the flare is static (a spinning flare would force
// the demand loop to render forever).

// Build a soft round radial-gradient glow texture (white centre → transparent).
function makeGlowTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const size = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,251,242,0.55)");
  g.addColorStop(0.45, "rgba(255,247,233,0.14)");
  g.addColorStop(1, "rgba(255,247,233,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Build a starburst "rays" texture: a faint core plus alternating long/short
// spokes radiating from the centre — the sun's shine waves.
function makeRaysTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const size = 512;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  const cx = size / 2;
  const cy = size / 2;
  // Faint round core so the rays emerge from a glow, not a hard point.
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.14);
  core.addColorStop(0, "rgba(255,255,255,0.85)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, size, size);
  // Spokes — tapering triangles that fade to transparent at the tip.
  const spokes = 14;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const len = (i % 2 === 0 ? 0.5 : 0.32) * size; // alternating long/short
    const halfW = size * (i % 2 === 0 ? 0.013 : 0.009);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    const lg = ctx.createLinearGradient(0, 0, len, 0);
    lg.addColorStop(0, "rgba(255,250,235,0.55)");
    lg.addColorStop(1, "rgba(255,250,235,0)");
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(0, -halfW);
    ctx.lineTo(len, 0);
    ctx.lineTo(0, halfW);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Limb-darkening overlay (#85): a disc that is bright-white at the centre and
// fades to a warmer, dimmer edge — mimicking the real Sun's photosphere, which is
// brightest at disc-centre and cooler/dimmer toward the limb. Sized to sit just
// over the core disc; additive so it only ever brightens, keeping the core white.
function makeLimbTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const size = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // Bright white core → warmer, dimmer toward the limb, then a hard cutoff at the
  // disc edge so the overlay stays inside the body.
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.55, "rgba(255,250,238,0.5)");
  g.addColorStop(0.82, "rgba(255,232,200,0.22)");
  g.addColorStop(0.97, "rgba(255,222,186,0.06)");
  g.addColorStop(1, "rgba(255,222,186,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Faint chromatic-glow halo (#85): a soft round glow in a single tint, used twice
// (a warm #fff0d8 and a cool blue), each slightly offset, additive. The offset +
// the two tints give a subtle chromatic fringe around the flare without any
// per-frame work. Pass the tint; the gradient fades it smoothly to transparent.
function makeTintGlowTexture(r: number, g: number, b: number): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const size = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.5)`);
  grad.addColorStop(0.4, `rgba(${r},${g},${b},0.16)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function SunBody() {
  const invalidate = useThree((s) => s.invalidate);

  const { geometry, material } = useMemo(() => {
    const geometry = new THREE.SphereGeometry(SUN_RADIUS, 48, 48);
    // White-hot, self-lit. toneMapped:false keeps it pure white. #fff8f0 is the
    // fallback colour if the diffuse map fails — still essentially white.
    const material = new THREE.MeshStandardMaterial({
      color: "#fff8f0",
      emissive: "#ffffff",
      emissiveIntensity: 1.7,
      roughness: 1,
      metalness: 0,
      toneMapped: false,
      fog: false,
    });
    return { geometry, material };
  }, []);

  // Procedural flare textures (glow + rays + limb darkening + warm/cool chromatic
  // glows), built once and disposed on unmount. All static CanvasTextures (no
  // external asset, no useFrame).
  const { glowTex, raysTex, limbTex, warmTex, coolTex } = useMemo(
    () => ({
      glowTex: makeGlowTexture(),
      raysTex: makeRaysTexture(),
      limbTex: makeLimbTexture(),
      // Warm #fff0d8 and a cool blue for the offset chromatic glow.
      warmTex: makeTintGlowTexture(255, 240, 216),
      coolTex: makeTintGlowTexture(176, 200, 255),
    }),
    [],
  );
  useEffect(
    () => () => {
      glowTex?.dispose();
      raysTex?.dispose();
      limbTex?.dispose();
      warmTex?.dispose();
      coolTex?.dispose();
    },
    [glowTex, raysTex, limbTex, warmTex, coolTex],
  );

  useEffect(() => {
    // Faint diffuse granulation only (NO emissiveMap — that would re-introduce the
    // texture's yellow). The white emissive dominates, so the disc stays white.
    const cleanup = loadTexture(SUN_COLOR, material, "map", THREE.SRGBColorSpace, invalidate);
    return cleanup;
  }, [material, invalidate]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  return (
    <group position={SUN_POSITION} raycast={() => null}>
      {/* Rays — the radiating shine waves (largest, faintest). */}
      {raysTex && (
        <sprite scale={[SUN_RADIUS * 13, SUN_RADIUS * 13, 1]} raycast={() => null}>
          <spriteMaterial
            map={raysTex}
            blending={THREE.AdditiveBlending}
            transparent
            depthWrite={false}
            toneMapped={false}
            opacity={0.9}
            fog={false}
          />
        </sprite>
      )}
      {/* Soft round glow (mid). */}
      {glowTex && (
        <sprite scale={[SUN_RADIUS * 6, SUN_RADIUS * 6, 1]} raycast={() => null}>
          <spriteMaterial
            map={glowTex}
            blending={THREE.AdditiveBlending}
            transparent
            depthWrite={false}
            toneMapped={false}
            opacity={0.95}
            fog={false}
          />
        </sprite>
      )}
      {/* Faint chromatic glow — a warm and a cool halo, slightly offset, additive,
          giving a subtle chromatic fringe around the flare (#85). Both faint; the
          core stays white. */}
      {warmTex && (
        <sprite
          position={[SUN_RADIUS * 0.35, 0, 0]}
          scale={[SUN_RADIUS * 8, SUN_RADIUS * 8, 1]}
          raycast={() => null}
        >
          <spriteMaterial
            map={warmTex}
            blending={THREE.AdditiveBlending}
            transparent
            depthWrite={false}
            toneMapped={false}
            opacity={0.6}
            fog={false}
          />
        </sprite>
      )}
      {coolTex && (
        <sprite
          position={[-SUN_RADIUS * 0.35, 0, 0]}
          scale={[SUN_RADIUS * 8, SUN_RADIUS * 8, 1]}
          raycast={() => null}
        >
          <spriteMaterial
            map={coolTex}
            blending={THREE.AdditiveBlending}
            transparent
            depthWrite={false}
            toneMapped={false}
            opacity={0.45}
            fog={false}
          />
        </sprite>
      )}
      {/* Limb-darkening overlay — sits just over the core disc (bright centre →
          warmer/dimmer edge). Additive so the core stays white (#85). */}
      {limbTex && (
        <sprite scale={[SUN_RADIUS * 2.2, SUN_RADIUS * 2.2, 1]} raycast={() => null}>
          <spriteMaterial
            map={limbTex}
            blending={THREE.AdditiveBlending}
            transparent
            depthWrite={false}
            toneMapped={false}
            opacity={0.95}
            fog={false}
          />
        </sprite>
      )}
      {/* Core disc — the body itself (always present: ADR-0004 fallback). */}
      <mesh geometry={geometry} material={material} raycast={() => null} />
    </group>
  );
}

// --- Lunar base marker (orbit view only) — the clickable "objective" ---------
// A game-style location marker pinned to the Moon globe at the worksite's berth,
// shown ONLY in orbit. Clicking it (its invisible hit-proxy) calls onSelect,
// which flips the app to surface view → the existing glare-masked descent flies
// the camera down to the base. This is an INTENTIONAL second pickable surface,
// admissible because it exists only in orbit, where NO rover/worksite is rendered
// — so it never competes with the rover hit-proxies that own click-to-kill on the
// surface (#48). Demand-loop safe: no useFrame; hover just brightens/scales via
// React state, waking exactly one frame.
//
// It is seated on the Moon's near face (the point of the globe pointing back at
// the orbit camera) and oriented to the surface normal there, so the ring lies
// flat on the globe and the beacon rises straight up off the surface.
const MARKER_COLOR = "#38e1ff"; // brand telemetry cyan (matches selection/revive)

function LunarBaseMarker({ onSelect }: { onSelect: () => void }) {
  const invalidate = useThree((s) => s.invalidate);
  const [hover, setHover] = useState(false);

  // Seat on the globe's near face + orient to the surface normal there. The orbit
  // camera berths along +z/+y off the Moon (see ORBIT_POSE), so the near face
  // normal points roughly that way; the marker is therefore camera-facing.
  const { position, quaternion } = useMemo(() => {
    const n = new THREE.Vector3(0, 80, 410).normalize(); // ≈ orbit camera dir off the Moon
    const base = new THREE.Vector3(...MOON_POSITION).addScaledVector(n, MOON_RADIUS);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    return {
      position: base.toArray() as [number, number, number],
      quaternion: q.toArray() as [number, number, number, number],
    };
  }, []);

  useEffect(() => {
    invalidate();
  }, [hover, invalidate]);

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHover(true);
    document.body.style.cursor = "pointer";
  };
  const onOut = () => {
    setHover(false);
    document.body.style.cursor = "default";
  };

  const intensity = hover ? 2.4 : 1.5;
  const scale = hover ? 1.14 : 1;

  return (
    <group position={position} quaternion={quaternion} scale={scale}>
      {/* Invisible, generous hit-proxy — the SOLE pickable part. A click flips to
          surface view, triggering the descent. */}
      <mesh
        position={[0, 11, 0]}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onSelect();
        }}
        onPointerOver={onOver}
        onPointerOut={onOut}
      >
        <cylinderGeometry args={[7, 7, 30, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Pulsing-style ring flat on the surface (static — no per-frame work). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.4, 0]} raycast={() => null}>
        <ringGeometry args={[7, 10, 40]} />
        <meshStandardMaterial
          color={MARKER_COLOR}
          emissive={MARKER_COLOR}
          emissiveIntensity={intensity}
          toneMapped={false}
          transparent
          opacity={0.95}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* A bright core disc inside the ring. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.5, 0]} raycast={() => null}>
        <circleGeometry args={[6.2, 32]} />
        <meshStandardMaterial
          color={MARKER_COLOR}
          emissive={MARKER_COLOR}
          emissiveIntensity={intensity * 0.5}
          toneMapped={false}
          transparent
          opacity={0.28}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Vertical beacon — a short tapering glow column rising off the surface, the
          "you are here / land here" signal. Additive so it reads as light. Kept
          SHORT (was 36u, which foreshortened into a streak across the disc at the
          orbit angle) and dim so it reads as a beacon dot, not a line. */}
      <mesh position={[0, 8, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.4, 2.6, 16, 16, 1, true]} />
        <meshBasicMaterial
          color={MARKER_COLOR}
          transparent
          opacity={hover ? 0.32 : 0.18}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

// --- Nebula hero (orbit view only) — a deep-space vista accent ---------------
// A 3-layer ADDITIVE sprite stack using the ESA/Hubble Veil Nebula ("Witch's
// Broom", heic0712a — CC-BY 4.0). The raw image has a BRIGHT, busy background, so
// it is conditioned OFFLINE for additive use: the dark background is crushed to
// true black (so additive adds nothing there) and a radial vignette fades the
// edges to black (so the square sprite quad never reads as a hard rectangle). With
// that, additive over the sky shows only the bright filaments as faint nebulosity
// hanging in deep space (space-view-realism.md §4), against the Milky-Way band.
//
// Orbit-view-only — gated exactly like MoonGlobe (the worksite is ON the Moon, so
// a deep-space accent only belongs in the orbit vista). Demand-loop safe: the
// image loads imperatively (no Suspense throw), invalidate()s once on load and
// once on every visibility toggle; NO useFrame (three.Sprite billboards on the GPU
// with no per-frame work). All layers toneMapped:false, depthWrite:false,
// fog:false, raycast={()=>null}; NOT on the bloom layer.
//
// ADR-0004 fallback: if the Veil image fails to load, a procedural radial-gradient
// CanvasTexture stands in so the accent never blanks.

// Berthed off in the deep-space vista — beyond Earth, low and to the right, so it
// fills a corner of the orbit frame without crowding the Moon hero or Earth.
const NEBULA_POSITION: [number, number, number] = [1700, -650, -3200];
const NEBULA_SIZE = 1700; // base sprite scale (world units across)

// Procedural radial-gradient nebula fallback (ADR-0004): a soft cool-violet cloud,
// so the accent is never blank if the Veil image fails to load.
function makeNebulaFallbackTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const size = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(150,130,200,0.5)");
  g.addColorStop(0.4, "rgba(110,120,190,0.2)");
  g.addColorStop(1, "rgba(90,110,180,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function NebulaHero({ visible }: { visible: boolean }) {
  const invalidate = useThree((s) => s.invalidate);

  // The displayed texture: starts as the procedural fallback, swapped to the Veil
  // image once it loads (ADR-0004). Held in state so the swap re-renders.
  const fallbackTex = useMemo(() => makeNebulaFallbackTexture(), []);
  const [tex, setTex] = useState<THREE.Texture | null>(fallbackTex);

  // Load the Veil image imperatively (no Suspense throw). On success, swap in the
  // image and invalidate once; on failure keep the fallback.
  useEffect(() => {
    let disposed = false;
    let loaded: THREE.Texture | null = null;
    new THREE.TextureLoader().load(
      NEBULA_VEIL,
      (t) => {
        if (disposed) {
          t.dispose();
          return;
        }
        t.colorSpace = THREE.SRGBColorSpace;
        loaded = t;
        setTex(t);
        invalidate();
      },
      undefined,
      () => {
        // Load failed → keep the procedural fallback (ADR-0004).
      },
    );
    return () => {
      disposed = true;
      loaded?.dispose();
    };
  }, [invalidate]);

  // Dispose the procedural fallback on unmount (the loaded image is disposed by the
  // loader effect's cleanup above).
  useEffect(() => () => fallbackTex?.dispose(), [fallbackTex]);

  // Toggling visibility under the demand loop must wake one frame so the change is
  // painted; otherwise the accent sticks.
  useEffect(() => {
    invalidate();
  }, [visible, invalidate]);

  if (!visible || !tex) return null;

  // Three CONCENTRIC additive layers at decreasing size/opacity → a layered, soft
  // cloud with a brighter core. The layers are concentric (NOT offset): the texture
  // is now vignetted to fade to black at its edges, so offsetting would re-expose
  // the (faded) quad edges as faint rectangles. Concentric + edge-vignetted reads
  // as one soft cloud. Opacities kept low so it's a subtle deep-space accent, not a
  // dominating panel that fights the Moon/Earth/Milky-Way composition.
  const layers: { scale: number; opacity: number }[] = [
    { scale: 1.0, opacity: 0.3 },
    { scale: 0.66, opacity: 0.26 },
    { scale: 0.4, opacity: 0.22 },
  ];

  return (
    <group position={NEBULA_POSITION} raycast={() => null}>
      {layers.map((l, i) => (
        <sprite
          key={i}
          scale={[NEBULA_SIZE * l.scale, NEBULA_SIZE * l.scale, 1]}
          raycast={() => null}
        >
          <spriteMaterial
            map={tex}
            blending={THREE.AdditiveBlending}
            transparent
            depthWrite={false}
            toneMapped={false}
            opacity={l.opacity}
            fog={false}
          />
        </sprite>
      ))}
    </group>
  );
}

// SkyBodies — the Sun (light emitter, both views) + the Moon globe (orbit-only,
// the space-vista hero) + Earth (a distant marble, both views) + the clickable
// lunar-base marker (orbit-only) + the nebula hero accent (orbit-only). The
// starfield (SpaceEnvironment) shows in both.
// `onBaseClick`, when provided, flips the app to surface view (the descent) when
// the marker is clicked.
export function SkyBodies({
  viewMode,
  onBaseClick,
}: {
  viewMode: ViewMode;
  onBaseClick?: () => void;
}) {
  const inOrbit = viewMode === "orbit";
  return (
    <>
      <SunBody />
      <MoonGlobe visible={inOrbit} />
      <NebulaHero visible={inOrbit} />
      <EarthBody visible />
      {inOrbit && onBaseClick ? <LunarBaseMarker onSelect={onBaseClick} /> : null}
    </>
  );
}
