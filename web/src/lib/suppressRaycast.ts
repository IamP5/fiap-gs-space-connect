// suppressRaycast — the determinism guard for click-to-kill (Issue #48).
//
// The scene makes EXACTLY ONE thing pickable per rover: an invisible hit-proxy
// sphere. Every primitive child sets `raycast={() => null}`, so the raycaster
// can only ever hit a proxy — that is what makes click-to-kill deterministic and
// what lets onPointerMissed deselect when you click empty space.
//
// A glTF placed via <primitive object={scene}> brings its OWN child meshes,
// none of them raycast-suppressed. Those would be hit by the raycaster and could
// steal rover selection or block the empty-space deselect. This helper walks an
// Object3D tree and replaces every node's raycast with a no-op so glTF children
// are never pickable.
//
// IMPORTANT: Object3D.clone(true) does NOT carry this override onto clones.
// `raycast` is normally a prototype method; assigning `o.raycast = () => null`
// makes it an OWN property, and Object3D.copy() does not copy own `raycast`. So
// this must run on the cached source AND on every per-placement clone.

import type { Object3D } from "three";

export function suppressRaycast<T extends Object3D>(root: T): T {
  root.traverse((o) => {
    o.raycast = () => null;
  });
  return root;
}
