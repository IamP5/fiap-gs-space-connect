// Structures — the immersive, professional procedural buildings (milestone 08).
//
// Replaces the old per-tier grey primitive (a box / box / hemisphere) with
// purpose-built habitat hardware: a paneled pressurised dome with a lit window
// band and interior glow, ribbed hab-wall modules with viewports, regolith-crete
// foundation pads with anchor hardware, sun-tracking solar arrays on truss mounts,
// and a lattice comms tower crowned by a parabolic dish with a pulsing beacon.
//
// EVERYTHING here is PROCEDURAL — no glTF to fetch, so it can never fail to load
// (ADR-0004's fallback story is satisfied by construction). PBR realism comes from
// the self-hosted CC0 metal + solar texture sets (public/assets/textures), each of
// which has the flat-colour fallback baked in: a missing map just leaves the tinted
// material, never a blank mesh. Lit elements (dome windows, the beacon) use real
// emissive + a couple of cheap point lights and ride the celestial bloom layer so
// they glow softly through the post stack.
//
// Each piece reads ONLY its Task's status, so the structure stays a pure function
// of the world snapshot (ADR-0004): UNCLAIMED → a faint planned footprint scribe;
// LEASED → the structure rising, semi-transparent; DONE → solid, shadow-casting.

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { loadTexture, preloadTexture } from "../lib/textureCache";

// CELESTIAL_BLOOM_LAYER mirror (Scene3D exports the same value=12). Kept local to
// avoid a circular import; lit structure elements opt into the soft celestial
// bloom by enabling this layer so window glow / beacon read as light, not paint.
const BLOOM_LAYER = 12;

// ---- shared PBR texture sets (CC0, self-hosted) ----------------------------

// The structural-metal set (Poly Haven, CC0) — clads frames, masts, dishes, the
// dome shell. The solar set is the literal PV-cell surface for the array panels.
export const METAL_MAPS = {
  map: "/assets/textures/metal_diff_512.jpg",
  normalMap: "/assets/textures/metal_nor_gl_512.jpg",
  roughnessMap: "/assets/textures/metal_rough_512.jpg",
} as const;
export const SOLAR_MAPS = {
  map: "/assets/textures/solar_diff_512.jpg",
  normalMap: "/assets/textures/solar_nor_gl_512.jpg",
  roughnessMap: "/assets/textures/solar_rough_512.jpg",
} as const;
export const REGOLITH_PAD_MAPS = {
  map: "/assets/textures/regolith_diff_512.jpg",
  normalMap: "/assets/textures/regolith_nor_gl_512.jpg",
  roughnessMap: "/assets/textures/regolith_rough_512.jpg",
} as const;

// Every texture URL these structures consume — exported so the preload manifest
// (lib/assets.ts) warms the SAME decoded source behind the splash (no pop-in), the
// way REGOLITH_MAPS already does for the terrain.
export const STRUCTURE_TEXTURES: readonly string[] = [
  METAL_MAPS.map,
  METAL_MAPS.normalMap,
  METAL_MAPS.roughnessMap,
  SOLAR_MAPS.map,
  SOLAR_MAPS.normalMap,
  SOLAR_MAPS.roughnessMap,
  REGOLITH_PAD_MAPS.map,
  REGOLITH_PAD_MAPS.normalMap,
  REGOLITH_PAD_MAPS.roughnessMap,
];

// pbrTexture returns a session-lived, per-(url,repeat,colorSpace) CLONE of the
// shared cached source. We clone (not reuse) because each surface wants its own
// wrap/repeat without mutating the one texture every other consumer holds; the
// heavy image/source is shared by reference, so a clone is a cheap sampler config.
// Under frameloop="always" the pixels simply appear the frame after the shared
// source decodes — we re-assert needsUpdate on the clone when preload settles.
const pbrCache = new Map<string, THREE.Texture>();
function pbrTexture(
  url: string,
  repeatX: number,
  repeatY: number,
  colorSpace: THREE.ColorSpace,
): THREE.Texture {
  const key = `${url}|${repeatX}x${repeatY}|${colorSpace}`;
  const hit = pbrCache.get(key);
  if (hit) return hit;
  const t = loadTexture(url).clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.colorSpace = colorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  pbrCache.set(key, t);
  // Adopt the pixels once the shared source finishes decoding (the clone shares
  // the Source by reference, so it only needs its own re-upload flagged).
  void preloadTexture(url).then(() => {
    t.needsUpdate = true;
  });
  return t;
}

