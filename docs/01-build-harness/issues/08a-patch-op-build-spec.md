# bh-08·A — Patch-op Build spec: place/move/delete + renderer fold (no LLM)

> Type: AFK · GitHub [#32](https://github.com/IamP5/fiap-gs-space-connect/issues/32) ·
> [TECHSPEC](../TECHSPEC.md) §4 · governed by
> [ADR-0009](../adr/0009-live-build-mode-runs-the-harness-on-the-work-path.md); upholds
> [ADR-0006](../adr/0006-build-spec-is-declarative-data-not-executed-code.md),
> [ADR-0004](../../00-mvp/adr/0004-react-three-fiber-3d-built-2d-first.md)

## What to build

Extend the Build spec from a place-only list into an **append-only patch log** the renderer
**folds** into current geometry — the foundation that lets a later refine pass *revise* earlier
work. **No LLM in this slice.**

A build operation gains an `op` of `place` | `move` | `delete` and a stable `id`; `move`/`delete`
target an earlier `place` by id. Folding the log (apply in order) yields the Task's current
geometry. Server-side validation runs against the **folded result** (envelope bounds, no
collisions), not per-op. The renderer folds the same way and draws the result. A place-only spec
(today's cache + primitive stream) is a degenerate patch log that folds to itself, so existing
replay and the committed cache render **pixel-identically** with no re-bake.

Cuts end-to-end: wire schema (Go + TS) → validation → renderer, proven with a hardcoded patch spec.

## Acceptance criteria

- [ ] `wire.BuildOp` (Go) and `wire.ts` (TS) carry `op: "place"|"move"|"delete"` and a stable `id`; round-trips Go↔TS
- [ ] Server-side validation folds the log and validates the folded result (over-envelope / colliding / `move`/`delete` of an unknown id rejected)
- [ ] `Scene3D` + `web/src/lib` fold `place`/`move`/`delete` into rendered geometry (hardcoded spec: place 3, move 1, delete 1 → correct final result)
- [ ] A place-only spec (existing cache + primitive stream) folds to itself and renders pixel-identically to today — no re-bake, no regression
- [ ] Go (`go test -race ./...`) + web (`vitest`) cover fold + validation; `make check` green

## Blocked by

None — can start immediately.
