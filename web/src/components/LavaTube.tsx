// LavaTube — the LUNAR hero lava-tube skylight (milestone 08 / #173).
//
// The flat lunar plain gets one dramatic landform: a collapsed lava-tube
// SKYLIGHT — a sheer, dark, near-bottomless shaft punched into the regolith SW
// of the worksite, with an ejecta-strewn raised rim. The user asked for a "cave";
// this is the lunar-pit read (Mare Tranquillitatis / Marius Hills collapse holes).
//
// Two snapshot-INDEPENDENT, non-pickable pieces, both keyed off the shared
// SKYLIGHT_* constants in lib/scene.ts (single source of truth so the terrain
// carve, the shaft, and the boulders all agree on centre + radii):
//
//   <LavaTubeSkylight>  — the dark void: a sheer cylinder wall (BackSide, so you
//     see its INNER face from the rim) sunk into the terrain collar, capped by a
//     near-black floor disc deep below. The terrain (LunarTerrain) only carves a
//     shallow recessed collar + raised rim via skylightProfile; THIS supplies the
//     crisp deep shaft, so the void reads the same regardless of ground tessellation.
//
//   <LavaTubeBoulders>  — an ejecta scatter of boulders clustered on the rim,
//     mirroring DecorRocks (drei <Instances frames={1}> ⇒ ~one draw call, the
//     matrices computed once then no per-frame work — demand-loop safe). Seeded
//     PRNG ⇒ a stable, reproducible field (ADR-0004: the scene stays a pure
//     function of the snapshot; decoration is snapshot-independent).
//
// ADR-0004 / #48: both set raycast={() => null}, so the ONLY pickable surface in
// the scene stays each rover's invisible hit-proxy sphere — click-to-kill and the
// onPointerMissed deselect stay deterministic; the landform can never steal a pick.
// A missing boulder texture leaves the flat regolith-grey fallback (never blanks).

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
import { ROCK_DIFF, ROCK_NORMAL, ROCK_ROUGH } from "./DecorRocks";

const [SKY_CX, SKY_CZ] = SKYLIGHT_CENTER;

// The shaft tapers slightly inward (mouth → floor) for a converging-tube read.
const SHAFT_FLOOR_RADIUS = SKYLIGHT_MOUTH_RADIUS * 0.78;
// Near-black void colour. The high lunar sun barely reaches down a sheer shaft, so
// the inner wall + floor sit in the scene's low ambient (≈0.05) and read black —
// but force the colour dark too so the void never looks like a lit grey pit.
const VOID_COLOR = "#060709";

// The dark shaft + floor that make the skylight read bottomless. Static geometry,
// built once. Positioned at the skylight centre in WORLD space (it is NOT a child
// of the rotated terrain plane, so scene x/y/z are used directly).
export function LavaTubeSkylight() {
  // Sheer wall: a cylinder whose TOP meets the terrain collar (y = −MOUTH_DROP) and
  // whose bottom reaches the floor disc. openEnded + BackSide ⇒ from the rim you
  // look at its inner face. Height spans collar → floor.
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
        true, // open-ended: no caps; the floor disc closes the bottom
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
      {/* Inner shaft wall — BackSide so the visible face is the one turned toward
          the rim viewer. Matte + dark; catches almost no light down the shaft. */}
      <mesh geometry={wallGeom} position={[0, shaftCenterY, 0]} raycast={() => null}>
        <meshStandardMaterial
          color={VOID_COLOR}
          roughness={1}
          metalness={0}
          side={THREE.BackSide}
        />
      </mesh>
      {/* Floor disc deep below, so the shaft isn't see-through to the underside of
          the ground plane. Faces up; near-black. */}
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

// ---- rim ejecta boulders ---------------------------------------------------

const BOULDER_COUNT = 30;
const REGOLITH_GREY = "#8a8076"; // flat fallback until the boulder texture resolves

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

// Deterministic PRNG (mulberry32) — a FIXED seed (distinct from DecorRocks') so the
// ejecta field is stable across reloads and reproducible (ADR-0004).
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

// An annular ejecta scatter hugging the skylight rim: densest just outside the rim
// crest, thinning outward — the debris a collapse throws up. Boulders are larger
// than the DecorRocks pebble field for hero presence at this focal landform.
export function LavaTubeBoulders() {
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const [maps, setMaps] = useState<RockMaps>({});

  const geometry = useMemo(() => new THREE.IcosahedronGeometry(0.5, 0), []);

  const placements = useMemo<Placement[]>(() => {
    const rand = mulberry32(0x1a7ab3); // fixed seed → reproducible ejecta
    const out: Placement[] = [];
    for (let n = 0; n < BOULDER_COUNT; n++) {
      const angle = rand() * Math.PI * 2;
      // Bias the radius toward the rim crest: rand²  clusters samples near the inner
      // edge of the band [RIM−1, OUTER+3], thinning outward.
      const band = rand() * rand();
      const dr = SKYLIGHT_RIM_RADIUS - 1 + band * (SKYLIGHT_OUTER_RADIUS + 3 - (SKYLIGHT_RIM_RADIUS - 1));
      const x = SKY_CX + Math.cos(angle) * dr;
      const z = SKY_CZ + Math.sin(angle) * dr;
      const scale = 0.5 + rand() * 1.1; // small-boulder → boulder
      // Seat on the rim slope: skylightProfile is the dominant local elevation this
      // far out (the plain's swell is ~0 inside r≈30). Half-bury the base.
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
        if (disposed || !tex.image) return; // failed ⇒ leave the slot unset (ADR-0004)
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
