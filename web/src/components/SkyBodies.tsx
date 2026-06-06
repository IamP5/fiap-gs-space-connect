// SkyBodies — two STATIC, snapshot-independent decorative sky bodies for the
// lunar diorama (issue #51), in the same Scenery category as <SpaceEnvironment>
// and <LaunchScenery>: they encode NO world state, so they respect ADR-0004's
// "scene is a pure function of the snapshot" invariant (decorative,
// snapshot-INDEPENDENT elements are allowed). Mounted unconditionally.
//
// The worksite is ON the Moon, so the two bodies are swapped by view mode and
// are NEVER both visible:
//   • Moon globe — ORBIT view ONLY. A drei <Detailed> (THREE.LOD) sphere sized
//     to read as a real globe at orbit zoom distances (minDistance 120 …
//     maxDistance 900, far plane ~8000). Crater relief comes from a NORMAL map
//     (never a displacementMap). L0 (orbit-close): color + normal + roughness.
//     L1 (pulled back): color + normal. Hidden in surface mode — the Moon must
//     never hang in the surface sky (you are standing on it).
//   • Earth — SURFACE view ONLY. A small, low-segment sphere with just an Earth
//     color map, hung in the black surface sky (the Apollo "Earthrise" read).
//     No LOD, no normal map. Hidden in orbit mode.
// The starfield (from <SpaceEnvironment>, issue #50) shows in BOTH views.
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

import { useEffect, useMemo } from "react";
import { Detailed } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

import type { ViewMode } from "./Scene3D";

// Self-hosted NASA-PD textures (see public/assets/CREDITS.md). Downscaled jpgs.
const MOON_COLOR = "/assets/textures/moon_color_1024.jpg";
const MOON_NORMAL = "/assets/textures/moon_normal_1024.jpg";
const MOON_ROUGH = "/assets/textures/moon_rough_512.jpg";
const EARTH_COLOR = "/assets/textures/earth_color_512.jpg";

// --- Moon globe (orbit view) ------------------------------------------------
// Placement + size: the orbit preset targets [0, 40, -200] and pulls the camera
// back to 120…900 units. We berth the globe out along -Z, comfortably inside the
// far plane, and size it so it reads as a real globe (not a dot) across that
// zoom band.
const MOON_RADIUS = 90;
const MOON_POSITION: [number, number, number] = [0, 60, -520];

// LOD switch distances (camera→object). L0 detail is shown until the camera is
// MOON_LOD_SWITCH units away, then L1 (the cheaper material) takes over on
// pull-back. Tuned to the orbit zoom band.
const MOON_LOD_SWITCH = 420;

// --- Earth (surface view) ---------------------------------------------------
// A smallish disc hung high in the surface sky (the Earthrise read). Sized as a
// modest sphere placed within the surface frustum.
const EARTH_RADIUS = 9;
const EARTH_POSITION: [number, number, number] = [4, -16, -65];

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
    const matNear = new THREE.MeshStandardMaterial({
      color: "#9a958c",
      roughness: 1,
      metalness: 0,
    });
    const matFar = new THREE.MeshStandardMaterial({
      color: "#9a958c",
      roughness: 1,
      metalness: 0,
    });
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

// Earth, shown ONLY in surface view. A small low-segment sphere + color map. No
// LOD, no normal map.
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

// SkyBodies — mounts both bodies and shows exactly one per view mode. The Moon
// globe is orbit-only; Earth is surface-only. The starfield (SpaceEnvironment)
// shows in both.
export function SkyBodies({ viewMode }: { viewMode: ViewMode }) {
  return (
    <>
      <MoonGlobe visible={viewMode === "orbit"} />
      <EarthBody visible={viewMode === "surface"} />
    </>
  );
}