// A PBR set bound to a uniform tile repeat. diffuse is sRGB; the data maps linear.
//
// `preview` (the transient drag-to-place ghost) returns an EMPTY set: the placement
// preview is translucent, short-lived, and re-rendered every frame while the user
// drags, so it skips all three texture samplers and rides only the tinted material.
// That keeps the ghost cheap (no map/normal/rough decode + sampling per sub-mesh)
// while the REAL built structures keep their full PBR realism.
function usePbrSet(
  maps: { map: string; normalMap: string; roughnessMap: string },
  repeat: number,
  preview = false,
) {
  return useMemo(
    () =>
      preview
        ? {}
        : {
            map: pbrTexture(maps.map, repeat, repeat, THREE.SRGBColorSpace),
            normalMap: pbrTexture(maps.normalMap, repeat, repeat, THREE.NoColorSpace),
            roughnessMap: pbrTexture(maps.roughnessMap, repeat, repeat, THREE.NoColorSpace),
          },
    [maps, repeat, preview],
  );
}

// ---- per-status "look" ------------------------------------------------------

// The render phase a Task is in, derived purely from its status by the caller.
export type StructurePhase = "ghost" | "rising" | "built";

// A built structure is opaque + casts the sun shadow; a leased one is rising and
// reads as a translucent shell with no hard shadow; emissive is dimmed while it
// builds and full once sealed.
type Look = {
  transparent: boolean;
  opacity: number;
  shadow: boolean;
  emissiveScale: number;
};
function lookOf(phase: StructurePhase): Look {
  return phase === "built"
    ? { transparent: false, opacity: 1, shadow: true, emissiveScale: 1 }
    : { transparent: true, opacity: 0.55, shadow: false, emissiveScale: 0.4 };
}

// Common props every structural material shares — keeps the per-mesh JSX to just
// its color/roughness/metalness/maps. Structural surfaces stay tone-mapped so they
// sit naturally in the lit scene; only the emissive GLOW meshes add
// toneMapped={false} (so they read as vivid light through the bloom pass).
//
// The faint cool `emissive` is a FAKE-BOUNCE FLOOR: the surface key light is a
// brutal lunar sun against a 0.05 ambient + a dark (moonless) HDR, so any face
// pointing away from the sun would otherwise crush to pure black and read as a
// void, not shadowed hardware. A tiny self-illumination lifts those shadow faces to
// a believable dark grey while being negligible on the blinding sunlit faces. The
// lit GLOW meshes (windows, beacon) spread bodyMat first, then OVERRIDE emissive.
function bodyMat(look: Look) {
  return {
    transparent: look.transparent,
    opacity: look.opacity,
    emissive: "#4a4d54",
    emissiveIntensity: 0.7,
  };
}

// enableBloom is a ref callback that opts a lit mesh into the soft celestial bloom
// layer so its emissive reads as glow through the post stack.
function enableBloom(o: THREE.Object3D | null) {
  if (o) o.layers.enable(BLOOM_LAYER);
}

// ---- the planned-footprint scribe (UNCLAIMED) -------------------------------

