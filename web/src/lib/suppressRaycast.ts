
import type { Object3D } from "three";

export function suppressRaycast<T extends Object3D>(root: T): T {
  root.traverse((o) => {
    o.raycast = () => null;
  });
  return root;
}
