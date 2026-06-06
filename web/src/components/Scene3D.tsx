// Scene3D — the react-three-fiber lunar diorama (ADR-0004).
//
// A PURE function of the latest world snapshot: low-poly lunar terrain, rovers,
// status halos (idle/bidding/working/dead), lease beams from each rover to the
// task it holds, and the habitat dome rising block-by-block as tasks complete.
// There is NO client-side simulation — every mesh position is derived from the
// authoritative snapshot via lib/scene.ts, so neither renderer can lie about
// World Model state. Choreography beats (lib/choreography.ts) only DECORATE.
//
// Drop-in swap for WorldCanvas: same `{ snapshot, selected, onPick }` contract,
// so App can toggle between the 3D scene and the 2D fallback.
//
// PERFORMANCE MODEL (the dashboard must run light on a projector laptop):
//   - frameloop="demand": the render loop is IDLE unless something changed. We
//     invalidate() on a new snapshot and WHILE beats animate; OrbitControls
//     (makeDefault) invalidates during interaction. No 60fps idle burn.
//   - Beats animate by MUTATING mesh/material refs inside useFrame — they NEVER
//     trigger a React re-render. The snapshot→mesh tree only re-renders when a
//     new snapshot arrives (~12 Hz), not per animation frame (r3f-fundamentals
//     "Avoiding Re-renders"; r3f-animation "Transient Subscriptions").
//   - Geometry buffers are shared: ONE set is created per Canvas mount and
//     disposed on unmount, instead of every rover allocating its own
//     (r3f-geometry "Reuse geometries").
//   - dpr capped at 1.5 and bloom kept cheap (small kernel, no MSAA).
//
// HARD SCOPE GUARD (ADR-0004 — obeyed here):
//   - Rover is PRIMITIVE geometry (low-poly box body + cylinder wheels). No CC0
//     glTF was available offline and we must NOT fetch unlicensed assets, so the
//     documented primitive fallback stands in — it still honors "primitive
//     geometry / no hand-modelled art".
//   - ONE fixed default orbit-camera angle (OrbitControls allowed, clamped).
//   - BLOOM ONLY on the status halos, via a selective-bloom layer limited to the
//     halo meshes (never full-scene bloom). See HALO_BLOOM_LAYER below.
//   - No custom physics, no hand-modelled art.

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import { EffectComposer, SelectiveBloom } from "@react-three/postprocessing";
import { KernelSize } from "postprocessing";
import * as THREE from "three";
import type { RoverView, Snapshot, TaskView, Vec2 } from "../types/wire";
import { batteryPercent } from "../lib/format";
import { suppressRaycast } from "../lib/suppressRaycast";
import {
  GROUND_SPAN,
  type SceneMap,
  isBuilt,
  sceneMap,
  tierHeight,
  tierOf,
} from "../lib/scene";
import {
  type ActiveBeat,
  activeBeats,
  beatProgress,
} from "../lib/choreography";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  type MeshDesc,
  type ModelDesc,
  type PrimitiveDesc,
  interpretBuildSpec,
} from "../lib/buildspec";
import { type Ghost, footprintOf } from "../lib/placement";

// Functional telemetry colors (DESIGN.md: live-data signals only — the brand
// palette itself is black + white). Matched to the 2D canvas so the two
// renderers read identically.
const SIGNAL_OK = "#2ecc71"; // working / done
const SIGNAL_WARN = "#f5a623"; // bidding / leased
const SIGNAL_DOWN = "#e74c3c"; // dead / kill target
const SIGNAL_IDLE = "#9aa4b2"; // idle / unclaimed
const SIGNAL_REVIVE = "#38e1ff"; // recovered — the in-place comeback pulse

// A dedicated render layer for the halo meshes. SelectiveBloom is told to bloom
// ONLY objects on this layer, so the glow is confined to status halos and never
// leaks onto the terrain, rovers, or dome (ADR-0004's "bloom only on halos").
const HALO_BLOOM_LAYER = 11;

// ---- shared geometry buffers ------------------------------------------------

