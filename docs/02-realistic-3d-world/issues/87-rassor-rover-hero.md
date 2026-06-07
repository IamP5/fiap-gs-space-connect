# Adopt RASSOR GLB as the swarm hero rover

- **Issue:** [#87](https://github.com/IamP5/fiap-gs-space-connect/issues/87)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK · **Relates:** #54
- **Wave:** Space-view realism (2) · **Research:** [`space-view-realism.md`](../space-view-realism.md) §7
- **⚠️ Status note:** RASSOR already shipped on main (PR #75, `rassor_rover.glb`). Kept open by user decision; treat as verify/no-op unless re-scoping.

## What to build

Adopt NASA's **RASSOR** (Regolith Advanced Surface Systems Operations Robot) GLB as the swarm's hero rover — a real lunar excavation robot. Self-host + condition (DRACO/meshopt), render through the existing rover render-swap seam with a primitive fallback, and **instance** for the swarm to bound draw calls.

## Acceptance criteria

- [ ] RASSOR GLB self-hosted + conditioned (DRACO/meshopt)
- [ ] Rendered as the rover via the render-swap seam; primitive proxy fallback (ADR-0004)
- [ ] Instanced for multiple rovers (bounded draw calls; 0 idle fps)
- [ ] Raycast/hit-proxy click-to-kill intact (decorative children `raycast={()=>null}`)
- [ ] No NASA insignia decals; NASA-PD credit (NASA/D. Smith; NASA/J. Schuler)
- [ ] lint+test+build green + screenshot

## Blocked by

- #52 (asset conditioning pipeline)
