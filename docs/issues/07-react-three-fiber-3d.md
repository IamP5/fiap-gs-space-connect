# react-three-fiber 3D scene

> Type: HITL (design review) · PRD stories: 31, 33 · [TECHSPEC](../TECHSPEC.md) · [ADR-0004](../adr/0004-react-three-fiber-3d-built-2d-first.md)

## What to build

Swap the 2D canvas for the react-three-fiber lunar diorama: low-poly terrain, instanced rovers, status halos (idle/bidding/working/dead), lease beams, and the habitat structure rising block-by-block as tasks complete. Both renderers remain pure functions of the same WebSocket snapshot, so neither can lie about World Model state. Click-to-kill raycast is hardened against misfire.

Hard scope guard (per ADR-0004): one CC0 rover glTF + primitive geometry, a fixed default orbit-camera angle, bloom only on status halos, **no custom physics, no hand-modelled art**. The 2D canvas stays as the rehearsed fallback.

## Acceptance criteria

- [ ] The 3D scene renders rovers, tasks, and the rising dome purely from the WS snapshot
- [ ] Click-to-kill works reliably in 3D — raycast hit-target hardened, no misfire on the projector
- [ ] Scope guard respected: one CC0 model + primitives, fixed default camera, bloom only on halos, no physics
- [ ] The 2D canvas remains functional as a fallback
- [ ] Design review approves the look (the HITL gate)

## Blocked by

- [06 — Choreography](./06-choreography.md)