// Every rover/task draws from the SAME geometry instances, created once per
// Canvas mount and disposed on unmount (r3f-geometry "Reuse geometries"). This
// is the difference between holding ~10 GPU buffers and ~10×N. Built in a
// useMemo so a 3D→2D→3D toggle gets a fresh, valid set each remount.
type SceneGeo = {
  hit: THREE.SphereGeometry;
  body: THREE.BoxGeometry;
  mast: THREE.BoxGeometry;
  wheel: THREE.CylinderGeometry;
  halo: THREE.RingGeometry;
  won: THREE.RingGeometry;
  sel: THREE.RingGeometry;
  battery: THREE.BoxGeometry; // unit box, scaled in x by charge
  foundation: THREE.BoxGeometry;
  wall: THREE.BoxGeometry;
  dome: THREE.SphereGeometry;
  // Unit primitives for the Build-spec interpreter (ADR-0006): each interpreted
  // op reuses one of these and is scaled per-op, so a spec of N ops still costs
  // only these 3 shared GPU buffers (r3f-geometry "Reuse geometries").
  specBox: THREE.BoxGeometry;
  specCylinder: THREE.CylinderGeometry;
  specSphere: THREE.SphereGeometry;
};

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
    foundation: new THREE.BoxGeometry(1.1, 0.3, 1.1),
    wall: new THREE.BoxGeometry(0.9, 1.1, 0.9),
    dome: new THREE.SphereGeometry(1.0, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    // Unit primitives (edge/diameter 1) so a Build op's scale maps directly.
    specBox: new THREE.BoxGeometry(1, 1, 1),
    specCylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 20),
    specSphere: new THREE.SphereGeometry(0.5, 20, 16),
  };
}

function disposeSceneGeo(g: SceneGeo) {
  for (const key of Object.keys(g) as (keyof SceneGeo)[]) g[key].dispose();
}

// Rover status → halo color. Idle (alive, no task), bidding (a transient beat,
// handled separately), working (alive, holding a task), dead. Pure read of the
// snapshot rover.
function roverHaloColor(r: RoverView): string {
  if (!r.alive) return SIGNAL_DOWN;
  if (r.task) return SIGNAL_OK; // working — holds a task
  return SIGNAL_IDLE; // idle — alive, unassigned
}

// ---- a single rover --------------------------------------------------------

type Rover3DProps = {
  rover: RoverView;
  map: SceneMap;
  geo: SceneGeo;
  selected: boolean;
  beats: React.RefObject<ActiveBeat[]>; // live beat list, read in useFrame
  onPick: (id: string) => void;
};

