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

The Evaluator emits a **layered verdict** ([ADR-0008](../adr/0008-lab-loop-observability-and-layered-evaluator.md)).
The **hard gate** runs every iteration and blocks: ops stay within the Task's **Build
envelope**, no collisions with neighbour tasks' accumulated ops, and the contract's
done-criteria are met. Alongside it, a **soft rubric** scores quality without blocking —
done-coverage / coherence (and silhouette once the vision pass lands, issue 06), each 0–2
with an evidence string. On exhaustion without passing the hard gate, accept the **primitive
fallback** and flag it for the operator. A spec that passes the hard gate is always cached;
if its soft score is below threshold the cache entry is flagged `quality_flag: low` rather
than withheld. Generation runs in **dependency order** so each worker sees a coherent world
(foundations before walls before the dome-cap).

Each bake writes a **trace** (`<spec-key>.trace.json`) beside the cached spec — contract,
per-iteration ops + verdict, and outcome — the inspectable artifact behind the (B)→(C)
topology decision.

Bake **all** demo Blueprints to the cache so the entire dome replays deterministically.

This slice ships topology **(B)**; specialized sub-agents **(C)** are deferred to slice 07,
gated on observed trace gaps.

## Acceptance criteria

- [ ] The Build harness runs a Generator sub-agent + an Evaluator sub-agent in a bounded refine loop (hard iteration cap)
- [ ] The **hard gate** (boolean, blocking) rejects out-of-envelope ops, neighbour collisions, and unmet done-criteria — with unit tests on each
- [ ] The Evaluator also emits a **soft rubric** (done-coverage, coherence; 0–2 + evidence) that scores quality without blocking; a hard-gate-passing but low-scoring spec is cached with `quality_flag: low`, not withheld
- [ ] Each bake writes a `<spec-key>.trace.json` (contract, per-iteration ops + verdict, outcome) beside the cached spec; the trace round-trips in a unit test
- [ ] Generation proceeds in dependency/topological order; a worker's snapshot includes neighbour ops within its envelope
- [ ] On loop exhaustion the Task takes the primitive fallback and is flagged; it still completes
- [ ] Every demo Blueprint is baked to cache; the full dome replays deterministically in the headline
- [ ] Operator can review the quality surface: which Tasks fell back **and** which were cached `quality_flag: low`

## Blocked by

- [03](./03-model-seam-and-bake-one-spec.md)
