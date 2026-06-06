# [Epic] Natural-language Blueprint authoring (Architect extension)

- **Issue:** [#62](https://github.com/IamP5/fiap-gs-space-connect/issues/62)
- **Labels:** `area:backend`, `type:feature`
- **Type:** Epic (downstream — separate from the realism milestone #46)
- **ADR:** [0010 — live-mode curated Asset catalog](../01-build-harness/adr/0010-live-mode-curated-asset-catalog.md)
- **Builds on:** the [realistic-3d-world](../02-realistic-3d-world/README.md) milestone (Asset catalog #59–#61, vendored Assets #54–#57)

## What to build

**[EPIC]** Natural-language Blueprint authoring — an **Architect** extension where an operator states a goal in natural language and the system authors a **Blueprint** + **Build contracts** that compose procedural geometry + **Assets** (drawn from the Asset catalog by key, ADR-0010) + textures. Downstream of the realism milestone (#46) and the Asset-catalog work (#59–#61), which it builds on.

Stub to be broken into vertical slices later (NL goal → parse → DAG / ready set / Build envelopes → contracts referencing the Asset catalog → validation / safety / cost).

## Acceptance criteria

- [ ] Broken into vertical slices via `/to-issues` when scheduled
- [ ] Depends on a populated Asset catalog (#59–#61) and vendored Assets (#54–#57)

## Blocked by

- [#46](https://github.com/IamP5/fiap-gs-space-connect/issues/46) (realism milestone)
- [#59](https://github.com/IamP5/fiap-gs-space-connect/issues/59)
- [#60](https://github.com/IamP5/fiap-gs-space-connect/issues/60)
- [#61](https://github.com/IamP5/fiap-gs-space-connect/issues/61)