// A rover built from PRIMITIVE geometry (ADR-0004 fallback): a low-poly box body
// on four short cylinder wheels, monochrome white per the brand's no-accent
// rule, dimmed when dead. A generous INVISIBLE hit-proxy sphere wraps it so the
// click raycast reliably selects the rover the user sees — the proxy uses the
// SAME world→scene map as the rendered body, so the hit can never drift (the 3D
// analogue of the 2D canvas's shared-projection guarantee).
//
// The bid-flash and winner-glow are animated by mutating refs in useFrame
// (below), NOT by re-rendering — this component only re-renders when its
// snapshot-derived props change (~12 Hz), never per animation frame.
function Rover3D({ rover, map, geo, selected, beats, onPick }: Rover3DProps) {
  const p = map.at(rover.pos);
  const dim = !rover.alive;
  const bodyColor = dim ? "#2a2a2e" : "#f0f0fa";
  const haloColor = roverHaloColor(rover);

  const haloRef = useRef<THREE.Mesh>(null);
  const haloMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const wonRef = useRef<THREE.Mesh>(null);
  const wonMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const revivedRef = useRef<THREE.Mesh>(null);
  const revivedMatRef = useRef<THREE.MeshStandardMaterial>(null);

  // Put the status halo + winner ring + recovery pulse on the bloom layer so ONLY
  // they glow. Once on mount — the meshes are stable across re-renders.
  useEffect(() => {
    haloRef.current?.layers.enable(HALO_BLOOM_LAYER);
    wonRef.current?.layers.enable(HALO_BLOOM_LAYER);
    revivedRef.current?.layers.enable(HALO_BLOOM_LAYER);
  }, []);

  // Animate the bid-flash (halo pulse + amber) and the winner glow by mutating
  // the meshes directly. Reads the live beat list every frame — but the loop is
  // demand-driven, so this only runs while a render is invalidated (i.e. while
  // beats are active or the user is interacting).
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

    const halo = haloRef.current;
    const haloMat = haloMatRef.current;
    if (halo && haloMat) {
      halo.scale.setScalar(1 + (bid > 0 ? Math.sin(bid * Math.PI) * 0.35 : 0));
      const c = bid > 0 ? SIGNAL_WARN : haloColor;
      haloMat.color.set(c);
      haloMat.emissive.set(c);
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

    // Recovery pulse — a wide cyan shockwave on a "revived" beat, marking the
    // in-place comeback before the rover holds station then drives off. Bigger
    // and brighter than the winner ring so the recovery reads as its own beat.
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

  // The selection halo is the clear KILL-target affordance, mirroring the 2D
  // canvas: danger-red around a live rover, muted around a dead one.
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
    <group position={[p.x, p.y, p.z]}>
      {/* Invisible, generous hit-proxy. Larger than the visible body so clicks
          reliably land; shares this group's transform (= map.at), so the raycast
          hit and the rendered rover are positioned by the exact same math. */}
      <mesh
        geometry={geo.hit}
        position={[0, 0.45, 0]}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation(); // empty-space deselect is handled by the ground
          onPick(rover.id);
        }}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "default")}
      >
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Body — low-poly box (PRIMITIVE fallback per ADR-0004). */}
      <mesh geometry={geo.body} position={[0, 0.42, 0]} raycast={() => null}>
        <meshStandardMaterial
          color={bodyColor}
          metalness={0.2}
          roughness={0.7}
          emissive={dim ? "#000000" : "#101014"}
        />
      </mesh>
      {/* Sensor mast block, so the rover reads as front-facing. */}
      <mesh geometry={geo.mast} position={[0, 0.66, -0.18]} raycast={() => null}>
        <meshStandardMaterial color={bodyColor} metalness={0.2} roughness={0.7} />
      </mesh>
      {/* Four cylinder wheels (PRIMITIVE). */}
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
        >
          <meshStandardMaterial color={dim ? "#141416" : "#3a3a3f"} roughness={0.9} />
        </mesh>
      ))}

      {/* Status halo — a thin ring on the ground under the rover. This is the
          ONLY rover element on the bloom layer, so the glow is confined to it.
          Uses an emissive, non-tone-mapped material so it reads as "lit". Color
          + scale are mutated in useFrame (the bid-flash) without re-rendering. */}
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

      {/* Winner glow — an expanding ring on a "won" beat (the auction winner).
          Always mounted but hidden; visibility/scale/opacity are driven in
          useFrame so it costs nothing to keep around between beats. */}
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

      {/* Recovery pulse — an expanding cyan ring on a "revived" beat (the rover's
          in-place comeback). Reuses the winner ring geometry; hidden until the
          beat drives it in useFrame. */}
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

      {/* Selection halo — the KILL-target affordance (NOT on the bloom layer, so
          it stays a crisp outline rather than a glow). */}
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

      {/* Battery tick: a short bar whose color encodes charge (functional). A
          shared unit box scaled in x, so charge changes never reallocate. */}
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

// ---- a lease beam (rover → held task) --------------------------------------

// A dashed green beam from a rover to the task it holds, mirroring the 2D
// canvas. Derived purely from the snapshot (rover.task → task.pos). The beam is
// "severed" on a kill beat by simply not rendering once the rover is dead/has no
// task — the snapshot drives it, so an orphaned task's beam vanishes on its own.
// Uses drei's <Line> (the bare three.js <line> JSX collides with SVG typings).
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

// ---- Build-spec mesh: primitive (optionally textured) or glTF model ---------
//
// bh-07b: the Build spec's forward-compatible slots become REAL. A primitive op
// may carry a CC0 texture (material.map); a "model" op references a CC0 glTF
// (model_ref). Both load asynchronously and FALL BACK to plain geometry on any
// miss, so the scene is never broken by a gone/slow asset (ADR-0004 — the scene
// stays a pure function of the snapshot, the renderer only INTERPRETS data).

// One shared GLTFLoader + a tiny module-level cache, so N tasks referencing the
// same .glb parse it ONCE (r3f-geometry "reuse"), and the parsed scene is cloned
// per placement so transforms/materials never cross-contaminate.
const gltfLoader = new GLTFLoader();
const gltfCache = new Map<string, Promise<THREE.Group>>();

