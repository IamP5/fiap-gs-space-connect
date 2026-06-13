
import { useEffect, useMemo, useRef, useState } from "react";
import { Billboard, Detailed, Line, Text } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import type { ThreeEvent } from "@react-three/fiber";

import { CELESTIAL_BLOOM_LAYER, type ViewMode } from "./Scene3D";
import {
  loadTexture as loadCachedTexture,
  preloadTexture,
} from "../lib/textureCache";
import {
  EARTH_POSITION,
  EARTH_RADIUS,
  latLonToGlobeNormal,
  latLonToGlobePoint,
  MOON_POSITION,
  MOON_RADIUS,
  ORBIT_SUN_POSITION,
  SUN_POSITION,
  SUN_RADIUS,
} from "../lib/scene";
import type { SiteId } from "./Scene3D";

export const MOON_COLOR = "/assets/textures/moon_color_4096.jpg";
export const MOON_NORMAL = "/assets/textures/moon_normal_4096.jpg";
export const EARTH_DAY = "/assets/textures/earth_day_2048.jpg";
export const EARTH_NIGHT = "/assets/textures/earth_night_2048.jpg";
export const EARTH_CLOUDS = "/assets/textures/earth_clouds_2048.jpg";
export const SUN_COLOR = "/assets/textures/sun_color_1024.jpg";
export const NEBULA_VEIL = "/assets/textures/nebula_veil_1024.jpg";


const MOON_LOD_SWITCH = 420;

const ATMOSPHERE_VERTEX = `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vNormal = normalize(normal);
    vec3 camObj = (inverse(modelViewMatrix) * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vViewDir = normalize(camObj - position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const ATMOSPHERE_FRAGMENT = `
  uniform vec3 uSunDir;
  uniform vec3 uRayleigh;
  uniform vec3 uMie;
  uniform float uIntensity;
  uniform float uPower;
  uniform float uNightFloor;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec3 N = normalize(vNormal);
    float fresnel = pow(clamp(1.0 - dot(N, normalize(vViewDir)), 0.0, 1.0), uPower);
    float sun = dot(N, normalize(uSunDir));
    float lit = max(sun, 0.0);
    float sunMask = mix(uNightFloor, 1.0, lit);
    float mieBand = smoothstep(0.5, 0.0, abs(sun)) * lit;
    vec3 tint = mix(uRayleigh, uMie, mieBand);
    float alpha = fresnel * sunMask * uIntensity;
    gl_FragColor = vec4(tint * alpha, alpha);
  }
`;

const EARTH_VERTEX = `
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
    #include <logdepthbuf_vertex>
  }
