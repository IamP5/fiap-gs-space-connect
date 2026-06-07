# Soft shadows + contact shadows: PCFSoft sun shadow + ContactShadows under rovers/domes

- **Issue:** [#104](https://github.com/IamP5/fiap-gs-space-connect/issues/104)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK
- **Wave:** Cinematic beauty & immersion (3) · **Research:** [`cinematic-beauty-immersion.md`](../cinematic-beauty-immersion.md)

## What to build

Turn on shadows — the scene currently casts none. Set the renderer `shadowMap` to `PCFSoftShadowMap`; make the sun `directionalLight` (`Scene3D.tsx:1509`) cast shadows with `shadow.mapSize 2048` and a shadow camera **clamped to the ±25-unit worksite**, with `normalBias` tuned for the extreme airless contrast. Add drei `<ContactShadows>` beneath rovers and domes for grounded soft contact occlusion. The shadow map re-renders only on `invalidate()`, so 0 idle fps holds.

Research: `docs/02-realistic-3d-world/cinematic-beauty-immersion.md` (Wave 3).

## Acceptance criteria

- [ ] `PCFSoftShadowMap` enabled; sun directional `castShadow` with 2048 map
- [ ] Shadow camera frustum clamped to the worksite; `normalBias` tuned (no acne / peter-panning)
- [ ] Rovers + domes `castShadow`/`receiveShadow`; ground receives
- [ ] drei `ContactShadows` under rovers/domes (opacity ~0.6, blur ~3)
- [ ] 0 idle fps preserved (shadow renders on invalidate only); pick/click-to-kill intact
- [ ] lint+test+build green + surface screenshots

## Blocked by

None - can start immediately
