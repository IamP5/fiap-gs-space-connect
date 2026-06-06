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
  scale: number;
  // Box fallback dimensions (scene units) + tint, shown until/if the glTF loads.
  fallback: { size: Vec3; color: string };
};

// Set-pieces parked along the FAR edge of the ~20-unit worksite (GROUND_SPAN=20,
// terrain reaches ±16). Placed back at z ≈ -11..-14 and spread on x so they read
// as a launch complex on the horizon without crowding the active worksite.
const SET_PIECES: SetPiece[] = [
  {
    key: "crawler",
    modelRef: "/assets/models/nasa_crawler.glb",
    position: [-12, 0, -12],
    rotation: [0, Math.PI / 5, 0],
    scale: 0.9,
    fallback: { size: [4, 1.4, 5], color: "#5a5a4e" },
  },
  {
    key: "mobile-launcher",
    modelRef: "/assets/models/nasa_mobile_launcher.glb",
    position: [-4, 0, -14],
    rotation: [0, 0, 0],
    scale: 0.9,
    fallback: { size: [3, 7, 3], color: "#6b6b72" },
  },
  {
    key: "gantry",
    modelRef: "/assets/models/nasa_gantry.glb",
    position: [5, 0, -13.5],
    rotation: [0, -Math.PI / 8, 0],
    scale: 0.9,
    fallback: { size: [3.5, 8, 3.5], color: "#7a4a3a" },
  },
  {
    key: "lander",
    modelRef: "/assets/models/nasa_lunar_module.glb",
    position: [13, 0, -11],
    rotation: [0, -Math.PI / 4, 0],
    scale: 0.9,
    fallback: { size: [2.5, 2.5, 2.5], color: "#b8a070" },
  },
];

function SceneryPiece({ piece }: { piece: SetPiece }) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const invalidate = useThree((s) => s.invalidate);

  const fallbackGeo = useMemo(
    () => new THREE.BoxGeometry(...piece.fallback.size),
    [piece.fallback.size],
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
        setScene(suppressRaycast(g.clone(true)));
        invalidate(); // wake the demand loop so the scenery shows once loaded
      })
      .catch(() => {
        // Missing/failed glTF ⇒ keep the box fallback below (never crash).
      });
    return () => {
      disposed = true;
    };
  }, [piece.modelRef, invalidate]);

  if (!scene) {
    // Box fallback: parked at the set-piece position, raised by half its height
    // so it rests on the ground, and never pickable.
    return (
      <mesh
        geometry={fallbackGeo}
        position={[
          piece.position[0],
          piece.position[1] + piece.fallback.size[1] / 2,
          piece.position[2],
        ]}
        rotation={piece.rotation}
        raycast={() => null}
      >
        <meshStandardMaterial color={piece.fallback.color} roughness={1} metalness={0} />
      </mesh>
    );
  }

  return (
    <primitive
      object={scene}
      position={piece.position}
      rotation={piece.rotation ?? [0, 0, 0]}
      scale={piece.scale}
    />
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
