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
// HARD SCOPE GUARD (ADR-0004 — obeyed here):
//   - Rover is PRIMITIVE geometry (low-poly box body + cylinder wheels). No CC0
//     glTF was available offline and we must NOT fetch unlicensed assets, so the
//     documented primitive fallback stands in — it still honors "primitive
//     geometry / no hand-modelled art".
//   - ONE fixed default orbit-camera angle (OrbitControls allowed, clamped).
//   - BLOOM ONLY on the status halos, via a selective-bloom layer limited to the
//     halo meshes (never full-scene bloom). See HALO_BLOOM_LAYER below.
//   - No custom physics, no hand-modelled art.

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import { EffectComposer, SelectiveBloom } from "@react-three/postprocessing";
import * as THREE from "three";
import type { RoverView, Snapshot, TaskView } from "../types/wire";
import { batteryPercent } from "../lib/format";
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

// Functional telemetry colors (DESIGN.md: live-data signals only — the brand
// palette itself is black + white). Matched to the 2D canvas so the two
// renderers read identically.
const SIGNAL_OK = "#2ecc71"; // working / done
const SIGNAL_WARN = "#f5a623"; // bidding / leased
const SIGNAL_DOWN = "#e74c3c"; // dead / kill target
const SIGNAL_IDLE = "#9aa4b2"; // idle / unclaimed

// A dedicated render layer for the halo meshes. SelectiveBloom is told to bloom
// ONLY objects on this layer, so the glow is confined to status halos and never
// leaks onto the terrain, rovers, or dome (ADR-0004's "bloom only on halos").
const HALO_BLOOM_LAYER = 11;

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
  selected: boolean;
  bidPulse: number; // 0 = no active bid beat; else 0..1 progress
  wonPulse: number; // 0 = no active winner beat; else 0..1 progress
  onPick: (id: string) => void;
};

