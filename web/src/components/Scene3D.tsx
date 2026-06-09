
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { ContactShadows, Html, Instance, Instances, Line, OrbitControls } from "@react-three/drei";
import { SpaceEnvironment, STARFIELD_PARALLAX_NAME } from "./SpaceEnvironment";
import { SkyBodies } from "./SkyBodies";
import {
  ChromaticAberration,
  DepthOfField,
  EffectComposer,
  GodRays,
  Noise,
  SelectiveBloom,
  SMAA,
  Vignette,
} from "@react-three/postprocessing";
import {
  BlendFunction,
  KernelSize,
  type GodRaysEffect,
  type SelectiveBloomEffect,
} from "postprocessing";
import * as THREE from "three";
import type { RoverView, Snapshot, TaskView, Vec2 } from "../types/wire";
import { batteryPercent } from "../lib/format";
import { roverStandoffPos } from "../lib/roverStandoff";
import { suppressRaycast } from "../lib/suppressRaycast";
import { applyGltfTextureFidelity, polishGltfMaterials } from "../lib/textureFidelity";
import { loadTexture, preloadTexture } from "../lib/textureCache";
import { reportAssetError, reportAssetWarning } from "../lib/assetLog";
import {
  CRATER_OUTER_RADIUS,
  EARTH_POSITION,
  GROUND_SPAN,
  MOON_POSITION,
  ORBIT_SUN_POSITION,
  REAL_METERS,
  SCENE_UNITS_PER_METER,
  SITE_FRAMES,
  SKYLIGHT_CENTER,
  SKYLIGHT_OUTER_RADIUS,
  SKYLIGHT_MOUTH_RADIUS,
  SKYLIGHT_RIM_RADIUS,
  type SceneMap,
  type SiteFrame,
  craterProfile,
  isBuilt,
  siteMap,
  skylightProfile,
  tierHeight,
  tierOf,
} from "../lib/scene";
import {
  type ActiveBeat,
  activeBeats,
  activeBidders,
  beatProgress,
  bidWarStrobe,
} from "../lib/choreography";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import {
  type MeshDesc,
  type ModelDesc,
  type PrimitiveDesc,
  interpretBuildSpec,
  interpretModuleSpec,
} from "../lib/buildspec";
import { type Ghost, dragDeltaToRadians } from "../lib/placement";
import {
  IDLE_DELAY_MS,
  ORBIT_EXPOSURE_SCALE,
  SURFACE_EXPOSURE_SCALE,
  PARALLAX_SETTLE_EPS,
  advanceParallax,
  idleSwayOffset,
  zoomExposure,
} from "../lib/cameraFeel";
import { LaunchScenery } from "./LaunchScenery";
import { LavaTubeSkylight, LavaTubeBoulders } from "./LavaTube";
import { LunarBaseDecals } from "./BaseDecals";
import { StructurePiece, kindFootprintRadius, kindOf, type StructurePhase } from "./Structures";

const SIGNAL_OK = "#2ecc71";
const SIGNAL_WARN = "#f5a623";
const SIGNAL_DOWN = "#e74c3c";
const SIGNAL_IDLE = "#9aa4b2";
const SIGNAL_REVIVE = "#38e1ff";

const HALO_BLOOM_LAYER = 11;

export const CELESTIAL_BLOOM_LAYER = 12;

const CHROMATIC_OFFSET = new THREE.Vector2(0.0006, 0.0012);


const SHADOW_WORKSITE_HALF = 25;


function SpaceLights({
  onSurface,
  lightRef,
  surfaceSunDir,
  surfaceSunIntensity,
  crater = false,
}: {
  onSurface: boolean;
  lightRef: React.RefObject<THREE.DirectionalLight>;
  surfaceSunDir: [number, number, number];
  surfaceSunIntensity: number;
  crater?: boolean;
}) {
  const sunPos = onSurface ? surfaceSunDir : ORBIT_SUN_POSITION;
  const sunLen = Math.hypot(sunPos[0], sunPos[1], sunPos[2]);
  const craterFill = onSurface && crater;
  return (
    <>
      <ambientLight
        color={craterFill ? "#1a2230" : "#0e1014"}
        intensity={onSurface ? (craterFill ? 0.34 : 0.05) : 0.01}
      />
      <hemisphereLight
        args={[craterFill ? "#aebfd6" : "#cdd6e2", "#1a1814", onSurface ? (craterFill ? 0.6 : 0.1) : 0.0]}
      />
      <directionalLight
        ref={lightRef}
        position={sunPos}
        color="#ffffff"
        intensity={onSurface ? surfaceSunIntensity : 1.9}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={sunLen - SHADOW_WORKSITE_HALF - 35}
        shadow-camera-far={sunLen + SHADOW_WORKSITE_HALF + 35}
        shadow-camera-left={-SHADOW_WORKSITE_HALF}
        shadow-camera-right={SHADOW_WORKSITE_HALF}
        shadow-camera-top={SHADOW_WORKSITE_HALF}
        shadow-camera-bottom={-SHADOW_WORKSITE_HALF}
        shadow-normalBias={0.05}
        shadow-bias={-0.0005}
      />
      <pointLight
        position={EARTH_POSITION}
        color="#a8bfda"
        decay={2}
        distance={0}
        intensity={onSurface ? 2_310_000 : 1_350_000}
      />
      {onSurface && (
        <>
          <directionalLight position={[-40, 26, -30]} color="#9fb6d8" intensity={0.16} />
          <directionalLight position={[36, 22, 28]} color="#ffd9b0" intensity={0.07} />
        </>
      )}
    </>
  );
}


type SceneGeo = {
  hit: THREE.SphereGeometry;
  body: THREE.BoxGeometry;
  mast: THREE.BoxGeometry;
  wheel: THREE.CylinderGeometry;
  halo: THREE.RingGeometry;
  won: THREE.RingGeometry;
  sel: THREE.RingGeometry;
  battery: THREE.BoxGeometry;
  specBox: THREE.BoxGeometry;
  specCylinder: THREE.CylinderGeometry;
  specSphere: THREE.SphereGeometry;
};

function withUV2<T extends THREE.BufferGeometry>(g: T): T {
  const uv = g.attributes.uv;
  if (uv && !g.attributes.uv2) g.setAttribute("uv2", uv);
  return g;
}

function makeSceneGeo(): SceneGeo {
  return {
    hit: new THREE.SphereGeometry(0.95, 16, 16),
    body: new THREE.BoxGeometry(0.7, 0.34, 0.95),
    mast: new THREE.BoxGeometry(0.3, 0.2, 0.3),
    wheel: new THREE.CylinderGeometry(0.2, 0.2, 0.16, 12),
    halo: new THREE.RingGeometry(0.62, 0.82, 40),
    won: new THREE.RingGeometry(0.82, 0.98, 40),
    sel: new THREE.RingGeometry(0.9, 1.02, 48),
    battery: new THREE.BoxGeometry(1, 0.06, 0.06),
    specBox: withUV2(new THREE.BoxGeometry(1, 1, 1)),
    specCylinder: withUV2(new THREE.CylinderGeometry(0.5, 0.5, 1, 20)),
    specSphere: withUV2(new THREE.SphereGeometry(0.5, 20, 16)),
  };
}

function disposeSceneGeo(g: SceneGeo) {
  for (const key of Object.keys(g) as (keyof SceneGeo)[]) g[key].dispose();
}

function roverHaloColor(r: RoverView): string {
  if (!r.alive) return SIGNAL_DOWN;
  if (r.task) return SIGNAL_OK;
  return SIGNAL_IDLE;
}


export const ROVER_MODEL_REF = "/assets/models/rover_nasa.glb";
const ROVER_MODEL_FIT = 1.15;
const ROVER_BASE_SIZE = ROVER_MODEL_FIT;

const ROVER_SCENE_SIZE = REAL_METERS.rover * SCENE_UNITS_PER_METER;
const ROVER_HERO_SCALE = 5.5;
const ROVER_SCALE = (ROVER_SCENE_SIZE / ROVER_BASE_SIZE) * ROVER_HERO_SCALE;

function fitAndSeatRover(obj: THREE.Object3D, fit: number) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) {
    obj.scale.setScalar(fit);
    obj.position.set(0, 0, 0);
    reportAssetWarning("fitAndSeatRover", "empty bounding box (no renderable geometry)");
    return;
  }
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const s = fit / maxDim;
  obj.scale.setScalar(s);
  obj.position.set(-center.x * s, -box.min.y * s, -center.z * s);
}

