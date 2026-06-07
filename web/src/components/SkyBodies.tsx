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

// Self-hosted textures (see public/assets/CREDITS.md). Downscaled jpgs. Moon +
// Earth are NASA-PD; the Sun colour map is Solar System Scope (CC-BY 4.0).
const MOON_COLOR = "/assets/textures/moon_color_1024.jpg";
const MOON_NORMAL = "/assets/textures/moon_normal_1024.jpg";
const MOON_ROUGH = "/assets/textures/moon_rough_512.jpg";
const EARTH_COLOR = "/assets/textures/earth_color_512.jpg";
const SUN_COLOR = "/assets/textures/sun_color_1024.jpg";

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
// diameter ratio) and hung up-and-LEFT, beyond the Moon, so the orbit vista reads
// correctly: the Moon is the close hero (~25°) and Earth the bigger-but-farther
// planet (~12°). Shown in BOTH views. Self-illuminated so it glows on its own
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
      t.anisotropy = 4;
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

// The Moon globe, shown ONLY in orbit view. Two LOD levels (drei <Detailed> =
// THREE.LOD): L0 color+normal+roughness, L1 color+normal. Relief is the normal
// map (NEVER displacementMap).
function MoonGlobe({ visible }: { visible: boolean }) {
  const invalidate = useThree((s) => s.invalidate);

  // Geometry + the two materials, built once. Higher segments for the close LOD,
  // fewer for the pulled-back LOD.
  const { geomNear, geomFar, matNear, matFar } = useMemo(() => {
    const geomNear = new THREE.SphereGeometry(MOON_RADIUS, 96, 96);
    const geomFar = new THREE.SphereGeometry(MOON_RADIUS, 48, 48);
    // Flat fallback color: a believable regolith gray, used if textures fail.
    // fog:false — celestial bodies sit far beyond the surface horizon fog (and
    // are only shown in orbit, which has no fog anyway), so they must never be
    // tinted toward the fog color.
    const matNear = new THREE.MeshStandardMaterial({
      color: "#9a958c",
      roughness: 1,
      metalness: 0,
      fog: false,
    });
    const matFar = new THREE.MeshStandardMaterial({
      color: "#9a958c",
      roughness: 1,
      metalness: 0,
      fog: false,
    });
    // Soften the crater normal map. Under the harsh space back-light + low fill,
    // a full-strength normal map over-shades every crater rim near the terminator,
    // making the lit area read as a blotchy/flat patch instead of a smooth sphere.
    // A gentle scale keeps subtle relief while the globe reads as a clean ball.
    matNear.normalScale.set(0.35, 0.35);
    matFar.normalScale.set(0.35, 0.35);
    return { geomNear, geomFar, matNear, matFar };
  }, []);

  // Load the maps imperatively (no Suspense throw). L0 = color+normal+rough,
  // L1 = color+normal.
  useEffect(() => {
    const cleanups = [
      loadTexture(MOON_COLOR, matNear, "map", THREE.SRGBColorSpace, invalidate),
      loadTexture(MOON_NORMAL, matNear, "normalMap", THREE.NoColorSpace, invalidate),
      loadTexture(MOON_ROUGH, matNear, "roughnessMap", THREE.NoColorSpace, invalidate),
      loadTexture(MOON_COLOR, matFar, "map", THREE.SRGBColorSpace, invalidate),
      loadTexture(MOON_NORMAL, matFar, "normalMap", THREE.NoColorSpace, invalidate),
    ];
    return () => cleanups.forEach((c) => c());
  }, [matNear, matFar, invalidate]);

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

// Earth, shown in BOTH views. A low-segment sphere + color map, far away. No LOD,
// no normal map. (`visible` stays a prop for symmetry with MoonGlobe, but SkyBodies
// now always mounts it visible.)
function EarthBody({ visible }: { visible: boolean }) {
  const invalidate = useThree((s) => s.invalidate);

  const { geometry, material } = useMemo(() => {
    const geometry = new THREE.SphereGeometry(EARTH_RADIUS, 32, 32);
    // Earth hangs far out in the black surface sky where the worksite key light
    // never reaches it, so it is SELF-ILLUMINATED rather than lit: the color map
    // is also wired as the emissiveMap (below) and emissive is white at a strong
    // intensity, so the textured disc glows on its own (the bright Earthrise
    // read) without any useFrame. The flat `color`/`emissive` deep-ocean-blue is
    // the fallback if the texture fails (ADR-0004) — still a visible blue disc.
    const material = new THREE.MeshStandardMaterial({
      color: "#2a4a8c",
      roughness: 1,
      metalness: 0,
      emissive: "#3b6fc4",
      emissiveIntensity: 1,
      // fog:false — Earth is a distant body well beyond the surface horizon fog;
      // without this it would be tinted to black in surface view and vanish.
      fog: false,
    });
    return { geometry, material };
  }, []);

  useEffect(() => {
    // Load the Earth color into BOTH the diffuse map and the emissive map so the
    // disc is self-lit (and switch emissive to white so the emissiveMap shows its
    // true colors). A failed load leaves the flat blue fallback.
    const cleanups = [
      loadTexture(EARTH_COLOR, material, "map", THREE.SRGBColorSpace, invalidate),
      loadTexture(EARTH_COLOR, material, "emissiveMap", THREE.SRGBColorSpace, () => {
        material.emissive.set("#ffffff");
        invalidate();
      }),
    ];
    return () => cleanups.forEach((c) => c());
  }, [material, invalidate]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useEffect(() => {
    invalidate();
  }, [visible, invalidate]);

  if (!visible) return null;

  return (
    <mesh
      geometry={geometry}
      material={material}
      position={EARTH_POSITION}
      raycast={() => null}
    />
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

  // Procedural flare textures (glow + rays), built once and disposed on unmount.
  const { glowTex, raysTex } = useMemo(
    () => ({ glowTex: makeGlowTexture(), raysTex: makeRaysTexture() }),
    [],
  );
  useEffect(
    () => () => {
      glowTex?.dispose();
      raysTex?.dispose();
    },
    [glowTex, raysTex],
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

  const intensity = hover ? 3.2 : 2.0;
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

      {/* Vertical beacon — a tapering glow column rising off the surface, the
          "you are here / land here" signal. Additive so it reads as light. */}
      <mesh position={[0, 18, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.4, 3.2, 36, 16, 1, true]} />
        <meshBasicMaterial
          color={MARKER_COLOR}
          transparent
          opacity={hover ? 0.5 : 0.32}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

// SkyBodies — the Sun (light emitter, both views) + the Moon globe (orbit-only,
// the space-vista hero) + Earth (a distant marble, both views) + the clickable
// lunar-base marker (orbit-only). The starfield (SpaceEnvironment) shows in both.
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
      <EarthBody visible />
      {inOrbit && onBaseClick ? <LunarBaseMarker onSelect={onBaseClick} /> : null}
    </>
  );
}
