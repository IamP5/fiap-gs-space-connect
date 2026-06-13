
import { useEffect, useMemo, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { suppressRaycast } from "../lib/suppressRaycast";
import { applyGltfTextureFidelity, polishGltfMaterials } from "../lib/textureFidelity";
import {
  LUNAR_SET_PIECES,
  SCENE_UNITS_PER_METER,
  SHACKLETON_SET_PIECES,
  type SetPiece,
} from "../lib/scene";
import { CELESTIAL_BLOOM_LAYER } from "./Scene3D";
import { reportAssetError, reportAssetWarning } from "../lib/assetLog";

const sceneryLoader = new GLTFLoader();
const sceneryDraco = new DRACOLoader();
sceneryDraco.setDecoderPath("/draco/");
sceneryLoader.setDRACOLoader(sceneryDraco);
sceneryLoader.setMeshoptDecoder(MeshoptDecoder);
const sceneryCache = new Map<string, Promise<THREE.Group>>();

export function loadScenery(url: string): Promise<THREE.Group> {
  let p = sceneryCache.get(url);
  if (!p) {
    p = new Promise<THREE.Group>((resolve, reject) => {
      sceneryLoader.load(
        url,
        (g) => {
          try {
            suppressRaycast(g.scene);
            polishGltfMaterials(g.scene, { bloomLayer: CELESTIAL_BLOOM_LAYER, url });
          } catch (err) {
            reportAssetError("set-piece polish", url, err);
          }
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


export const SCENERY_MODEL_REFS: readonly string[] = Array.from(
  new Set(
    [...LUNAR_SET_PIECES, ...SHACKLETON_SET_PIECES].map((p) => p.modelRef),
  ),
);

function fitAndSeat(obj: THREE.Object3D, fit: number) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) {
    obj.scale.setScalar(fit);
    obj.position.set(0, 0, 0);
    reportAssetWarning("fitAndSeat", "empty bounding box (no renderable geometry)");
    return;
  }
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const s = fit / maxDim;
  obj.scale.setScalar(s);
  obj.position.set(-center.x * s, -box.min.y * s, -center.z * s);
}

function mergeSetPiece(root: THREE.Object3D): {
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
} {
  root.updateMatrixWorld(true);
  const local = new THREE.Matrix4();

  const buckets = new Map<
    string,
    { material: THREE.Material; geometries: THREE.BufferGeometry[] }
  >();

  const pushGeom = (geom: THREE.BufferGeometry, material: THREE.Material) => {
    geom.applyMatrix4(local);
    const matKey = registerMaterial(material);
    const sigKey = attributeSignature(geom);
    const key = `${matKey}|${sigKey}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { material, geometries: [] };
      buckets.set(key, bucket);
    }
    bucket.geometries.push(geom);
  };

  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const mesh = o as THREE.Mesh;

    local.copy(mesh.matrixWorld);

    if (Array.isArray(mesh.material)) {
      const materials = mesh.material;
      const groups = mesh.geometry.groups;
      for (let gi = 0; gi < groups.length; gi++) {
        const material = materials[groups[gi].materialIndex ?? 0];
        if (!material) continue;
        const sliced = sliceGroup(mesh.geometry, gi);
        if (!sliced) continue;
        pushGeom(sliced, material);
      }
    } else {
      const material = mesh.material;
      if (!material) return;
      pushGeom(mesh.geometry.clone(), material);
    }
  });

  const group = new THREE.Group();
  const owned: THREE.BufferGeometry[] = [];
  for (const { material, geometries } of buckets.values()) {
    const merged =
      geometries.length === 1
        ? geometries[0]
        : mergeGeometries(geometries);
    if (!merged) {
      for (const g of geometries) {
        const m = new THREE.Mesh(g, material);
        group.add(m);
        owned.push(g);
      }
      continue;
    }
    if (merged !== geometries[0]) {
      for (const g of geometries) g.dispose();
    }
    const mesh = new THREE.Mesh(merged, material);
    group.add(mesh);
    owned.push(merged);
  }

  suppressRaycast(group);
  return { group, geometries: owned };
}

const materialIds = new WeakMap<THREE.Material, number>();
let nextMaterialId = 0;
function registerMaterial(m: THREE.Material): number {
  let id = materialIds.get(m);
  if (id === undefined) {
    id = nextMaterialId++;
    materialIds.set(m, id);
  }
  return id;
}

function attributeSignature(geom: THREE.BufferGeometry): string {
  const names = Object.keys(geom.attributes).sort();
  return `${geom.index ? "i" : "n"}:${names.join(",")}`;
}

function sliceGroup(
  geom: THREE.BufferGeometry,
  groupIndex: number,
): THREE.BufferGeometry | null {
  const grp = geom.groups[groupIndex];
  if (!grp || grp.count === 0) return null;
  const flat = geom.index ? geom.toNonIndexed() : geom;
  const out = new THREE.BufferGeometry();
  for (const name in flat.attributes) {
    const attr = flat.attributes[name] as THREE.BufferAttribute;
    const itemSize = attr.itemSize;
    const start = grp.start * itemSize;
    const end = (grp.start + grp.count) * itemSize;
    const src = attr.array as THREE.TypedArray;
    const sliced = src.slice(start, end);
    out.setAttribute(
      name,
      new THREE.BufferAttribute(sliced, itemSize, attr.normalized),
    );
  }
  if (geom.index) flat.dispose();
  return out;
}

function SceneryPiece({ piece }: { piece: SetPiece }) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);

  const [merged, setMerged] = useState<THREE.BufferGeometry[]>([]);
  useEffect(() => {
    return () => {
      for (const g of merged) g.dispose();
    };
  }, [merged]);

  const sceneSize = piece.realMeters * SCENE_UNITS_PER_METER;

  const fallbackSize = useMemo<Vec3>(
    () => [sceneSize * 0.6, sceneSize, sceneSize * 0.6],
    [sceneSize],
  );
  const fallbackGeo = useMemo(() => {
    if (piece.fallbackShape === "capsule") {
      const radius = sceneSize * 0.2;
      const length = Math.max(sceneSize - 2 * radius, 0.001);
      return new THREE.CapsuleGeometry(radius, length, 4, 8);
    }
    return new THREE.BoxGeometry(...fallbackSize);
  }, [piece.fallbackShape, sceneSize, fallbackSize]);
  useEffect(() => () => fallbackGeo.dispose(), [fallbackGeo]);

  useEffect(() => {
    let disposed = false;
    loadScenery(piece.modelRef)
      .then((g) => {
        if (disposed) return;
        const obj = suppressRaycast(g.clone(true));
        fitAndSeat(obj, sceneSize);
        applyGltfTextureFidelity(obj, gl.capabilities.getMaxAnisotropy());
        const { group, geometries } = mergeSetPiece(obj);
        setScene(group);
        setMerged(geometries);
        invalidate();
      })
      .catch((err) => {
        reportAssetError("set-piece", piece.modelRef, err);
      });
    return () => {
      disposed = true;
    };
  }, [piece.modelRef, sceneSize, invalidate, gl]);

  if (!scene) {
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

  return (
    <group position={piece.position} rotation={piece.rotation ?? [0, 0, 0]}>
      <primitive object={scene} />
    </group>
  );
}

export function LaunchScenery({ pieces }: { pieces: SetPiece[] }) {
  return (
    <group>
      {pieces.map((piece) => (
        <SceneryPiece key={piece.key} piece={piece} />
      ))}
    </group>
  );
}