const DIM_ROVER_MULTIPLIER = 0.18;
function dimRoverModel(obj: THREE.Object3D): THREE.Material[] {
  const owned: THREE.Material[] = [];
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const cloned = mats.map((m) => {
      const c = m.clone();
      const cc = c as THREE.MeshStandardMaterial;
      cc.color?.multiplyScalar(DIM_ROVER_MULTIPLIER);
      cc.emissive?.multiplyScalar(DIM_ROVER_MULTIPLIER);
      owned.push(c);
      return c;
    });
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
  });
  return owned;
}

const REVIVE_FLASH = new THREE.Color(SIGNAL_REVIVE);
function RoverBody({
  geo,
  dim,
  revived,
}: {
  geo: SceneGeo;
  dim: boolean;
  revived: React.RefObject<number>;
}) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const invalidate = useThree((s) => s.invalidate);
  const bodyRef = useRef<THREE.Group>(null);
  const gl = useThree((s) => s.gl);
  const bodyColor = dim ? "#2a2a2e" : "#f0f0fa";

  const flashMats = useRef<THREE.MeshStandardMaterial[] | null>(null);
  const flashing = useRef(false);
  const idlePhase = useRef(Math.random() * Math.PI * 2);

  useFrame(() => {
    const group = bodyRef.current;
    if (!group) return;
    if (!dim) {
      const t = performance.now() / 1000;
      group.rotation.y = Math.sin(t * 0.55 + idlePhase.current) * 0.09;
      group.position.y = Math.sin(t * 1.2 + idlePhase.current) * 0.012;
    }
    const p = revived.current ?? 0;
    if (p <= 0) {
      if (!flashing.current) return;
      flashing.current = false;
    } else {
      flashing.current = true;
      if (!flashMats.current) {
        const owned: THREE.MeshStandardMaterial[] = [];
        group.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh || !mesh.material) return;
          if (Array.isArray(mesh.material)) {
            mesh.material = mesh.material.map((m) => {
              const c = m.clone() as THREE.MeshStandardMaterial;
              owned.push(c);
              return c;
            });
          } else {
            const c = mesh.material.clone() as THREE.MeshStandardMaterial;
            owned.push(c);
            mesh.material = c;
          }
        });
        flashMats.current = owned;
      }
    }
    const intensity = p > 0 ? (1 - p) * 1.6 : 0;
    for (const sm of flashMats.current ?? []) {
      if (!sm.isMeshStandardMaterial) continue;
      sm.emissive.copy(REVIVE_FLASH);
      sm.emissiveIntensity = intensity;
    }
  });

  useEffect(
    () => () => {
      for (const m of flashMats.current ?? []) m.dispose();
      flashMats.current = null;
      flashing.current = false;
    },
    [scene],
  );

  useEffect(() => {
    let disposed = false;
    let ownedMats: THREE.Material[] = [];
    loadGLTF(ROVER_MODEL_REF)
      .then((g) => {
        if (disposed) return;
        const obj = suppressRaycast(g.clone(true));
        fitAndSeatRover(obj, ROVER_MODEL_FIT);
        applyGltfTextureFidelity(obj, gl.capabilities.getMaxAnisotropy());
        if (dim) ownedMats = dimRoverModel(obj);
        obj.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        setScene(obj);
        invalidate();
      })
      .catch((err) => {
        reportAssetError("rover", ROVER_MODEL_REF, err);
      });
    return () => {
      disposed = true;
      for (const m of ownedMats) m.dispose();
    };
  }, [invalidate, dim, gl]);

  if (scene) {
    return (
      <group ref={bodyRef}>
        <primitive object={scene} />
      </group>
    );
  }

  return (
    <group ref={bodyRef}>
      <mesh geometry={geo.body} position={[0, 0.42, 0]} raycast={() => null} castShadow receiveShadow>

        <meshStandardMaterial
          color={bodyColor}
          metalness={0.2}
          roughness={0.7}
          emissive={dim ? "#000000" : "#101014"}
        />
      </mesh>
      <mesh
        geometry={geo.mast}
        position={[0, 0.66, -0.18]}
        raycast={() => null}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={bodyColor} metalness={0.2} roughness={0.7} />
      </mesh>
      {(
        [
          [-0.38, -0.42],
          [0.38, -0.42],
          [-0.38, 0.42],
          [0.38, 0.42],
        ] as const
      ).map(([wx, wz], i) => (
        <mesh
          key={i}
          geometry={geo.wheel}
          position={[wx, 0.2, wz]}
          rotation={[0, 0, Math.PI / 2]}
          raycast={() => null}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color={dim ? "#141416" : "#3a3a3f"} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}


const DUST_COUNT = 15;
const DUST_MS = 600;

function dustRand(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type DustParticle = {
  dx: number;
  dz: number;
  speed: number;
  scale: number;
};

function makeDustParticles(seed: number): DustParticle[] {
  const rand = dustRand(seed);
  const out: DustParticle[] = [];
  for (let i = 0; i < DUST_COUNT; i++) {
    const ang = rand() * Math.PI * 2;
    const speed = 0.5 + rand() * 0.9;
    out.push({
      dx: Math.cos(ang),
      dz: Math.sin(ang),
      speed,
      scale: 0.05 + rand() * 0.07,
    });
  }
  return out;
}

function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function RoverDust({ pos }: { pos: Vec2 }) {
  const invalidate = useThree((s) => s.invalidate);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const instances = useRef<(THREE.Group | null)[]>([]);
  const burstStart = useRef<number>(0);
  const particles = useRef<DustParticle[]>([]);
  const prevPos = useRef<Vec2 | null>(null);

  useEffect(() => {
    const prev = prevPos.current;
    prevPos.current = pos;
    if (!prev) return;
    if (prev.X === pos.X && prev.Y === pos.Y) return;
    const seed = (hashId(`${pos.X},${pos.Y}`) ^ 0x9e3779b9) >>> 0;
    particles.current = makeDustParticles(seed);
    burstStart.current = performance.now();
    invalidate();
  }, [pos, invalidate]);

  useFrame(() => {
    const start = burstStart.current;
    const mat = matRef.current;
    if (!start || !mat) return;
    const age = (performance.now() - start) / DUST_MS;
    if (age >= 1) {
      burstStart.current = 0;
      for (const inst of instances.current) inst?.scale.setScalar(0);
      mat.opacity = 0;
      return;
    }
    const ps = particles.current;
    const rise = Math.sin(age * Math.PI) * 0.5;
    const spread = age;
    for (let i = 0; i < ps.length; i++) {
      const inst = instances.current[i];
      if (!inst) continue;
      const p = ps[i];
      inst.position.set(
        p.dx * p.speed * spread,
        0.06 + rise * p.speed,
        p.dz * p.speed * spread,
      );
      inst.scale.setScalar(p.scale * (1 + age));
      inst.updateMatrixWorld();
    }
    mat.opacity = 0.5 * (1 - age);
    invalidate();
  });

  return (
    <Instances limit={DUST_COUNT} raycast={() => null}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshStandardMaterial
        ref={matRef}
        color="#b8ac9c"
        roughness={1}
        metalness={0}
        transparent
        opacity={0}
        depthWrite={false}
      />
      {Array.from({ length: DUST_COUNT }, (_, i) => (
        <Instance
          key={i}
          ref={(el: THREE.Group | null) => (instances.current[i] = el)}
          scale={0}
        />
      ))}
    </Instances>
  );
}


type Rover3DProps = {
  rover: RoverView;
  map: SceneMap;
  geo: SceneGeo;
  selected: boolean;
  beats: React.RefObject<ActiveBeat[]>;
  onPick: (id: string) => void;
};

function Rover3D({ rover, map, geo, selected, beats, onPick }: Rover3DProps) {
  const p = map.at(rover.pos);
  const dim = !rover.alive;
  const haloColor = roverHaloColor(rover);

  const haloRef = useRef<THREE.Mesh>(null);
  const haloMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const wonRef = useRef<THREE.Mesh>(null);
  const wonMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const revivedRef = useRef<THREE.Mesh>(null);
  const revivedMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const revivedProgress = useRef<number>(0);

  useEffect(() => {
    haloRef.current?.layers.enable(HALO_BLOOM_LAYER);
    wonRef.current?.layers.enable(HALO_BLOOM_LAYER);
    revivedRef.current?.layers.enable(HALO_BLOOM_LAYER);
  }, []);

  const id = rover.id;
  useFrame(() => {
    const list = beats.current;
    if (!list) return;
    const now = performance.now();
    let bid = 0;
    let won = 0;
    let revived = 0;
    for (const b of list) {
      if (b.robot_id !== id) continue;
      if (b.kind === "bid") bid = beatProgress(b, now);
      else if (b.kind === "won") won = beatProgress(b, now);
      else if (b.kind === "revived") revived = beatProgress(b, now);
    }
    revivedProgress.current = revived;

    const strobe = bid > 0 ? bidWarStrobe(activeBidders(list, now)) : 0;

    const halo = haloRef.current;
    const haloMat = haloMatRef.current;
    if (halo && haloMat) {
      const basePulse = bid > 0 ? Math.sin(bid * Math.PI) * 0.35 : 0;
      const strobePulse =
        strobe > 0 ? (0.5 + 0.5 * Math.sin(now * 0.063)) * strobe * 0.4 : 0;
      halo.scale.setScalar(1 + basePulse + strobePulse);
      const c = bid > 0 ? SIGNAL_WARN : haloColor;
      haloMat.color.set(c);
      haloMat.emissive.set(c);
      haloMat.emissiveIntensity = (dim ? 1.4 : 2.2) + strobePulse * 3.0;
    }

    const wonMesh = wonRef.current;
    const wonMat = wonMatRef.current;
    if (wonMesh && wonMat) {
      if (won > 0) {
        wonMesh.visible = true;
        wonMesh.scale.setScalar(1 + won * 1.6);
        wonMat.opacity = 1 - won;
        wonMat.emissiveIntensity = 2.4 * (1 - won);
      } else if (wonMesh.visible) {
        wonMesh.visible = false;
      }
    }

    const revMesh = revivedRef.current;
    const revMat = revivedMatRef.current;
    if (revMesh && revMat) {
      if (revived > 0) {
        revMesh.visible = true;
        revMesh.scale.setScalar(1 + revived * 2.8);
        revMat.opacity = 1 - revived;
        revMat.emissiveIntensity = 3.0 * (1 - revived);
      } else if (revMesh.visible) {
        revMesh.visible = false;
      }
    }
  });

  const selColor = dim ? SIGNAL_IDLE : SIGNAL_DOWN;

  const battery = batteryPercent(rover.battery);
  const batteryColor = dim
    ? "#555"
    : battery > 50
      ? SIGNAL_OK
      : battery > 20
        ? SIGNAL_WARN
        : SIGNAL_DOWN;

  return (
    <group position={[p.x, p.y, p.z]} scale={ROVER_SCALE}>
      <mesh
        geometry={geo.hit}
        position={[0, 0.45, 0]}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onPick(rover.id);
        }}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "default")}
      >
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <RoverBody geo={geo} dim={dim} revived={revivedProgress} />

      <RoverDust pos={rover.pos} />

      <mesh
        ref={haloRef}
        geometry={geo.halo}
        position={[0, 0.04, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        raycast={() => null}
      >
        <meshStandardMaterial
          ref={haloMatRef}
          color={haloColor}
          emissive={haloColor}
          emissiveIntensity={dim ? 1.4 : 2.2}
          toneMapped={false}
          transparent
          opacity={dim ? 0.7 : 0.95}
          side={THREE.DoubleSide}
        />
      </mesh>

      <mesh
        ref={wonRef}
        geometry={geo.won}
        position={[0, 0.05, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
        raycast={() => null}
      >
        <meshStandardMaterial
          ref={wonMatRef}
          color={SIGNAL_OK}
          emissive={SIGNAL_OK}
          emissiveIntensity={0}
          toneMapped={false}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
        />
      </mesh>

      <mesh
        ref={revivedRef}
        geometry={geo.won}
        position={[0, 0.055, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
        raycast={() => null}
      >
        <meshStandardMaterial
          ref={revivedMatRef}
          color={SIGNAL_REVIVE}
          emissive={SIGNAL_REVIVE}
          emissiveIntensity={0}
          toneMapped={false}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
        />
      </mesh>

      {selected ? (
        <mesh
          geometry={geo.sel}
          position={[0, 0.06, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          raycast={() => null}
        >
          <meshBasicMaterial color={selColor} transparent opacity={0.95} side={THREE.DoubleSide} />
        </mesh>
      ) : null}

      <mesh
        geometry={geo.battery}
        position={[0, 0.92, 0]}
        scale={[0.5 * (battery / 100) + 0.02, 1, 1]}
        raycast={() => null}
      >
        <meshStandardMaterial
          color={batteryColor}
          emissive={batteryColor}
          emissiveIntensity={0.6}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}


function LeaseBeam({ from, to, map }: { from: RoverView; to: TaskView; map: SceneMap }) {
  const a = map.at(from.pos, 0.42);
  const b = map.at(to.pos, tierHeight(tierOf(to.type)));
  const points = useMemo<[number, number, number][]>(
    () => [
      [a.x, a.y, a.z],
      [b.x, b.y, b.z],
    ],
    [a.x, a.y, a.z, b.x, b.y, b.z],
  );
  return (
    <Line
      points={points}
      color={SIGNAL_OK}
      lineWidth={2}
      dashed
      dashSize={0.3}
      gapSize={0.2}
      transparent
      opacity={0.85}
      raycast={() => null}
    />
  );
}


const gltfLoader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath("/draco/");
gltfLoader.setDRACOLoader(dracoLoader);
gltfLoader.setMeshoptDecoder(MeshoptDecoder);
const gltfCache = new Map<string, Promise<THREE.Group>>();

export function loadGLTF(url: string): Promise<THREE.Group> {
  let p = gltfCache.get(url);
  if (!p) {
    p = new Promise<THREE.Group>((resolve, reject) => {
      gltfLoader.load(
        url,
        (g) => {
          try {
            suppressRaycast(g.scene);
            polishGltfMaterials(g.scene, { bloomLayer: CELESTIAL_BLOOM_LAYER, url });
          } catch (err) {
            reportAssetError("glTF polish", url, err);
          }
          resolve(g.scene);
        },
        undefined,
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
      );
    });
    gltfCache.set(url, p);
  }
  return p;
}

function SpecPrimitive({
  desc,
  geo,
  color,
  opacity,
  built,
}: {
  desc: PrimitiveDesc;
  geo: SceneGeo;
  color: string;
  opacity: number;
  built?: boolean;
}) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    const slots: {
      url: string | undefined;
      key: "map" | "normalMap" | "roughnessMap" | "aoMap";
      colorSpace: THREE.ColorSpace;
    }[] = [
      { url: desc.map, key: "map", colorSpace: THREE.SRGBColorSpace },
      { url: desc.normalMap, key: "normalMap", colorSpace: THREE.NoColorSpace },
      { url: desc.roughnessMap, key: "roughnessMap", colorSpace: THREE.NoColorSpace },
      { url: desc.aoMap, key: "aoMap", colorSpace: THREE.NoColorSpace },
    ];
    let disposed = false;
    for (const slot of slots) {
      if (!slot.url) {
        if (matRef.current && matRef.current[slot.key]) {
          matRef.current[slot.key] = null;
          matRef.current.needsUpdate = true;
        }
        continue;
      }
      const url = slot.url;
      const t = loadTexture(url);
      t.colorSpace = slot.colorSpace;
      void preloadTexture(url).then(() => {
        if (disposed || !matRef.current) return;
        if (!t.image) return;
        matRef.current[slot.key] = t;
        matRef.current.needsUpdate = true;
        invalidate();
      });
    }
    const mat = matRef.current;
    return () => {
      disposed = true;
      if (mat) {
        for (const slot of slots) {
          if (!slot.url) continue;
          if (mat[slot.key] === loadTexture(slot.url)) mat[slot.key] = null;
        }
      }
    };
  }, [desc.map, desc.normalMap, desc.roughnessMap, desc.aoMap, invalidate]);

  const geometry =
    desc.geometry === "box"
      ? geo.specBox
      : desc.geometry === "cylinder"
        ? geo.specCylinder
        : geo.specSphere;

  return (
    <mesh
      geometry={geometry}
      position={desc.position}
      rotation={desc.rotation}
      scale={desc.scale}
      raycast={() => null}
      castShadow={built !== false}
      receiveShadow={built !== false}
    >
      <meshStandardMaterial
        ref={matRef}
        color={color}
        roughness={desc.roughness}
        metalness={desc.metalness}
        transparent
        opacity={opacity}
        emissive="#000000"
        emissiveIntensity={0}
        toneMapped={false}
      />
    </mesh>
  );
}

function SpecModel({
  desc,
  geo,
  color,
  opacity,
  built,
}: {
  desc: ModelDesc;
  geo: SceneGeo;
  color: string;
  opacity: number;
  built: boolean;
}) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    let disposed = false;
    loadGLTF(desc.modelRef)
      .then((g) => {
        if (disposed) return;
        const obj = suppressRaycast(g.clone(true));
        if (built) {
          obj.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) {
              o.castShadow = true;
              o.receiveShadow = true;
            }
          });
        }
        applyGltfTextureFidelity(obj, gl.capabilities.getMaxAnisotropy());
        setScene(obj);
        invalidate();
      })
      .catch((err) => {
        reportAssetError("spec model", desc.modelRef, err);
      });
    return () => {
      disposed = true;
    };
  }, [desc.modelRef, invalidate, built, gl]);

  if (!scene) {
    return (
      <SpecPrimitive desc={desc.fallback} geo={geo} color={color} opacity={opacity} built={built} />
    );
  }

  return (
    <primitive
      object={scene}
      position={desc.position}
      rotation={desc.rotation}
      scale={desc.scale}
    />
  );
}