// At rest an UNCLAIMED piece is NOT a translucent solid (that "pre-placed blob"
// was the surface overhaul's complaint #5) — it's a faint ring scribed on the
// regolith: a build affordance marking where the structure will rise. Dropped
// entirely for the hero dome/dish (they'd read as a squatting blob); kept as a
// clean footprint for pads/walls/panels/masts.
function FootprintScribe({ radius, color }: { radius: number; color: string }) {
  return (
    <group position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh raycast={() => null}>
        <ringGeometry args={[radius * 0.92, radius, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.28} toneMapped={false} />
      </mesh>
      <mesh raycast={() => null}>
        <circleGeometry args={[radius * 0.92, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.06} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ---- foundation pad ---------------------------------------------------------

// A poured regolith-crete deck with a recessed metal grating, a perimeter kerb and
// four anchor bolts — the prepared pad a wall/panel/mast bolts onto.
function FoundationPad({ phase, color, preview, reveal }: { phase: StructurePhase; color: string; preview?: boolean; reveal?: number }) {
  const look = lookOf(phase);
  const crete = usePbrSet(REGOLITH_PAD_MAPS, 2, preview);
  const metal = usePbrSet(METAL_MAPS, 1, preview);
  if (phase === "ghost" || reveal === 0) return <FootprintScribe radius={0.95} color={color} />;
  const bolt = (x: number, z: number) => (
    <mesh
      key={`${x},${z}`}
      position={[x, 0.3, z]}
      castShadow={look.shadow}
      raycast={() => null}
    >
      <cylinderGeometry args={[0.07, 0.09, 0.16, 10]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#c9ccd2" metalness={0.32} roughness={0.45} />
    </mesh>
  );
  // Ordered build steps (one per streamed module op). Count MUST match
  // partSteps["foundation"] in internal/agent/opsource.go (7).
  const steps = [
    // poured deck
    <mesh key="deck" position={[0, 0.16, 0]} castShadow={look.shadow} receiveShadow={look.shadow} raycast={() => null}>
      <boxGeometry args={[1.7, 0.32, 1.7]} />
      <meshStandardMaterial {...crete} {...bodyMat(look)} color={color} roughness={0.96} metalness={0.04} />
    </mesh>,
    // perimeter kerb (a slightly larger, thinner lip)
    <mesh key="kerb" position={[0, 0.33, 0]} castShadow={look.shadow} raycast={() => null}>
      <boxGeometry args={[1.78, 0.06, 1.78]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#9aa0aa" metalness={0.26} roughness={0.55} />
    </mesh>,
    // recessed metal grating deck
    <mesh key="grating" position={[0, 0.34, 0]} receiveShadow={look.shadow} raycast={() => null}>
      <boxGeometry args={[1.34, 0.05, 1.34]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#7f8893" metalness={0.3} roughness={0.5} />
    </mesh>,
    bolt(0.72, 0.72),
    bolt(-0.72, 0.72),
    bolt(0.72, -0.72),
    bolt(-0.72, -0.72),
  ];
  return <group>{steps.slice(0, reveal ?? steps.length)}</group>;
}

// ---- habitat wall module ----------------------------------------------------

// A pressurised hab-wall segment: an insulated metal panel with side pilasters, a
// mid seam, a base flare, and a lit viewport — the modules ringing the dome.
function HabitatWall({ phase, color, preview, reveal }: { phase: StructurePhase; color: string; preview?: boolean; reveal?: number }) {
  const look = lookOf(phase);
  const metal = usePbrSet(METAL_MAPS, 1.5, preview);
  if (phase === "ghost" || reveal === 0) return <FootprintScribe radius={0.85} color={color} />;
  const bodyColor = phase === "built" ? "#d6d9e0" : color;
  // Ordered build steps (one per streamed module op). Count MUST match
  // partSteps["wall"] in internal/agent/opsource.go (7).
  const steps = [
    // base flare
    <mesh key="base" position={[0, 0.18, 0]} castShadow={look.shadow} receiveShadow={look.shadow} raycast={() => null}>
      <boxGeometry args={[1.5, 0.36, 0.66]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#9aa0aa" metalness={0.26} roughness={0.5} />
    </mesh>,
    // insulated panel body
    <mesh key="body" position={[0, 0.95, 0]} castShadow={look.shadow} receiveShadow={look.shadow} raycast={() => null}>
      <boxGeometry args={[1.4, 1.45, 0.52]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color={bodyColor} metalness={0.18} roughness={0.62} />
    </mesh>,
    // side pilasters (left, then right)
    <mesh key="pilaster-l" position={[-0.66, 0.92, 0]} castShadow={look.shadow} raycast={() => null}>
      <boxGeometry args={[0.14, 1.5, 0.6]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#878d98" metalness={0.26} roughness={0.45} />
    </mesh>,
    <mesh key="pilaster-r" position={[0.66, 0.92, 0]} castShadow={look.shadow} raycast={() => null}>
      <boxGeometry args={[0.14, 1.5, 0.6]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#878d98" metalness={0.26} roughness={0.45} />
    </mesh>,
    // mid structural seam
    <mesh key="seam" position={[0, 1.0, 0.27]} raycast={() => null}>
      <boxGeometry args={[1.32, 0.07, 0.04]} />
      <meshStandardMaterial {...bodyMat(look)} color="#4a4f59" metalness={0.35} roughness={0.6} />
    </mesh>,
    // lit viewport
    <mesh key="viewport" position={[0, 1.12, 0.28]} ref={enableBloom} raycast={() => null}>
      <boxGeometry args={[0.8, 0.34, 0.03]} />
      <meshStandardMaterial
        {...bodyMat(look)}
        color="#0c1622"
        emissive="#bfe9ff"
        emissiveIntensity={1.4 * look.emissiveScale}
        metalness={0.1}
        roughness={0.2}
        toneMapped={false}
      />
    </mesh>,
    // top trim cap
    <mesh key="trim" position={[0, 1.72, 0]} castShadow={look.shadow} raycast={() => null}>
      <boxGeometry args={[1.46, 0.12, 0.6]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#aeb4be" metalness={0.26} roughness={0.5} />
    </mesh>,
  ];
  return <group position={[0, 0, 0]}>{steps.slice(0, reveal ?? steps.length)}</group>;
}

// ---- habitat dome (the hero) ------------------------------------------------

// A pressurised geodesic dome: a flat-shaded faceted shell (reads as triangulated
// panels), meridian ribs, a heavy base ring, a glowing window band, a glass apex
// cupola, and a side airlock — lit from within by a warm point light.
function HabitatDome({ phase, preview, reveal }: { phase: StructurePhase; preview?: boolean; reveal?: number }) {
  const look = lookOf(phase);
  const metal = usePbrSet(METAL_MAPS, 2, preview);
  // A resting UNCLAIMED dome (or a not-yet-started build) is dropped entirely (no
  // squatting blob; complaint #5).
  if (phase === "ghost" || reveal === 0) return null;

  const R = 2.6;
  // 4 meridian ribs as half-torus arcs sweeping base→apex→base, rotated around Y.
  const ribs = [0, 1, 2, 3].map((i) => (i * Math.PI) / 4);
  // Ordered build steps (one per streamed module op), bottom-up. Count MUST match
  // partSteps["dome"] in internal/agent/opsource.go (8).
  const steps = [
    // heavy base ring
    <mesh key="base-ring" position={[0, 0.18, 0]} castShadow={look.shadow} receiveShadow={look.shadow} raycast={() => null}>
      <cylinderGeometry args={[R + 0.06, R + 0.12, 0.36, 32, 1, true]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#8b919c" metalness={0.26} roughness={0.45} side={THREE.DoubleSide} />
    </mesh>,
    // faceted pressurised shell — flat-shaded for crisp triangulated panels
    // (no normalMap; it fights flat shading), with subtle metalness sheen.
    <mesh key="shell" position={[0, 0.02, 0]} castShadow={look.shadow} receiveShadow={look.shadow} raycast={() => null}>
      <sphereGeometry args={[R, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
      <meshStandardMaterial
        {...bodyMat(look)}
        color={phase === "built" ? "#cdd2da" : "#aeb6c4"}
        metalness={0.25}
        roughness={0.55}
        flatShading
        side={THREE.DoubleSide}
      />
    </mesh>,
    // glowing window band (interior light bleeding through the lower panels)
    <mesh key="window-band" position={[0, 0.66, 0]} ref={enableBloom} raycast={() => null}>
      <cylinderGeometry args={[R - 0.04, R - 0.04, 0.28, 32, 1, true]} />
      <meshStandardMaterial
        {...bodyMat(look)}
        color="#10202c"
        emissive="#86d8ff"
        emissiveIntensity={0.8 * look.emissiveScale}
        metalness={0.1}
        roughness={0.25}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </mesh>,
    // meridian ribs
    <group key="ribs">
      {ribs.map((ry) => (
        <mesh key={ry} rotation={[0, ry, 0]} castShadow={look.shadow} raycast={() => null}>
          <torusGeometry args={[R - 0.02, 0.05, 6, 24, Math.PI]} />
          <meshStandardMaterial {...metal} {...bodyMat(look)} color="#6f757f" metalness={0.3} roughness={0.4} />
        </mesh>
      ))}
    </group>,
    // apex collar
    <mesh key="apex-collar" position={[0, R - 0.18, 0]} raycast={() => null}>
      <cylinderGeometry args={[0.5, 0.58, 0.2, 20]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#7f858f" metalness={0.3} roughness={0.4} />
    </mesh>,
    // glass apex cupola
    <mesh key="cupola" position={[0, R + 0.05, 0]} ref={enableBloom} castShadow={look.shadow} raycast={() => null}>
      <sphereGeometry args={[0.42, 16, 12]} />
      <meshStandardMaterial
        {...bodyMat(look)}
        color="#0e2230"
        emissive="#bfecff"
        emissiveIntensity={0.65 * look.emissiveScale}
        metalness={0.2}
        roughness={0.15}
        toneMapped={false}
      />
    </mesh>,
    // side airlock tube + door (tube axis along Z → rotate the MESH)
    <group key="airlock" position={[0, 0.5, R - 0.1]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow={look.shadow} receiveShadow={look.shadow} raycast={() => null}>
        <cylinderGeometry args={[0.45, 0.5, 0.9, 18]} />
        <meshStandardMaterial {...metal} {...bodyMat(look)} color="#aeb4be" metalness={0.26} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0, 0.46]} ref={enableBloom} raycast={() => null}>
        <circleGeometry args={[0.34, 20]} />
        <meshStandardMaterial
          {...bodyMat(look)}
          color="#0c1a24"
          emissive="#ffd9a0"
          emissiveIntensity={1.1 * look.emissiveScale}
          metalness={0.1}
          roughness={0.3}
          toneMapped={false}
        />
      </mesh>
    </group>,
    // warm interior glow — one cheap, shadowless point light (built only)
    <group key="interior-light">
      {phase === "built" && (
        <pointLight position={[0, 1.2, 0]} color="#ffe2b0" intensity={6} distance={6} decay={2} />
      )}
    </group>,
  ];
  return <group>{steps.slice(0, reveal ?? steps.length)}</group>;
}

// ---- solar array panel ------------------------------------------------------

// A sun-tracking PV panel: a framed photovoltaic surface (the CC0 solar texture)
// tilted on a pedestal + A-frame mount with back struts and a tracking actuator.
function SolarPanel({ phase, color, preview, reveal }: { phase: StructurePhase; color: string; preview?: boolean; reveal?: number }) {
  const look = lookOf(phase);
  const metal = usePbrSet(METAL_MAPS, 1, preview);
  const solar = usePbrSet(SOLAR_MAPS, 1, preview);
  const panelRef = useRef<THREE.MeshStandardMaterial>(null);
  // A faint, slow cell shimmer so the array reads as live silicon, not a sticker.
  useFrame(({ clock }) => {
    const m = panelRef.current;
    if (m) m.emissiveIntensity = (0.18 + 0.07 * Math.sin(clock.elapsedTime * 0.8)) * look.emissiveScale;
  });
  if (phase === "ghost" || reveal === 0) return <FootprintScribe radius={1.2} color={color} />;
  const tilt = -Math.PI / 5; // ~36° toward the sun
  // Ordered build steps (one per streamed module op). Count MUST match
  // partSteps["panel"] in internal/agent/opsource.go (5).
  const steps = [
    // pedestal
    <mesh key="pedestal" position={[0, 0.4, 0]} castShadow={look.shadow} receiveShadow={look.shadow} raycast={() => null}>
      <cylinderGeometry args={[0.16, 0.22, 0.8, 14]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#9aa0aa" metalness={0.3} roughness={0.45} />
    </mesh>,
    // A-frame legs (left, then right)
    <mesh key="leg-l" position={[-0.5, 0.25, 0]} rotation={[0, 0, -0.5]} castShadow={look.shadow} raycast={() => null}>
      <cylinderGeometry args={[0.07, 0.07, 0.7, 10]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#878d98" metalness={0.3} roughness={0.45} />
    </mesh>,
    <mesh key="leg-r" position={[0.5, 0.25, 0]} rotation={[0, 0, 0.5]} castShadow={look.shadow} raycast={() => null}>
      <cylinderGeometry args={[0.07, 0.07, 0.7, 10]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#878d98" metalness={0.3} roughness={0.45} />
    </mesh>,
    // tracking actuator
    <mesh key="actuator" position={[0, 0.82, 0]} raycast={() => null}>
      <boxGeometry args={[0.5, 0.22, 0.3]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#5b606a" metalness={0.26} roughness={0.5} />
    </mesh>,
    // the tilted panel head (frame + PV surface + mullions + back struts)
    <group key="head" position={[0, 0.95, 0]} rotation={[tilt, 0, 0]}>
      {/* frame */}
      <mesh castShadow={look.shadow} receiveShadow={look.shadow} raycast={() => null}>
        <boxGeometry args={[2.4, 0.1, 1.5]} />
        <meshStandardMaterial {...metal} {...bodyMat(look)} color="#aeb4be" metalness={0.3} roughness={0.4} />
      </mesh>
      {/* photovoltaic surface */}
      <mesh position={[0, 0.06, 0]} raycast={() => null}>
        <boxGeometry args={[2.24, 0.04, 1.36]} />
        <meshStandardMaterial
          ref={panelRef}
          {...solar}
          {...bodyMat(look)}
          color="#2a4f8f"
          emissive="#1b3a6b"
          emissiveIntensity={0.2 * look.emissiveScale}
          metalness={0.35}
          roughness={0.28}
        />
      </mesh>
      {/* cell mullions */}
      {[-0.78, 0, 0.78].map((x) => (
        <mesh key={x} position={[x, 0.09, 0]} raycast={() => null}>
          <boxGeometry args={[0.03, 0.02, 1.36]} />
          <meshStandardMaterial {...bodyMat(look)} color="#7f8893" metalness={0.3} roughness={0.4} />
        </mesh>
      ))}
      {/* back struts */}
      {[-0.6, 0.6].map((x) => (
        <mesh key={x} position={[x, -0.18, -0.2]} rotation={[0.5, 0, 0]} castShadow={look.shadow} raycast={() => null}>
          <cylinderGeometry args={[0.05, 0.05, 0.7, 8]} />
          <meshStandardMaterial {...metal} {...bodyMat(look)} color="#878d98" metalness={0.3} roughness={0.45} />
        </mesh>
      ))}
    </group>,
  ];
  return <group>{steps.slice(0, reveal ?? steps.length)}</group>;
}

// ---- comms mast + dish ------------------------------------------------------

const MAST_HEIGHT = 4.0;

// strutBetween computes the transform (midpoint position, orientation quaternion,
// length) for a unit-Y cylinder spanning two points — the lattice-truss primitive.
function strutBetween(
  a: [number, number, number],
  b: [number, number, number],
): { position: [number, number, number]; quaternion: [number, number, number, number]; length: number } {
  const start = new THREE.Vector3(...a);
  const end = new THREE.Vector3(...b);
  const dir = new THREE.Vector3().subVectors(end, start);
  const length = dir.length();
  const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.clone().normalize(),
  );
  return { position: [mid.x, mid.y, mid.z], quaternion: [quat.x, quat.y, quat.z, quat.w], length };
}

// A four-leg tapering lattice tower with horizontal rings and diagonal cross
// braces — the comms mast the dish sits on.
function CommsMast({ phase, color, preview, reveal }: { phase: StructurePhase; color: string; preview?: boolean; reveal?: number }) {
  const look = lookOf(phase);
  const metal = usePbrSet(METAL_MAPS, 1, preview);
  // Build the strut list once: 4 legs + per-segment rings + face diagonals.
  const struts = useMemo(() => {
    const SEG = 4;
    const baseHalf = 0.46;
    const topHalf = 0.2;
    const out: ReturnType<typeof strutBetween>[] = [];
    const corner = (level: number, sx: number, sz: number): [number, number, number] => {
      const t = level / SEG;
      const half = baseHalf + (topHalf - baseHalf) * t;
      return [sx * half, t * MAST_HEIGHT, sz * half];
    };
    const signs: [number, number][] = [
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1],
    ];
    // legs
    for (const [sx, sz] of signs) out.push(strutBetween(corner(0, sx, sz), corner(SEG, sx, sz)));
    // rings + diagonals
    for (let lvl = 0; lvl < SEG; lvl++) {
      for (let i = 0; i < 4; i++) {
        const [ax, az] = signs[i];
        const [bx, bz] = signs[(i + 1) % 4];
        // horizontal ring at the TOP of this segment
        out.push(strutBetween(corner(lvl + 1, ax, az), corner(lvl + 1, bx, bz)));
        // one diagonal brace per face, alternating direction
        if (lvl % 2 === 0) out.push(strutBetween(corner(lvl, ax, az), corner(lvl + 1, bx, bz)));
        else out.push(strutBetween(corner(lvl, bx, bz), corner(lvl + 1, ax, az)));
      }
    }
    return out;
  }, []);

  if (phase === "ghost" || reveal === 0) return <FootprintScribe radius={0.7} color={color} />;
  // The lattice rises in three chunks so the tower visibly climbs op-by-op.
  const strutChunk = (lo: number, hi: number, key: string) => (
    <group key={key}>
      {struts.slice(lo, hi).map((s, i) => (
        <mesh
          key={i}
          position={s.position}
          quaternion={s.quaternion}
          castShadow={look.shadow}
          raycast={() => null}
        >
          <cylinderGeometry args={[0.04, 0.04, s.length, 6]} />
          <meshStandardMaterial {...metal} {...bodyMat(look)} color={phase === "built" ? "#aeb4be" : color} metalness={0.3} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
  const third = Math.ceil(struts.length / 3);
  // Ordered build steps (one per streamed module op). Count MUST match
  // partSteps["mast"] in internal/agent/opsource.go (5).
  const steps = [
    // equipment box at the base
    <mesh key="equipment" position={[0.7, 0.3, 0]} castShadow={look.shadow} receiveShadow={look.shadow} raycast={() => null}>
      <boxGeometry args={[0.5, 0.6, 0.7]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#878d98" metalness={0.26} roughness={0.5} />
    </mesh>,
    strutChunk(0, third, "lattice-0"),
    strutChunk(third, third * 2, "lattice-1"),
    strutChunk(third * 2, struts.length, "lattice-2"),
    // top platform
    <mesh key="platform" position={[0, MAST_HEIGHT, 0]} castShadow={look.shadow} raycast={() => null}>
      <boxGeometry args={[0.5, 0.08, 0.5]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#9aa0aa" metalness={0.3} roughness={0.45} />
    </mesh>,
  ];
  return <group>{steps.slice(0, reveal ?? steps.length)}</group>;
}

// A parabolic dish on a yoke atop the mast, with a tripod feed horn and a pulsing
// red obstruction beacon — the comms "antenna" task (a dome-cap typed piece whose
// id marks it as the mast crown rather than the habitat dome).
function CommsDish({ phase, color, preview, reveal }: { phase: StructurePhase; color: string; preview?: boolean; reveal?: number }) {
  const look = lookOf(phase);
  const metal = usePbrSet(METAL_MAPS, 1, preview);
  const dishRef = useRef<THREE.Group>(null);
  const beaconRef = useRef<THREE.MeshStandardMaterial>(null);
  const beaconLightRef = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    if (dishRef.current) dishRef.current.rotation.y = clock.elapsedTime * 0.12;
    // 1 Hz obstruction-beacon blink.
    const blink = 0.5 + 0.5 * Math.sin(clock.elapsedTime * Math.PI * 2);
    if (beaconRef.current) beaconRef.current.emissiveIntensity = (0.4 + 2.4 * blink) * look.emissiveScale;
    if (beaconLightRef.current) beaconLightRef.current.intensity = 2.4 * blink * (phase === "built" ? 1 : 0.4);
  });
  if (phase === "ghost" || reveal === 0) return null; // crown of the mast — no resting blob
  // Ordered build steps (one per streamed module op): yoke, then the dish
  // assembly, then the beacon last. Count MUST match partSteps["dish"] in
  // internal/agent/opsource.go (3).
  const steps = [
    // yoke
    <mesh key="yoke" position={[0, 0.16, 0]} castShadow={look.shadow} raycast={() => null}>
      <boxGeometry args={[0.34, 0.32, 0.18]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#7f858f" metalness={0.3} roughness={0.45} />
    </mesh>,
    // the rotating dish assembly, tilted skyward
    <group key="dish" ref={dishRef} position={[0, 0.35, 0]}>
      <group rotation={[-Math.PI / 4, 0, 0]}>
        {/* parabolic bowl */}
        <mesh castShadow={look.shadow} receiveShadow={look.shadow} raycast={() => null}>
          <sphereGeometry args={[1.15, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.42]} />
          <meshStandardMaterial
            {...metal}
            {...bodyMat(look)}
            color={phase === "built" ? "#e6e9ef" : color}
            metalness={0.3}
            roughness={0.4}
            side={THREE.DoubleSide}
          />
        </mesh>
        {/* rim — a horizontal ring at the bowl mouth (rotate the MESH flat) */}
        <mesh position={[0, 0.27, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
          <torusGeometry args={[1.06, 0.04, 8, 36]} />
          <meshStandardMaterial {...metal} {...bodyMat(look)} color="#9aa0aa" metalness={0.3} roughness={0.4} />
        </mesh>
        {/* feed-horn tripod */}
        {[0, (2 * Math.PI) / 3, (4 * Math.PI) / 3].map((a) => {
          const s = strutBetween(
            [Math.cos(a) * 0.7, 0.05, Math.sin(a) * 0.7],
            [0, 1.0, 0],
          );
          return (
            <mesh key={a} position={s.position} quaternion={s.quaternion} raycast={() => null}>
              <cylinderGeometry args={[0.022, 0.022, s.length, 6]} />
              <meshStandardMaterial {...metal} {...bodyMat(look)} color="#878d98" metalness={0.3} roughness={0.45} />
            </mesh>
          );
        })}
        {/* feed horn */}
        <mesh position={[0, 1.02, 0]} raycast={() => null}>
          <cylinderGeometry args={[0.1, 0.06, 0.22, 12]} />
          <meshStandardMaterial {...metal} {...bodyMat(look)} color="#c9ccd2" metalness={0.32} roughness={0.35} />
        </mesh>
      </group>
    </group>,
    // beacon at the very top (+ its point light)
    <group key="beacon">
      <mesh position={[0, 0.5, 0]} ref={enableBloom} raycast={() => null}>
        <sphereGeometry args={[0.1, 12, 10]} />
        <meshStandardMaterial ref={beaconRef} color="#3a0a08" emissive="#ff3b30" emissiveIntensity={1.5} toneMapped={false} transparent={look.transparent} opacity={look.opacity} />
      </mesh>
      <pointLight ref={beaconLightRef} position={[0, 0.5, 0]} color="#ff3b30" intensity={2} distance={4} decay={2} />
    </group>,
  ];
  return <group position={[0, MAST_HEIGHT + 0.1, 0]}>{steps.slice(0, reveal ?? steps.length)}</group>;
}

// ---- dispatcher -------------------------------------------------------------

// StructureKind is the resolved visual family for a Task (CONTEXT.md task `type`
// plus a hint from its id for the dome-cap collision: the comms "antenna" and the
// habitat "dome-cap" share type "dome-cap").
export type StructureKind = "foundation" | "wall" | "dome" | "panel" | "mast" | "dish";

// kindOf resolves a Task's (type, id) to a StructureKind. Pure — a function of the
// snapshot only. The id refines the only ambiguous type (dome-cap → dish if it's
// the comms antenna, else the habitat dome).
export function kindOf(type: string, id: string): StructureKind {
  const t = type.toLowerCase();
  const i = id.toLowerCase();
  if (t.includes("foundation")) return "foundation";
  if (t.includes("wall")) return "wall";
  if (t.includes("panel") || t.includes("solar")) return "panel";
  if (t.includes("mast")) return "mast";
  if (t.includes("dome") || t.includes("cap") || t.includes("roof")) {
    return i.includes("antenna") || i.includes("dish") ? "dish" : "dome";
  }
  return "dome";
}

// kindFootprintRadius is the on-ground radius (scene units) each built structure
// actually occupies — used by the placement ghost to scribe a footprint that
// matches the REAL construction, not the (much larger) clearance envelope the
// server validates against. Kept in sync with the geometry sizes above.
export function kindFootprintRadius(kind: StructureKind): number {
  switch (kind) {
    case "dome":
      return 3.0; // shell R 2.6 + base ring
    case "wall":
      return 0.95;
    case "foundation":
      return 1.0;
    case "panel":
      return 1.4;
    case "mast":
      return 0.7;
    case "dish":
      return 0.6;
    default:
      return 1.0;
  }
}

// StructurePiece renders the right building for a Task, in the phase its status
// implies. This is the new PRIMITIVE FALLBACK (replacing the old grey box/sphere)
// — the Build-spec interpreted path (server-authored glTF/ops) is unchanged.
export function StructurePiece({
  type,
  id,
  phase,
  color,
  preview,
  reveal,
}: {
  type: string;
  id: string;
  phase: StructurePhase;
  color: string;
  // `preview` marks the transient drag-to-place ghost: it renders the same hardware
  // untextured (flat-tinted) so the placement preview stays cheap to redraw.
  preview?: boolean;
  // `reveal` is how many build STEPS to show (milestone 08): the live agent-built
  // path passes the count of streamed module ops so the structure rises step-by-step
  // and resumes after a kill. undefined ⇒ the whole structure (preview / built /
  // no-spec fallback); 0 ⇒ not started (footprint or nothing, like a ghost).
  reveal?: number;
}) {
  const kind = kindOf(type, id);
  switch (kind) {
    case "foundation":
      return <FoundationPad phase={phase} color={color} preview={preview} reveal={reveal} />;
    case "wall":
      return <HabitatWall phase={phase} color={color} preview={preview} reveal={reveal} />;
    case "panel":
      return <SolarPanel phase={phase} color={color} preview={preview} reveal={reveal} />;
    case "mast":
      return <CommsMast phase={phase} color={color} preview={preview} reveal={reveal} />;
    case "dish":
      return <CommsDish phase={phase} color={color} preview={preview} reveal={reveal} />;
    case "dome":
    default:
      return <HabitatDome phase={phase} preview={preview} reveal={reveal} />;
  }
}
