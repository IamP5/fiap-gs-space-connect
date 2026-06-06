# Coordinator validates Asset keys before World Model fold

- **Issue:** [#60](https://github.com/IamP5/fiap-gs-space-connect/issues/60)
- **Epic:** [#46](https://github.com/IamP5/fiap-gs-space-connect/issues/46)
- **Labels:** `area:backend`, `type:feature`
- **Type:** AFK
- **ADR:** [0010 — live-mode curated Asset catalog](../../build-harness/adr/0010-live-mode-curated-asset-catalog.md)

## What to build

Per ADR-0010, the coordinator must **reject any Build op whose Asset key is not in that Task's Asset catalog BEFORE it folds into the World Model** — the same single-writer chokepoint that guards every other op. A bad/hallucinated key can never become durable Build spec.

## Acceptance criteria

- [ ] Op validation rejects out-of-catalog Asset keys at the single-writer fold point
- [ ] Rejected op never reaches the Snapshot / World Model
- [ ] Valid keys fold normally; rejection is observable (logged/flagged)
- [ ] Tests: in-catalog key accepted, out-of-catalog key rejected and never durable

## Blocked by

- [#59](https://github.com/IamP5/fiap-gs-space-connect/issues/59)
