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
// three 0.169 renamed the old mergeBufferGeometries → mergeGeometries; it merges
// a list of BufferGeometries that share an IDENTICAL attribute signature (same
// attribute names, same indexed-ness) into one buffer, returning null + an error
// if they don't. We pre-bucket by that signature so it never fails (see below).
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
import { reportAssetError } from "../lib/assetLog";

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

// Exported so the preload pass (lib/assets.ts) can WARM this exact module-level
// cache — preloading a set-piece GLB through here means the surface reuses the
// already-decoded model with zero rework (Epic 05 P1).
export function loadScenery(url: string): Promise<THREE.Group> {
  let p = sceneryCache.get(url);
  if (!p) {
    p = new Promise<THREE.Group>((resolve, reject) => {
      sceneryLoader.load(
        url,
        (g) => {
          try {
            suppressRaycast(g.scene);
            // Material tier polish (#111): clearcoat on metal set-pieces (the crawler,
            // launcher, gantry all read as steel), solar glint by URL, emissive
            // *window* submeshes on the bloom layer. Once on the cached source.
            polishGltfMaterials(g.scene, { bloomLayer: CELESTIAL_BLOOM_LAYER, url });
          } catch (err) {
            // Decorate/polish must NEVER reject: this promise is already in
            // sceneryCache, so a rejection caches the FAILURE and poisons every
            // later placement into a permanent box (#171 class — e.g. a solar-panel
            // GLB with an unlit mesh). Log and resolve the raw model instead.
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

// SetPiece + the per-site arrays (LUNAR_SET_PIECES / SHACKLETON_SET_PIECES) now
// live in lib/scene (pure data, no three) so SITE_FRAMES can carry each site's
// `pieces` list; LaunchScenery just renders the active site's pieces (Epic 04 P2).

// Every distinct set-piece GLB URL across BOTH sites, de-duplicated (Shackleton
// reuses the SAME GLBs as lunar — no new assets), so the preload manifest
// (lib/assets.ts) warms every model the surface can show and can't drift from the
// actual scenery (Epic 05 P1).
export const SCENERY_MODEL_REFS: readonly string[] = Array.from(
  new Set(
    [...LUNAR_SET_PIECES, ...SHACKLETON_SET_PIECES].map((p) => p.modelRef),
  ),
);

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

// mergeSetPiece — the draw-call diet (#58b). A loaded NASA glTF scene is a TREE
// of child meshes, and each child mesh is its own draw call. This collapses that
// tree into ONE merged mesh PER DISTINCT MATERIAL, so a four-set-piece complex
// that was dozens of draw calls becomes a handful — a pure perf refactor that
// must render IDENTICALLY (same silhouette, placement, materials).
//
// The model arrives already fitAndSeat-normalized, i.e. its own transform (scale
// + x/z recenter + base-at-y=0 lift) lives on the ROOT. We bake every child's FULL
// world matrix into a cloned geometry so that normalization (the fit SCALE + the
// recenter/seat) is frozen into the merged buffers — the merged group is then
// parented under the wrapping <group position rotation> which only adds placement.
// (A prior version stripped the root matrix back off via `rootInverse`, which
// silently CANCELLED fitAndSeat's scale + recenter — pieces rendered at their raw
// native size + off-origin pivot. That was masked only because the lunar GLBs are
// authored near unit scale; raw NASA models like the habitat/astronaut, 70–380
// native units, then rendered enormous. Baking the full world matrix fixes it so
// realMeters actually governs on-screen size for EVERY piece — Epic 04 P0's intent.)
//
// Geometries are bucketed by (material identity, attribute signature). Material
// identity keeps materials pixel-identical (one output mesh per material).
// Attribute signature (sorted attribute names + indexed flag) guarantees every
// list handed to mergeGeometries is internally compatible, so it never returns
// null and never logs the "attributes differ" warning — meshes that share a
// material but differ in attributes (e.g. some have uv, some don't) simply land
// in separate buckets and emit separate merged meshes.
//
// Returns a fresh Group of merged meshes plus the list of NEW geometries it
// created, so the caller can dispose those owned buffers on unmount.
function mergeSetPiece(root: THREE.Object3D): {
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
} {
  // Freeze the normalized transforms (fitAndSeat's root scale + recenter + every
  // child's own transform) into world matrices, so the bake captures the model at
  // its NORMALIZED size/placement — not the raw native frame.
  root.updateMatrixWorld(true);
  const local = new THREE.Matrix4();

  // Bucket key → { material, geometries[] }. Insertion order is preserved so the
  // output mesh order is stable across loads (handy for diffing draw order).
  const buckets = new Map<
    string,
    { material: THREE.Material; geometries: THREE.BufferGeometry[] }
  >();

  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const mesh = o as THREE.Mesh;
    // A child could carry a material ARRAY (multi-material mesh w/ geometry
    // groups). Split it into per-group geometries so each piece pairs with its
    // single material and merges cleanly; a single material is the common case.
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];

    // Bake the child's FULL normalized world matrix (includes fitAndSeat's root
    // scale + recenter/seat), so the merged geometry renders at the fitted size.
    local.copy(mesh.matrixWorld);

    for (let g = 0; g < materials.length; g++) {
      const material = materials[g];
      if (!material) continue;
      // Clone so we never mutate the shared cached source geometry, then bake the
      // transform into the clone's positions/normals/tangents.
      let geom: THREE.BufferGeometry;
      if (Array.isArray(mesh.material)) {
        // Multi-material mesh: carve out just this group's index range so the
        // slice pairs with materials[g] alone, then merge per slice. sliceGroup
        // clones internally, so we don't clone again here.
        const sliced = sliceGroup(mesh.geometry, g);
        if (!sliced) continue;
        geom = sliced;
      } else {
        geom = mesh.geometry.clone();
      }
      geom.applyMatrix4(local);

      // Identify by material reference (pixel-identical) + attribute signature.
      const matKey = registerMaterial(material);
      const sigKey = attributeSignature(geom);
      const key = `${matKey}|${sigKey}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { material, geometries: [] };
        buckets.set(key, bucket);
      }
      bucket.geometries.push(geom);
    }
  });

  const group = new THREE.Group();
  const owned: THREE.BufferGeometry[] = [];
  for (const { material, geometries } of buckets.values()) {
    // One geometry merges to itself (no copy needed); >1 collapses to one buffer.
    const merged =
      geometries.length === 1
        ? geometries[0]
        : mergeGeometries(geometries);
    if (!merged) {
      // Defensive: should be impossible given the signature bucketing, but if a
      // merge ever fails, keep the per-child clones rather than dropping geometry
      // (the scene must never silently lose a set-piece).
      for (const g of geometries) {
        const m = new THREE.Mesh(g, material);
        group.add(m);
        owned.push(g);
      }
      continue;
    }
    // Drop the per-child clones once merged into a new buffer (avoid leaking the
    // intermediates); the single-geometry case reuses its clone as the output.
    if (merged !== geometries[0]) {
      for (const g of geometries) g.dispose();
    }
    const mesh = new THREE.Mesh(merged, material);
    group.add(mesh);
    owned.push(merged);
  }

  // Re-suppress raycast on the freshly built meshes so the merged scenery stays
  // non-pickable (same invariant the cloned tree carried — see suppressRaycast).
  suppressRaycast(group);
  return { group, geometries: owned };
}

// registerMaterial — stable per-material key by object identity. Materials are
// shared across the cached source, so a WeakMap of material → id gives identical
// materials the same bucket without depending on uuid string formatting.
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

// attributeSignature — the compatibility key mergeGeometries demands: sorted
// attribute names plus whether the geometry is indexed. Geometries with the same
// signature are guaranteed mergeable; differing signatures go to separate meshes.
function attributeSignature(geom: THREE.BufferGeometry): string {
  const names = Object.keys(geom.attributes).sort();
  return `${geom.index ? "i" : "n"}:${names.join(",")}`;
}

// sliceGroup — extract a single geometry group (index range) from a multi-
// material geometry as its own standalone BufferGeometry, so it can pair with
// exactly one material before merging. Returns null if the group is empty.
function sliceGroup(
  geom: THREE.BufferGeometry,
  groupIndex: number,
): THREE.BufferGeometry | null {
  const grp = geom.groups[groupIndex];
  if (!grp || grp.count === 0) return null;
  // toNonIndexed flattens to per-vertex attributes; then take the group's slice.
  const flat = geom.index ? geom.toNonIndexed() : geom;
  const out = new THREE.BufferGeometry();
  for (const name in flat.attributes) {
    const attr = flat.attributes[name] as THREE.BufferAttribute;
    const itemSize = attr.itemSize;
    const start = grp.start * itemSize;
    const end = (grp.start + grp.count) * itemSize;
    // slice() copies the group's range into a standalone TypedArray (every
    // TypedArray implements slice) so the new geometry owns its own buffer.
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

  // The merged geometries we BUILD are new owned GPU buffers (unlike the shared
  // cached source geometry), so we must dispose them on unmount to avoid a leak.
  // Stash them per-load and dispose in the load effect's cleanup.
  const [merged, setMerged] = useState<THREE.BufferGeometry[]>([]);
  useEffect(() => {
    return () => {
      for (const g of merged) g.dispose();
    };
  }, [merged]);

  // The literal scene size (Epic 04 P0): real meters → scene units via the one
  // fixed scale. Drives BOTH the fitAndSeat target for the loaded glTF and the
  // primitive fallback below, so the fallback occupies the exact footprint the
  // real model will (ADR-0004 fallback must read at the same scale).
  const sceneSize = piece.realMeters * SCENE_UNITS_PER_METER;

  // Primitive fallback (ADR-0004) approximating the normalized model: a slim
  // upright volume whose height is `sceneSize` (towers read tall, the crawler
  // low-ish), seated on the ground. `fallbackShape` picks the silhouette: a box
  // for structures, a capsule for the astronaut. Both are sized to the model's
  // computed scene size so the proxy occupies the same footprint until/if the
  // glTF loads.
  const fallbackSize = useMemo<Vec3>(
    () => [sceneSize * 0.6, sceneSize, sceneSize * 0.6],
    [sceneSize],
  );
  const fallbackGeo = useMemo(() => {
    if (piece.fallbackShape === "capsule") {
      // CapsuleGeometry(radius, length, …): total height = length + 2·radius, so
      // length = sceneSize − 2·radius keeps the overall height at sceneSize. A
      // slim radius reads as a standing figure.
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
        // clone(true) SHARES the cached source's geometry/materials, so the clone
        // owns nothing disposable; we only clone for an independent transform
        // node. Re-suppress raycast: clone(true) does not carry the own-property
        // override, so each placement must re-apply it to stay non-pickable.
        const obj = suppressRaycast(g.clone(true));
        // Normalize the raw NASA model (arbitrary units / off-origin pivot) to a
        // predictable size, centered on x/z and seated on y=0, so the wrapping
        // group's position drops it onto the ground at its LITERAL real-world
        // scale (Epic 04 P0).
        fitAndSeat(obj, sceneSize);
        // Texture fidelity sweep (#100): max anisotropy + per-channel colourSpace
        // + crisp data-map mip filtering. Runs BEFORE mergeSetPiece, which buckets
        // by material identity and reuses these same (now-corrected) materials.
        applyGltfTextureFidelity(obj, gl.capabilities.getMaxAnisotropy());
        // Collapse the normalized child-mesh tree into one merged mesh per
        // material (#58b): same silhouette/placement/materials, far fewer draw
        // calls. The merged group expects the SAME wrapping group below, since
        // mergeSetPiece bakes child transforms into root-LOCAL space.
        const { group, geometries } = mergeSetPiece(obj);
        setScene(group);
        setMerged(geometries); // own these buffers; dispose on unmount/reload
        invalidate(); // wake the demand loop so the scenery shows once loaded
      })
      .catch((err) => {
        // Missing/failed glTF ⇒ keep the box fallback below (never crash), but log
        // WHICH set-piece ref failed (the DRACOLoader-required path, a 404, etc.).
        reportAssetError("set-piece", piece.modelRef, err);
      });
    return () => {
      disposed = true;
    };
  }, [piece.modelRef, sceneSize, invalidate, gl]);

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

// LaunchScenery — ONE component wrapping the ACTIVE site's static set-pieces
// (Epic 04 P2). Renders nothing snapshot-dependent and never animates. The two
// sites reuse the same GLBs but compose/retint them differently (see
// LUNAR_SET_PIECES / SHACKLETON_SET_PIECES in lib/scene); the active site's
// `pieces` list is threaded down from SceneContents via the site frame.
export function LaunchScenery({ pieces }: { pieces: SetPiece[] }) {
  return (
    <group>
      {pieces.map((piece) => (
        <SceneryPiece key={piece.key} piece={piece} />
      ))}
    </group>
  );
}
