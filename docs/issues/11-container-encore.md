# Container encore — `docker kill` a real rover

> Type: HITL (stretch) · PRD stories: 37, 38 · [TECHSPEC](../TECHSPEC.md) · [ADR-0001](../adr/0001-in-process-rovers-with-container-encore.md)

## What to build

Prove the rovers are genuinely separate systems, as an encore after the safe in-process heal has already landed. The same agent binary runs as a standalone container (`--mode=container`) joining the swarm over NATS. A killer sidecar performs `docker kill` on a control command — the browser never touches `docker.sock`. Killing the container triggers the same expiry → re-auction → heal over the real bus. Must be rehearsed working on the actual presentation laptop (macOS / Docker Desktop), since this is the most platform-specific, flake-prone path.

## Acceptance criteria

- [x] The agent binary runs identically as a container, joining the swarm over NATS (`rover-encore` = `R7`, `--mode=container`; see [deploy/docker-compose.yml](../../deploy/docker-compose.yml))
- [x] A killer sidecar executes `docker kill` on a control command; the browser never accesses `docker.sock` (`internal/killer`, `cmd/killer`; only the killer mounts the socket)
- [x] Killing the container triggers the same expiry → re-auction → heal over the real bus (`killContainer` → `docker kill` → Lease TTL-expiry → Re-auction, unchanged coordinator path)
- [ ] The path is rehearsed working on the presentation laptop (macOS / Docker Desktop) — **manual step**: the path is made real and the exact steps are documented in [docs/encore.md](../encore.md#rehearsal-note-macos--docker-desktop--do-this-before-presenting); a live `docker kill` rehearsal on the laptop is still required before presenting
- [x] The Adapter seam is documented so a second capability profile compiles (spin-off proof) — see [docs/encore.md](../encore.md#the-adapter-seam--how-a-second-capability-profile-compiles-spin-off-proof)

## Blocked by

- [05 — Habitat dome blueprint](./05-habitat-dome-blueprint.md)