function SpecMesh({
  desc,
  geo,
  built,
  ghostColor,
  opacity,
}: {
  desc: MeshDesc;
  geo: SceneGeo;
  built: boolean;
  ghostColor: string;
  opacity: number;
}) {
  const color = built ? desc.color : ghostColor;
  if (desc.kind === "model") {
    return <SpecModel desc={desc} geo={geo} color={color} opacity={opacity} built={built} />;
  }
  return <SpecPrimitive desc={desc} geo={geo} color={color} opacity={opacity} built={built} />;
}


function TaskBlock({
  task,
  map,
  geo,
  beats,
}: {
  task: TaskView;
  map: SceneMap;
  geo: SceneGeo;
  beats: React.RefObject<ActiveBeat[]>;
}) {
  const p = map.at(task.pos, 0);
  const built = isBuilt(task);

  const phase: StructurePhase = built ? "built" : task.status === "LEASED" ? "rising" : "ghost";
  const color = built ? "#cfcfd6" : task.status === "LEASED" ? SIGNAL_WARN : SIGNAL_IDLE;
  const isUnclaimedGhost = !built && task.status === "UNCLAIMED";
  const opacity = built ? 1 : task.status === "LEASED" ? 0.5 : 0.1;

  const specMeshes = useMemo<MeshDesc[]>(
    () => interpretBuildSpec(task),
    [task],
  );
  const interpreted = specMeshes.length > 0;

  const moduleSpec = useMemo(() => interpretModuleSpec(task), [task]);

  const groupRef = useRef<THREE.Group>(null);

  const id = task.id;
  useFrame(() => {
    const list = beats.current;
    let solidify = 0;
    if (list) {
      const now = performance.now();
      for (const b of list) {
        if (b.kind === "solidify" && b.task_id === id) {
          solidify = beatProgress(b, now);
          break;
        }
      }
    }
    const popScale = solidify > 0 ? 1 + Math.sin(solidify * Math.PI) * 0.25 : 1;
    if (groupRef.current) groupRef.current.scale.setScalar(popScale);
  });

  if (interpreted && isUnclaimedGhost) return null;
  if (interpreted) {
    return (
      <group ref={groupRef} position={[p.x, 0, p.z]}>
        {specMeshes.map((m, i) => (
          <SpecMesh
            key={i}
            desc={m}
            geo={geo}
            built={built}
            ghostColor={color}
            opacity={opacity}
          />
        ))}
      </group>
    );
  }

  const reveal = moduleSpec ? moduleSpec.shown : task.status === "LEASED" ? 0 : undefined;
  return (
    <group ref={groupRef} position={[p.x, 0, p.z]}>
      <StructurePiece type={task.type} id={task.id} phase={phase} color={color} reveal={reveal} />
    </group>
  );
}


