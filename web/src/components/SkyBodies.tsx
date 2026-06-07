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

import { useEffect, useMemo, useRef, useState } from "react";
import { Detailed } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import type { ThreeEvent } from "@react-three/fiber";

import { CELESTIAL_BLOOM_LAYER, type ViewMode } from "./Scene3D";
import {
  EARTH_POSITION,
  EARTH_RADIUS,
  MOON_POSITION,
  MOON_RADIUS,
  ORBIT_SUN_POSITION,
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
const EARTH_CLOUDS = "/assets/textures/earth_clouds_2048.jpg";
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

// --- Earth atmosphere Fresnel shader (#102) ---------------------------------
// A physically-motivated atmosphere rim on a BackSide shell (radius ×1.03), the
// successor to #86's flat MeshBasicMaterial halo. Two effects combine:
//   • Fresnel — pow(1 - dot(normal, viewDir), p): the halo is thin/bright exactly
//     at the limb (grazing angle) and fades toward disc-centre, the read of light
//     scattering through a deep slice of air at the edge.
//   • Sun-angle — max(0, dot(normal, sunDir)): the rim glows on the SUNLIT side and
//     dims to nothing on the dark limb, because there is no sunlight to scatter
//     there. A soft floor keeps a whisper of rim on the night limb (earthshine).
// The body is tinted with a Rayleigh BLUE (short wavelengths scatter most → the
// sky's blue), warming to a Mie GOLD band near the terminator (forward-scattered
// low-sun light → the sunrise/sunset rim). Fully STATIC: every uniform is set once
// at build time (sun direction in Earth-local space, since the shell is a child of
// the Earth group), so there is NO per-frame work — 0 idle fps preserved.
//
// Structured for reuse: #112 (Living Earth) layers a cloud/animation pass on top,
// so the uniforms + the fresnel/sun-angle split are kept explicit and named.
//
// ADR-0004 fallback: a ShaderMaterial cannot "fail to load" (no external asset);
// the GLSL is inlined. If shader compilation ever degrades, the additive shell
// simply contributes nothing — Earth still renders as the lit/unlit marble beneath.
const ATMOSPHERE_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vNormal;       // object-space surface normal
  varying vec3 vViewDir;      // object-space dir from surface point toward the camera
  void main() {
    vNormal = normalize(normal);
    // Camera position in object space (the shell is centered on Earth's origin, so
    // object space here is Earth-local — the sun-direction uniform is in the same
    // frame). View direction = from the vertex toward the camera.
    vec3 camObj = (inverse(modelViewMatrix) * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vViewDir = normalize(camObj - position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // Logarithmic depth (see EARTH_VERTEX): the rim depth-tests correctly against the
    // Earth surface so its limb halo clips to the silhouette instead of flickering.
    #include <logdepthbuf_vertex>
  }
`;

const ATMOSPHERE_FRAGMENT = /* glsl */ `
  uniform vec3 uSunDir;        // Earth→Sun direction, object-space (set once)
  uniform vec3 uRayleigh;      // cool blue body tint
  uniform vec3 uMie;           // warm terminator-band tint
  uniform float uIntensity;    // overall rim brightness
  uniform float uPower;        // fresnel falloff exponent
  uniform float uNightFloor;   // residual rim on the dark limb (earthshine)
  varying vec3 vNormal;
  varying vec3 vViewDir;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec3 N = normalize(vNormal);
    // Fresnel: bright at the limb (N ⟂ view), fading toward disc-centre.
    float fresnel = pow(clamp(1.0 - dot(N, normalize(vViewDir)), 0.0, 1.0), uPower);
    // Sun illumination of THIS rim point: lit limb glows, dark limb dims out.
    float sun = dot(N, normalize(uSunDir));
    float lit = max(sun, 0.0);
    // Keep a whisper of rim on the night limb (earthshine), never fully black.
    float sunMask = mix(uNightFloor, 1.0, lit);
    // Warm Mie band straddling the terminator (sun grazing → forward scatter),
    // blue Rayleigh body elsewhere. The band peaks where the sun is near-horizon
    // (|sun| small) on the lit side.
    float mieBand = smoothstep(0.5, 0.0, abs(sun)) * lit;
    vec3 tint = mix(uRayleigh, uMie, mieBand);
    float alpha = fresnel * sunMask * uIntensity;
    gl_FragColor = vec4(tint * alpha, alpha);
  }
`;

// --- Living Earth surface shader (Wave 4) -----------------------------------
// A custom day/night ShaderMaterial that replaces the old "day map brighter than
// the night emissive" trick with a REAL terminator, masked city lights, a warm
// sunset scatter band, and a moving OCEAN SUN-GLINT (the "sun waves reflecting in
// Earth" the brief asks for) — the SVS #14992 read. Self-determined from a single
// world-space sun-direction uniform (decoupled from the scene lights), so it is
// stable as the Earth body SPINS (the world normal + UV rotate together while the
// sun stays put → the terminator sweeps the continents).
//
// Frame math: everything is WORLD space. The vertex shader builds the world normal
// (`mat3(modelMatrix) * normal`, so it tracks the mesh's rotation) and a world view
// dir (`cameraPosition − worldPos`, so the glint tracks the orbiting camera). The
// ACES tone-map + sRGB output chunks are appended so Earth sits in the SAME pipeline
// as the rest of the scene; input maps are linearized in-shader (raw ShaderMaterial
// texels are undecoded). ADR-0004: uniforms default to 1×1 solid textures, so a
// failed map load still renders a clean lit marble.
const EARTH_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vViewDir = normalize(cameraPosition - worldPos);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // Logarithmic depth (Canvas runs logarithmicDepthBuffer): the Earth surface + the
    // cloud shell that shares this vertex shader sit at a RESOLVABLE depth from each
    // other at the ~4.7k orbit distance. Without it the hyperbolic depth buffer can't
    // separate the ×1.0/×1.012 shells → they z-fight and flicker.
    #include <logdepthbuf_vertex>
  }
`;

const EARTH_FRAGMENT = /* glsl */ `
  uniform sampler2D uDayMap;     // Blue Marble (sRGB texels — linearized below)
  uniform sampler2D uNightMap;   // Black Marble city lights
  uniform vec3 uSunDir;          // world-space Earth→Sun (normalized, view-conditional)
  uniform vec3 uNightColor;      // warm-gold city-light tint
  uniform vec3 uGlintColor;      // specular sun-glint colour
  uniform float uTime;           // seconds — drives glint shimmer + city flicker
  uniform float uTermWidth;      // half-width of the soft day/night terminator
  uniform float uGlintShininess; // specular exponent (tight highlight)
  uniform float uGlintStrength;  // glint brightness
  uniform float uAmbient;        // faint day-side floor so the disc is never pure black
  uniform float uDayExposure;    // day-side brightness scale (tames the bright Blue Marble)
  uniform float uNightFill;      // earthshine wash on the dark side (smooths the terminator)
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;
  varying vec2 vUv;
  #include <logdepthbuf_pars_fragment>

  vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(vViewDir);
    vec3 L = normalize(uSunDir);
    float ndl = dot(N, L);

    vec3 day = toLinear(texture2D(uDayMap, vUv).rgb);
    vec3 night = toLinear(texture2D(uNightMap, vUv).rgb);

    // Soft terminator (Earth's atmosphere softens it — unlike the crisp Moon edge).
    float dayF = smoothstep(-uTermWidth, uTermWidth, ndl);

    // Day diffuse with a faint ambient floor, scaled DOWN by uDayExposure so the
    // sunlit hemisphere reads as a soft lit marble rather than a blown-out, bloom-
    // amplified disc (the "day side too bright" the user flagged). A >1 exponent makes
    // the brightness rise SLOWLY just past the terminator (the old 0.8 rose too fast
    // and re-sharpened the edge), so the day eases in over a broad dusk band.
    float diff = pow(max(ndl, 0.0), 1.3);
    vec3 lit = day * (uAmbient + (1.0 - uAmbient) * diff) * uDayExposure;

    // City lights — NIGHT side only (masked by 1−dayF so they never bleed onto the
    // lit hemisphere), with a gentle per-pixel flicker. A LIMB FADE (by view angle)
    // kills the bright orange vertical smear that foreshortened equirect city-light
    // bands produce at the grazing night limb — cities only read on the face.
    float NdotV = max(dot(N, V), 0.0);
    float limbFade = smoothstep(0.0, 0.32, NdotV);
    // Low spatial frequency on purpose: Earth is a small distant marble, so the
    // fine per-texel terms the city flicker used to carry aliased into crawling dark
    // speckle as the globe turned. A broad, slow shimmer reads as "alive" without the
    // moire. (Same reasoning for the ocean-glint shimmer below.)
    float flicker = 0.94 + 0.06 * sin(uTime * 1.6 + vUv.x * 22.0) * sin(uTime * 1.1 + vUv.y * 18.0);
    vec3 city = night * uNightColor * (1.0 - dayF) * flicker * limbFade;

    // Ocean sun-glint — the "sun waves". Ocean mask from the day map (blue-dominant,
    // low land), Blinn-Phong highlight at the sub-solar point, shimmered over time.
    float ocean = smoothstep(0.015, 0.10, day.b - max(day.r, day.g));
    vec3 H = normalize(L + V);
    float shimmer = 1.0 + 0.04 * sin(uTime * 1.7 + vUv.x * 14.0)
                        + 0.04 * sin(uTime * 1.3 + vUv.y * 11.0);
    float spec = pow(max(dot(N, H), 0.0), uGlintShininess);
    vec3 glint = uGlintColor * spec * ocean * dayF * uGlintStrength * shimmer;

    // Earthshine night fill — a faint COOL wash of the day geography across the dark
    // hemisphere, so the night side reads as dim, blue-lit earth rather than a pure-
    // black cutout. THIS is what makes the day/night boundary smooth: the same trick
    // that softens the MOON's terminator (its dark side is filled by earthshine + IBL,
    // so the edge is a grey→grey gradient, not lit→black). Kept low + cool; on the lit
    // side dayF→1 so the mix below weights it out → the day side is unaffected.
    vec3 nightFill = day * uNightFill * vec3(0.7, 0.85, 1.15);
    vec3 darkSide = nightFill + city;

    // Fade the whole surface shader at the EXTREME grazing limb — foreshortened
    // equirect texels alias into a bright vertical streak there. The atmosphere rim
    // shell carries the limb glow, so fading the surface a few degrees in is invisible.
    float surfFade = smoothstep(0.0, 0.06, NdotV);
    vec3 color = (mix(darkSide, lit, dayF) + glint) * surfFade;
    gl_FragColor = vec4(color, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// --- Cloud shell shader (Wave 4, #112) --------------------------------------
// A thin transparent shell over Earth: white cloud where the density map is bright,
// lit by the same sun, fading to nothing on the night side. Rotates INDEPENDENTLY of
// the Earth body for parallax life. ADR-0004: a failed cloud-map load leaves the
// default black (density 0) texture → alpha 0 → the shell renders nothing.
const CLOUD_FRAGMENT = /* glsl */ `
  uniform sampler2D uCloudMap;   // grayscale cloud density (NASA Blue Marble clouds)
  uniform vec3 uSunDir;
  uniform float uAmbient;
  uniform float uOpacity;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;
  varying vec2 vUv;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    float density = texture2D(uCloudMap, vUv).r;
    vec3 N = normalize(vWorldNormal);
    float ndl = dot(N, normalize(uSunDir));
    // Wider, softer day fade so clouds dissolve gently across the terminator instead
    // of cutting off in a hard arc.
    float dayF = smoothstep(-0.2, 0.35, ndl);
    // Sun-lit cloud, but held below pure white (×0.8) so the day side doesn't blow out.
    vec3 col = vec3(uAmbient + max(ndl, 0.0) * 0.8);
    float alpha = density * dayF * uOpacity;     // gone on the night side
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// A 1×1 solid-colour fallback texture (ADR-0004) for the Earth shader uniforms, so
// `texture2D` is always valid even before/without a real map.
function makeSolidTexture(r: number, g: number, b: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

// Imperatively load a texture into a shader UNIFORM (the ShaderMaterial analogue of
// loadTexture's material-slot loader). Raw texels (NoColorSpace) — the Earth/cloud
// shaders linearize in-GLSL. A failed load leaves the uniform's solid fallback.
function loadUniformTexture(
  url: string,
  uniform: THREE.IUniform,
  invalidate: () => void,
  anisotropy: number,
): () => void {
  let disposed = false;
  let texture: THREE.Texture | null = null;
  new THREE.TextureLoader().load(
    url,
    (t) => {
      if (disposed) {
        t.dispose();
        return;
      }
      t.colorSpace = THREE.NoColorSpace;
      t.anisotropy = anisotropy;
      t.wrapS = THREE.RepeatWrapping; // equirectangular maps wrap horizontally
      t.wrapT = THREE.ClampToEdgeWrapping;
      // Mipmaps ON (default) with max anisotropy minify the equirect cleanly at the
      // grazing limb; the surface limb-fade in EARTH_FRAGMENT handles the residual
      // foreshortening streak.
      texture = t;
      uniform.value = t;
      invalidate();
    },
    undefined,
    () => {
      // Missing/failed ⇒ keep the solid fallback already in the uniform (ADR-0004).
    },
  );
  return () => {
    disposed = true;
    texture?.dispose();
  };
}

// --- Earth (both views) -----------------------------------------------------
// A distant marble hung high in the black sky to give the sense of deep space.
// SIZED PROPORTIONALLY to the Moon (EARTH_RADIUS = MOON_RADIUS × 3.67, the real
// diameter ratio) and hung beyond the Moon's upper-right limb so the orbit vista
// matches the NASA reference: the Moon is the close hero (~38°) and Earth the
// smaller-but-farther marble (~13°). Shown in BOTH views. A LIVING body now —
// it spins under a drifting cloud shell, oceans glinting at the sub-solar point.
// EARTH_RADIUS + EARTH_POSITION live in lib/scene so Scene3D's earthshine light
// can share Earth's position.

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
          "  // Wave 4: dimmed 0.14→0.05 — on the now near-black dark side the brighter",
          "  // halo ringed the whole disc like a (false) atmosphere; the Moon is airless.",
          "  gl_FragColor.rgb += uRimColor * ( rim * rim ) * 0.05;",
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
    // Pushed a touch (0.9→1.05 / 0.6→0.72) for Wave 4: with the decoupled orbit sun
    // now back/side-lighting the Moon (dark-side crescent — SVS #14992), the
    // surviving sunlit limb is a RAKING light, so stronger crater-rim relief reads as
    // dramatic terminator detail rather than over-shading.
    matNear.normalScale.set(1.05, 1.05);
    matFar.normalScale.set(0.72, 0.72);
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

// Earth, shown in BOTH views (space-view-realism.md §2; Wave 4 living-Earth). A
// LIVING day/night marble: the custom EARTH_FRAGMENT shader (real terminator, masked
// city lights, warm scatter band, ocean sun-glint) on a slowly-spinning body, under
// a drifting CLOUD shell, wrapped in the #102 atmospheric rim. Shown in both views.
//
// `uSunDir` is VIEW-CONDITIONAL: it points to the decoupled ORBIT_SUN in orbit (the
// dark-side crescent composition) and to SUN_POSITION on the surface. `visible`
// stays a prop for symmetry with MoonGlobe; SkyBodies always mounts Earth visible.
//
// Spin rates (rad/s) — slow + cinematic, not dizzying; clouds drift a touch faster
// than the surface so they shear over the continents. Wave 4.1: dialled WAY down
// (0.03→0.008 / 0.042→0.011). Earth is a tiny ~80px disc, so the 2048px equirect
// maps minify ~25× — a fast spin made the high-contrast coastlines/oceans crawl and
// alias into the "collapsing / black flickering" the user saw. A near-stately turn
// (one rotation ≈ 13 min) reads as "alive" while the per-frame texel motion stays
// well under the minification floor, so the temporal moire is gone.
const EARTH_SPIN = 0.008;
const CLOUD_SPIN = 0.011;

// Earth's ORBIT sun DIRECTION is decoupled from the Moon's dramatic dark-side sun
// (ORBIT_SUN_POSITION). The Moon's sun sits far behind it for a thin crescent; if
// Earth shared it, Earth would also be a razor-thin crescent — but the brief wants
// Earth to clearly show a day side AND a night side (and the ocean sun-glint needs
// the day side facing us). Earth and the Moon are separate, far-apart decorative
// bodies, so an independent sun angle for Earth's shader reads fine. Tuned ~⟂ to the
// orbit view so Earth shows a near-half terminator with the day side toward the Moon.
const EARTH_ORBIT_SUN_DIR = new THREE.Vector3(0.45, 0.12, -0.88).normalize();

function EarthBody({ visible, viewMode }: { visible: boolean; viewMode: ViewMode }) {
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  // Spinning bodies (earth surface + cloud shell) + the static rim shell.
  const earthRef = useRef<THREE.Mesh>(null);
  const cloudRef = useRef<THREE.Mesh>(null);
  const rimRef = useRef<THREE.Mesh>(null);
  const tRef = useRef(0);

  // World-space Earth→Sun direction for the CURRENT view (orbit vs surface). The
  // Earth group is unrotated, so this world vector also serves the rim shell's
  // object-space shader (object axes == world axes there).
  const sunWorldDir = useMemo(() => {
    // Orbit: Earth's own tuned sun angle (decoupled from the Moon's dark-side sun).
    if (viewMode === "orbit") return EARTH_ORBIT_SUN_DIR.clone();
    // Surface: lit by the real worksite sun.
    return new THREE.Vector3(
      SUN_POSITION[0] - EARTH_POSITION[0],
      SUN_POSITION[1] - EARTH_POSITION[1],
      SUN_POSITION[2] - EARTH_POSITION[2],
    ).normalize();
  }, [viewMode]);

  const {
    geometry,
    material,
    cloudGeometry,
    cloudMaterial,
    rimGeometry,
    rimMaterial,
    fallbacks,
  } = useMemo(() => {
    const geometry = new THREE.SphereGeometry(EARTH_RADIUS, 64, 64);

    // ADR-0004 fallbacks: a deep-ocean-blue day map + black night/cloud maps, so the
    // shaders render a clean lit marble (and no clouds) even if a load fails.
    const dayFallback = makeSolidTexture(42, 74, 140); // #2a4a8c
    const nightFallback = makeSolidTexture(0, 0, 0);
    const cloudFallback = makeSolidTexture(0, 0, 0);

    const material = new THREE.ShaderMaterial({
      vertexShader: EARTH_VERTEX,
      fragmentShader: EARTH_FRAGMENT,
      uniforms: {
        uDayMap: { value: dayFallback },
        uNightMap: { value: nightFallback },
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        // Warm-gold city lights (boosted past 1 so they read as emissive at night).
        uNightColor: { value: new THREE.Color("#ffcb78").multiplyScalar(1.5) },
        uGlintColor: { value: new THREE.Color("#fff4e0").multiplyScalar(1.2) },
        uTime: { value: 0 },
        // Wide, soft terminator (Wave 4.1) — Earth's thick atmosphere scatters the
        // day/night boundary into a gentle gradient, not the crisp Moon edge. The
        // old 0.12 read as a hard line; widened again 0.24→0.45 so the day/night
        // hand-off is a broad, smooth dusk band like the NASA reference.
        uTermWidth: { value: 0 }, // soft terminator half-width
        // Broader sub-solar highlight (60→30): a tight specular speckled at the small
        // marble size; a softer, wider glint reads cleanly as "sun on the oceans".
        uGlintShininess: { value: 30.0 },
        uGlintStrength: { value: 0.7 },
        uAmbient: { value: 0.03 },
        // Day-side exposure (Wave 4.1): pull the sunlit hemisphere down so the bright
        // Blue Marble + bloom no longer blows out. Dropped 0.6→0.44 (operator: day
        // side darker) for a moodier, deeper-space read.
        uDayExposure: { value: 0.44 },
        // Earthshine night fill (Wave 4.1): a faint cool wash of the day geography on
        // the dark side so the terminator is a smooth grey→grey gradient (like the
        // Moon), not a hard lit→black edge. 0.08→0.055 (operator: dark side a little
        // darker) — still filled enough to keep the terminator soft, just dimmer.
        uNightFill: { value: 0.055 },
      },
      fog: false,
    });

    // Cloud shell — a thin transparent sphere just above the surface. Reuses the
    // Earth vertex shader (world normal + uv); the CLOUD_FRAGMENT lights it by the
    // sun and fades it out on the night side.
    const cloudGeometry = new THREE.SphereGeometry(EARTH_RADIUS * 1.012, 64, 64);
    const cloudMaterial = new THREE.ShaderMaterial({
      vertexShader: EARTH_VERTEX,
      fragmentShader: CLOUD_FRAGMENT,
      uniforms: {
        uCloudMap: { value: cloudFallback },
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uAmbient: { value: 0.04 },
        // Wave 4.1: 0.9→0.55. Near-opaque white clouds were a big part of the bright,
        // "torn" day side — a thinner veil shears far more gently over the surface.
        uOpacity: { value: 0.55 },
      },
      transparent: true,
      depthWrite: false,
      fog: false,
    });

    // Atmospheric rim — back-side additive shell (#102), unchanged shader. Kept as a
    // non-spinning child so the limb glow stays symmetric while the surface turns.
    const rimGeometry = new THREE.SphereGeometry(EARTH_RADIUS * 1.03, 48, 48);
    const rimMaterial = new THREE.ShaderMaterial({
      vertexShader: ATMOSPHERE_VERTEX,
      fragmentShader: ATMOSPHERE_FRAGMENT,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uRayleigh: { value: new THREE.Color("#4a86d6") },
        uMie: { value: new THREE.Color("#ffd6a0") },
        uIntensity: { value: 0.9 },
        uPower: { value: 4.0 },
        uNightFloor: { value: 0.08 },
      },
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    return {
      geometry,
      material,
      cloudGeometry,
      cloudMaterial,
      rimGeometry,
      rimMaterial,
      fallbacks: [dayFallback, nightFallback, cloudFallback],
    };
  }, []);

  // Load the real maps into the shader uniforms (ADR-0004: a failed load leaves the
  // solid fallback already in the uniform). Max anisotropy keeps the terminator +
  // coastlines crisp at the grazing limb.
  useEffect(() => {
    const aniso = gl.capabilities.getMaxAnisotropy();
    const cleanups = [
      loadUniformTexture(EARTH_DAY, material.uniforms.uDayMap, invalidate, aniso),
      loadUniformTexture(EARTH_NIGHT, material.uniforms.uNightMap, invalidate, aniso),
      loadUniformTexture(EARTH_CLOUDS, cloudMaterial.uniforms.uCloudMap, invalidate, aniso),
    ];
    return () => cleanups.forEach((c) => c());
  }, [material, cloudMaterial, invalidate, gl]);

  // Point every shader's sun uniform at the current view's sun (orbit vs surface).
  useEffect(() => {
    material.uniforms.uSunDir.value.copy(sunWorldDir);
    cloudMaterial.uniforms.uSunDir.value.copy(sunWorldDir);
    rimMaterial.uniforms.uSunDir.value.copy(sunWorldDir);
    invalidate();
  }, [sunWorldDir, material, cloudMaterial, rimMaterial, invalidate]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      cloudGeometry.dispose();
      cloudMaterial.dispose();
      rimGeometry.dispose();
      rimMaterial.dispose();
      fallbacks.forEach((t) => t.dispose());
    },
    [geometry, material, cloudGeometry, cloudMaterial, rimGeometry, rimMaterial, fallbacks],
  );

  // Enable the celestial-bloom layer on Earth's rim shell so its cool-blue limb
  // glows softly in the cinematic bloom pass (#99). Layer-gated (ADR-0004).
  useEffect(() => {
    rimRef.current?.layers.enable(CELESTIAL_BLOOM_LAYER);
  }, [visible]);

  // The living loop (frameloop="always"): spin the Earth + clouds and advance the
  // shader clock that drives the ocean-glint shimmer, city flicker, and a faint
  // atmosphere "breathe". Early-out while the tab is hidden (battery).
  useFrame((_, dt) => {
    if (typeof document !== "undefined" && document.hidden) return;
    if (!earthRef.current) return;
    const t = (tRef.current += dt);
    earthRef.current.rotation.y += dt * EARTH_SPIN;
    if (cloudRef.current) cloudRef.current.rotation.y += dt * CLOUD_SPIN;
    material.uniforms.uTime.value = t;
    rimMaterial.uniforms.uIntensity.value = 0.9 + 0.08 * Math.sin(t * 0.6);
  });

  if (!visible) return null;

  return (
    <group position={EARTH_POSITION} raycast={() => null}>
      {/* Living day/night surface — spins. */}
      <mesh ref={earthRef} geometry={geometry} material={material} raycast={() => null} />
      {/* Drifting cloud shell — spins a touch faster. */}
      <mesh ref={cloudRef} geometry={cloudGeometry} material={cloudMaterial} raycast={() => null} />
      {/* Atmospheric rim shell (cool-blue limb glow) — on CELESTIAL_BLOOM_LAYER. */}
      <mesh ref={rimRef} geometry={rimGeometry} material={rimMaterial} raycast={() => null} />
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

function SunBody({ position }: { position: [number, number, number] }) {
  const invalidate = useThree((s) => s.invalidate);
  // The Sun core mesh glows in the celestial bloom pass (#99).
  const coreRef = useRef<THREE.Mesh>(null);

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
      // Warm #fff0d8 and a near-neutral cool tint for the offset chromatic glow.
      // The cool half is kept only FAINTLY blue (Wave 4.1): when the warm core is
      // occluded behind the Moon's limb in orbit, a saturated blue sprite poked out
      // and read as a TEAL flare. A desaturated, lower-opacity cool tint keeps the
      // subtle fringe on the fully-visible surface-view sun without the teal edge.
      warmTex: makeTintGlowTexture(255, 240, 216),
      coolTex: makeTintGlowTexture(206, 216, 240),
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

  // Enable the celestial-bloom layer on the Sun core so the brightest body in the
  // scene blooms in the cinematic pass (#99). Layer-gated (ADR-0004) — only the
  // core disc glows, not the whole scene. The additive flare sprites already
  // brighten on their own, so they stay off this layer.
  useEffect(() => {
    coreRef.current?.layers.enable(CELESTIAL_BLOOM_LAYER);
  }, []);

  return (
    <group position={position} raycast={() => null}>
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
          position={[-SUN_RADIUS * 0.22, 0, 0]}
          scale={[SUN_RADIUS * 8, SUN_RADIUS * 8, 1]}
          raycast={() => null}
        >
          <spriteMaterial
            map={coolTex}
            blending={THREE.AdditiveBlending}
            transparent
            depthWrite={false}
            toneMapped={false}
            opacity={0.3}
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
      {/* Core disc — the body itself (always present: ADR-0004 fallback).
          On CELESTIAL_BLOOM_LAYER so it glows in the cinematic bloom pass (#99). */}
      <mesh ref={coreRef} geometry={geometry} material={material} raycast={() => null} />
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
  // DECOUPLED sun (Wave 4): the visible flare follows the same swing as the key
  // directionalLight in Scene3D — orbit reads the dark-side crescent Moon (the flare
  // sits ~69° off-axis, off-frame), surface keeps the worksite's lit-from-above sun.
  return (
    <>
      <SunBody position={inOrbit ? ORBIT_SUN_POSITION : SUN_POSITION} />
      <MoonGlobe visible={inOrbit} />
      <NebulaHero visible={inOrbit} />
      <EarthBody visible viewMode={viewMode} />
      {inOrbit && onBaseClick ? <LunarBaseMarker onSelect={onBaseClick} /> : null}
    </>
  );
}
