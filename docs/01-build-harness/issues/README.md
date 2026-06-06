# Build Harness — Issues

Vertical tracer-bullet slices of the [TECHSPEC](../TECHSPEC.md). Each cuts end-to-end
(harness → NATS → World Model → snapshot → renderer → screen) and is demoable on its own.
Build the spine in order; the drag-to-place branch parallelises.

```
1 ─ 2 ─ 3 ─ 4 ─ 6 ─ 7 ─ 8     (critical spine)
        └─ 5 ───────────┘     (drag-to-place — parallel branch off 2, rejoins at 8)
```

| # | Slice | Type | Blocked by |
|---|---|---|---|
| [01](./01-build-spec-seam-and-renderer-fallback.md) | Build-spec seam + renderer interpreter + fallback (no LLM) | AFK | — |
| [02](./02-streamed-durable-resumable-ops.md) | Streamed, durable, resumable build ops (no LLM) | AFK | 01 |
| [03](./03-model-seam-and-bake-one-spec.md) | Model seam + one provider; bake one spec | HITL | 02 |
| [04](./04-generator-evaluator-loop-and-bake-all.md) | Generator↔Evaluator loop + analytic gate; bake all | HITL | 03 |
| [05](./05-drag-to-place-and-architect.md) | Drag-to-place + Architect contracts + palette | AFK | 02 |
| [06](./06-vision-evaluator-and-provider-swap.md) | Vision evaluator pass + provider-swap proof | HITL | 04 |
| [07](./07-stretch-lab-mode-subagents-assets.md) | Stretch — live lab mode, sub-agents (C), glTF + textures | HITL | 06 |
| [08](./08-live-build-mode.md) | **Live build mode** (epic — the Rover runs the harness in the world) | HITL | 05, 07 |

### 08 — Live build mode sub-slices

Epic [08](./08-live-build-mode.md) ([ADR-0009](../adr/0009-live-build-mode-runs-the-harness-on-the-work-path.md))
is decomposed into seven grabbable tracer bullets; GitHub parent
[#31](https://github.com/IamP5/fiap-gs-space-connect/issues/31). `08a` + `08b` start immediately.

| # | Slice | Type | Blocked by | GitHub |
|---|---|---|---|---|
| [08a](./08a-patch-op-build-spec.md) | Patch-op Build spec: place/move/delete + renderer fold (no LLM) | AFK | — | [#32](https://github.com/IamP5/fiap-gs-space-connect/issues/32) |
| [08b](./08b-live-mode-core.md) | Live mode core: Rover runs the harness inline + rescoped archtest | HITL | — | [#33](https://github.com/IamP5/fiap-gs-space-connect/issues/33) |
| [08c](./08c-per-placement-mode-toggle.md) | Per-placement replay/live toggle on drag-to-place | AFK | 08b | [#34](https://github.com/IamP5/fiap-gs-space-connect/issues/34) |
| [08d](./08d-iteration-streaming.md) | Iteration-level streaming: world grows & self-corrects | HITL | 08a, 08b | [#35](https://github.com/IamP5/fiap-gs-space-connect/issues/35) |
| [08e](./08e-resume-live-on-kill.md) | Resume-live on kill: replacement continues the live loop | HITL | 08a, 08b | [#36](https://github.com/IamP5/fiap-gs-space-connect/issues/36) |
| [08f](./08f-failure-heals.md) | Failure heals: retry → die past threshold → re-auction | AFK | 08b | [#37](https://github.com/IamP5/fiap-gs-space-connect/issues/37) |
| [08g](./08g-circuit-breaker.md) | Circuit breaker: primitive after ≈3 builder deaths | AFK | 08c, 08f | [#38](https://github.com/IamP5/fiap-gs-space-connect/issues/38) |

> No issue tracker is configured for this project; these files are the issue backlog.
> Decisions they must respect: [ADR-0005..0009](../adr/) and [ADR-0001..0004](../../00-mvp/adr/).
> Domain vocabulary (load-bearing): [CONTEXT.md](../../../CONTEXT.md).
>
> **The invariant slices 01–07 protect:** no harness call sits on the path of an award, a
> lease renewal, or an expiry; the worst failure is "looks like today," never "demo breaks."
> **Slice 08 (live mode) deliberately scopes this** ([ADR-0009](../adr/0009-live-build-mode-runs-the-harness-on-the-work-path.md)):
> the model may run on the *build* phase in live mode, but the **self-heal core** (allocation,
> lease, expiry, tick, World Model, Planner) stays model-free, and the **replay** default keeps
> every guarantee above.
