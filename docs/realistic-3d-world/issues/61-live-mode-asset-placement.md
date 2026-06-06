# Live-mode Asset placement via catalog keys

- **Issue:** [#61](https://github.com/IamP5/fiap-gs-space-connect/issues/61)
- **Epic:** [#46](https://github.com/IamP5/fiap-gs-space-connect/issues/46)
- **Labels:** `area:backend`, `area:frontend`, `type:feature`
- **Type:** AFK
- **ADR:** [0010 — live-mode curated Asset catalog](../../build-harness/adr/0010-live-mode-curated-asset-catalog.md)

## What to build

Enable **live** Build mode to place Assets by catalog key (ADR-0010). The Build harness/Model may emit Asset keys during the live work phase; inject the Task's catalog **key list** (not URLs) into the model-seam prompt; the renderer resolves keys via the existing `SpecModel` path with primitive fallback. Replay and live share the same catalog. Relies on the raycast fix (#48) so Asset clicks stay deterministic.

## Acceptance criteria

- [ ] Live harness can emit catalog-key Asset ops; prompt carries the key list, not paths
- [ ] Placed Assets render via SpecModel with primitive fallback on miss
- [ ] Out-of-catalog keys handled by #60 (rejected, never durable)
- [ ] Click-to-kill stays deterministic with live-placed Assets (hit-proxy only)
- [ ] Idle stays 0 fps; live determinism story (ADR-0009) intact

## Blocked by

- [#59](https://github.com/IamP5/fiap-gs-space-connect/issues/59)
- [#60](https://github.com/IamP5/fiap-gs-space-connect/issues/60)
- [#48](https://github.com/IamP5/fiap-gs-space-connect/issues/48)
