# Fix glTF child raycast so click-to-kill stays deterministic

- **Issue:** [#48](https://github.com/IamP5/fiap-gs-space-connect/issues/48)
- **Epic:** [#46](https://github.com/IamP5/fiap-gs-space-connect/issues/46)
- **Labels:** `area:frontend`, `type:bug`
- **Type:** AFK

## What to build

Loaded glTF models placed via `<primitive>` in `SpecModel` bring their own child meshes, none raycast-suppressed, so they can steal rover selection or block empty-space deselect (`onPointerMissed`) — breaking the deterministic click-to-kill that today relies on the invisible hit-proxy sphere being the only pickable surface. Suppress raycast on the **cached glTF source once** (so every clone inherits it) right after load, before caching/cloning. The hit-proxy sphere must remain the sole pickable surface per rover.

```ts
// after the GLTF loads, before caching/cloning the source scene:
source.traverse((o) => { (o as THREE.Mesh).raycast = () => null; });
setScene(source.clone(true));
```

## Acceptance criteria

- [ ] Raycast suppressed on the cached glTF source in the SpecModel load path
- [ ] Clicking anywhere on a loaded model still selects the owning rover via its hit-proxy
- [ ] Clicking empty space still deselects (onPointerMissed fires)
- [ ] Test/assertion that only hit-proxies are pickable
- [ ] Idle stays 0 fps; box fallback behavior unchanged

## Blocked by

None - can start immediately