`;

const EARTH_FRAGMENT = `
  uniform sampler2D uDayMap;
  uniform sampler2D uNightMap;
  uniform vec3 uSunDir;
  uniform vec3 uNightColor;
  uniform vec3 uGlintColor;
  uniform float uTime;
  uniform float uTermWidth;
  uniform float uGlintShininess;
  uniform float uGlintStrength;
  uniform float uAmbient;
  uniform float uDayExposure;
  uniform float uNightFill;
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

    float dayF = smoothstep(-uTermWidth, uTermWidth, ndl);

    float diff = pow(max(ndl, 0.0), 1.3);
    vec3 lit = day * (uAmbient + (1.0 - uAmbient) * diff) * uDayExposure;

    float NdotV = max(dot(N, V), 0.0);
    float limbFade = smoothstep(0.0, 0.32, NdotV);
    float flicker = 0.94 + 0.06 * sin(uTime * 1.6 + vUv.x * 22.0) * sin(uTime * 1.1 + vUv.y * 18.0);
    vec3 city = night * uNightColor * (1.0 - dayF) * flicker * limbFade;

    float ocean = smoothstep(0.015, 0.10, day.b - max(day.r, day.g));
    vec3 H = normalize(L + V);
    float shimmer = 1.0 + 0.04 * sin(uTime * 1.7 + vUv.x * 14.0)
                        + 0.04 * sin(uTime * 1.3 + vUv.y * 11.0);
    float spec = pow(max(dot(N, H), 0.0), uGlintShininess);
    vec3 glint = uGlintColor * spec * ocean * dayF * uGlintStrength * shimmer;

    vec3 nightFill = day * uNightFill * vec3(0.7, 0.85, 1.15);
    vec3 darkSide = nightFill + city;

    float surfFade = smoothstep(0.0, 0.06, NdotV);
    vec3 color = (mix(darkSide, lit, dayF) + glint) * surfFade;
    gl_FragColor = vec4(color, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const CLOUD_FRAGMENT = `
  uniform sampler2D uCloudMap;
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
    float dayF = smoothstep(-0.2, 0.35, ndl);
    vec3 col = vec3(uAmbient + max(ndl, 0.0) * 0.8);
    float alpha = density * dayF * uOpacity;
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function makeSolidTexture(r: number, g: number, b: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

function loadUniformTexture(
  url: string,
  uniform: THREE.IUniform,
  invalidate: () => void,
  anisotropy: number,
): () => void {
  let disposed = false;
  const t = loadCachedTexture(url);
  void preloadTexture(url).then(() => {
    if (disposed || !t.image) return;
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = anisotropy;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    uniform.value = t;
    invalidate();
  });
  return () => {
    disposed = true;
  };
}


function loadTexture(
  url: string,
  material: THREE.MeshStandardMaterial,
  key: "map" | "normalMap" | "roughnessMap" | "emissiveMap",
  colorSpace: THREE.ColorSpace,
  invalidate: () => void,
  anisotropy = 4,
): () => void {
  let disposed = false;
  const t = loadCachedTexture(url);
  void preloadTexture(url).then(() => {
    if (disposed || !t.image) return;
    t.colorSpace = colorSpace;
    t.anisotropy = anisotropy;
    t.needsUpdate = true;
    material[key] = t;
    material.needsUpdate = true;
    invalidate();
  });
  return () => {
    disposed = true;
    if (material[key] === t) material[key] = null;
  };
}

const MOON_RIM_GLOW_COLOR = new THREE.Color("#8fb4ff");
const MOON_LIMB_WARM_TINT = new THREE.Color("#fff1dc");

function patchMoonLimbShader(material: THREE.MeshStandardMaterial) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: MOON_RIM_GLOW_COLOR };
    shader.uniforms.uWarmTint = { value: MOON_LIMB_WARM_TINT };
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
          "  float darken = mix( 1.0, 0.62, rim );",
          "  gl_FragColor.rgb *= mix( vec3( 1.0 ), uWarmTint, rim * 0.5 ) * darken;",
          "  gl_FragColor.rgb += uRimColor * ( rim * rim ) * 0.05;",
          "}",
          "#include <tonemapping_fragment>",
        ].join("\n"),
      );
  };
}

function MoonGlobe({ visible }: { visible: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);

  const { geomNear, geomFar, matNear, matFar } = useMemo(() => {
    const geomNear = new THREE.SphereGeometry(MOON_RADIUS, 96, 96);
    const geomFar = new THREE.SphereGeometry(MOON_RADIUS, 48, 48);
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
    matNear.normalScale.set(1.1, 1.1);
    matFar.normalScale.set(0.72, 0.72);
    patchMoonLimbShader(matNear);
    patchMoonLimbShader(matFar);
    return { geomNear, geomFar, matNear, matFar };
  }, []);

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

  useEffect(
    () => () => {
      geomNear.dispose();
      geomFar.dispose();
      matNear.dispose();
      matFar.dispose();
    },
    [geomNear, geomFar, matNear, matFar],
  );

  useEffect(() => {
    invalidate();
  }, [visible, invalidate]);

  if (!visible) return null;

  return (
    <group position={MOON_POSITION} raycast={() => null}>
      <Detailed distances={[0, MOON_LOD_SWITCH]}>
        <mesh geometry={geomNear} material={matNear} raycast={() => null} />
        <mesh geometry={geomFar} material={matFar} raycast={() => null} />
      </Detailed>
    </group>
  );
}

const EARTH_SPIN = 0.008;
const CLOUD_SPIN = 0.011;

const EARTH_ORBIT_SUN_DIR = new THREE.Vector3(0.45, 0.12, -0.88).normalize();

function EarthBody({ visible, viewMode }: { visible: boolean; viewMode: ViewMode }) {
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const earthRef = useRef<THREE.Mesh>(null);
  const cloudRef = useRef<THREE.Mesh>(null);
  const rimRef = useRef<THREE.Mesh>(null);
  const tRef = useRef(0);

  const sunWorldDir = useMemo(() => {
    if (viewMode === "orbit") return EARTH_ORBIT_SUN_DIR.clone();
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

    const dayFallback = makeSolidTexture(42, 74, 140);
    const nightFallback = makeSolidTexture(0, 0, 0);
    const cloudFallback = makeSolidTexture(0, 0, 0);

    const material = new THREE.ShaderMaterial({
      vertexShader: EARTH_VERTEX,
      fragmentShader: EARTH_FRAGMENT,
      uniforms: {
        uDayMap: { value: dayFallback },
        uNightMap: { value: nightFallback },
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uNightColor: { value: new THREE.Color("#ffcb78").multiplyScalar(1.5) },
        uGlintColor: { value: new THREE.Color("#fff4e0").multiplyScalar(1.2) },
        uTime: { value: 0 },
        uTermWidth: { value: 0 },
        uGlintShininess: { value: 30.0 },
        uGlintStrength: { value: 0.7 },
        uAmbient: { value: 0.03 },
        uDayExposure: { value: 0.44 },
        uNightFill: { value: 0.055 },
      },
      fog: false,
    });

    const cloudGeometry = new THREE.SphereGeometry(EARTH_RADIUS * 1.012, 64, 64);
    const cloudMaterial = new THREE.ShaderMaterial({
      vertexShader: EARTH_VERTEX,
      fragmentShader: CLOUD_FRAGMENT,
      uniforms: {
        uCloudMap: { value: cloudFallback },
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uAmbient: { value: 0.04 },
        uOpacity: { value: 0.55 },
      },
      transparent: true,
      depthWrite: false,
      fog: false,
    });

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

  useEffect(() => {
    const aniso = gl.capabilities.getMaxAnisotropy();
    const cleanups = [
      loadUniformTexture(EARTH_DAY, material.uniforms.uDayMap, invalidate, aniso),
      loadUniformTexture(EARTH_NIGHT, material.uniforms.uNightMap, invalidate, aniso),
      loadUniformTexture(EARTH_CLOUDS, cloudMaterial.uniforms.uCloudMap, invalidate, aniso),
    ];
    return () => cleanups.forEach((c) => c());
  }, [material, cloudMaterial, invalidate, gl]);

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

  useEffect(() => {
    rimRef.current?.layers.enable(CELESTIAL_BLOOM_LAYER);
  }, [visible]);

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
      <mesh ref={earthRef} geometry={geometry} material={material} raycast={() => null} />
      <mesh ref={cloudRef} geometry={cloudGeometry} material={cloudMaterial} raycast={() => null} />
      <mesh ref={rimRef} geometry={rimGeometry} material={rimMaterial} raycast={() => null} />
    </group>
  );
}


const SUN_CORE_EMISSIVE = 1.7;

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

function makeRaysTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const size = 512;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  const cx = size / 2;
  const cy = size / 2;
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.14);
  core.addColorStop(0, "rgba(255,255,255,0.85)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, size, size);
  const spokes = 14;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const len = (i % 2 === 0 ? 0.5 : 0.32) * size;
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

function makeLimbTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const size = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
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

function makeAnamorphicStreakTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const w = 1024;
  const h = 128;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  const cx = w / 2;
  const cy = h / 2;
  const lg = ctx.createLinearGradient(0, 0, w, 0);
  lg.addColorStop(0, "rgba(150,185,255,0)");
  lg.addColorStop(0.5, "rgba(210,226,255,0.9)");
  lg.addColorStop(1, "rgba(150,185,255,0)");
  for (let y = 0; y < h; y++) {
    const d = Math.abs(y - cy) / cy;
    const v = Math.pow(1 - d, 6);
    if (v <= 0.001) continue;
    ctx.globalAlpha = v;
    ctx.fillStyle = lg;
    ctx.fillRect(0, y, w, 1);
  }
  ctx.globalAlpha = 1;
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, h * 0.6);
  core.addColorStop(0, "rgba(255,255,255,0.85)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = core;
  ctx.fillRect(cx - h, 0, h * 2, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function SunBody({
  position,
  coreRef: externalCoreRef,
  showStreak,
  occludeBehindMoon,
}: {
  position: [number, number, number];
  coreRef?: React.RefObject<THREE.Mesh>;
  showStreak?: boolean;
  occludeBehindMoon?: boolean;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const localCoreRef = useRef<THREE.Mesh>(null);
  const coreRef = externalCoreRef ?? localCoreRef;

  const { geometry, material } = useMemo(() => {
    const geometry = new THREE.SphereGeometry(SUN_RADIUS, 48, 48);
    const material = new THREE.MeshStandardMaterial({
      color: "#fff8f0",
      emissive: "#ffffff",
      emissiveIntensity: SUN_CORE_EMISSIVE,
      roughness: 1,
      metalness: 0,
      toneMapped: false,
      fog: false,
    });
    return { geometry, material };
  }, []);

  const { glowTex, raysTex, limbTex, warmTex, coolTex, streakTex } = useMemo(
    () => ({
      glowTex: makeGlowTexture(),
      raysTex: makeRaysTexture(),
      limbTex: makeLimbTexture(),
      streakTex: makeAnamorphicStreakTexture(),
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
      streakTex?.dispose();
    },
    [glowTex, raysTex, limbTex, warmTex, coolTex, streakTex],
  );

  useEffect(() => {
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

  useEffect(() => {
    coreRef.current?.layers.enable(CELESTIAL_BLOOM_LAYER);
  }, [coreRef]);

  const occScratch = useMemo(
    () => ({ cam: new THREE.Vector3(), dir: new THREE.Vector3(), m: new THREE.Vector3() }),
    [],
  );
  useFrame(() => {
    const core = coreRef.current;
    if (!core) return;
    let occluded = false;
    if (occludeBehindMoon) {
      const cam = camera.getWorldPosition(occScratch.cam);
      const dir = occScratch.dir.set(position[0], position[1], position[2]).sub(cam);
      const L = dir.length();
      if (L > 1e-3) {
        dir.divideScalar(L);
        const m = occScratch.m
          .set(MOON_POSITION[0], MOON_POSITION[1], MOON_POSITION[2])
          .sub(cam);
        const tca = m.dot(dir);
        if (tca > 0 && tca < L) {
          const perp2 = m.lengthSq() - tca * tca;
          occluded = perp2 < MOON_RADIUS * MOON_RADIUS;
        }
      }
    }
    if (core.visible === occluded) core.visible = !occluded;
  });

  return (
    <group position={position} raycast={() => null}>
      {showStreak && streakTex && (
        <sprite scale={[SUN_RADIUS * 26, SUN_RADIUS * 2.6, 1]} raycast={() => null}>
          <spriteMaterial
            map={streakTex}
            blending={THREE.AdditiveBlending}
            transparent
            depthWrite={false}
            toneMapped={false}
            opacity={0.85}
            fog={false}
          />
        </sprite>
      )}
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
      <mesh ref={coreRef} geometry={geometry} material={material} raycast={() => null} />
    </group>
  );
}


const SITE_COORDS: Record<SiteId, { lat: number; lon: number }> = {
  lunar: { lat: 0.7, lon: 23.5 },
  shackleton: { lat: -35, lon: 20 },
};

const SITE_MARKERS: Record<
  SiteId,
  { color: string; label: string; name: string; status: string }
> = {
  lunar: {
    color: "#38e1ff",
    label: "Lunar Base",
    name: "LUNAR BASE",
    status: "operational",
  },
  shackleton: {
    color: "#ffb347",
    label: "Shackleton — in construction",
    name: "SHACKLETON",
    status: "in construction",
  },
};

const RETICLE_RADIUS = 6;
const DIAMOND_POINTS: [number, number, number][] = [
  [0, RETICLE_RADIUS, 0],
  [RETICLE_RADIUS, 0, 0],
  [0, -RETICLE_RADIUS, 0],
  [-RETICLE_RADIUS, 0, 0],
  [0, RETICLE_RADIUS, 0],
];
const TICK = 2.4;
const BR = RETICLE_RADIUS + 2.4;
const BRACKET_POINTS: [number, number, number][] = [
  [-TICK, BR - TICK, 0], [0, BR, 0], [0, BR, 0], [TICK, BR - TICK, 0],
  [BR - TICK, TICK, 0], [BR, 0, 0], [BR, 0, 0], [BR - TICK, -TICK, 0],
  [TICK, -BR + TICK, 0], [0, -BR, 0], [0, -BR, 0], [-TICK, -BR + TICK, 0],
  [-BR + TICK, -TICK, 0], [-BR, 0, 0], [-BR, 0, 0], [-BR + TICK, TICK, 0],
];

function SiteMarker({
  position,
  quaternion,
  color,
  name,
  status,
  onSelect,
}: {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  color: string;
  name: string;
  status: string;
  onSelect: () => void;
}) {
  const [hover, setHover] = useState(false);
  const locked = hover;
  const reticleRef = useRef<THREE.Group>(null);
  const diamondRef = useRef<THREE.Object3D>(null);
  const bracketRef = useRef<THREE.Object3D>(null);

  useEffect(() => {
    diamondRef.current?.layers.enable(CELESTIAL_BLOOM_LAYER);
    bracketRef.current?.layers.enable(CELESTIAL_BLOOM_LAYER);
  }, [locked]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const breathe = 1 + Math.sin(t * 2) * 0.04;
    const lock = locked ? 0.9 : 1;
    if (reticleRef.current) {
      reticleRef.current.scale.setScalar(breathe * lock);
    }
    if (bracketRef.current) {
      const mat = (bracketRef.current as THREE.Mesh)
        .material as THREE.Material & { opacity: number };
      if (mat) mat.opacity = THREE.MathUtils.lerp(mat.opacity, locked ? 1 : 0, 0.2);
    }
  });

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHover(true);
    document.body.style.cursor = "pointer";
  };
  const onOut = () => {
    setHover(false);
    document.body.style.cursor = "default";
  };

  const lineWidth = locked ? 2.4 : 1.6;

  return (
    <group position={position} quaternion={quaternion}>
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

      <Billboard position={[0, 14, 0]} raycast={() => null}>
        <group ref={reticleRef}>
          <Line
            ref={diamondRef as never}
            points={DIAMOND_POINTS}
            color={color}
            lineWidth={lineWidth}
            transparent
            opacity={locked ? 1 : 0.9}
            toneMapped={false}
            raycast={() => null}
          />
          <Line
            ref={bracketRef as never}
            points={BRACKET_POINTS}
            segments
            color={color}
            lineWidth={locked ? 2 : 1.4}
            transparent
            opacity={0}
            toneMapped={false}
            raycast={() => null}
          />
          <Text
            position={[0, -RETICLE_RADIUS - 4.5, 0]}
            fontSize={3.4}
            color={color}
            anchorX="center"
            anchorY="top"
            textAlign="center"
            lineHeight={1.25}
            letterSpacing={0.08}
            outlineWidth={0.12}
            outlineColor="#000000"
            outlineOpacity={0.85}
            fillOpacity={locked ? 1 : 0.92}
            material-toneMapped={false}
            raycast={() => null}
          >
            {`${name}\n${status}`}
          </Text>
        </group>
      </Billboard>
    </group>
  );
}

function useSiteMarkerSeat(site: SiteId) {
  return useMemo(() => {
    const { lat, lon } = SITE_COORDS[site];
    const position = latLonToGlobePoint(lat, lon);
    const n = new THREE.Vector3(...latLonToGlobeNormal(lat, lon));
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      n,
    );
    return {
      position,
      quaternion: q.toArray() as [number, number, number, number],
    };
  }, [site]);
}

function SiteMarkers({
  onSelectSite,
}: {
  onSelectSite: (site: SiteId) => void;
}) {
  const lunarSeat = useSiteMarkerSeat("lunar");
  const shackletonSeat = useSiteMarkerSeat("shackleton");
  return (
    <>
      <SiteMarker
        position={lunarSeat.position}
        quaternion={lunarSeat.quaternion}
        color={SITE_MARKERS.lunar.color}
        name={SITE_MARKERS.lunar.name}
        status={SITE_MARKERS.lunar.status}
        onSelect={() => onSelectSite("lunar")}
      />
      <SiteMarker
        position={shackletonSeat.position}
        quaternion={shackletonSeat.quaternion}
        color={SITE_MARKERS.shackleton.color}
        name={SITE_MARKERS.shackleton.name}
        status={SITE_MARKERS.shackleton.status}
        onSelect={() => onSelectSite("shackleton")}
      />
    </>
  );
}


const NEBULA_POSITION: [number, number, number] = [1700, -650, -3200];
const NEBULA_SIZE = 1700;
const NEBULA_POSITION_SURFACE: [number, number, number] = [-1500, 1550, -2800];
const NEBULA_SIZE_SURFACE = 1450;

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

function NebulaHero({ visible, onSurface }: { visible: boolean; onSurface: boolean }) {
  const invalidate = useThree((s) => s.invalidate);

  const fallbackTex = useMemo(() => makeNebulaFallbackTexture(), []);
  const [tex, setTex] = useState<THREE.Texture | null>(fallbackTex);

  useEffect(() => {
    let disposed = false;
    const t = loadCachedTexture(NEBULA_VEIL);
    void preloadTexture(NEBULA_VEIL).then(() => {
      if (disposed || !t.image) return;
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      setTex(t);
      invalidate();
    });
    return () => {
      disposed = true;
    };
  }, [invalidate]);

  useEffect(() => () => fallbackTex?.dispose(), [fallbackTex]);

  useEffect(() => {
    invalidate();
  }, [visible, onSurface, invalidate]);

  if (!visible || !tex) return null;

  const position = onSurface ? NEBULA_POSITION_SURFACE : NEBULA_POSITION;
  const size = onSurface ? NEBULA_SIZE_SURFACE : NEBULA_SIZE;

  const layers: { scale: number; opacity: number }[] = [
    { scale: 1.0, opacity: 0.3 },
    { scale: 0.66, opacity: 0.26 },
    { scale: 0.4, opacity: 0.22 },
  ];

  return (
    <group position={position} raycast={() => null}>
      {layers.map((l, i) => (
        <sprite
          key={i}
          scale={[size * l.scale, size * l.scale, 1]}
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

export function SkyBodies({
  viewMode,
  onSelectSite,
  sunRef,
}: {
  viewMode: ViewMode;
  onSelectSite?: (site: SiteId) => void;
  sunRef?: React.RefObject<THREE.Mesh>;
}) {
  const inOrbit = viewMode === "orbit";
  return (
    <>
      <SunBody
        position={inOrbit ? ORBIT_SUN_POSITION : SUN_POSITION}
        coreRef={sunRef}
        showStreak={inOrbit}
        occludeBehindMoon={inOrbit}
      />
      <MoonGlobe visible={inOrbit} />
      <NebulaHero visible onSurface={!inOrbit} />
      <EarthBody visible viewMode={viewMode} />
      {inOrbit && onSelectSite ? (
        <SiteMarkers onSelectSite={onSelectSite} />
      ) : null}
    </>
  );
}
