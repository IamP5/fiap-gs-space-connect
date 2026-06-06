# Lab-loop observability: a trace sidecar and a layered (hard-gate + soft-rubric) Evaluator

**Status:** accepted

The generation / "lab" path writes a **durable trace** beside every baked Build spec, and
the Evaluator emits a **two-layer verdict**: a *hard gate* (boolean, blocking — the safety
invariants) plus a *soft rubric* (0–2 scores with cited evidence — quality only). A spec that
passes the hard gate is always cacheable; a low soft score never blocks the bake — it is
**flagged** in the trace and surfaced in the operator review. The accumulated low-quality
flags *are* the "observed trace gaps" that gate the move to specialized sub-agents (topology
**C**).

## Context

[ADR-0007](./0007-hybrid-generation-with-durable-resumable-build-specs.md) puts the agentic
depth in the lab/bake path and freezes approved specs to cache. The TECHSPEC then makes two
forward-looking promises it never gave a mechanism for:

- Topology evolves from **(B)** Generator+Evaluator to **(C)** specialized sub-agents
  *"when traces show 'passes analytic, looks wrong'"* (TECHSPEC §10) / *"gated on observed
  trace gaps"* (issue 04) — but no **trace** was ever defined, so the trigger pointed at
  nothing.
- The Evaluator's verdict was a single boolean (envelope + collision + done-criteria). A
  boolean cannot express *"this is structurally valid but reads as low quality on stage,"*
  which is precisely the signal the (B)→(C) decision needs.

This mirrors the harness-engineering lesson that observability must live **inside** the
harness — a scored rubric with cited evidence and a per-task trace, not a self-graded
pass/fail (Learn Harness Engineering, Lecture 11). It is a lab-only concern: the headline
replays frozen specs and must stay free of any of this ([ADR-0005](./0005-llm-build-harness-augments-deterministic-swarm.md)).

## Decision

- **Trace sidecar.** Each bake writes `<spec-key>.trace.json` next to the cached spec. It
  records the Build contract, every Generator iteration (ops emitted/changed), every
  Evaluator verdict, and the final outcome (`accepted` | `fallback`, a `quality_flag` of
  `ok` | `low`, and a human-readable reason). It is **declarative data, never executed**
  (consistent with [ADR-0006](./0006-build-spec-is-declarative-data-not-executed-code.md)),
  and it lives with the cache — not in an external tracing backend.
- **Layered Evaluator verdict.**
  - *Hard gate* (unchanged, blocking, every iteration): ops within the **Build envelope**,
    no collisions with neighbours' accumulated ops, contract done-criteria met. These are
    **safety invariants and stay boolean** — they are never averaged into a score.
  - *Soft rubric* (new, advisory): quality dimensions — done-coverage %, silhouette/visual
    match (from the vision pass), structural coherence — each scored **0–2 with an evidence
    string**. The soft rubric gates nothing on its own.
- **Advisory flag, never blocks.** A spec that passes the hard gate is always frozen to
  cache. If its soft score is below a configurable threshold the trace outcome is marked
  `quality_flag: low` and the **operator review** lists it alongside fell-back Tasks. The
  operator decides whether to regenerate or accept. The bake never stalls on quality.
- **The trigger is now real.** The set of `quality_flag: low` specs over a bake run is the
  inspectable "observed trace gaps" population. Topology **(C)** is justified when that set
  is non-trivial and concentrated (specs that pass the hard gate yet score low on
  silhouette/coherence) — not before.

## Considered options

- **Full OpenTelemetry tracing** (span per Task, sub-spans per iteration, exported to
  Jaeger/Zipkin) — rejected as the mechanism: it is the gold standard for a long-running
  agent service, but heavy infra for an off-critical-path bake step in a demo product. The
  sidecar gives the same inspectability for the (B)→(C) decision with no backend.
- **Structured stdout logs, no durable artifact** — rejected: "trace gaps" stays a vibe; you
  cannot go back and inspect why a frozen spec looked wrong, so the (B)→(C) trigger stays
  subjective.
- **Score everything 0–2, including envelope/collision** — rejected: a colliding or
  out-of-envelope spec could score "mostly fine" and slip through. Safety invariants must
  stay boolean and blocking, never blended into a quality average.
- **Hard freeze gate on the soft score** (refuse to cache below threshold) — rejected as the
  default: it can stall the bake and pushes borderline Tasks to primitive geometry (fewer
  rich structures on stage), which fights the best-effort philosophy of ADR-0005. The flag +
  operator decision keeps quality visible without starving the headline.

## Consequences

- The Evaluator verdict is now a small structured object (hard gate + scored rubric +
  evidence), not a boolean — a new internal contract the trace schema depends on.
- The trace schema joins the cache as a durable artifact; it has no consumer on the headline
  path and so carries none of the money-shot risk.
- The operator review (issue 04) widens from "which Tasks fell back" to "fell back ∪
  low-quality," giving a single quality surface over a baked Blueprint.
- The (B)→(C) decision in TECHSPEC §10 and issue 07 now reads off a concrete population
  rather than a hunch.
- The vision pass (issue 06) becomes the source of the `silhouette` rubric dimension, so the
  two slices are now explicitly coupled through the rubric.