export const REGOLITH_MAPS: {
  url: string;
  key: "map" | "normalMap" | "roughnessMap" | "aoMap";
  colorSpace: THREE.ColorSpace;
}[] = [
  { url: "/assets/textures/regolith_diff_2k.jpg", key: "map", colorSpace: THREE.SRGBColorSpace },
  {
    url: "/assets/textures/regolith_nor_gl_2k.jpg",
    key: "normalMap",
    colorSpace: THREE.NoColorSpace,
  },
  {
    url: "/assets/textures/regolith_rough_2k.jpg",
    key: "roughnessMap",
    colorSpace: THREE.NoColorSpace,
  },
  { url: "/assets/textures/regolith_ao_2k.jpg", key: "aoMap", colorSpace: THREE.NoColorSpace },
];

const GROUND_VISUAL = 700;

const REGOLITH_REPEAT = Math.round(GROUND_VISUAL * 0.22);

const REGOLITH_MACRO_VERT_DECL = `varying vec3 vRegoWPos;`;
const REGOLITH_MACRO_VERT_ASSIGN = `vRegoWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`;
const REGOLITH_MACRO_FRAG_DECL = `
varying vec3 vRegoWPos;
float regoHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float regoVN(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  float a = regoHash(i), b = regoHash(i + vec2(1.0, 0.0));
  float c = regoHash(i + vec2(0.0, 1.0)), d = regoHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float regoMacro(vec2 wxz){
  return regoVN(wxz * 0.034) * 0.62 + regoVN(wxz * 0.11 + 17.3) * 0.38;
}`;

