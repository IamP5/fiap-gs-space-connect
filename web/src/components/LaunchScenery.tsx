// LaunchScenery — static, non-diegetic launch-infrastructure set-pieces (#56).
//
// These are SCENERY, not snapshot-driven Assets: NASA-PD glTF models dropped at
// the edge of the worksite as pure decoration (a crawler, a mobile launcher, a
// gantry, and a lander). They take NO snapshot props and never animate, so the
// scene stays a pure function of the snapshot (ADR-0004) — the decoration is
// snapshot-INDEPENDENT and simply always present.
//
// Each set-piece follows the SAME pattern as Scene3D's SpecModel: load the .glb
// on mount; until it resolves — and FOREVER if it fails — render a primitive box
// fallback so the structure is always present and a gone/slow asset never breaks
// the scene. The loaded tree is raycast-suppressed (suppressRaycast) so scenery
// is NOT pickable: the raycaster can still only hit a rover's invisible hit-proxy
// sphere, keeping click-to-kill deterministic and letting onPointerMissed
// deselect on empty space.

import { useEffect, useMemo, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { suppressRaycast } from "../lib/suppressRaycast";

// Self-contained loader + cache (mirrors Scene3D's loadGLTF): N references to the
// same .glb parse it ONCE, and the parsed scene is cloned per placement so
// transforms never cross-contaminate. raycast is suppressed on the CACHED source
// here AND re-applied to every clone (clone(true) does not carry the own-property
// override — see suppressRaycast).
//
// The NASA-PD set-pieces are Draco-compressed (extensionsRequired:
// KHR_draco_mesh_compression), so this loader MUST carry a DRACOLoader pointed at
// the self-hosted decoder (web/public/draco/, vendored by #52) or every load
// throws "No DRACOLoader instance provided" and silently falls back to a box.
// meshopt is wired too, matching Scene3D's module-level loader.
const sceneryLoader = new GLTFLoader();
const sceneryDraco = new DRACOLoader();
sceneryDraco.setDecoderPath("/draco/");
sceneryLoader.setDRACOLoader(sceneryDraco);
sceneryLoader.setMeshoptDecoder(MeshoptDecoder);
const sceneryCache = new Map<string, Promise<THREE.Group>>();

function loadScenery(url: string): Promise<THREE.Group> {
  let p = sceneryCache.get(url);
  if (!p) {
    p = new Promise<THREE.Group>((resolve, reject) => {
      sceneryLoader.load(
        url,
        (g) => {
          suppressRaycast(g.scene);
          resolve(g.scene);
        },
        undefined,
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
      );
    });
    sceneryCache.set(url, p);
  }
  return p;
}

type Vec3 = [number, number, number];

type SetPiece = {
  key: string;
  modelRef: string;
  position: Vec3;
  rotation?: Vec3;
  // Target for the model's LARGEST bounding-box dimension, in world units. The
  // NASA glTFs have arbitrary native units + off-origin pivots, so a fixed scale
  // scalar is meaningless (one model fills the sky, another is a speck). We fit
  // each model to this size at load (see fitAndSeat) so presence is predictable
  // regardless of the source units. The fallback box uses the same number.
  fit: number;
  // Tint for the box fallback shown until/if the glTF loads.
  fallbackColor: string;
};

// Set-pieces parked along the FAR edge of the ~20-unit worksite (GROUND_SPAN=20,
// terrain reaches ±16), spread on x so they read as a launch complex on the
// horizon without crowding the active worksite. `fit` keeps the towers tall but
// no longer dominating: an ~8-unit launcher/gantry reads as a backdrop next to
// the ~2-unit dome, the crawler sits low and wide, the lander is smallest.
const SET_PIECES: SetPiece[] = [
  {
    key: "crawler",
    modelRef: "/assets/models/nasa_crawler.glb",
    position: [-13, 0, -13],
    rotation: [0, Math.PI / 5, 0],
    fit: 4.5,
    fallbackColor: "#5a5a4e",
  },
  {
    key: "mobile-launcher",
    modelRef: "/assets/models/nasa_mobile_launcher.glb",
    position: [-5, 0, -15],
    rotation: [0, 0, 0],
    fit: 8,
    fallbackColor: "#6b6b72",
  },
  {
    key: "gantry",
    modelRef: "/assets/models/nasa_gantry.glb",
    position: [6, 0, -14],
    rotation: [0, -Math.PI / 8, 0],
    fit: 7,
    fallbackColor: "#7a4a3a",
  },
  {
    key: "lander",
    modelRef: "/assets/models/nasa_lunar_module.glb",
    position: [13, 0, -12],
    rotation: [0, -Math.PI / 4, 0],
    fit: 3,
    fallbackColor: "#b8a070",
  },
];

// fitAndSeat normalizes a loaded model in place: scale its largest dimension to
// `fit` world units, recenter on x/z, and seat its base at y=0 — so the wrapping
// <group position={piece.position}> drops it cleanly onto the ground. This is the
// fitToView bake the research flagged for NASA's arbitrary-unit, off-origin glbs;
// doing it at load (vs. baking each .glb) keeps the vendored assets untouched.
function fitAndSeat(obj: THREE.Object3D, fit: number) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const s = fit / maxDim;
  obj.scale.setScalar(s);
  // Center x/z on the group origin; lift so the model's base rests on y=0.
  obj.position.set(-center.x * s, -box.min.y * s, -center.z * s);
}

