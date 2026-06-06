# Build Harness — Issues

Vertical tracer-bullet slices of the [TECHSPEC](../TECHSPEC.md). Each cuts end-to-end
(harness → NATS → World Model → snapshot → renderer → screen) and is demoable on its own.
Build the spine in order; the drag-to-place branch parallelises.

```
1 ─ 2 ─ 3 ─ 4 ─ 6 ─ 7        (critical spine)
        └─ 5                  (drag-to-place — parallel branch off 2)
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

> No issue tracker is configured for this project; these files are the issue backlog.
> Decisions they must respect: [ADR-0005..0007](../adr/) and [ADR-0001..0004](../../mvp/adr/).
> Domain vocabulary (load-bearing): [CONTEXT.md](../../../CONTEXT.md).
>
> **The invariant every slice protects:** no harness call sits on the path of an award, a
> lease renewal, or an expiry; the worst failure is "looks like today," never "demo breaks."
