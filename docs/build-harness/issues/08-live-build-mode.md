# Live build mode — the Rover runs the harness in the world (parent)

> Type: HITL (epic) · GitHub parent [#31](https://github.com/IamP5/fiap-gs-space-connect/issues/31) ·
> [TECHSPEC](../TECHSPEC.md) §5 · governed by
> [ADR-0009](../adr/0009-live-build-mode-runs-the-harness-on-the-work-path.md);
> upholds [ADR-0006](../adr/0006-build-spec-is-declarative-data-not-executed-code.md),
> [ADR-0004](../../mvp/adr/0004-react-three-fiber-3d-built-2d-first.md)
>
> **This is the parent overview.** It is broken into seven grabbable sub-slices (08a–08g);
> implement those, not this file. See the table under *Sub-slices* below.

## What to build

A per-placement **live Build mode** in which a Rover runs its Build harness *as it works* and
the structure rises — and visibly self-corrects — in the world step by step. The deterministic
**replay** headline stays the default and untouched; live is opt-in and the two coexist
side by side. This is the deliberate, scoped break of ADR-0005 the operator asked for.

End-to-end slice (harness → NATS → World Model → snapshot → renderer → screen):

- **Per-placement mode.** Extend the drag-to-place control: `placeBlueprint { ..., mode:
  "replay" | "live" }`. Tasks of a live-placed Blueprint are tagged `live`; the palette/ghost
  exposes the choice. Default stays `replay`.
- **Rover runs the harness inline.** `agent.Config.Mode {replay | live}`; in live mode the
  Rover imports the Model seam and runs the Generator↔Evaluator loop in its work phase. In
  replay mode the path is byte-for-byte today's cache/primitive stream (no model call).
- **Patch ops + folding.** Extend the Build-spec schema with `move` / `delete` ops and op
  identity; each refine iteration streams its revision as patches on `build.op.<task>`. The
  durable spec stays an append-only patch log; the renderer **folds** it into current geometry
  (`Scene3D` + `web/src/lib`). Place-only specs (the cache) fold to the same result — no re-bake.
- **Iteration-level streaming.** The world updates per accepted refine pass, so the operator
  watches the loop grow and correct the structure (not one final blob).
- **Failure heals live.** The harness loop **retries** failed/invalid calls; after a per-Rover
  threshold the Rover **dies** via the existing expiry → re-auction path. The replacement Rover
  loads the patch log, folds it, and **continues the live loop** from where it stopped. No
  primitive fallback on the normal path.
- **Circuit breaker.** A Task re-auctioned because its builder died more than ≈3 times is
  finished with the deterministic primitive op-source as a last resort, so dependents unblock
  and the dome still closes (bounds a systemic model outage).
- **Rescoped archtest.** Narrow the import-graph test: the self-heal core (allocation/auction,
  lease/heartbeat, expiry, single-writer tick, World Model, Planner) must still not import
  `harness/model`; only the Rover work phase may.

## Sub-slices (grabbable issues)

Vertical tracer bullets; parallelism maximised. `08a` and `08b` start immediately.

| Slice | Title | Type | Blocked by | GitHub |
|---|---|---|---|---|
| [08a](./08a-patch-op-build-spec.md) | Patch-op Build spec: place/move/delete + renderer fold (no LLM) | AFK | — | [#32](https://github.com/IamP5/fiap-gs-space-connect/issues/32) |
| [08b](./08b-live-mode-core.md) | Live mode core: Rover runs the harness inline + rescoped archtest | HITL | — | [#33](https://github.com/IamP5/fiap-gs-space-connect/issues/33) |
| [08c](./08c-per-placement-mode-toggle.md) | Per-placement replay/live toggle on drag-to-place | AFK | 08b | [#34](https://github.com/IamP5/fiap-gs-space-connect/issues/34) |
| [08d](./08d-iteration-streaming.md) | Iteration-level streaming: world grows & self-corrects | HITL | 08a, 08b | [#35](https://github.com/IamP5/fiap-gs-space-connect/issues/35) |
| [08e](./08e-resume-live-on-kill.md) | Resume-live on kill: replacement continues the live loop | HITL | 08a, 08b | [#36](https://github.com/IamP5/fiap-gs-space-connect/issues/36) |
| [08f](./08f-failure-heals.md) | Failure heals: retry → die past threshold → re-auction | AFK | 08b | [#37](https://github.com/IamP5/fiap-gs-space-connect/issues/37) |
| [08g](./08g-circuit-breaker.md) | Circuit breaker: primitive after ≈3 builder deaths | AFK | 08c, 08f | [#38](https://github.com/IamP5/fiap-gs-space-connect/issues/38) |

```
08a ───────────────┐
                   ├─ 08d, 08e   (need 08a + 08b)
08b ─┬─────────────┘
     ├─ 08c
     ├─ 08f ─┐
     └────── 08g   (needs 08c + 08f)
```

## Acceptance criteria (epic — satisfied when all sub-slices land)

- [ ] A Blueprint dropped in `live` mode builds with real model calls; a `replay` Blueprint in
      the same world is byte-for-byte today's deterministic headline
- [ ] The structure visibly grows **and self-corrects** across refine iterations (a piece can
      move/recolour/vanish between passes) via folded patch ops
- [ ] Killing a Rover mid-live-build returns the Task UNCLAIMED with its patch log intact; the
      replacement folds it and **continues live** from where it stopped
- [ ] A failing/stalling model call is retried; past the per-Rover threshold the Rover dies and
      self-heal reassigns — no primitive geometry appears on this path
- [ ] The circuit breaker finishes a Task with primitive geometry only after >≈3 builder deaths;
      dependents always unblock and the dome closes
- [ ] Rescoped archtest is green: `harness/model` absent from the self-heal core's import closure
- [ ] Replay mode with `build_spec` absent is pixel-identical to today; API keys server-side only

## Blocked by

- [05](./05-drag-to-place-and-architect.md) (drag-to-place control + palette)
- [07](./07-stretch-lab-mode-subagents-assets.md) (in-app live Generator↔Evaluator loop)