function SceneryPiece({ piece }: { piece: SetPiece }) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const invalidate = useThree((s) => s.invalidate);

  // Fallback box approximates the normalized model: a slim upright volume whose
  // height is `fit` (towers read tall, the crawler low-ish), seated on the ground.
  const fallbackSize = useMemo<Vec3>(
    () => [piece.fit * 0.6, piece.fit, piece.fit * 0.6],
    [piece.fit],
  );
  const fallbackGeo = useMemo(
    () => new THREE.BoxGeometry(...fallbackSize),
    [fallbackSize],
  );
  useEffect(() => () => fallbackGeo.dispose(), [fallbackGeo]);

  useEffect(() => {
    let disposed = false;
    loadScenery(piece.modelRef)
      .then((g) => {
        if (disposed) return;
        // clone(true) SHARES the cached source's geometry/materials, so the clone
        // owns nothing disposable; we only clone for an independent transform
        // node. Re-suppress raycast: clone(true) does not carry the own-property
        // override, so each placement must re-apply it to stay non-pickable.
        const obj = suppressRaycast(g.clone(true));
        // Normalize the raw NASA model (arbitrary units / off-origin pivot) to a
        // predictable size, centered on x/z and seated on y=0, so the wrapping
        // group's position drops it onto the ground at a sensible scale.
        fitAndSeat(obj, piece.fit);
        setScene(obj);
        invalidate(); // wake the demand loop so the scenery shows once loaded
      })
      .catch(() => {
        // Missing/failed glTF ⇒ keep the box fallback below (never crash).
      });
    return () => {
      disposed = true;
    };
  }, [piece.modelRef, piece.fit, invalidate]);

  if (!scene) {
    // Box fallback: parked at the set-piece position, raised by half its height
    // so it rests on the ground, and never pickable.
    return (
      <mesh
        geometry={fallbackGeo}
        position={[
          piece.position[0],
          piece.position[1] + fallbackSize[1] / 2,
          piece.position[2],
        ]}
        rotation={piece.rotation}
        raycast={() => null}
      >
        <meshStandardMaterial color={piece.fallbackColor} roughness={1} metalness={0} />
      </mesh>
    );
  }

  // The model is pre-normalized (centered x/z, base at y=0), so the group just
  // positions + orients it on the ground.
  return (
    <group position={piece.position} rotation={piece.rotation ?? [0, 0, 0]}>
      <primitive object={scene} />
    </group>
  );
}

// LaunchScenery — ONE component wrapping every static set-piece. Renders nothing
// snapshot-dependent and never animates, so the demand loop returns to 0 fps once
// the models have loaded.
export function LaunchScenery() {
  return (
    <group>
      {SET_PIECES.map((piece) => (
        <SceneryPiece key={piece.key} piece={piece} />
      ))}
    </group>
  );
}
