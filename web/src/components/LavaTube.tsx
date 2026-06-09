
import { useEffect, useMemo, useState } from "react";
import { Instance, Instances } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  SKYLIGHT_CENTER,
  SKYLIGHT_MOUTH_RADIUS,
  SKYLIGHT_MOUTH_DROP,
  SKYLIGHT_OUTER_RADIUS,
  SKYLIGHT_RIM_RADIUS,
  SKYLIGHT_SHAFT_BOTTOM,
  skylightProfile,
} from "../lib/scene";
import { applyMaxAnisotropy } from "../lib/textureFidelity";
import { loadTexture, preloadTexture } from "../lib/textureCache";

export const ROCK_DIFF = "/assets/textures/rock_boulder_dry_diff_512.jpg";
export const ROCK_NORMAL = "/assets/textures/rock_boulder_dry_nor_gl_512.jpg";
export const ROCK_ROUGH = "/assets/textures/rock_boulder_dry_rough_512.jpg";

const [SKY_CX, SKY_CZ] = SKYLIGHT_CENTER;

const SHAFT_FLOOR_RADIUS = SKYLIGHT_MOUTH_RADIUS * 0.78;
const VOID_COLOR = "#060709";

export function LavaTubeSkylight() {
  const shaftHeight = SKYLIGHT_SHAFT_BOTTOM - SKYLIGHT_MOUTH_DROP;
  const shaftCenterY = -(SKYLIGHT_MOUTH_DROP + shaftHeight / 2);

  const wallGeom = useMemo(
    () =>
      new THREE.CylinderGeometry(
        SKYLIGHT_MOUTH_RADIUS,
        SHAFT_FLOOR_RADIUS,
        shaftHeight,
        48,
        1,
        true,
      ),
    [shaftHeight],
  );
  const floorGeom = useMemo(
    () => new THREE.CircleGeometry(SHAFT_FLOOR_RADIUS, 48),
    [],
  );
  useEffect(() => () => {
    wallGeom.dispose();
    floorGeom.dispose();
  }, [wallGeom, floorGeom]);

  return (
    <group position={[SKY_CX, 0, SKY_CZ]} raycast={() => null}>
      <mesh geometry={wallGeom} position={[0, shaftCenterY, 0]} raycast={() => null}>
        <meshStandardMaterial
          color={VOID_COLOR}
          roughness={1}
          metalness={0}
          side={THREE.BackSide}
        />
      </mesh>
      <mesh
        geometry={floorGeom}
        position={[0, -SKYLIGHT_SHAFT_BOTTOM, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        raycast={() => null}
      >
        <meshStandardMaterial color={VOID_COLOR} roughness={1} metalness={0} />
      </mesh>
    </group>
  );
}


const BOULDER_COUNT = 30;
const REGOLITH_GREY = "#8a8076";

const BOULDER_MAPS: {
  url: string;
  key: "map" | "normalMap" | "roughnessMap";
  colorSpace: THREE.ColorSpace;
}[] = [
  { url: ROCK_DIFF, key: "map", colorSpace: THREE.SRGBColorSpace },
  { url: ROCK_NORMAL, key: "normalMap", colorSpace: THREE.NoColorSpace },
  { url: ROCK_ROUGH, key: "roughnessMap", colorSpace: THREE.NoColorSpace },
];

type Placement = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
};

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type RockMaps = {
  map?: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
};

export function LavaTubeBoulders() {
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const [maps, setMaps] = useState<RockMaps>({});

  const geometry = useMemo(() => new THREE.IcosahedronGeometry(0.5, 0), []);

  const placements = useMemo<Placement[]>(() => {
    const rand = mulberry32(0x1a7ab3);
    const out: Placement[] = [];
    for (let n = 0; n < BOULDER_COUNT; n++) {
      const angle = rand() * Math.PI * 2;
      const band = rand() * rand();
      const dr = SKYLIGHT_RIM_RADIUS - 1 + band * (SKYLIGHT_OUTER_RADIUS + 3 - (SKYLIGHT_RIM_RADIUS - 1));
      const x = SKY_CX + Math.cos(angle) * dr;
      const z = SKY_CZ + Math.sin(angle) * dr;
      const scale = 0.5 + rand() * 1.1;
      const y = skylightProfile(dr) - 0.5 * scale * 0.5;
      out.push({
        position: [x, y, z],
        rotation: [rand() * Math.PI, rand() * Math.PI, rand() * Math.PI],
        scale,
      });
    }
    return out;
  }, []);

  useEffect(() => {
    let disposed = false;
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    for (const slot of BOULDER_MAPS) {
      const tex = loadTexture(slot.url);
      tex.colorSpace = slot.colorSpace;
      applyMaxAnisotropy(tex, maxAniso);
      void preloadTexture(slot.url).then(() => {
        if (disposed || !tex.image) return;
        setMaps((prev) => ({ ...prev, [slot.key]: tex }));
        invalidate();
      });
    }
    return () => {
      disposed = true;
    };
  }, [invalidate, gl]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <Instances geometry={geometry} frames={1} raycast={() => null}>
      <meshStandardMaterial
        map={maps.map ?? undefined}
        normalMap={maps.normalMap ?? undefined}
        roughnessMap={maps.roughnessMap ?? undefined}
        color={maps.map ? "#ffffff" : REGOLITH_GREY}
        roughness={maps.roughnessMap ? 1 : 0.95}
        metalness={0}
      />
      {placements.map((p, i) => (
        <Instance key={i} position={p.position} rotation={p.rotation} scale={p.scale} />
      ))}
    </Instances>
  );
}
