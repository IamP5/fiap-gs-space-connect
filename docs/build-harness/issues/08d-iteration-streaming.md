# bh-08·D — Iteration-level streaming: world grows & self-corrects per refine pass

> Type: HITL · GitHub [#35](https://github.com/IamP5/fiap-gs-space-connect/issues/35) ·
> [TECHSPEC](../TECHSPEC.md) §5 · governed by
> [ADR-0009](../adr/0009-live-build-mode-runs-the-harness-on-the-work-path.md); upholds
> [ADR-0004](../../mvp/adr/0004-react-three-fiber-3d-built-2d-first.md)

## What to build

Make the live build **visibly grow and self-correct** in the world: the harness loop publishes
**each refine iteration's patches** on `build.op.<task>` as it produces them (not one final
blob), so the structure rises and a piece can move/recolour/vanish between passes as the
Generator↔Evaluator loop revises its own work (option B). Ops are paced by Choreography so a pass
never dumps in one tick.

This is where [08a](./08a-patch-op-build-spec.md) (patch-op fold) and
[08b](./08b-live-mode-core.md) (live loop) meet: iterations stream `place`/`move`/`delete`
patches that the renderer folds.

HITL: live model + human review of the self-correcting build.

## Acceptance criteria

- [ ] The live harness loop emits per refine iteration onto `build.op.<task>` (streamed), not a single terminal spec
- [ ] Iterations may emit `move`/`delete` patches; the world updates in place so a piece visibly moves/recolours/vanishes between passes
- [ ] Op stream paced by Choreography (no whole-iteration dump in one ~100ms tick)
- [ ] The durable Task spec stays an append-only patch log; the snapshot carries it and the renderer folds it (re-render stays pure, ADR-0004)
- [ ] Manual: place a live wall and watch it grow and self-correct across iterations; `make check` + web tests green

## Blocked by

- [08a](./08a-patch-op-build-spec.md) (#32)
- [08b](./08b-live-mode-core.md) (#33)
