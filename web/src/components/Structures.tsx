
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { loadTexture, preloadTexture } from "../lib/textureCache";

const BLOOM_LAYER = 12;


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
  void preloadTexture(url).then(() => {
    t.needsUpdate = true;
  });
  return t;
}

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


export type StructurePhase = "ghost" | "rising" | "built";

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

function bodyMat(look: Look) {
  return {
    transparent: look.transparent,
    opacity: look.opacity,
    emissive: "#4a4d54",
    emissiveIntensity: 0.7,
  };
}

function enableBloom(o: THREE.Object3D | null) {
  if (o) o.layers.enable(BLOOM_LAYER);
}


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
  const steps = [
    <mesh key="deck" position={[0, 0.16, 0]} castShadow={look.shadow} receiveShadow={look.shadow} raycast={() => null}>
      <boxGeometry args={[1.7, 0.32, 1.7]} />
      <meshStandardMaterial {...crete} {...bodyMat(look)} color={color} roughness={0.96} metalness={0.04} />
    </mesh>,
    <mesh key="kerb" position={[0, 0.33, 0]} castShadow={look.shadow} raycast={() => null}>
      <boxGeometry args={[1.78, 0.06, 1.78]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#9aa0aa" metalness={0.26} roughness={0.55} />
    </mesh>,
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


function HabitatWall({ phase, color, preview, reveal }: { phase: StructurePhase; color: string; preview?: boolean; reveal?: number }) {
  const look = lookOf(phase);
  const metal = usePbrSet(METAL_MAPS, 1.5, preview);
  if (phase === "ghost" || reveal === 0) return <FootprintScribe radius={0.85} color={color} />;
  const bodyColor = phase === "built" ? "#d6d9e0" : color;
  const steps = [
    <mesh key="base" position={[0, 0.18, 0]} castShadow={look.shadow} receiveShadow={look.shadow} raycast={() => null}>
      <boxGeometry args={[1.5, 0.36, 0.66]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#9aa0aa" metalness={0.26} roughness={0.5} />
    </mesh>,
    <mesh key="body" position={[0, 0.95, 0]} castShadow={look.shadow} receiveShadow={look.shadow} raycast={() => null}>
      <boxGeometry args={[1.4, 1.45, 0.52]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color={bodyColor} metalness={0.18} roughness={0.62} />
    </mesh>,
    <mesh key="pilaster-l" position={[-0.66, 0.92, 0]} castShadow={look.shadow} raycast={() => null}>
      <boxGeometry args={[0.14, 1.5, 0.6]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#878d98" metalness={0.26} roughness={0.45} />
    </mesh>,
    <mesh key="pilaster-r" position={[0.66, 0.92, 0]} castShadow={look.shadow} raycast={() => null}>
      <boxGeometry args={[0.14, 1.5, 0.6]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#878d98" metalness={0.26} roughness={0.45} />
    </mesh>,
    <mesh key="seam" position={[0, 1.0, 0.27]} raycast={() => null}>
      <boxGeometry args={[1.32, 0.07, 0.04]} />
      <meshStandardMaterial {...bodyMat(look)} color="#4a4f59" metalness={0.35} roughness={0.6} />
    </mesh>,
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
    <mesh key="trim" position={[0, 1.72, 0]} castShadow={look.shadow} raycast={() => null}>
      <boxGeometry args={[1.46, 0.12, 0.6]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#aeb4be" metalness={0.26} roughness={0.5} />
    </mesh>,
  ];
  return <group position={[0, 0, 0]}>{steps.slice(0, reveal ?? steps.length)}</group>;
}


function HabitatDome({ phase, preview, reveal }: { phase: StructurePhase; preview?: boolean; reveal?: number }) {
  const look = lookOf(phase);
  const metal = usePbrSet(METAL_MAPS, 2, preview);
  if (phase === "ghost" || reveal === 0) return null;

  const R = 2.6;
  const ribs = [0, 1, 2, 3].map((i) => (i * Math.PI) / 4);
  const steps = [
    <mesh key="base-ring" position={[0, 0.18, 0]} castShadow={look.shadow} receiveShadow={look.shadow} raycast={() => null}>
      <cylinderGeometry args={[R + 0.06, R + 0.12, 0.36, 32, 1, true]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#8b919c" metalness={0.26} roughness={0.45} side={THREE.DoubleSide} />
    </mesh>,
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
    <group key="ribs">
      {ribs.map((ry) => (
        <mesh key={ry} rotation={[0, ry, 0]} castShadow={look.shadow} raycast={() => null}>
          <torusGeometry args={[R - 0.02, 0.05, 6, 24, Math.PI]} />
          <meshStandardMaterial {...metal} {...bodyMat(look)} color="#6f757f" metalness={0.3} roughness={0.4} />
        </mesh>
      ))}
    </group>,
    <mesh key="apex-collar" position={[0, R - 0.18, 0]} raycast={() => null}>
      <cylinderGeometry args={[0.5, 0.58, 0.2, 20]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#7f858f" metalness={0.3} roughness={0.4} />
    </mesh>,
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
    <group key="interior-light">
      {phase === "built" && (
        <pointLight position={[0, 1.2, 0]} color="#ffe2b0" intensity={6} distance={6} decay={2} />
      )}
    </group>,
  ];
  return <group>{steps.slice(0, reveal ?? steps.length)}</group>;
}


function SolarPanel({ phase, color, preview, reveal }: { phase: StructurePhase; color: string; preview?: boolean; reveal?: number }) {
  const look = lookOf(phase);
  const metal = usePbrSet(METAL_MAPS, 1, preview);
  const solar = usePbrSet(SOLAR_MAPS, 1, preview);
  const panelRef = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    const m = panelRef.current;
    if (m) m.emissiveIntensity = (0.18 + 0.07 * Math.sin(clock.elapsedTime * 0.8)) * look.emissiveScale;
  });
  if (phase === "ghost" || reveal === 0) return <FootprintScribe radius={1.2} color={color} />;
  const tilt = -Math.PI / 5;
  const steps = [
    <mesh key="pedestal" position={[0, 0.4, 0]} castShadow={look.shadow} receiveShadow={look.shadow} raycast={() => null}>
      <cylinderGeometry args={[0.16, 0.22, 0.8, 14]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#9aa0aa" metalness={0.3} roughness={0.45} />
    </mesh>,
    <mesh key="leg-l" position={[-0.5, 0.25, 0]} rotation={[0, 0, -0.5]} castShadow={look.shadow} raycast={() => null}>
      <cylinderGeometry args={[0.07, 0.07, 0.7, 10]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#878d98" metalness={0.3} roughness={0.45} />
    </mesh>,
    <mesh key="leg-r" position={[0.5, 0.25, 0]} rotation={[0, 0, 0.5]} castShadow={look.shadow} raycast={() => null}>
      <cylinderGeometry args={[0.07, 0.07, 0.7, 10]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#878d98" metalness={0.3} roughness={0.45} />
    </mesh>,
    <mesh key="actuator" position={[0, 0.82, 0]} raycast={() => null}>
      <boxGeometry args={[0.5, 0.22, 0.3]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#5b606a" metalness={0.26} roughness={0.5} />
    </mesh>,
    <group key="head" position={[0, 0.95, 0]} rotation={[tilt, 0, 0]}>
      <mesh castShadow={look.shadow} receiveShadow={look.shadow} raycast={() => null}>
        <boxGeometry args={[2.4, 0.1, 1.5]} />
        <meshStandardMaterial {...metal} {...bodyMat(look)} color="#aeb4be" metalness={0.3} roughness={0.4} />
      </mesh>
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
      {[-0.78, 0, 0.78].map((x) => (
        <mesh key={x} position={[x, 0.09, 0]} raycast={() => null}>
          <boxGeometry args={[0.03, 0.02, 1.36]} />
          <meshStandardMaterial {...bodyMat(look)} color="#7f8893" metalness={0.3} roughness={0.4} />
        </mesh>
      ))}
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


const MAST_HEIGHT = 4.0;

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

function CommsMast({ phase, color, preview, reveal }: { phase: StructurePhase; color: string; preview?: boolean; reveal?: number }) {
  const look = lookOf(phase);
  const metal = usePbrSet(METAL_MAPS, 1, preview);
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
    for (const [sx, sz] of signs) out.push(strutBetween(corner(0, sx, sz), corner(SEG, sx, sz)));
    for (let lvl = 0; lvl < SEG; lvl++) {
      for (let i = 0; i < 4; i++) {
        const [ax, az] = signs[i];
        const [bx, bz] = signs[(i + 1) % 4];
        out.push(strutBetween(corner(lvl + 1, ax, az), corner(lvl + 1, bx, bz)));
        if (lvl % 2 === 0) out.push(strutBetween(corner(lvl, ax, az), corner(lvl + 1, bx, bz)));
        else out.push(strutBetween(corner(lvl, bx, bz), corner(lvl + 1, ax, az)));
      }
    }
    return out;
  }, []);

  if (phase === "ghost" || reveal === 0) return <FootprintScribe radius={0.7} color={color} />;
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
  const steps = [
    <mesh key="equipment" position={[0.7, 0.3, 0]} castShadow={look.shadow} receiveShadow={look.shadow} raycast={() => null}>
      <boxGeometry args={[0.5, 0.6, 0.7]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#878d98" metalness={0.26} roughness={0.5} />
    </mesh>,
    strutChunk(0, third, "lattice-0"),
    strutChunk(third, third * 2, "lattice-1"),
    strutChunk(third * 2, struts.length, "lattice-2"),
    <mesh key="platform" position={[0, MAST_HEIGHT, 0]} castShadow={look.shadow} raycast={() => null}>
      <boxGeometry args={[0.5, 0.08, 0.5]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#9aa0aa" metalness={0.3} roughness={0.45} />
    </mesh>,
  ];
  return <group>{steps.slice(0, reveal ?? steps.length)}</group>;
}

function CommsDish({ phase, color, preview, reveal }: { phase: StructurePhase; color: string; preview?: boolean; reveal?: number }) {
  const look = lookOf(phase);
  const metal = usePbrSet(METAL_MAPS, 1, preview);
  const dishRef = useRef<THREE.Group>(null);
  const beaconRef = useRef<THREE.MeshStandardMaterial>(null);
  const beaconLightRef = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    if (dishRef.current) dishRef.current.rotation.y = clock.elapsedTime * 0.12;
    const blink = 0.5 + 0.5 * Math.sin(clock.elapsedTime * Math.PI * 2);
    if (beaconRef.current) beaconRef.current.emissiveIntensity = (0.4 + 2.4 * blink) * look.emissiveScale;
    if (beaconLightRef.current) beaconLightRef.current.intensity = 2.4 * blink * (phase === "built" ? 1 : 0.4);
  });
  if (phase === "ghost" || reveal === 0) return null;
  const steps = [
    <mesh key="yoke" position={[0, 0.16, 0]} castShadow={look.shadow} raycast={() => null}>
      <boxGeometry args={[0.34, 0.32, 0.18]} />
      <meshStandardMaterial {...metal} {...bodyMat(look)} color="#7f858f" metalness={0.3} roughness={0.45} />
    </mesh>,
    <group key="dish" ref={dishRef} position={[0, 0.35, 0]}>
      <group rotation={[-Math.PI / 4, 0, 0]}>
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
        <mesh position={[0, 0.27, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
          <torusGeometry args={[1.06, 0.04, 8, 36]} />
          <meshStandardMaterial {...metal} {...bodyMat(look)} color="#9aa0aa" metalness={0.3} roughness={0.4} />
        </mesh>
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
        <mesh position={[0, 1.02, 0]} raycast={() => null}>
          <cylinderGeometry args={[0.1, 0.06, 0.22, 12]} />
          <meshStandardMaterial {...metal} {...bodyMat(look)} color="#c9ccd2" metalness={0.32} roughness={0.35} />
        </mesh>
      </group>
    </group>,
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


export type StructureKind = "foundation" | "wall" | "dome" | "panel" | "mast" | "dish";

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

export function kindFootprintRadius(kind: StructureKind): number {
  switch (kind) {
    case "dome":
      return 3.0;
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
  preview?: boolean;
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
