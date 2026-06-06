# Generator↔Evaluator loop + analytic gate; bake all blueprints

> Type: HITL (visual-quality judgment on generated structures) · Build sequence step 4 ·
> [TECHSPEC](../TECHSPEC.md) · respects
> [ADR-0005](../adr/0005-llm-build-harness-augments-deterministic-swarm.md) · see memory:
> build-harness-agent-topology (start at B, evolve to C)

## What to build

Turn the single generation into the agentic loop, still on the bake/lab path. Inside the
**Build harness**, split the work: a **Generator** sub-agent emits the Build spec ops; an
**Evaluator** sub-agent judges them. Run a **bounded refine loop** (1–3 iterations, hard
cap) — the Generator/Evaluator split is the quality lever (an agent grading its own work
praises it).

The Evaluator's **analytic gate** runs every iteration: ops stay within the Task's **Build
envelope**, no collisions with neighbour tasks' accumulated ops, and the contract's
done-criteria are met. On exhaustion without passing, accept the **primitive fallback** and
flag it for the operator. Generation runs in **dependency order** so each worker sees a
coherent world (foundations before walls before the dome-cap).

Bake **all** demo Blueprints to the cache so the entire dome replays deterministically.

This slice ships topology **(B)**; specialized sub-agents **(C)** are deferred to slice 07,
gated on observed trace gaps.

## Acceptance criteria

- [ ] The Build harness runs a Generator sub-agent + an Evaluator sub-agent in a bounded refine loop (hard iteration cap)
- [ ] The analytic gate rejects out-of-envelope ops, neighbour collisions, and unmet done-criteria — with unit tests on each
- [ ] Generation proceeds in dependency/topological order; a worker's snapshot includes neighbour ops within its envelope
- [ ] On loop exhaustion the Task takes the primitive fallback and is flagged; it still completes
- [ ] Every demo Blueprint is baked to cache; the full dome replays deterministically in the headline
- [ ] Operator can review which Tasks fell back vs. generated

## Blocked by

- [03](./03-model-seam-and-bake-one-spec.md)
