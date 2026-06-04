# Container encore — `docker kill` a real rover

> Type: HITL (stretch) · PRD stories: 37, 38 · [TECHSPEC](../TECHSPEC.md) · [ADR-0001](../adr/0001-in-process-rovers-with-container-encore.md)

## What to build

Prove the rovers are genuinely separate systems, as an encore after the safe in-process heal has already landed. The same agent binary runs as a standalone container (`--mode=container`) joining the swarm over NATS. A killer sidecar performs `docker kill` on a control command — the browser never touches `docker.sock`. Killing the container triggers the same expiry → re-auction → heal over the real bus. Must be rehearsed working on the actual presentation laptop (macOS / Docker Desktop), since this is the most platform-specific, flake-prone path.

## Acceptance criteria

- [ ] The agent binary runs identically as a container, joining the swarm over NATS
- [ ] A killer sidecar executes `docker kill` on a control command; the browser never accesses `docker.sock`
- [ ] Killing the container triggers the same expiry → re-auction → heal over the real bus
- [ ] The path is rehearsed working on the presentation laptop (macOS / Docker Desktop)
- [ ] The Adapter seam is documented so a second capability profile compiles (spin-off proof)

## Blocked by

- [05 — Habitat dome blueprint](./05-habitat-dome-blueprint.md)
