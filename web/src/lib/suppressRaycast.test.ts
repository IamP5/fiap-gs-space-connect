
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { suppressRaycast } from "./suppressRaycast";

function isUnpickable(o: THREE.Object3D): boolean {
  const ray = new THREE.Raycaster(
    new THREE.Vector3(0, 0, 5),
    new THREE.Vector3(0, 0, -1),
  );
  const hits: THREE.Intersection[] = [];
  o.raycast(ray, hits);
  return hits.length === 0;
}

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

    const rawClone = source.clone(true);
    let pickableInRawClone = 0;
    rawClone.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !isUnpickable(o)) pickableInRawClone++;
    });
    expect(pickableInRawClone).toBeGreaterThan(0);

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
