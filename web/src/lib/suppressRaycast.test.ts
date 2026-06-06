// suppressRaycast.test.ts — the "only hit-proxies are pickable" guarantee (#48).
//
// A glTF placed via <primitive> brings its own child meshes. If any of them keep
// the real Mesh.raycast, they can steal rover selection or block the empty-space
// deselect. suppressRaycast must make every node in the tree non-pickable — on
// the cached source AND on every clone, since clone(true) drops the override.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { suppressRaycast } from "./suppressRaycast";

// A no-op raycast pushes nothing onto the intersection array, so the raycaster
// can never report a hit on this object. We assert that directly rather than
// inspecting the function identity, so the test survives refactors of the no-op.
function isUnpickable(o: THREE.Object3D): boolean {
  const ray = new THREE.Raycaster(
    new THREE.Vector3(0, 0, 5),
    new THREE.Vector3(0, 0, -1),
  );
  const hits: THREE.Intersection[] = [];
  // Call the object's own raycast exactly as Raycaster.intersectObject would.
  o.raycast(ray, hits);
  return hits.length === 0;
}

// A small stand-in for a loaded glTF scene: a Group with nested child meshes,
// all sitting at the origin so a real raycast WOULD hit them if not suppressed.
function fakeGltfScene(): THREE.Group {
  const root = new THREE.Group();
  const a = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  const b = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshBasicMaterial());
  const inner = new THREE.Group();
  const c = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  inner.add(c);
  root.add(a, b, inner);
  root.updateMatrixWorld(true);
  return root;
}

describe("suppressRaycast", () => {
  it("makes every mesh in the source tree unpickable", () => {
    const root = fakeGltfScene();

    // Sanity: at least one child WOULD be hit before suppression, proving the
    // geometry is in the ray's path (otherwise the test would pass vacuously).
    let pickableBefore = 0;
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !isUnpickable(o)) pickableBefore++;
    });
    expect(pickableBefore).toBeGreaterThan(0);

    suppressRaycast(root);

    root.traverse((o) => {
      expect(isUnpickable(o)).toBe(true);
    });
  });

  it("keeps clones unpickable (clone(true) drops the override, so re-suppress)", () => {
    const source = suppressRaycast(fakeGltfScene());

    // clone(true) does NOT copy the own-property raycast override, so the raw
    // clone is pickable again — this is the exact bug #48 guards against.
    const rawClone = source.clone(true);
    let pickableInRawClone = 0;
    rawClone.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !isUnpickable(o)) pickableInRawClone++;
    });
    expect(pickableInRawClone).toBeGreaterThan(0);

    // Re-suppressing the clone (as SpecModel does) makes it fully unpickable.
    const clone = suppressRaycast(source.clone(true));
    clone.traverse((o) => {
      expect(isUnpickable(o)).toBe(true);
    });
  });

  it("returns the same root it was given (chainable)", () => {
    const root = fakeGltfScene();
    expect(suppressRaycast(root)).toBe(root);
  });
});