function hashLattice(ix: number, iy: number): number {
  const h = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function valueNoise2(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hashLattice(ix, iy);
  const b = hashLattice(ix + 1, iy);
  const c = hashLattice(ix, iy + 1);
  const d = hashLattice(ix + 1, iy + 1);
  const top = a + (b - a) * ux;
  const bottom = c + (d - c) * ux;
  return top + (bottom - top) * uy;
}

function applyRegolithMacro(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${REGOLITH_MACRO_VERT_DECL}`)
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>\n  ${REGOLITH_MACRO_VERT_ASSIGN}`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${REGOLITH_MACRO_FRAG_DECL}`)
    .replace(
      "#include <map_fragment>",
      `#include <map_fragment>\n  { float m = regoMacro(vRegoWPos.xz); diffuseColor.rgb *= mix(0.82, 1.18, m); }`,
    )
    .replace(
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>\n  roughnessFactor *= mix(0.94, 1.06, regoMacro(vRegoWPos.xz));`,
    );
}

function LunarTerrain({
  terrainTint,
  crater = false,
  skylight = false,
}: {
  terrainTint: string;
  crater?: boolean;
  skylight?: boolean;
}) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);

  const geom = useMemo(() => {
    const seg = crater ? 220 : skylight ? 160 : 96;
    const g = new THREE.PlaneGeometry(GROUND_VISUAL, GROUND_VISUAL, seg, seg);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const r = Math.hypot(x, y);
      const fine = Math.sin(x * 0.6) * Math.cos(y * 0.55) * 0.18 + Math.sin(x * 1.7 + y) * 0.05;
      const swellAmp = THREE.MathUtils.smoothstep(r, 30, 200) * 4.0;
      const swell = Math.sin(x * 0.018 + 1.3) * Math.cos(y * 0.021) * swellAmp;
      const microMask = 0.55 + 0.45 * THREE.MathUtils.smoothstep(r, 4, 12);
      const micro =
        ((valueNoise2(x * 0.31, y * 0.31) - 0.5) * 0.16 +
          (valueNoise2(x * 0.73 + 19.3, y * 0.73 - 7.1) - 0.5) * 0.07) *
        microMask;
      let skyTerm = 0;
      let skyWall = 1;
      if (skylight) {
        const sdr = Math.hypot(x - SKYLIGHT_CENTER[0], -y - SKYLIGHT_CENTER[1]);
        if (sdr < SKYLIGHT_OUTER_RADIUS) {
          skyTerm = skylightProfile(sdr);
          skyWall = THREE.MathUtils.smoothstep(sdr, SKYLIGHT_MOUTH_RADIUS, SKYLIGHT_RIM_RADIUS);
        }
      }
      const swellTerm = crater
        ? r > CRATER_OUTER_RADIUS
          ? swell
          : 0
        : swell * (skylight ? skyWall : 1);
      pos.setZ(
        i,
        fine * (skylight ? 0.4 + 0.6 * skyWall : 1) +
          swellTerm +
          micro * (skylight ? 0.3 + 0.7 * skyWall : 1) +
          (crater ? craterProfile(r) : 0) +
          skyTerm,
      );
    }
    g.computeVertexNormals();
    if (g.attributes.uv && !g.attributes.uv2) g.setAttribute("uv2", g.attributes.uv);
    return g;
  }, [crater, skylight]);
  useEffect(() => () => geom.dispose(), [geom]);

  useEffect(() => {
    let disposed = false;
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    for (const m of REGOLITH_MAPS) {
      const t = loadTexture(m.url);
      t.colorSpace = m.colorSpace;
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(REGOLITH_REPEAT, REGOLITH_REPEAT);
      t.anisotropy = maxAniso;
      void preloadTexture(m.url).then(() => {
        if (disposed || !matRef.current) return;
        if (!t.image) return;
        matRef.current[m.key] = t;
        matRef.current.needsUpdate = true;
        invalidate();
      });
    }
    return () => {
      disposed = true;
    };
  }, [gl, invalidate]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} receiveShadow>
      <primitive object={geom} attach="geometry" />
      <meshStandardMaterial
        ref={matRef}
        color={terrainTint}
        roughness={1}
        metalness={0}
        onBeforeCompile={applyRegolithMacro}
      />
    </mesh>
  );
}


const SHACKLETON_SHADOW_ANCHORS: { at: [number, number]; len: number }[] = [
  { at: [-10, -16], len: 1.25 },
  { at: [14, -18], len: 1.15 },
  { at: [-26, -30], len: 1.4 },
  { at: [0, 0], len: 1.0 },
];

function makeShadowBlobTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const size = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(0.55, "rgba(0,0,0,0.32)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function ShackletonShadows() {
  const { heading, blobLen } = useMemo(() => {
    const [sx, , sz] = SITE_FRAMES.shackleton.sunDir;
    const shadowAngle = Math.atan2(-sz, -sx);
    return { heading: shadowAngle, blobLen: 18 };
  }, []);

  const tex = useMemo(makeShadowBlobTexture, []);
  useEffect(() => () => tex?.dispose(), [tex]);
  if (!tex) return null;

  return (
    <group>
      {SHACKLETON_SHADOW_ANCHORS.map((a, i) => {
        const len = blobLen * a.len;
        const width = 5 * a.len;
        const ox = a.at[0] + Math.cos(heading) * len * 0.45;
        const oz = a.at[1] + Math.sin(heading) * len * 0.45;
        return (
          <mesh
            key={i}
            position={[ox, 0.03, oz]}
            rotation={[-Math.PI / 2, 0, -heading]}
            scale={[len, width, 1]}
            raycast={() => null}
            renderOrder={1}
          >
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial
              map={tex}
              transparent
              opacity={0.85}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}


const BLOOM_BASE_INTENSITY = 2.2;
const BLOOM_WAR_SPIKE = 2.6;

const GODRAYS_SAMPLES = 60;
const GODRAYS_ACTIVE_SCALE = 0.5;
const GODRAYS_IDLE_SCALE = 0.05;
const GODRAYS_NDC_MARGIN = 0.4;

const CinematicFX = memo(function CinematicFX({
  lightRef,
  sunRef,
  onSurface,
  beats,
}: {
  lightRef: React.RefObject<THREE.DirectionalLight>;
  sunRef: React.RefObject<THREE.Mesh>;
  onSurface: boolean;
  beats: React.RefObject<ActiveBeat[]>;
}) {
  const [, ready] = useState(0);
  useEffect(() => ready(1), []);
  const bloomRef = useRef<SelectiveBloomEffect>(null);
  const camera = useThree((s) => s.camera);

  const godRaysRef = useRef<GodRaysEffect>(null);
  const godRaysVisible = useRef<boolean | null>(null);
  const sunNdc = useRef(new THREE.Vector3());
  useFrame(() => {
    const fx = godRaysRef.current;
    const sunMesh = sunRef.current;
    if (!fx || !sunMesh) return;
    sunMesh.getWorldPosition(sunNdc.current).project(camera);
    const v = sunNdc.current;
    const onScreen =
      v.z < 1 &&
      Math.abs(v.x) <= 1 + GODRAYS_NDC_MARGIN &&
      Math.abs(v.y) <= 1 + GODRAYS_NDC_MARGIN;
    if (godRaysVisible.current === onScreen) return;
    godRaysVisible.current = onScreen;
    fx.resolution.scale = onScreen ? GODRAYS_ACTIVE_SCALE : GODRAYS_IDLE_SCALE;
  });

  const spiked = useRef(false);
  useFrame(() => {
    const effect = bloomRef.current;
    const list = beats.current;
    if (!effect) return;
    let strobe = 0;
    if (list && list.length > 0) {
      strobe = bidWarStrobe(activeBidders(list, performance.now()));
    }
    if (strobe <= 0) {
      if (!spiked.current) return;
      spiked.current = false;
      effect.intensity = BLOOM_BASE_INTENSITY;
      return;
    }
    spiked.current = true;
    effect.intensity = BLOOM_BASE_INTENSITY + BLOOM_WAR_SPIKE * strobe;
  });

  const light = lightRef.current;
  if (!light) return null;
  const sun = sunRef.current;
  return (
    <EffectComposer multisampling={0}>
      <SMAA />
      <SelectiveBloom
        ref={bloomRef}
        lights={[light]}
        selectionLayer={HALO_BLOOM_LAYER}
        blendFunction={BlendFunction.SCREEN}
        intensity={BLOOM_BASE_INTENSITY}
        luminanceThreshold={0.1}
        luminanceSmoothing={0.2}
        mipmapBlur
        kernelSize={KernelSize.SMALL}
        radius={0.6}
      />
      <SelectiveBloom
        lights={[light]}
        selectionLayer={CELESTIAL_BLOOM_LAYER}
        blendFunction={BlendFunction.SCREEN}
        intensity={1.1}
        luminanceThreshold={0.08}
        luminanceSmoothing={0.35}
        mipmapBlur
        kernelSize={KernelSize.LARGE}
        radius={0.85}
      />
      {!onSurface && sun ? (
        <GodRays
          ref={godRaysRef}
          sun={sun}
          blendFunction={BlendFunction.SCREEN}
          samples={GODRAYS_SAMPLES}
          resolutionScale={GODRAYS_ACTIVE_SCALE}
          density={0.5}
          decay={0.93}
          weight={0.3}
          exposure={0.3}
          clampMax={1}
          kernelSize={KernelSize.SMALL}
          blur
        />
      ) : (
        <></>
      )}
      {onSurface ? (
        <DepthOfField
          focusDistance={0.02}
          focalLength={0.45}
          bokehScale={0.6}
          height={480}
        />
      ) : (
        <></>
      )}
      {onSurface ? (
        <></>
      ) : (
        <ChromaticAberration
          blendFunction={BlendFunction.NORMAL}
          offset={CHROMATIC_OFFSET}
          radialModulation={false}
          modulationOffset={0}
        />
      )}
      <Vignette offset={0.3} darkness={0.4} blendFunction={BlendFunction.NORMAL} />
      <Noise blendFunction={BlendFunction.SCREEN} opacity={0.018} />
    </EffectComposer>
  );
});

export type ViewMode = "surface" | "orbit";

export type SiteId = "lunar" | "shackleton";

type Scene3DProps = {
  snapshot: Snapshot | null;
  selected: string | null;
  onPick: (id: string | null) => void;
  placing?: boolean;
  ghost?: Ghost | null;
  onPlaceMove?: (origin: Vec2) => void;
  onPlaceConfirm?: () => void;
  placementRotation?: number;
  placementInvalidReason?: string | null;
  onPlaceRotate?: (rotation: number) => void;
  onPlaceCancel?: () => void;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  activeSite?: SiteId;
  onActiveSiteChange?: (site: SiteId) => void;
};

const VIEW_PRESETS: Record<
  ViewMode,
  {
    minDistance: number;
    maxDistance: number;
    minPolarAngle: number;
    maxPolarAngle: number;
    target: [number, number, number];
  }
> = {
  surface: {
    minDistance: 6,
    maxDistance: 60,
    minPolarAngle: Math.PI / 10,
    maxPolarAngle: Math.PI / 2.25,
    target: [2.5, 0, -3],
  },
  orbit: {
    minDistance: 220,
    maxDistance: 640,
    minPolarAngle: Math.PI / 4,
    maxPolarAngle: Math.PI / 2.2,
    target: [MOON_POSITION[0], MOON_POSITION[1], MOON_POSITION[2]],
  },
};

type Pose = { position: THREE.Vector3; target: THREE.Vector3 };

const SURFACE_POSE: Pose = {
  position: new THREE.Vector3(2, 9, 9),
  target: new THREE.Vector3(0, 0.8, -2),
};
const LUNAR_SURFACE_POSE: Pose = SURFACE_POSE;
const SHACKLETON_SURFACE_POSE: Pose = {
  position: new THREE.Vector3(2.5, 13, 19),
  target: new THREE.Vector3(2.5, 1, -3),
};
const SURFACE_HIGH_POSE: Pose = {
  position: new THREE.Vector3(0, 120, 80),
  target: new THREE.Vector3(0, 0.6, 0),
};
const ORBIT_POSE: Pose = {
  position: new THREE.Vector3(
    MOON_POSITION[0] + 264,
    MOON_POSITION[1] + 85,
    MOON_POSITION[2] + 26,
  ),
  target: new THREE.Vector3(...MOON_POSITION),
};
const MOON_CLOSE_POSE: Pose = {
  position: new THREE.Vector3(
    MOON_POSITION[0] + 166,
    MOON_POSITION[1] + 54,
    MOON_POSITION[2] + 16,
  ),
  target: new THREE.Vector3(...MOON_POSITION),
};

const TRANSITION_MS = 1500;
const INTRO_MS = 4500;
const TRAVERSE_MS = 3600;
const SKIM_ALTITUDE = 4;
const SKIM_OUT_DIST = 100;

export function traverseEnvelope(t: number) {
  const c = Math.min(1, Math.max(0, t));
  const DUST_HALF = 0.46;
  const x = Math.min(1, Math.abs(c - 0.5) / DUST_HALF);
  const veil = 0.5 * (1 + Math.cos(Math.PI * x));
  const k = c * c * (3 - 2 * c);
  return { veil, k, swapped: c >= 0.5 };
}

const easeInQuad = (x: number) => x * x;
const easeOutQuint = (x: number) => 1 - Math.pow(1 - x, 5);
const smooth = (x: number) => x * x * (3 - 2 * x);

const lerpPose = (
  a: Pose,
  b: Pose,
  k: number,
  outPos: THREE.Vector3,
  outTgt: THREE.Vector3,
  pitchHold = 1,
) => {
  outPos.lerpVectors(a.position, b.position, k);
  const tk =
    pitchHold >= 1
      ? k
      : k <= pitchHold
        ? 0
        : smooth((k - pitchHold) / (1 - pitchHold));
  outTgt.lerpVectors(a.target, b.target, tk);
};

const GHOST_OK = "#38e1ff";
const GHOST_BAD = "#e74c3c";


function BlueprintGhost({ ghost, map }: { ghost: Ghost; map: SceneMap }) {
  const tint = ghost.invalid ? GHOST_BAD : GHOST_OK;
  return (
    <group>
      {ghost.tasks.map((t) => {
        const center = map.at(t.pos, 0);
        const kind = kindOf(t.type, t.id);
        const r = kindFootprintRadius(kind);
        return (
          <group key={t.id} position={[center.x, 0, center.z]}>
            <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
              <ringGeometry args={[r * 0.84, r, 44]} />
              <meshBasicMaterial color={tint} transparent opacity={0.6} side={THREE.DoubleSide} depthWrite={false} />
            </mesh>
            <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
              <circleGeometry args={[r * 0.84, 32]} />
              <meshBasicMaterial color={tint} transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
            </mesh>
            <StructurePiece type={t.type} id={t.id} phase="rising" color="#cfcfd6" preview />
          </group>
        );
      })}
    </group>
  );
}

function PlacementTip({
  ghost,
  map,
  invalidReason,
}: {
  ghost: Ghost;
  map: SceneMap;
  invalidReason: string | null;
}) {
  if (ghost.tasks.length === 0) return null;
  let cx = 0;
  let cy = 0;
  for (const t of ghost.tasks) {
    cx += t.pos.X;
    cy += t.pos.Y;
  }
  cx /= ghost.tasks.length;
  cy /= ghost.tasks.length;
  const center = map.at({ X: cx, Y: cy }, 0.06);
  const valid = invalidReason === null;
  return (
    <Html
      position={[center.x, center.y + 1.2, center.z]}
      center
      zIndexRange={[20, 0]}
      style={{ pointerEvents: "none" }}
    >
      <div className={`place-tip ${valid ? "place-tip--ok" : "place-tip--bad"}`}>
        <span className="place-tip__mark">{valid ? "✓" : "✗"}</span>
        {valid ? null : <span className="place-tip__reason">{invalidReason}</span>}
      </div>
    </Html>
  );
}

function PlacementPlane({
  map,
  rotation,
  onMove,
  onConfirm,
  onRotate,
}: {
  map: SceneMap;
  rotation: number;
  onMove: (origin: Vec2) => void;
  onConfirm: () => void;
  onRotate: (rotation: number) => void;
}) {
  const drag = useRef<{ baseRotation: number; startX: number; pointerId: number } | null>(null);
  return (
    <mesh
      position={[0, 0.02, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        if (drag.current) {
          const dx = e.nativeEvent.clientX - drag.current.startX;
          onRotate(drag.current.baseRotation + dragDeltaToRadians(dx));
          return;
        }
        onMove(map.invert(e.point.x, e.point.z));
      }}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        if (e.button === 2) {
          const target = e.nativeEvent.target as HTMLElement | null;
          target?.setPointerCapture?.(e.pointerId);
          drag.current = {
            baseRotation: rotation,
            startX: e.nativeEvent.clientX,
            pointerId: e.pointerId,
          };
          return;
        }
        if (e.button === 0) {
          onConfirm();
        }
      }}
      onPointerUp={(e: ThreeEvent<PointerEvent>) => {
        if (drag.current && e.button === 2) {
          const target = e.nativeEvent.target as HTMLElement | null;
          target?.releasePointerCapture?.(drag.current.pointerId);
          drag.current = null;
        }
      }}
    >
      <planeGeometry args={[GROUND_SPAN * 4, GROUND_SPAN * 4]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}


function SceneContents({
  snapshot,
  selected,
  onPick,
  placing,
  ghost,
  placementRotation = 0,
  placementInvalidReason = null,
  onPlaceMove,
  onPlaceConfirm,
  onPlaceRotate,
  viewMode = "surface",
  onViewModeChange,
  activeSite = "lunar",
  onActiveSiteChange,
}: Scene3DProps) {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const sunRef = useRef<THREE.Mesh>(null);
  const invalidate = useThree((s) => s.invalidate);

  const onSelectSite =
    onViewModeChange && onActiveSiteChange
      ? (site: SiteId) => {
          onActiveSiteChange(site);
          onViewModeChange("surface");
        }
      : undefined;

  const geo = useMemo(makeSceneGeo, []);
  useEffect(() => () => disposeSceneGeo(geo), [geo]);

  const beats = useRef<ActiveBeat[]>([]);
  const lastAt = useRef<number>(Number.NEGATIVE_INFINITY);

  useEffect(() => {
    invalidate();
  }, [ghost, placing, invalidate]);

  useEffect(() => {
    if (snapshot && snapshot.at !== lastAt.current) {
      lastAt.current = snapshot.at;
      const incoming = snapshot.events ?? [];
      if (incoming.length > 0) {
        const now = performance.now();
        beats.current = [...beats.current, ...incoming.map((e) => ({ ...e, spawn: now }))];
        invalidate();
      }
    }
  }, [snapshot, invalidate]);

  useFrame(() => {
    const before = beats.current.length;
    if (before > 0) beats.current = activeBeats(beats.current, performance.now());
    if (beats.current.length > 0 || before > 0) invalidate();
  });

  const frame: SiteFrame = SITE_FRAMES[activeSite];
  const map = useMemo(() => siteMap(frame), [frame]);

  const siteRovers = useMemo(
    () =>
      snapshot
        ? snapshot.rovers.filter((r) => (r.site ?? "lunar") === activeSite)
        : [],
    [snapshot, activeSite],
  );
  const siteTasks = useMemo(
    () =>
      snapshot
        ? snapshot.tasks.filter((t) => (t.site ?? "lunar") === activeSite)
        : [],
    [snapshot, activeSite],
  );
  const taskById = useMemo(
    () => (snapshot ? new Map(siteTasks.map((t) => [t.id, t])) : null),
    [snapshot, siteTasks],
  );

  const roverDisplayPos = useMemo(() => {
    const blocks = siteTasks.map((t) => t.pos);
    const m = new Map<string, Vec2>();
    for (const r of siteRovers) m.set(r.id, roverStandoffPos(r.pos, blocks));
    return m;
  }, [siteRovers, siteTasks]);

  const onSurface = viewMode === "surface";

  return (
    <group>
      <SpaceLights
        onSurface={onSurface}
        lightRef={lightRef}
        surfaceSunDir={frame.sunDir}
        surfaceSunIntensity={frame.sunIntensity}
        crater={activeSite === "shackleton"}
      />

      {onSurface && <fog attach="fog" args={frame.fog} />}

      <SpaceEnvironment onSurface={onSurface} />

      <SkyBodies
        viewMode={viewMode}
        onSelectSite={onSelectSite}
        sunRef={sunRef}
      />

      {snapshot && taskById && onSurface && (
        <>
          <LunarTerrain
            terrainTint={frame.terrainTint}
            crater={activeSite === "shackleton"}
            skylight={activeSite === "lunar"}
          />

          {activeSite === "shackleton" && <ShackletonShadows />}

          {activeSite === "lunar" && (
            <>
              <LavaTubeSkylight />
              <LavaTubeBoulders />
              <LunarBaseDecals />
            </>
          )}

          <ContactShadows
            position={[0, 0.02, 0]}
            scale={40}
            resolution={1024}
            far={6}
            blur={3}
            opacity={0.6}
            color="#000000"
            frames={1}
          />

          {siteTasks.map((t) => (
            <TaskBlock key={t.id} task={t} map={map} geo={geo} beats={beats} />
          ))}

          {siteRovers.map((r) => {
            if (!r.alive || !r.task) return null;
            const held = taskById.get(r.task);
            if (!held) return null;
            const pos = roverDisplayPos.get(r.id) ?? r.pos;
            const from = pos === r.pos ? r : { ...r, pos };
            return <LeaseBeam key={`beam-${r.id}`} from={from} to={held} map={map} />;
          })}

          {siteRovers.map((r) => {
            const pos = roverDisplayPos.get(r.id) ?? r.pos;
            return (
              <Rover3D
                key={r.id}
                rover={pos === r.pos ? r : { ...r, pos }}
                map={map}
                geo={geo}
                selected={selected === r.id}
                beats={beats}
                onPick={onPick}
              />
            );
          })}

          <LaunchScenery pieces={frame.pieces} />
        </>
      )}

      {onSurface && ghost ? <BlueprintGhost ghost={ghost} map={map} /> : null}
      {onSurface && ghost ? (
        <PlacementTip ghost={ghost} map={map} invalidReason={placementInvalidReason} />
      ) : null}
      {onSurface && placing && onPlaceMove && onPlaceConfirm && onPlaceRotate ? (
        <PlacementPlane
          map={map}
          rotation={placementRotation}
          onMove={onPlaceMove}
          onConfirm={onPlaceConfirm}
          onRotate={onPlaceRotate}
        />
      ) : null}

      <CinematicFX lightRef={lightRef} sunRef={sunRef} onSurface={onSurface} beats={beats} />
    </group>
  );
}

type OrbitLike = THREE.EventDispatcher & {
  target: THREE.Vector3;
  update: () => void;
  enabled: boolean;
};

function RigBridge({
  cameraRef,
  controlsRef,
  invalidateRef,
}: {
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
  controlsRef: React.MutableRefObject<OrbitLike | null>;
  invalidateRef: React.MutableRefObject<(() => void) | null>;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitLike | null;
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    cameraRef.current = camera;
    controlsRef.current = controls;
    invalidateRef.current = invalidate;
  });
  return null;
}

function PlacementGestureGuard({ placing }: { placing: boolean }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    if (!placing) return;
    const el = gl.domElement;
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    el.addEventListener("contextmenu", onContextMenu);
    return () => el.removeEventListener("contextmenu", onContextMenu);
  }, [placing, gl]);
  return null;
}

type FeelControls = {
  target: THREE.Vector3;
  enabled: boolean;
  minDistance: number;
  maxDistance: number;
  getDistance: () => number;
  getAzimuthalAngle: () => number;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

function CameraFeel({ active, onSurface }: { active: boolean; onSurface: boolean }) {
  const controls = useThree((s) => s.controls) as FeelControls | null;
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const domElement = gl.domElement;

  const lastInputRef = useRef<number>(performance.now());
  const restAzimuthRef = useRef<number | null>(null);
  const restOffsetRef = useRef(new THREE.Vector3());
  const draggingRef = useRef(false);
  const parallaxRef = useRef(0);
  const lastAzimuthRef = useRef<number | null>(null);
  const starsRef = useRef<THREE.Object3D | null>(null);

  useEffect(() => {
    if (!controls || !active) return;

    const markInput = () => {
      lastInputRef.current = performance.now();
      restAzimuthRef.current = null;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => invalidate(), IDLE_DELAY_MS + 16);
    };
    const onStart = () => {
      draggingRef.current = true;
      markInput();
    };
    const onEnd = () => {
      draggingRef.current = false;
      markInput();
    };

    let idleTimer = 0;
    controls.addEventListener("start", onStart);
    controls.addEventListener("end", onEnd);
    domElement.addEventListener("pointerdown", markInput);
    domElement.addEventListener("wheel", markInput, { passive: true });
    domElement.addEventListener("touchstart", markInput, { passive: true });

    const onVisibility = () => {
      if (!document.hidden) markInput();
    };
    document.addEventListener("visibilitychange", onVisibility);

    restAzimuthRef.current = null;
    lastInputRef.current = performance.now() - IDLE_DELAY_MS;
    idleTimer = window.setTimeout(() => invalidate(), 16);

    return () => {
      controls.removeEventListener("start", onStart);
      controls.removeEventListener("end", onEnd);
      domElement.removeEventListener("pointerdown", markInput);
      domElement.removeEventListener("wheel", markInput);
      domElement.removeEventListener("touchstart", markInput);
      document.removeEventListener("visibilitychange", onVisibility);
      if (idleTimer) clearTimeout(idleTimer);
      const stars = starsRef.current ?? scene.getObjectByName(STARFIELD_PARALLAX_NAME);
      if (stars) stars.rotation.y = 0;
      parallaxRef.current = 0;
      lastAzimuthRef.current = null;
    };
  }, [controls, domElement, invalidate, active, scene]);

  const qRef = useRef(new THREE.Quaternion());
  const offRef = useRef(new THREE.Vector3());

  useFrame((_, dt) => {
    if (!controls || !active) return;
    if (typeof document !== "undefined" && document.hidden) return;

    gl.toneMappingExposure =
      zoomExposure(
        controls.getDistance(),
        controls.minDistance,
        controls.maxDistance,
      ) * (onSurface ? SURFACE_EXPOSURE_SCALE : ORBIT_EXPOSURE_SCALE);

    const azimuth = controls.getAzimuthalAngle();

    const idleElapsed = performance.now() - lastInputRef.current - IDLE_DELAY_MS;
    if (idleElapsed > 0 && !draggingRef.current) {
      if (restAzimuthRef.current === null) {
        restAzimuthRef.current = azimuth;
        restOffsetRef.current.copy(camera.position).sub(controls.target);
      }
      const sway = idleSwayOffset(idleElapsed);
      const off = offRef.current.copy(restOffsetRef.current);
      off.applyQuaternion(qRef.current.setFromAxisAngle(camera.up, sway));
      camera.position.copy(controls.target).add(off);
      invalidate();
    }

    const stars =
      starsRef.current ??
      (starsRef.current = scene.getObjectByName(STARFIELD_PARALLAX_NAME) ?? null);
    if (stars) {
      const last = lastAzimuthRef.current;
      const azimuthDelta = last === null ? 0 : azimuth - last;
      lastAzimuthRef.current = azimuth;
      const next = advanceParallax(parallaxRef.current, azimuthDelta, dt);
      parallaxRef.current = next;
      stars.rotation.y = next;
      if (Math.abs(next) > PARALLAX_SETTLE_EPS) invalidate();
    }
  });

  return null;
}


export const poseFor = (m: ViewMode, site: SiteId = "lunar"): Pose =>
  m === "orbit"
    ? ORBIT_POSE
    : site === "shackleton"
      ? SHACKLETON_SURFACE_POSE
      : LUNAR_SURFACE_POSE;

export function Scene3D({
  snapshot,
  selected,
  onPick,
  placing,
  ghost,
  placementRotation = 0,
  placementInvalidReason = null,
  onPlaceMove,
  onPlaceConfirm,
  onPlaceRotate,
  viewMode = "surface",
  onViewModeChange,
  activeSite = "lunar",
  onActiveSiteChange,
}: Scene3DProps) {
  const initialCamera = useRef({
    position: (viewMode === "orbit"
      ? [ORBIT_POSE.position.x, ORBIT_POSE.position.y, ORBIT_POSE.position.z]
      : [SURFACE_POSE.position.x, SURFACE_POSE.position.y, SURFACE_POSE.position.z]) as [
      number,
      number,
      number,
    ],
    fov: 50,
    near: 0.1,
    far: 8000,
  }).current;

  const [shown, setShown] = useState<ViewMode>(viewMode);
  const shownRef = useRef<ViewMode>(viewMode);
  const [shownSite, setShownSite] = useState<SiteId>(activeSite);
  const shownSiteRef = useRef<SiteId>(activeSite);
  const [transitioning, setTransitioning] = useState(false);

  const cameraRef = useRef<THREE.Camera | null>(null);
  const controlsRef = useRef<OrbitLike | null>(null);
  const invalidateRef = useRef<(() => void) | null>(null);
  const glareRef = useRef<HTMLDivElement>(null);

  const runDescent = useRef<
    (from: ViewMode, to: ViewMode, durationMs: number, toSite?: SiteId) => () => void
  >(() => () => {});
  runDescent.current = (from, to, durationMs, toSite = shownSiteRef.current) => {
    const camera = cameraRef.current;
    const invalidate = invalidateRef.current;
    const controls = controlsRef.current;
    if (!camera || !invalidate) {
      shownRef.current = to;
      setShown(to);
      shownSiteRef.current = toSite;
      setShownSite(toSite);
      return () => {};
    }

    const startPose: Pose = {
      position: camera.position.clone(),
      target: controls
        ? controls.target.clone()
        : poseFor(from, shownSiteRef.current).target.clone(),
    };
    const beat1To = to === "surface" ? MOON_CLOSE_POSE : SURFACE_HIGH_POSE;
    const beat2From = to === "surface" ? SURFACE_HIGH_POSE : MOON_CLOSE_POSE;
    const destPose = poseFor(to, toSite);

    const descending = to === "surface";
    const DESCENT_PITCH_HOLD = 0.7;
    const ARC_X = descending ? 14 : -14;
    const ROLL_MAX = THREE.MathUtils.degToRad(2.2) * (descending ? 1 : -1);

    const tmpPos = new THREE.Vector3();
    const tmpTgt = new THREE.Vector3();
    let raf = 0;
    let start = 0;
    let swapped = false;
    if (controls) controls.enabled = false;
    setTransitioning(true);

    const step = (now: number) => {
      if (!start) start = now;
      const t = Math.min(1, (now - start) / durationMs);

      const GLARE_HALF = 0.16;
      const gx = Math.max(0, 1 - Math.abs(t - 0.5) / GLARE_HALF);
      if (glareRef.current) glareRef.current.style.opacity = String(Math.pow(gx, 1.6));

      if (t < 0.5) {
        const k = easeInQuad(t / 0.5);
        lerpPose(startPose, beat1To, k, tmpPos, tmpTgt, descending ? 1 : DESCENT_PITCH_HOLD);
      } else {
        if (!swapped) {
          swapped = true;
          shownRef.current = to;
          setShown(to);
          shownSiteRef.current = toSite;
          setShownSite(toSite);
        }
        const k = easeOutQuint((t - 0.5) / 0.5);
        lerpPose(beat2From, destPose, k, tmpPos, tmpTgt, descending ? DESCENT_PITCH_HOLD : 1);
      }

      const bump = Math.sin(t * Math.PI);
      tmpPos.x += ARC_X * bump;
      camera.position.copy(tmpPos);
      camera.lookAt(tmpTgt);
      camera.rotateZ(ROLL_MAX * bump);
      if (controls) controls.target.copy(tmpTgt);
      invalidate();

      if (t < 1) {
        raf = requestAnimationFrame(step);
      } else {
        if (glareRef.current) glareRef.current.style.opacity = "0";
        camera.position.copy(destPose.position);
        camera.up.set(0, 1, 0);
        camera.lookAt(destPose.target);
        if (controls) {
          controls.target.copy(destPose.target);
          controls.enabled = true;
          controls.update();
        }
        setTransitioning(false);
        invalidate();
      }
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      if (glareRef.current) glareRef.current.style.opacity = "0";
      if (controls) controls.enabled = true;
    };
  };

  const runTraverse = useRef<(toSite: SiteId, durationMs: number) => () => void>(
    () => () => {},
  );
  runTraverse.current = (toSite, durationMs) => {
    const camera = cameraRef.current;
    const invalidate = invalidateRef.current;
    const controls = controlsRef.current;
    if (!camera || !invalidate) {
      shownSiteRef.current = toSite;
      setShownSite(toSite);
      return () => {};
    }

    const startPose: Pose = {
      position: camera.position.clone(),
      target: controls
        ? controls.target.clone()
        : poseFor("surface", shownSiteRef.current).target.clone(),
    };
    const destPose = poseFor("surface", toSite);

    const heading = new THREE.Vector3(0.15, 0, -1).normalize();
    const skimOut: Pose = {
      position: heading.clone().multiplyScalar(SKIM_OUT_DIST).setY(SKIM_ALTITUDE),
      target: heading.clone().multiplyScalar(SKIM_OUT_DIST + 40).setY(2),
    };
    const skimIn: Pose = {
      position: heading.clone().multiplyScalar(SKIM_OUT_DIST).setY(SKIM_ALTITUDE),
      target: destPose.target.clone(),
    };

    const tmpPos = new THREE.Vector3();
    const tmpTgt = new THREE.Vector3();
    let raf = 0;
    let start = 0;
    let swapped = false;
    if (controls) controls.enabled = false;
    setTransitioning(true);
    if (glareRef.current) glareRef.current.classList.add("view-dust");

    const step = (now: number) => {
      if (!start) start = now;
      const t = Math.min(1, (now - start) / durationMs);
      const env = traverseEnvelope(t);

      if (glareRef.current) glareRef.current.style.opacity = String(env.veil);

      if (env.swapped && !swapped) {
        swapped = true;
        shownSiteRef.current = toSite;
        setShownSite(toSite);
      }

      if (t < 0.5) {
        lerpPose(startPose, skimOut, easeInQuad(t / 0.5), tmpPos, tmpTgt, 1);
      } else {
        lerpPose(skimIn, destPose, easeOutQuint((t - 0.5) / 0.5), tmpPos, tmpTgt, 0.7);
      }
      camera.position.copy(tmpPos);
      camera.lookAt(tmpTgt);
      if (controls) controls.target.copy(tmpTgt);
      invalidate();

      if (t < 1) {
        raf = requestAnimationFrame(step);
      } else {
        if (glareRef.current) {
          glareRef.current.style.opacity = "0";
          glareRef.current.classList.remove("view-dust");
        }
        camera.position.copy(destPose.position);
        camera.up.set(0, 1, 0);
        camera.lookAt(destPose.target);
        if (controls) {
          controls.target.copy(destPose.target);
          controls.enabled = true;
          controls.update();
        }
        setTransitioning(false);
        invalidate();
      }
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      if (glareRef.current) {
        glareRef.current.style.opacity = "0";
        glareRef.current.classList.remove("view-dust");
      }
      if (controls) controls.enabled = true;
    };
  };

  useEffect(() => {
    const toView = viewMode;
    const fromView = shownRef.current;
    const toSite = activeSite;
    const fromSite = shownSiteRef.current;
    if (toView !== fromView) {
      return runDescent.current(fromView, toView, TRANSITION_MS, toSite);
    }
    if (toSite === fromSite) return;
    if (toView === "surface") {
      return runTraverse.current(toSite, TRAVERSE_MS);
    }
    shownSiteRef.current = toSite;
    setShownSite(toSite);
  }, [viewMode, activeSite]);

  const introPlayed = useRef(false);
  useEffect(() => {
    if (introPlayed.current || viewMode !== "surface") return;
    let cleanup: (() => void) | undefined;
    let raf = 0;
    const tryStart = () => {
      if (introPlayed.current) return;
      if (!cameraRef.current || !invalidateRef.current) {
        raf = requestAnimationFrame(tryStart);
        return;
      }
      introPlayed.current = true;
      const camera = cameraRef.current;
      camera.position.set(ORBIT_POSE.position.x, ORBIT_POSE.position.y, ORBIT_POSE.position.z);
      cleanup = runDescent.current("orbit", "surface", INTRO_MS);
    };
    tryStart();
    return () => {
      cancelAnimationFrame(raf);
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preset = VIEW_PRESETS[shown];
  return (
    <>
      <Canvas
        className="world-canvas"
        frameloop="always"
        shadows={{ type: THREE.PCFSoftShadowMap }}
        dpr={[1, 1.5]}
        camera={initialCamera}
        onPointerMissed={() => (placing ? onPlaceConfirm?.() : onPick(null))}
        gl={{
          antialias: false,
          powerPreference: "high-performance",
          toneMappingExposure: 1.1,
          logarithmicDepthBuffer: true,
        }}
      >
        <color attach="background" args={["#000000"]} />
        <SceneContents
          snapshot={snapshot}
          selected={selected}
          onPick={onPick}
          placing={placing}
          ghost={ghost}
          placementRotation={placementRotation}
          placementInvalidReason={placementInvalidReason}
          onPlaceMove={onPlaceMove}
          onPlaceConfirm={onPlaceConfirm}
          onPlaceRotate={onPlaceRotate}
          viewMode={shown}
          onViewModeChange={onViewModeChange}
          activeSite={shownSite}
          onActiveSiteChange={onActiveSiteChange}
        />
        <RigBridge
          cameraRef={cameraRef}
          controlsRef={controlsRef}
          invalidateRef={invalidateRef}
        />
        <PlacementGestureGuard placing={placing === true} />
        <OrbitControls
          makeDefault
          enablePan={false}
          enableRotate={!placing && !transitioning}
          minDistance={preset.minDistance}
          maxDistance={preset.maxDistance}
          minPolarAngle={preset.minPolarAngle}
          maxPolarAngle={preset.maxPolarAngle}
          target={preset.target}
          enableDamping
          dampingFactor={0.08}
        />
        <CameraFeel active={!placing && !transitioning} onSurface={shown === "surface"} />
      </Canvas>
      <div className="view-glare" ref={glareRef} aria-hidden="true" />
    </>
  );
}