function loadGLTF(url: string): Promise<THREE.Group> {
  let p = gltfCache.get(url);
  if (!p) {
    p = new Promise<THREE.Group>((resolve, reject) => {
      gltfLoader.load(
        url,
        (g) => {
          // Suppress raycast on every child of the CACHED SOURCE once. This keeps
          // the source itself non-pickable and documents the asset-wide intent.
          // NOTE: Object3D.clone(true) does NOT copy this own-property override
          // onto clones (raycast is normally a prototype method), so each
          // placement must ALSO re-suppress its clone — see suppressRaycast() use
          // in SpecModel. Doing both keeps glTF child meshes unpickable so only a
          // rover's invisible hit-proxy sphere stays pickable, keeping
          // click-to-kill deterministic and letting onPointerMissed deselect on
          // empty space.
          suppressRaycast(g.scene);
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

// SpecPrimitive draws one primitive op. If the op declares a texture map
// (bh-07b), it loads it via TextureLoader and applies it once ready; a load
// failure simply leaves the flat color (the scene never breaks). The texture
// loads on mount and is disposed on unmount.
function SpecPrimitive({
  desc,
  geo,
  color,
  opacity,
}: {
  desc: PrimitiveDesc;
  geo: SceneGeo;
  color: string;
  opacity: number;
}) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    if (!desc.map) return;
    let disposed = false;
    let tex: THREE.Texture | null = null;
    const loader = new THREE.TextureLoader();
    loader.load(
      desc.map,
      (t) => {
        if (disposed) {
          t.dispose();
          return;
        }
        t.colorSpace = THREE.SRGBColorSpace;
        tex = t;
        if (matRef.current) {
          matRef.current.map = t;
          matRef.current.needsUpdate = true;
          invalidate(); // wake the demand loop so the texture shows
        }
      },
      undefined,
      () => {
        // Missing/failed texture ⇒ keep the flat color (fallback, never crash).
      },
    );
    return () => {
      disposed = true;
      tex?.dispose();
    };
  }, [desc.map, invalidate]);

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

// SpecModel places a CC0 glTF model (model_ref, bh-07b). It loads the .glb on
// mount; until it resolves — and FOREVER if it fails — it renders the descriptor's
// box fallback, so the structure is always present and the scene stays a pure
// function of the snapshot. The loaded scene is cloned so each placement is
// independent; the clone is disposed on unmount.
function SpecModel({
  desc,
  geo,
  color,
  opacity,
}: {
  desc: ModelDesc;
  geo: SceneGeo;
  color: string;
  opacity: number;
}) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    let disposed = false;
    loadGLTF(desc.modelRef)
      .then((g) => {
        if (disposed) return;
        // clone(true) SHARES the source geometry + materials with the cached glTF
        // (Object3D.clone does not deep-copy them), so the clone owns nothing
        // disposable — disposing its geometry/material would free the cached
        // original and break every later placement of the same asset. The cached
        // glTF lives for the session and is reclaimed on page unload; we only
        // clone so each placement gets its own transform node.
        // Re-suppress raycast on this clone: clone(true) does not carry over the
        // own-property override applied to the cached source, so every placement
        // must re-apply it to stay non-pickable (see suppressRaycast / loadGLTF).
        setScene(suppressRaycast(g.clone(true)));
        invalidate();
      })
      .catch(() => {
        // Missing/failed glTF ⇒ keep the box fallback below (never crash).
      });
    return () => {
      disposed = true;
    };
  }, [desc.modelRef, invalidate]);

  if (!scene) {
    // Fallback primitive (a box at the op's transform) until/if the glTF loads.
    return <SpecPrimitive desc={desc.fallback} geo={geo} color={color} opacity={opacity} />;
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

// SpecMesh dispatches one descriptor to the primitive or model renderer. Built
// tasks show the op's own color; an unfinished interpreted task ghosts in the
// shared status color (so it reads like the primitive ghost).
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
    return <SpecModel desc={desc} geo={geo} color={color} opacity={opacity} />;
  }
  return <SpecPrimitive desc={desc} geo={geo} color={color} opacity={opacity} />;
}

// ---- a task / dome block ----------------------------------------------------

// Each task is a block in the rising habitat: foundations form the base, walls
// the mid ring, the dome task the cap. A DONE task is "built" (solid, lit by a
// brief solidify pop); a not-yet-done task is a faint ghost of the structure to
// come. Position + height come from lib/scene.ts — a pure read of the snapshot.
// The solidify pop (scale + green flash) is animated in useFrame by mutating
// refs, so a completing block never forces a scene re-render.
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
  const tier = tierOf(task.type);
  const h = tierHeight(tier);
  const p = map.at(task.pos, 0);
  const built = isBuilt(task);

  const color = built ? "#cfcfd6" : task.status === "LEASED" ? SIGNAL_WARN : SIGNAL_IDLE;
  const opacity = built ? 1 : task.status === "LEASED" ? 0.5 : 0.28;

  // The dome cap reads as a hemisphere; foundations/walls as low blocks.
  const isCap = tier === "dome";
  const blockGeo = isCap ? geo.dome : tier === "foundation" ? geo.foundation : geo.wall;

  // Interpret the Task's Build spec (ADR-0006), if any, into renderable meshes.
  // EMPTY ⇒ the Task has no (renderable) spec, so we render EXACTLY today's
  // primitive — the fallback this slice must keep pixel-identical. Memoized on
  // the spec identity so the pure pass stays allocation-light (~12 Hz snapshots).
  const specMeshes = useMemo<MeshDesc[]>(
    () => interpretBuildSpec(task),
    [task],
  );
  const interpreted = specMeshes.length > 0;

  // Solidify-pop refs. The PRIMITIVE path animates its single mesh + material
  // EXACTLY as before (meshRef/matRef). The INTERPRETED path has no single
  // material to flash, so it pops the whole structure group (groupRef) by scale
  // alone, keeping each op's procedural material intact. Only one path's refs are
  // populated per render, so the unused branch is a harmless no-op.
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
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

    // Interpreted structure: pop the group (scale only — procedural mats stay).
    if (groupRef.current) groupRef.current.scale.setScalar(popScale);

    // Primitive: pop the single mesh + green-flash its material (unchanged).
    const mesh = meshRef.current;
    const mat = matRef.current;
    if (mesh && mat) {
      mesh.scale.setScalar(popScale);
      if (solidify > 0) {
        mat.emissive.set(SIGNAL_OK);
        mat.emissiveIntensity = 1.5 * (1 - solidify);
      } else if (mat.emissiveIntensity !== 0) {
        mat.emissiveIntensity = 0;
      }
    }
  });

  // INTERPRETED PATH — the richer structure. Each op is drawn by <SpecMesh>,
  // which renders a primitive (optionally textured, bh-07b) or a glTF model
  // (model_ref, bh-07b) with a primitive fallback. The group sits at the same
  // ground point as the primitive; built/ghost opacity is shared so an unfinished
  // interpreted Task still reads as a ghost, like the primitive.
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

  // PRIMITIVE FALLBACK — EXACTLY today's tierOf block (unchanged).
  return (
    <group position={[p.x, 0, p.z]}>
      <mesh ref={meshRef} geometry={blockGeo} position={[0, h, 0]} raycast={() => null}>
        <meshStandardMaterial
          ref={matRef}
          color={color}
          roughness={isCap ? 0.85 : 0.9}
          metalness={0.05}
          transparent
          opacity={opacity}
          emissive="#000000"
          emissiveIntensity={0}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

// ---- lunar terrain ----------------------------------------------------------

// Low-poly lunar ground: a single displaced plane primitive (ADR-0004 allows a
// "simple ground plane / displaced primitive"). Static — built once, not driven
// by the snapshot. Subtle deterministic vertex displacement gives a regolith
// feel without any hand-modelled art.
function LunarTerrain() {
  const geom = useMemo(() => {
    const g = new THREE.PlaneGeometry(GROUND_SPAN * 1.6, GROUND_SPAN * 1.6, 48, 48);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      // Deterministic pseudo-noise (sines) — gentle dunes, no physics, no asset.
      const z = Math.sin(x * 0.6) * Math.cos(y * 0.55) * 0.18 + Math.sin(x * 1.7 + y) * 0.05;
      pos.setZ(i, z);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
      <primitive object={geom} attach="geometry" />
      <meshStandardMaterial color="#3a3a40" roughness={1} metalness={0} flatShading />
    </mesh>
  );
}

// ---- bloom (selective, halos only) -----------------------------------------

// SelectiveBloom blooms ONLY meshes on HALO_BLOOM_LAYER (the status/winner
// halos), never the full scene — ADR-0004's hard guard. Kept cheap: a small
// blur kernel and no composer MSAA, so it adds minimal GPU cost and plays nicely
// with frameloop="demand" (it renders only on invalidated frames).
//
// MEMOIZED on its single (stable) lightRef prop. Without this, the parent
// SceneContents re-renders on every snapshot (~12 Hz), which re-renders
// <SelectiveBloom>, whose internal effect-useMemo depends on a fresh `...props`
// object each render — so a brand-new SelectiveBloomEffect (and its Selection)
// was being constructed ~12×/sec. Each Selection pulls from postprocessing's
// MODULE-GLOBAL layer-id counter; once it climbed past 31 the lib spammed
// "Layer out of range, resetting to 2" forever. memo() keeps the whole
// postprocessing subtree stable across snapshots, so the effect is built once.
const HaloBloom = memo(function HaloBloom({
  lightRef,
}: {
  lightRef: React.RefObject<THREE.DirectionalLight>;
}) {
  // The directional light mounts in the same pass as this component, so its ref
  // is null on first render. Force exactly one re-render after mount so the ref
  // has resolved; SelectiveBloom requires a non-null light, so we render nothing
  // until then.
  const [, ready] = useState(0);
  useEffect(() => ready(1), []);
  const light = lightRef.current;
  if (!light) return null;
  return (
    // multisampling={0}: SelectiveBloom does its own threshold/blur, so composer
    // MSAA buys nothing here. A SMALL kernel keeps the blur passes (and their
    // render targets) light — the halos are tiny, so a wide kernel would be
    // wasted GPU memory. (The depth/stencil glBlitFramebuffer error ANGLE/macOS
    // drivers throw comes from the CANVAS's antialias:true backbuffer, not this
    // composer — see the Canvas gl props below, where antialias is off.)
    <EffectComposer multisampling={0}>
      <SelectiveBloom
        lights={[light]}
        selectionLayer={HALO_BLOOM_LAYER}
        intensity={2.2}
        luminanceThreshold={0.1}
        luminanceSmoothing={0.2}
        mipmapBlur
        kernelSize={KernelSize.SMALL}
        radius={0.6}
      />
    </EffectComposer>
  );
});

type Scene3DProps = {
  snapshot: Snapshot | null;
  selected: string | null;
  onPick: (id: string | null) => void;
  // Drag-to-place (bh-05). `placing` arms the ground placement plane; `ghost` is
  // the transient preview (null until the cursor hits the ground); `onPlaceMove`
  // reports the world origin under the cursor; `onPlaceConfirm` drops it. All are
  // optional so the 2D fallback / tests can omit them.
  placing?: boolean;
  ghost?: Ghost | null;
  onPlaceMove?: (origin: Vec2) => void;
  onPlaceConfirm?: () => void;
};

// GHOST_OK / GHOST_BAD tint the placement preview green when the spot is valid,
// red when the client-side gate (bounds/no-overlap) rejects it — the UI feedback
// for "invalid placement is rejected" before the control is even emitted.
const GHOST_OK = "#38e1ff";
const GHOST_BAD = "#e74c3c";

// ---- drag-to-place ghost + placement plane (bh-05) -------------------------

// BlueprintGhost draws the transient placement preview: each ghost Task's Build
// envelope as a flat footprint quad on the ground, plus a thin upright box hinting
// the envelope height. Tinted green when valid, red when the client gate rejects
// the spot. It is CLIENT-ONLY transient state (never from the snapshot), so the
// scene stays a pure function of the snapshot for everything authoritative — the
// placed tasks themselves arrive via the next snapshot (ADR-0004).
function BlueprintGhost({ ghost, map }: { ghost: Ghost; map: SceneMap }) {
  const color = ghost.invalid ? GHOST_BAD : GHOST_OK;
  return (
    <group>
      {ghost.tasks.map((t) => {
        const f = footprintOf(t);
        const center = map.at({ X: f.cx, Y: f.cy }, 0.06);
        const w = f.halfX * 2 * map.scale;
        const d = f.halfY * 2 * map.scale;
        const h = Math.max(0.05, (t.envelope.size.Z * map.scale) / 2);
        return (
          <group key={t.id} position={[center.x, 0, center.z]}>
            {/* Footprint quad flat on the ground. */}
            <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
              <planeGeometry args={[w, d]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={0.35}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
            {/* A faint envelope box, so the ghost reads as a volume not just a pad. */}
            <mesh position={[0, h, 0]} raycast={() => null}>
              <boxGeometry args={[w, h * 2, d]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={0.12}
                depthWrite={false}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// PlacementPlane is a large invisible ground plane, mounted ONLY while placing,
// that captures the cursor: pointer-move raycasts a world origin (via the shared
// sceneMap inverse, so the ghost can't drift from the rendered world) and reports
// it; a click drops the Blueprint. It sits just above the terrain so it wins the
// raycast over scene geometry during placement.
function PlacementPlane({
  map,
  onMove,
  onConfirm,
}: {
  map: SceneMap;
  onMove: (origin: Vec2) => void;
  onConfirm: () => void;
}) {
  return (
    <mesh
      position={[0, 0.02, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        // e.point is the world-space (scene) hit; map its ground x/z back to the
        // worksite origin via the inverse of the shared world→scene projection.
        onMove(map.invert(e.point.x, e.point.z));
      }}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        onConfirm();
      }}
    >
      <planeGeometry args={[GROUND_SPAN * 4, GROUND_SPAN * 4]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

// The actual scene contents (inside <Canvas>). The snapshot → meshes mapping is
// a single pure pass that re-renders ONLY when a new snapshot arrives. Beats
// animate via per-mesh useFrame ref-mutation (in Rover3D/TaskBlock), so the
// React tree never re-renders per frame. This component's own useFrame just
// prunes expired beats and keeps the demand loop alive while any beat is live.
function SceneContents({
  snapshot,
  selected,
  onPick,
  placing,
  ghost,
  onPlaceMove,
  onPlaceConfirm,
}: Scene3DProps) {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const invalidate = useThree((s) => s.invalidate);

  // Shared geometry buffers — one set per Canvas mount, disposed on unmount.
  const geo = useMemo(makeSceneGeo, []);
  useEffect(() => () => disposeSceneGeo(geo), [geo]);

  // Beat bookkeeping — DECORATION ONLY, derived from the server's own events
  // (mirrors WorldCanvas). Stamped with performance.now() so animation progress
  // is independent of snapshot cadence. Held in a ref and read by each mesh's
  // useFrame; mutating it never triggers a React re-render.
  const beats = useRef<ActiveBeat[]>([]);
  const lastAt = useRef<number>(Number.NEGATIVE_INFINITY);

  // Drag-to-place is transient client state, not a snapshot, so it does NOT ride
  // the snapshot-driven invalidate above. Wake the demand loop whenever the ghost
  // (cursor origin / rotation / validity) or the placing arm changes, so the ghost
  // redraws as the user moves the cursor. Cheap: it draws one frame per change.
  useEffect(() => {
    invalidate();
  }, [ghost, placing, invalidate]);

  // On each new snapshot, fold its events into the live beat list and wake the
  // demand loop so the new pulses (and the new mesh positions) get drawn.
  useEffect(() => {
    if (snapshot && snapshot.at !== lastAt.current) {
      lastAt.current = snapshot.at;
      const incoming = snapshot.events ?? [];
      if (incoming.length > 0) {
        const now = performance.now();
        beats.current = [...beats.current, ...incoming.map((e) => ({ ...e, spawn: now }))];
        invalidate(); // kick the demand loop awake to animate the new beats
      }
    }
  }, [snapshot, invalidate]);

  // Prune expired beats once per rendered frame, and keep the demand loop alive
  // while any beat is still animating (plus one trailing frame, so the per-mesh
  // useFrames reset their meshes to base once the last beat clears). When no
  // beats are live we stop invalidating, so the loop idles — zero GPU burn.
  useFrame(() => {
    const before = beats.current.length;
    if (before > 0) beats.current = activeBeats(beats.current, performance.now());
    if (beats.current.length > 0 || before > 0) invalidate();
  });

  // The world→scene map (and the task lookup) only change when a new snapshot
  // arrives, so memoize them on snapshot identity rather than rebuilding every
  // render — cheap, but it keeps the snapshot pass allocation-light.
  const map = useMemo(
    () =>
      snapshot
        ? sceneMap(
            snapshot.rovers.map((r) => r.pos),
            snapshot.tasks.map((t) => t.pos),
          )
        : null,
    [snapshot],
  );
  const taskById = useMemo(
    () => (snapshot ? new Map(snapshot.tasks.map((t) => [t.id, t])) : null),
    [snapshot],
  );

  if (!snapshot || !map || !taskById) {
    return (
      <>
        <ambientLight intensity={0.4} />
        <LunarTerrain />
      </>
    );
  }

  return (
    <group>
      {/* Lighting — a fixed key light (drives the selective-bloom pass) + soft
          fill, so the diorama reads without per-frame tweaking (ADR-0004). */}
      <ambientLight intensity={0.35} />
      <hemisphereLight args={["#9a9aae", "#1a1a22", 0.5]} />
      <directionalLight ref={lightRef} position={[6, 10, 6]} intensity={1.4} />

      <LunarTerrain />

      {/* Tasks / rising dome. */}
      {snapshot.tasks.map((t) => (
        <TaskBlock key={t.id} task={t} map={map} geo={geo} beats={beats} />
      ))}

      {/* Lease beams (rover → held task), under the rovers. */}
      {snapshot.rovers.map((r) => {
        if (!r.alive || !r.task) return null;
        const held = taskById.get(r.task);
        if (!held) return null;
        return <LeaseBeam key={`beam-${r.id}`} from={r} to={held} map={map} />;
      })}

      {/* Rovers. */}
      {snapshot.rovers.map((r) => (
        <Rover3D
          key={r.id}
          rover={r}
          map={map}
          geo={geo}
          selected={selected === r.id}
          beats={beats}
          onPick={onPick}
        />
      ))}

      {/* Drag-to-place ghost + cursor plane (bh-05). The plane is mounted only
          while placing; the ghost only once the cursor has hit the ground. */}
      {ghost ? <BlueprintGhost ghost={ghost} map={map} /> : null}
      {placing && onPlaceMove && onPlaceConfirm ? (
        <PlacementPlane map={map} onMove={onPlaceMove} onConfirm={onPlaceConfirm} />
      ) : null}

      {/* Selective bloom — halos ONLY (ADR-0004). Rendered last; reads lightRef. */}
      <HaloBloom lightRef={lightRef} />
    </group>
  );
}

// The exported renderer. Mirrors WorldCanvas's contract exactly so App can swap
// them. A FIXED default orbit-camera angle frames the worksite; OrbitControls is
// allowed but clamped (no roll past the horizon, bounded zoom) so it can't be
// knocked into a useless pose on a projector. A click on empty space (the
// ground / background) deselects via onPointerMissed.
//
// frameloop="demand": the render loop is idle until something invalidates it —
// a new snapshot, an animating beat, or orbit interaction (OrbitControls is
// makeDefault, so drei invalidates on change + damping). dpr is capped at 1.5
// so a retina projector doesn't pay for 4× the pixels.
export function Scene3D({
  snapshot,
  selected,
  onPick,
  placing,
  ghost,
  onPlaceMove,
  onPlaceConfirm,
}: Scene3DProps) {
  return (
    <Canvas
      className="world-canvas"
      frameloop="demand"
      dpr={[1, 1.5]}
      camera={{ position: [0, 14, 18], fov: 42, near: 0.1, far: 200 }}
      // While placing, a click on empty space confirms the drop; otherwise it
      // deselects a rover (the existing behaviour).
      onPointerMissed={() => (placing ? onPlaceConfirm?.() : onPick(null))}
      // antialias:false — the EffectComposer owns the framebuffers, so a
      // multisampled default backbuffer is redundant AND, on ANGLE/macOS, forces
      // a depth/stencil blitFramebuffer resolve that errors with "Read and write
      // depth stencil attachments cannot be the same image". Turning it off
      // removes the MSAA backbuffer (and that blit) entirely; the low-poly scene
      // plus soft halo bloom reads fine without canvas-level AA.
      gl={{ antialias: false, powerPreference: "high-performance" }}
    >
      <color attach="background" args={["#000000"]} />
      <SceneContents
        snapshot={snapshot}
        selected={selected}
        onPick={onPick}
        placing={placing}
        ghost={ghost}
        onPlaceMove={onPlaceMove}
        onPlaceConfirm={onPlaceConfirm}
      />
      <OrbitControls
        makeDefault
        enablePan={false}
        // Disable orbit drag while placing so a placement-drag doesn't spin the
        // camera; the placement plane owns the cursor then.
        enableRotate={!placing}
        minDistance={10}
        maxDistance={34}
        // Clamp the vertical angle so the camera can't dip under the ground or
        // look straight down — keeps the diorama readable from any orbit.
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 2.4}
        target={[0, 0.6, 0]}
        enableDamping
        dampingFactor={0.08}
      />
    </Canvas>
  );
}
