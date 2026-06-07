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
//   - LICENSED art only (CC0 / CC-BY 4.0 with attribution / NASA-PD), NEVER
//     unlicensed art. glTF models and PBR/HDR textures ARE admissible, but each
//     MUST carry a primitive fallback (the SpecModel box / SpecPrimitive flat
//     color) so a missing/slow/failed asset never breaks the render. The rover
//     ships as PRIMITIVE geometry (low-poly box body + cylinder wheels) — the
//     documented fallback — and licensed glTFs swap in through the buildspec seam.
//   - ONE fixed default orbit-camera angle (OrbitControls allowed, clamped).
//   - BLOOM ONLY on the status halos, via a selective-bloom layer limited to the
//     halo meshes (never full-scene bloom). See HALO_BLOOM_LAYER below.
//   - No custom physics; only LICENSED art (CC0/CC-BY/NASA-PD), each with a
//     mandatory primitive fallback.

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import { SpaceEnvironment } from "./SpaceEnvironment";
import { SkyBodies } from "./SkyBodies";
import { EffectComposer, SelectiveBloom } from "@react-three/postprocessing";
import { KernelSize } from "postprocessing";
import * as THREE from "three";
import type { RoverView, Snapshot, TaskView, Vec2 } from "../types/wire";
import { batteryPercent } from "../lib/format";
import { suppressRaycast } from "../lib/suppressRaycast";
import {
  EARTH_POSITION,
  GROUND_SPAN,
  MOON_POSITION,
  SUN_POSITION,
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
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import {
  type MeshDesc,
  type ModelDesc,
  type PrimitiveDesc,
  interpretBuildSpec,
} from "../lib/buildspec";
import { type Ghost, footprintOf } from "../lib/placement";
import { LaunchScenery } from "./LaunchScenery";
import { DecorRocks } from "./DecorRocks";

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

// withUV2 copies a geometry's primary uv set into uv2 so a material's aoMap (and
// any second-channel map) is visible — three reads aoMap from uv2, which the
// built-in primitive geometries do not provide by default (three 0.169). Returns
// the same geometry for chaining. No-op if it has no uv attribute.
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
    foundation: new THREE.BoxGeometry(1.1, 0.3, 1.1),
    wall: new THREE.BoxGeometry(0.9, 1.1, 0.9),
    dome: new THREE.SphereGeometry(1.0, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    // Unit primitives (edge/diameter 1) so a Build op's scale maps directly.
    // withUV2 gives each a uv2 channel so a Material.aoMap renders (three reads
    // aoMap from uv2). uv2 == uv, so it is harmless when no aoMap is present.
    specBox: withUV2(new THREE.BoxGeometry(1, 1, 1)),
    specCylinder: withUV2(new THREE.CylinderGeometry(0.5, 0.5, 1, 20)),
    specSphere: withUV2(new THREE.SphereGeometry(0.5, 20, 16)),
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

// ---- the realistic rover model (#54) ---------------------------------------
//
// The worker-entity render: every Rover swaps its PRIMITIVE body (box + mast +
// wheels) for ONE configured, self-hosted NASA-PD glTF (RASSOR). This is NOT a
// Build-spec catalog Asset — it never goes through the Asset catalog; the model
// is fixed for all rovers. It loads via the module-level loadGLTF helper (DRACO +
// meshopt wired, raycast suppressed on the cached source) and FALLS BACK to the
// primitives forever if the asset is missing/slow/fails, so the scene is never
// blank (ADR-0004). The loaded tree is raycast-suppressed so the rover's
// invisible hit-proxy sphere stays the SOLE pickable surface (click-to-kill
// determinism, #48).

// The one configured rover model. Self-hosted, conditioned + Draco-compressed by
// scripts/condition-asset.mjs (recentered, fit-to-unit). A missing file just
// keeps the primitive fallback below.
const ROVER_MODEL_REF = "/assets/models/rassor_rover.glb";
// Target world size for the model's LARGEST bbox dimension. Matches the visible
// footprint of the primitive fallback (~1 unit), so the realistic body and the
// fallback read at the same scale under the same hit-proxy/halos.
const ROVER_MODEL_FIT = 1.15;

// fitAndSeatRover normalizes a loaded model in place (mirrors LaunchScenery's
// fitAndSeat): scale its largest dimension to `fit`, recenter on x/z, and seat
// its base on y=0 — so the wrapping rover group drops it cleanly onto the
// ground. NASA glbs have arbitrary native units + off-origin pivots, so a fixed
// scalar is meaningless; we fit at load instead of baking each asset.
function fitAndSeatRover(obj: THREE.Object3D, fit: number) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const s = fit / maxDim;
  obj.scale.setScalar(s);
  obj.position.set(-center.x * s, -box.min.y * s, -center.z * s);
}

// dimRoverModel darkens a cloned rover model's materials so a DEAD rover reads as
// dimmed, mirroring the primitive fallback (which drops the body to #2a2a2e). The
// clone shares the cached source's materials, so we MUST clone each material
// before mutating it — otherwise dimming one dead rover would dim every rover
// (and the cached source) that shares those materials. The cloned materials are
// owned by this placement and disposed on unmount (see RoverBody cleanup). When
// the rover is alive this is a no-op, so live rovers keep the shared materials.
const DIM_ROVER_MULTIPLIER = 0.18;
function dimRoverModel(obj: THREE.Object3D): THREE.Material[] {
  const owned: THREE.Material[] = [];
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const cloned = mats.map((m) => {
      const c = m.clone();
      // Darken whatever standard PBR channels the material exposes; guard each
      // field so this works across MeshStandard/Physical/Basic without assuming a
      // type. multiplyScalar dims the base + emissive so the dead rover goes dark.
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

// RoverBody renders the realistic rover glTF, falling back to the PRIMITIVE body
// (box + sensor mast + 4 wheels) until — and FOREVER if — the model fails to
// load. The primitives are exactly the prior fallback geometry, so a gone/slow
// asset never breaks the rover. The `dim` flag (dead rover) dims BOTH paths: the
// primitives via their material color, the loaded model via dimRoverModel (which
// clones + darkens the model's materials), so a dead rover always reads as dark.
function RoverBody({ geo, dim }: { geo: SceneGeo; dim: boolean }) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const invalidate = useThree((s) => s.invalidate);
  const bodyColor = dim ? "#2a2a2e" : "#f0f0fa";

  useEffect(() => {
    let disposed = false;
    // Materials we clone for the dead-rover dim tint are owned by this placement;
    // dispose them on unmount/reload (the shared cached materials are NOT ours).
    let ownedMats: THREE.Material[] = [];
    loadGLTF(ROVER_MODEL_REF)
      .then((g) => {
        if (disposed) return;
        // clone(true) SHARES the cached source's geometry + materials (Object3D
        // .clone does not deep-copy them), so the clone owns nothing disposable;
        // disposing them would free the cached original and break later rovers.
        // Re-suppress raycast: clone(true) does NOT carry over the own-property
        // raycast override on the cached source, so every placement must re-apply
        // it to keep the model unpickable (the hit-proxy is the SOLE pick target).
        const obj = suppressRaycast(g.clone(true));
        // Normalize the raw NASA model (arbitrary units / off-origin pivot) to a
        // predictable rover size, centered on x/z and seated on y=0.
        fitAndSeatRover(obj, ROVER_MODEL_FIT);
        // Dead rover ⇒ darken this placement's materials (clones, so the shared
        // cached materials and live rovers are untouched). Alive ⇒ no-op.
        if (dim) ownedMats = dimRoverModel(obj);
        setScene(obj);
        invalidate(); // wake the demand loop once so the model shows when loaded
      })
      .catch(() => {
        // Missing/failed glTF ⇒ keep the primitive fallback below (never crash).
      });
    return () => {
      disposed = true;
      // Free only the materials WE cloned for the dim tint; never the shared
      // cached geometry/materials the clone references.
      for (const m of ownedMats) m.dispose();
    };
  }, [invalidate, dim]);

  if (scene) {
    // The model is pre-normalized (centered x/z, base at y=0), so it just sits at
    // the group origin. It is raycast-suppressed, so it never steals a pick.
    return <primitive object={scene} />;
  }

  // PRIMITIVE fallback (ADR-0004): a low-poly box body on four short cylinder
  // wheels with a sensor mast, monochrome white, dimmed when dead. Every mesh is
  // raycast-suppressed so only the hit-proxy is pickable.
  return (
    <group>
      {/* Body — low-poly box. */}
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
      {/* Four cylinder wheels. */}
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
    </group>
  );
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

      {/* Body — the realistic rover glTF (#54), with the PRIMITIVE box + mast +
          wheels as the FOREVER fallback until/if the model loads. Both are
          raycast-suppressed so the hit-proxy above stays the SOLE pick target. */}
      <RoverBody geo={geo} dim={dim} />

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
// Self-hosted Draco + meshopt decoders so conditioned (compressed) .glb load
// OFFLINE — no gstatic CDN fetch (the projector may have no network). The
// decoder files live in web/public/draco/ and are served from the same origin;
// '/draco/' is where DRACOLoader looks for draco_wasm_wrapper.js +
// draco_decoder.wasm (the glTF decoder variant vendored from three's examples).
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath("/draco/");
gltfLoader.setDRACOLoader(dracoLoader);
gltfLoader.setMeshoptDecoder(MeshoptDecoder);
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

// SpecPrimitive draws one primitive op. If the op declares any PBR texture maps
// (issue #53: map / normalMap / roughnessMap / aoMap), it loads each via
// TextureLoader and applies it once ready; a load failure simply leaves the flat
// color for that channel (the scene never breaks). colorSpace is set per map:
// the diffuse map is sRGB; normal/roughness/ao are linear (NoColorSpace) — drei
// does NOT auto-set this on three 0.169, so getting it wrong skews lighting.
// aoMap relies on the spec geometries carrying a uv2 channel (see withUV2). All
// textures load on mount and are disposed on unmount.
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
    // The PBR channels to load, paired with the material slot and the correct
    // colorSpace: diffuse is sRGB, the data maps (normal/roughness/ao) are linear.
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
    const loaded: THREE.Texture[] = [];
    const loader = new THREE.TextureLoader();
    for (const slot of slots) {
      // A slot with no URL is explicitly cleared so a re-render that DROPS a map
      // (this mesh's index now folds a different op) doesn't keep a stale texture.
      if (!slot.url) {
        if (matRef.current && matRef.current[slot.key]) {
          matRef.current[slot.key] = null;
          matRef.current.needsUpdate = true;
        }
        continue;
      }
      loader.load(
        slot.url,
        (t) => {
          if (disposed) {
            t.dispose();
            return;
          }
          t.colorSpace = slot.colorSpace;
          loaded.push(t);
          if (matRef.current) {
            matRef.current[slot.key] = t;
            matRef.current.needsUpdate = true;
            invalidate(); // wake the demand loop so the texture shows
          }
        },
        undefined,
        () => {
          // Missing/failed texture ⇒ keep the flat color for this channel
          // (fallback, never crash).
        },
      );
    }
    const mat = matRef.current;
    return () => {
      disposed = true;
      // Detach our textures from the material BEFORE disposing them, so a
      // re-render never leaves a freed texture referenced on the slot.
      for (const t of loaded) {
        if (mat) {
          for (const slot of slots) {
            if (mat[slot.key] === t) mat[slot.key] = null;
          }
        }
        t.dispose();
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

// The CC0 regolith PBR set (Poly Haven "Moon 01", 512 jpg) tiled over the ground.
// Self-hosted under web/public so it works offline; see public/assets/CREDITS.md.
const REGOLITH_MAPS: {
  url: string;
  key: "map" | "normalMap" | "roughnessMap" | "aoMap";
  colorSpace: THREE.ColorSpace;
}[] = [
  { url: "/assets/textures/regolith_diff_512.jpg", key: "map", colorSpace: THREE.SRGBColorSpace },
  {
    url: "/assets/textures/regolith_nor_gl_512.jpg",
    key: "normalMap",
    colorSpace: THREE.NoColorSpace,
  },
  {
    url: "/assets/textures/regolith_rough_512.jpg",
    key: "roughnessMap",
    colorSpace: THREE.NoColorSpace,
  },
  { url: "/assets/textures/regolith_ao_512.jpg", key: "aoMap", colorSpace: THREE.NoColorSpace },
];

// The VISIBLE ground extends FAR past the worksite so its edge falls beyond the
// horizon and (with the surface fog) dissolves into the black sky — it reads as an
// endless regolith plain, not a platform. This is purely the terrain MESH size;
// the world→scene projection still uses GROUND_SPAN (=20) so rover/task placement
// is unchanged. Worksite detail lives in the central ~±16 units; the rest is plain.
const GROUND_VISUAL = 700;

// Tile count across the visible ground. Scaled WITH the ground size (~0.3 tiles
// per world unit) so the regolith grain stays the same size whether the plane is
// 32 or 700 units (Moon 01 is authored to tile). Tune the factor if grain reads
// too large/small.
const REGOLITH_REPEAT = Math.round(GROUND_VISUAL * 0.3);

// Low-poly lunar ground: a single displaced plane primitive (ADR-0004 allows a
// "simple ground plane / displaced primitive"). Static — built once, not driven
// by the snapshot. Subtle deterministic vertex displacement gives a regolith
// feel, and a tiling CC0 regolith PBR set (issue #53) clothes it. A missing/
// failed texture leaves the flat fallback color, so the scene never breaks.
function LunarTerrain() {
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);

  const geom = useMemo(() => {
    const g = new THREE.PlaneGeometry(GROUND_VISUAL, GROUND_VISUAL, 96, 96);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      // Deterministic pseudo-noise (sines): fine regolith ripple everywhere, plus a
      // long, low rolling swell that fades IN with distance from the worksite so the
      // far plain undulates toward the horizon while the center (where rovers/tasks
      // sit at y=0) stays flat. No physics, no asset.
      const fine = Math.sin(x * 0.6) * Math.cos(y * 0.55) * 0.18 + Math.sin(x * 1.7 + y) * 0.05;
      const swellAmp = THREE.MathUtils.smoothstep(Math.hypot(x, y), 30, 200) * 4.0;
      const swell = Math.sin(x * 0.018 + 1.3) * Math.cos(y * 0.021) * swellAmp;
      pos.setZ(i, fine + swell);
    }
    g.computeVertexNormals();
    // aoMap reads from uv2; PlaneGeometry's uv works directly as the second set.
    if (g.attributes.uv && !g.attributes.uv2) g.setAttribute("uv2", g.attributes.uv);
    return g;
  }, []);
  useEffect(() => () => geom.dispose(), [geom]);

  useEffect(() => {
    let disposed = false;
    const loaded: THREE.Texture[] = [];
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    const loader = new THREE.TextureLoader();
    for (const m of REGOLITH_MAPS) {
      loader.load(
        m.url,
        (t) => {
          if (disposed) {
            t.dispose();
            return;
          }
          // Each map is loaded fresh here (no shared cache), so we own it and may
          // mutate wrap/repeat directly before disposing it on unmount.
          t.colorSpace = m.colorSpace;
          t.wrapS = THREE.RepeatWrapping;
          t.wrapT = THREE.RepeatWrapping;
          t.repeat.set(REGOLITH_REPEAT, REGOLITH_REPEAT);
          t.anisotropy = maxAniso;
          loaded.push(t);
          if (matRef.current) {
            matRef.current[m.key] = t;
            matRef.current.needsUpdate = true;
            invalidate(); // wake the demand loop so the texture shows
          }
        },
        undefined,
        () => {
          // Missing/failed map ⇒ keep the flat fallback for this channel.
        },
      );
    }
    return () => {
      disposed = true;
      for (const t of loaded) t.dispose();
    };
  }, [gl, invalidate]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
      <primitive object={geom} attach="geometry" />
      {/* Flat #3a3a40 is the fallback until/if the regolith maps load. */}
      <meshStandardMaterial ref={matRef} color="#8a8a8e" roughness={1} metalness={0} />
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

// View-mode (issue #49). "surface" is the DEFAULT clamped worksite framing
// (ADR-0004 fixed default orbit angle); "orbit" is a DISTINCT clamped preset
// that pulls the camera back to take in a distant parked Moon. Each mode keeps
// its own clamps/target so neither can be knocked into a useless pose.
export type ViewMode = "surface" | "orbit";

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
  // View-mode framing (issue #49). Defaults to "surface" so the scene keeps its
  // rehearsed worksite pose when the prop is omitted (tests / 2D fallback).
  viewMode?: ViewMode;
  // Lets the in-scene lunar-base marker (orbit view) request a view change —
  // clicking the marker calls this with "surface", flipping the app to surface
  // view and triggering the descent. Optional (tests / 2D fallback omit it).
  onViewModeChange?: (mode: ViewMode) => void;
};

// Per-mode OrbitControls clamps + target. Both presets are clamped (ADR-0004):
// surface is the rehearsed worksite framing; orbit pulls back far enough to see
// a distant Moon WITHOUT just widening surface-mode's reach (kept distinct). The
// far plane (~8000) puts a parked Moon in-frustum; maxDistance here stays well
// under that so the orbit target is always renderable.
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
    minDistance: 10,
    maxDistance: 40,
    minPolarAngle: Math.PI / 6,
    // Allow a flatter, more horizon-facing look (up to ~80° from vertical) so the
    // plain + sky + distant Earth read; still clamped short of dipping under it.
    maxPolarAngle: Math.PI / 2.25,
    target: [0, 4, 0],
  },
  orbit: {
    // The space vista: the camera ORBITS THE MOON GLOBE itself (target = the
    // globe's berth, imported from SkyBodies so the two can never drift apart).
    // The worksite is hidden in this mode (it's "on" the Moon), so there is no
    // floating diorama in frame — just the Moon, distant Earth, and stars. The
    // distance band keeps a radius-90 globe filling a good part of the 42° fov.
    minDistance: 220,
    maxDistance: 640,
    minPolarAngle: Math.PI / 4,
    maxPolarAngle: Math.PI / 2.2,
    target: [MOON_POSITION[0], MOON_POSITION[1], MOON_POSITION[2]],
  },
};

// ---- view-transition poses + easing (glare-masked descent) ------------------
// Each mode has a canonical camera pose the transition flies BETWEEN. The toggle
// plays a two-beat, glare-masked move: fly toward the Moon (or lift off the
// surface) into a white sunlit flash that hides the scene swap, then settle into
// the destination pose. Tuned by eye; see CameraTransition.
type Pose = { position: THREE.Vector3; target: THREE.Vector3 };

// Surface: the rehearsed worksite framing (matches the Canvas `camera` default).
// A lower pitch that looks OUT toward the horizon so the regolith plain recedes
// into the fog and the sky (with a distant Earth) reads above it — "standing on
// the Moon," not staring straight down at a platform.
const SURFACE_POSE: Pose = {
  position: new THREE.Vector3(0, 11, 30),
  target: new THREE.Vector3(0, 4, 0),
};
// A high vantage straight over the worksite — the start/end of the descent half,
// so the surface "drops in" from above rather than cutting in flat.
const SURFACE_HIGH_POSE: Pose = {
  position: new THREE.Vector3(0, 120, 80),
  target: new THREE.Vector3(0, 0.6, 0),
};
// Orbit: the camera berthed off the Moon globe, framing it as the hero.
const ORBIT_POSE: Pose = {
  position: new THREE.Vector3(MOON_POSITION[0], MOON_POSITION[1] + 80, MOON_POSITION[2] + 410),
  target: new THREE.Vector3(...MOON_POSITION),
};
// The closest point of the fly-to-Moon beat: the globe looms large just as the
// glare peaks and the scene swaps. Target stays on the globe center.
const MOON_CLOSE_POSE: Pose = {
  position: new THREE.Vector3(MOON_POSITION[0], MOON_POSITION[1] + 20, MOON_POSITION[2] + 180),
  target: new THREE.Vector3(...MOON_POSITION),
};

const TRANSITION_MS = 1500;
// easeInOutCubic — smooth accelerate/decelerate for each half-beat.
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const lerpPose = (a: Pose, b: Pose, k: number, outPos: THREE.Vector3, outTgt: THREE.Vector3) => {
  outPos.lerpVectors(a.position, b.position, k);
  outTgt.lerpVectors(a.target, b.target, k);
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
  viewMode = "surface",
  onViewModeChange,
}: Scene3DProps) {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const invalidate = useThree((s) => s.invalidate);

  // Clicking the orbit-view lunar-base marker flips to surface view → the descent.
  const onBaseClick = onViewModeChange ? () => onViewModeChange("surface") : undefined;

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

  // `viewMode` here is the RENDERED mode (Scene3D's `shown`, which flips at the
  // glare peak). In orbit the worksite is hidden — you see only the Moon globe,
  // distant Earth, and stars — so it never floats as a square in space.
  const onSurface = viewMode === "surface";

  if (!snapshot || !map || !taskById) {
    return (
      <>
        <ambientLight intensity={0.4} />
        {/* Surface-only horizon fog: dissolves the far ground edge into the black
            sky for a clean horizon. Skipped in orbit (the Moon must stay crisp). */}
        {onSurface && <fog attach="fog" args={["#000000", 180, 680]} />}
        {onSurface && <LunarTerrain />}
        <SpaceEnvironment />
        <SkyBodies viewMode={viewMode} onBaseClick={onBaseClick} />
      </>
    );
  }

  return (
    <group>
      {/* SPACE LIGHTING — one harsh white sun + faint reflected fills, the way
          airless space really lights a scene (no atmosphere to scatter, so high
          contrast and near-black shadows). Three contributions:
          1. SUN — the key light, FROM the visible Sun body (shared SUN_POSITION),
             WHITE (0xffffff, sunlight in vacuum), strong. Also drives the bloom.
          2. EARTHSHINE — a dim COOL-BLUE light FROM the visible Earth
             (EARTH_POSITION): Earth reflects sunlight back, faintly lighting the
             Moon's night side (the classic "earthshine") and filling the
             worksite's shadow side. This is the "bodies reflect their sunlight"
             effect the scene is replicating.
          3. Regolith bounce — a low hemisphere (lit ground colour from below,
             black sky from above) standing in for sunlight bouncing off the bright
             lunar surface, plus a tiny ambient floor so nothing is pure black
             (ADR-0004 readability). */}
      <ambientLight intensity={0.12} />
      <hemisphereLight args={["#1a1a26", "#8a8276", 0.35]} />
      <directionalLight ref={lightRef} position={SUN_POSITION} intensity={2.1} />
      {/* Earthshine — cool, dim, from Earth's actual position. */}
      <directionalLight position={EARTH_POSITION} color="#7da2ff" intensity={0.55} />

      {/* Surface-only horizon fog: dissolves the far ground edge into the black
          sky for a clean horizon + sense of vastness. The worksite (within ~30
          units) is unaffected. Skipped in orbit so the Moon stays crisp. */}
      {onSurface && <fog attach="fog" args={["#000000", 180, 680]} />}

      {/* Static, snapshot-independent backdrop: hand-rolled starfield + self-
          hosted HDR skybox/IBL (issue #50). Shown in BOTH views. Encodes no world
          state; gives metallic glTFs real reflections. */}
      <SpaceEnvironment />

      {/* Decorative sky bodies (issue #51) — snapshot-INDEPENDENT Scenery: the
          Moon globe (orbit-only hero) + a distant Earth (both views) + the Sun
          (light emitter) + the clickable lunar-base marker (orbit-only). The
          Moon's appear/vanish is hidden behind the descent glare. */}
      <SkyBodies viewMode={viewMode} onBaseClick={onBaseClick} />

      {/* The WORKSITE — only in surface view. In orbit it would float as a square
          in space ("moonbase lost in space"), so it is mounted only on the
          surface (the rendered mode flips under the glare, so the swap is unseen). */}
      {onSurface && (
        <>
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

          {/* Launch infrastructure set-pieces (#56) — static NASA-PD Scenery at the
              worksite edge. Snapshot-INDEPENDENT decoration, raycast-suppressed. */}
          <LaunchScenery />

          {/* Instanced decorative rock field (#58a) — snapshot-INDEPENDENT scatter of
              low-poly rocks in ONE draw call via <Instances frames={1}>, non-pickable. */}
          <DecorRocks />
        </>
      )}

      {/* Drag-to-place ghost + cursor plane (bh-05). Worksite-bound, so surface
          only. The plane is mounted only while placing; the ghost only once the
          cursor has hit the ground. */}
      {onSurface && ghost ? <BlueprintGhost ghost={ghost} map={map} /> : null}
      {onSurface && placing && onPlaceMove && onPlaceConfirm ? (
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
// OrbitControls' minimal surface that the transition driver mutates.
type OrbitLike = THREE.EventDispatcher & {
  target: THREE.Vector3;
  update: () => void;
  enabled: boolean;
};

// RigBridge lives INSIDE the Canvas and exposes the live camera / OrbitControls /
// invalidate to the OUT-OF-Canvas transition driver in Scene3D via refs. (The
// driver runs a plain requestAnimationFrame loop — not a useFrame — so it must
// reach these through refs.) It captures them on every commit so a late-mounting
// OrbitControls (makeDefault) is picked up as soon as it exists. Renders nothing.
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

// The canonical settled pose for a mode (start/end of the descent transition).
const poseFor = (m: ViewMode): Pose => (m === "orbit" ? ORBIT_POSE : SURFACE_POSE);

export function Scene3D({
  snapshot,
  selected,
  onPick,
  placing,
  ghost,
  onPlaceMove,
  onPlaceConfirm,
  viewMode = "surface",
  onViewModeChange,
}: Scene3DProps) {
  // `viewMode` (prop) is the DESIRED mode; `shown` is the mode currently RENDERED.
  // They differ only during the descent transition: `shown` flips at the glare
  // peak, so the content/sky swap is hidden behind the flash. Clamps + the OrbitⅭ
  // ontrols target track `shown` so they always match the visible scene.
  const [shown, setShown] = useState<ViewMode>(viewMode);
  const shownRef = useRef<ViewMode>(viewMode);
  const [transitioning, setTransitioning] = useState(false);

  // Live handles to the in-Canvas camera/controls/invalidate, captured by RigBridge.
  const cameraRef = useRef<THREE.Camera | null>(null);
  const controlsRef = useRef<OrbitLike | null>(null);
  const invalidateRef = useRef<(() => void) | null>(null);
  // The full-screen glare overlay (DOM). Driven by direct style mutation (no React
  // re-render per frame) so the demand loop is never woken by React state churn.
  const glareRef = useRef<HTMLDivElement>(null);

  // Glare-masked descent: on a view-mode change, fly the camera in two eased
  // half-beats through a white sunlit flash that masks the scene swap. Runs a
  // plain rAF loop (NOT a useFrame) only for its ~1.5s, invalidating each tick;
  // when idle nothing renders, so the demand loop stays at 0 fps.
  useEffect(() => {
    const to = viewMode;
    const from = shownRef.current;
    if (to === from) return;

    const camera = cameraRef.current;
    const invalidate = invalidateRef.current;
    const controls = controlsRef.current;
    // Rig not ready yet (shouldn't happen after first mount): snap, no animation.
    if (!camera || !invalidate) {
      shownRef.current = to;
      setShown(to);
      return;
    }

    // Beat 1 flies toward the Moon (descent) or lifts off the worksite (ascent);
    // beat 2 settles into the destination once the content has swapped under the
    // glare. Beat 1 starts from wherever the user actually left the camera.
    const startPose: Pose = {
      position: camera.position.clone(),
      target: controls ? controls.target.clone() : poseFor(from).target.clone(),
    };
    const beat1To = to === "surface" ? MOON_CLOSE_POSE : SURFACE_HIGH_POSE;
    const beat2From = to === "surface" ? SURFACE_HIGH_POSE : MOON_CLOSE_POSE;
    const destPose = poseFor(to);

    const tmpPos = new THREE.Vector3();
    const tmpTgt = new THREE.Vector3();
    let raf = 0;
    let start = 0;
    let swapped = false;
    if (controls) controls.enabled = false; // we own the camera for the duration
    setTransitioning(true);

    const step = (now: number) => {
      if (!start) start = now;
      const t = Math.min(1, (now - start) / TRANSITION_MS);
      // Triangle glare: 0 → 1 at the midpoint → 0. Direct DOM write, no re-render.
      if (glareRef.current) glareRef.current.style.opacity = String(1 - Math.abs(t - 0.5) * 2);

      if (t < 0.5) {
        lerpPose(startPose, beat1To, easeInOut(t / 0.5), tmpPos, tmpTgt);
      } else {
        if (!swapped) {
          swapped = true;
          shownRef.current = to;
          setShown(to); // swap content + sky under the full-glare peak
        }
        lerpPose(beat2From, destPose, easeInOut((t - 0.5) / 0.5), tmpPos, tmpTgt);
      }
      camera.position.copy(tmpPos);
      camera.lookAt(tmpTgt);
      if (controls) controls.target.copy(tmpTgt);
      invalidate();

      if (t < 1) {
        raf = requestAnimationFrame(step);
      } else {
        if (glareRef.current) glareRef.current.style.opacity = "0";
        if (controls) {
          controls.target.copy(destPose.target);
          controls.enabled = true;
          controls.update();
        }
        setTransitioning(false);
        invalidate(); // final settled frame, then the loop idles
      }
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      if (controls) controls.enabled = true; // never leave controls disabled if interrupted
    };
    // Driven by viewMode only; the refs/state setters captured above are stable.
  }, [viewMode]);

  // Clamps + target follow the RENDERED mode so they match the visible scene.
  const preset = VIEW_PRESETS[shown];
  return (
    <>
      <Canvas
        className="world-canvas"
        frameloop="demand"
        dpr={[1, 1.5]}
        // far raised to ~8000 (issue #49) so the distant Moon + Earth are in-frustum;
        // near kept at 0.1. Shipping WITHOUT logarithmicDepthBuffer — the low-poly
        // worksite shows no z-fighting at this range.
        camera={{ position: [0, 11, 30], fov: 42, near: 0.1, far: 8000 }}
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
        {/* Black background as the GRACEFUL FALLBACK (issue #50): the HDR
            Environment in <SpaceEnvironment> overrides scene.background once it
            loads, but if the .hdr is missing/fails this black backdrop remains so
            the scene never goes blank (ADR-0004 mandatory fallback). */}
        <color attach="background" args={["#000000"]} />
        <SceneContents
          snapshot={snapshot}
          selected={selected}
          onPick={onPick}
          placing={placing}
          ghost={ghost}
          onPlaceMove={onPlaceMove}
          onPlaceConfirm={onPlaceConfirm}
          viewMode={shown}
          onViewModeChange={onViewModeChange}
        />
        <RigBridge
          cameraRef={cameraRef}
          controlsRef={controlsRef}
          invalidateRef={invalidateRef}
        />
        <OrbitControls
          makeDefault
          enablePan={false}
          // Disable orbit drag while placing (the placement plane owns the cursor)
          // and during the transition (the driver owns the camera).
          enableRotate={!placing && !transitioning}
          // Distance + polar clamps come from the RENDERED view preset (issue #49);
          // surface = rehearsed worksite framing, orbit = the Moon vista. Both stay
          // clamped (ADR-0004) — never a free-fly camera.
          minDistance={preset.minDistance}
          maxDistance={preset.maxDistance}
          // Clamp the vertical angle so the camera can't dip under the ground or
          // look straight down — keeps the diorama readable from any orbit.
          minPolarAngle={preset.minPolarAngle}
          maxPolarAngle={preset.maxPolarAngle}
          target={preset.target}
          enableDamping
          dampingFactor={0.08}
        />
      </Canvas>
      {/* Glare overlay for the descent transition. A child of .stage (position:
          relative), so it fills the stage; pointer-events:none keeps clicks going
          to the canvas; opacity is driven imperatively by the rAF above. */}
      <div className="view-glare" ref={glareRef} aria-hidden="true" />
    </>
  );
}