// A rover built from PRIMITIVE geometry (ADR-0004 fallback): a low-poly box body
// on four short cylinder wheels, monochrome white per the brand's no-accent
// rule, dimmed when dead. A generous INVISIBLE hit-proxy sphere wraps it so the
// click raycast reliably selects the rover the user sees — the proxy uses the
// SAME world→scene map as the rendered body, so the hit can never drift (the 3D
// analogue of the 2D canvas's shared-projection guarantee).
function Rover3D({ rover, map, selected, bidPulse, wonPulse, onPick }: Rover3DProps) {
  const p = map.at(rover.pos);
  const dim = !rover.alive;
  const bodyColor = dim ? "#2a2a2e" : "#f0f0fa";

  const haloRef = useRef<THREE.Mesh>(null);
  const wonRef = useRef<THREE.Mesh>(null);

  // Put the status halo + winner ring on the bloom layer so ONLY they glow.
  useEffect(() => {
    haloRef.current?.layers.enable(HALO_BLOOM_LAYER);
    wonRef.current?.layers.enable(HALO_BLOOM_LAYER);
  });

  const haloColor = roverHaloColor(rover);
  // A bid beat momentarily flips the halo amber and pulses it (the "bid flash").
  const flashColor = bidPulse > 0 ? SIGNAL_WARN : haloColor;
  const haloScale = 1 + (bidPulse > 0 ? Math.sin(bidPulse * Math.PI) * 0.35 : 0);

  // The selection halo is the clear KILL-target affordance, mirroring the 2D
  // canvas: danger-red around a live rover, muted around a dead one.
  const selColor = dim ? SIGNAL_IDLE : SIGNAL_DOWN;

  const battery = batteryPercent(rover.battery);

  return (
    <group position={[p.x, p.y, p.z]}>
      {/* Invisible, generous hit-proxy. Larger than the visible body so clicks
          reliably land; shares this group's transform (= map.at), so the raycast
          hit and the rendered rover are positioned by the exact same math. */}
      <mesh
        position={[0, 0.45, 0]}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation(); // empty-space deselect is handled by the ground
          onPick(rover.id);
        }}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "default")}
      >
        <sphereGeometry args={[0.95, 16, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Body — low-poly box (PRIMITIVE fallback per ADR-0004). */}
      <mesh position={[0, 0.42, 0]} raycast={() => null}>
        <boxGeometry args={[0.7, 0.34, 0.95]} />
        <meshStandardMaterial
          color={bodyColor}
          metalness={0.2}
          roughness={0.7}
          emissive={dim ? "#000000" : "#101014"}
        />
      </mesh>
      {/* Sensor mast block, so the rover reads as front-facing. */}
      <mesh position={[0, 0.66, -0.18]} raycast={() => null}>
        <boxGeometry args={[0.3, 0.2, 0.3]} />
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
          position={[wx, 0.2, wz]}
          rotation={[0, 0, Math.PI / 2]}
          raycast={() => null}
        >
          <cylinderGeometry args={[0.2, 0.2, 0.16, 12]} />
          <meshStandardMaterial color={dim ? "#141416" : "#3a3a3f"} roughness={0.9} />
        </mesh>
      ))}

      {/* Status halo — a thin ring on the ground under the rover. This is the
          ONLY rover element on the bloom layer, so the glow is confined to it.
          Uses an emissive, non-tone-mapped material so it reads as "lit". */}
      <mesh
        ref={haloRef}
        position={[0, 0.04, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={haloScale}
        raycast={() => null}
      >
        <ringGeometry args={[0.62, 0.82, 40]} />
        <meshStandardMaterial
          color={flashColor}
          emissive={flashColor}
          emissiveIntensity={dim ? 1.4 : 2.2}
          toneMapped={false}
          transparent
          opacity={dim ? 0.7 : 0.95}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Winner glow — an expanding ring on a "won" beat (the auction winner). */}
      {wonPulse > 0 ? (
        <mesh
          ref={wonRef}
          position={[0, 0.05, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={1 + wonPulse * 1.6}
          raycast={() => null}
        >
          <ringGeometry args={[0.82, 0.98, 40]} />
          <meshStandardMaterial
            color={SIGNAL_OK}
            emissive={SIGNAL_OK}
            emissiveIntensity={2.4 * (1 - wonPulse)}
            toneMapped={false}
            transparent
            opacity={1 - wonPulse}
            side={THREE.DoubleSide}
          />
        </mesh>
      ) : null}

      {/* Selection halo — the KILL-target affordance (NOT on the bloom layer, so
          it stays a crisp outline rather than a glow). */}
      {selected ? (
        <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
          <ringGeometry args={[0.9, 1.02, 48]} />
          <meshBasicMaterial color={selColor} transparent opacity={0.95} side={THREE.DoubleSide} />
        </mesh>
      ) : null}

      {/* Battery tick: a short bar whose color encodes charge (functional). */}
      <mesh position={[0, 0.92, 0]} raycast={() => null}>
        <boxGeometry args={[0.5 * (battery / 100) + 0.02, 0.06, 0.06]} />
        <meshStandardMaterial
          color={dim ? "#555" : battery > 50 ? SIGNAL_OK : battery > 20 ? SIGNAL_WARN : SIGNAL_DOWN}
          emissive={dim ? "#000" : battery > 50 ? SIGNAL_OK : battery > 20 ? SIGNAL_WARN : SIGNAL_DOWN}
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

// ---- a task / dome block ----------------------------------------------------

// Each task is a block in the rising habitat: foundations form the base, walls
// the mid ring, the dome task the cap. A DONE task is "built" (solid, lit by a
// brief solidify pop); a not-yet-done task is a faint ghost of the structure to
// come. Position + height come from lib/scene.ts — a pure read of the snapshot.
function TaskBlock({
  task,
  map,
  solidify,
}: {
  task: TaskView;
  map: SceneMap;
  solidify: number; // 0 = none; else 0..1 solidify-pop progress
}) {
  const tier = tierOf(task.type);
  const h = tierHeight(tier);
  const p = map.at(task.pos, 0);
  const built = isBuilt(task);

  // Solidify pop: a brief upward scale + flash on a just-completed task.
  const popScale = solidify > 0 ? 1 + Math.sin(solidify * Math.PI) * 0.25 : 1;

  const color = built ? "#cfcfd6" : task.status === "LEASED" ? SIGNAL_WARN : SIGNAL_IDLE;
  const opacity = built ? 1 : task.status === "LEASED" ? 0.5 : 0.28;

  // The dome cap reads as a hemisphere; foundations/walls as low blocks.
  const isCap = tier === "dome";

  return (
    <group position={[p.x, 0, p.z]}>
      {isCap ? (
        <mesh position={[0, h, 0]} scale={popScale} raycast={() => null}>
          <sphereGeometry args={[1.0, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial
            color={color}
            roughness={0.85}
            metalness={0.05}
            transparent
            opacity={opacity}
            emissive={solidify > 0 ? SIGNAL_OK : "#000000"}
            emissiveIntensity={solidify > 0 ? 1.5 * (1 - solidify) : 0}
            toneMapped={false}
          />
        </mesh>
      ) : (
        <mesh
          position={[0, h, 0]}
          scale={[popScale, popScale, popScale]}
          raycast={() => null}
        >
          <boxGeometry args={tier === "foundation" ? [1.1, 0.3, 1.1] : [0.9, 1.1, 0.9]} />
          <meshStandardMaterial
            color={color}
            roughness={0.9}
            metalness={0.05}
            transparent
            opacity={opacity}
            emissive={solidify > 0 ? SIGNAL_OK : "#000000"}
            emissiveIntensity={solidify > 0 ? 1.5 * (1 - solidify) : 0}
            toneMapped={false}
          />
        </mesh>
      )}
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
// halos), never the full scene — ADR-0004's hard guard. It needs the light and
// the scene refs; we resolve the halo objects by walking the scene for anything
// on the bloom layer each render is overkill, so instead we let SelectiveBloom
// target the whole scene but gate by layer via `selectionLayer`.
function HaloBloom({ lightRef }: { lightRef: React.RefObject<THREE.DirectionalLight> }) {
  // The directional light mounts in the same pass as this component, so its ref
  // is null on first render. Force exactly one re-render after mount so the ref
  // has resolved; SelectiveBloom requires a non-null light, so we render nothing
  // until then.
  const [, ready] = useState(0);
  useEffect(() => ready(1), []);
  const light = lightRef.current;
  if (!light) return null;
  return (
    // multisampling={0}: SelectiveBloom does its own threshold/blur, so MSAA on
    // the composer only adds a depth/stencil blit step some ANGLE/macOS drivers
    // warn about. Bloom-only needs no extra AA here.
    <EffectComposer multisampling={0}>
      <SelectiveBloom
        lights={[light]}
        selectionLayer={HALO_BLOOM_LAYER}
        intensity={2.2}
        luminanceThreshold={0.1}
        luminanceSmoothing={0.2}
        mipmapBlur
        radius={0.7}
      />
    </EffectComposer>
  );
}

type Scene3DProps = {
  snapshot: Snapshot | null;
  selected: string | null;
  onPick: (id: string | null) => void;
};

// The actual scene contents (inside <Canvas>). Kept as one component so the
// snapshot → meshes mapping is a single pure pass, and so beats animate smoothly
// between snapshots via a continuous rAF (useFrame), exactly like the 2D canvas.
function SceneContents({ snapshot, selected, onPick }: Scene3DProps) {
  const lightRef = useRef<THREE.DirectionalLight>(null);

  // Beat bookkeeping — DECORATION ONLY, derived from the server's own events
  // (mirrors WorldCanvas). Stamped with performance.now() so animation progress
  // is independent of snapshot cadence; pruned each frame.
  const beats = useRef<ActiveBeat[]>([]);
  const lastAt = useRef<number>(Number.NEGATIVE_INFINITY);
  const nowRef = useRef<number>(0);
  // A frame tick: bumped only WHILE beats are active, to force a re-render so the
  // declarative pulse meshes animate smoothly between the ~12 Hz snapshots. When
  // no beats are live this stays put, so the scene re-renders only on snapshot
  // change (cheap) — a pure decoration that never touches world state.
  const [, setTick] = useState(0);

  useEffect(() => {
    if (snapshot && snapshot.at !== lastAt.current) {
      lastAt.current = snapshot.at;
      const now = performance.now();
      const incoming = snapshot.events ?? [];
      if (incoming.length > 0) {
        beats.current = [...beats.current, ...incoming.map((e) => ({ ...e, spawn: now }))];
        setTick((t) => t + 1); // kick the animation loop awake
      }
    }
  }, [snapshot]);

  // Prune expired beats and advance the clock the render reads for beat
  // progress, so pulses fade smoothly (mirrors WorldCanvas's rAF). While any
  // beat is live we bump React state each frame to re-render the pulse meshes;
  // once they all expire we stop, so idle frames cost nothing extra.
  useFrame(() => {
    const now = performance.now();
    nowRef.current = now;
    const before = beats.current.length;
    beats.current = activeBeats(beats.current, now);
    if (beats.current.length > 0 || before > 0) setTick((t) => (t + 1) % 1_000_000);
  });

  if (!snapshot) {
    return (
      <>
        <ambientLight intensity={0.4} />
        <LunarTerrain />
      </>
    );
  }

  const map = sceneMap(
    snapshot.rovers.map((r) => r.pos),
    snapshot.tasks.map((t) => t.pos),
  );

  const now = nowRef.current || performance.now();

  // Per-rover bid/won pulses and per-task solidify pulses, from active beats.
  const bidPulse = new Map<string, number>();
  const wonPulse = new Map<string, number>();
  const solidify = new Map<string, number>();
  for (const b of beats.current) {
    const p = beatProgress(b, now);
    if (b.kind === "bid" && b.robot_id) bidPulse.set(b.robot_id, p);
    else if (b.kind === "won" && b.robot_id) wonPulse.set(b.robot_id, p);
    else if (b.kind === "solidify" && b.task_id) solidify.set(b.task_id, p);
  }

  const taskById = new Map(snapshot.tasks.map((t) => [t.id, t]));

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
        <TaskBlock key={t.id} task={t} map={map} solidify={solidify.get(t.id) ?? 0} />
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
          selected={selected === r.id}
          bidPulse={bidPulse.get(r.id) ?? 0}
          wonPulse={wonPulse.get(r.id) ?? 0}
          onPick={onPick}
        />
      ))}

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
export function Scene3D({ snapshot, selected, onPick }: Scene3DProps) {
  return (
    <Canvas
      className="world-canvas"
      dpr={[1, 2]}
      camera={{ position: [0, 14, 18], fov: 42, near: 0.1, far: 200 }}
      onPointerMissed={() => onPick(null)} // click empty space → deselect
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#000000"]} />
      <SceneContents snapshot={snapshot} selected={selected} onPick={onPick} />
      <OrbitControls
        makeDefault
        enablePan={false}
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
