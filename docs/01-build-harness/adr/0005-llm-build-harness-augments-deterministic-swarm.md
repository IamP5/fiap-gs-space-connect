# The LLM build harness augments, never replaces, the deterministic swarm

**Status:** accepted

We are adding an LLM agent layer that lets Rovers generate the actual geometry they build.
It is layered strictly on the **output** side of a Task. The Auction, Lease, World Model,
and self-heal stay deterministic and untouched; the LLM never decides allocation, ordering,
or timing. The harness is **best-effort** and the deterministic core never blocks on it.

## Context

The entire product thesis is `self-heal = expiry + re-auction`, provable in a ~30-second
deterministic money shot (PRD; [ADR-0001](../../00-mvp/adr/0001-in-process-rovers-with-container-encore.md),
[ADR-0003](../../00-mvp/adr/0003-single-writer-live-path-crdt-as-tested-module.md)). The new
ask — "agents that really *work and create* things" — could be read as putting an LLM in
the allocation loop (a leader that plans and *delegates*). That reading collides head-on
with the codebase: there is no delegation, there is an **Auction** where Rovers *bid* and
the lowest cost wins. Putting a slow, non-deterministic, failure-prone model on the critical
path would trade a sub-second reproducible heal for an unreliable one and force a rewrite of
the load-bearing domain language.

## Decision

- The LLM layer produces *what a completed Task looks like* (a **Build spec**), not *who
  builds it or when*. Allocation remains the deterministic Auction; "delegate" is rejected
  from the vocabulary (CONTEXT.md).
- The harness is **best-effort**. A failed/timed-out/invalid generation degrades the Task to
  its **default primitive geometry** (today's `tierOf`: foundation→box, wall→box,
  dome→sphere). The Task still flips DONE so dependents unblock; the Auction, Lease, and
  self-heal proceed exactly as today. The worst case is "looks like today," never "demo
  breaks."
- Roles map onto the Anthropic harness pattern: **Architect** = Planner (Blueprint → Build
  contracts), **Build harness** = Generator + Evaluator per Rover. None of them allocate
  work.

## Considered options

- **Replace the auction with LLM decision-making** (a leader that assigns) — rejected: kills
  the deterministic money shot, discards the proven deep modules, and contradicts the entire
  CONTEXT.md vocabulary.
- **A separate "AI build" demo bolted alongside** — rejected as the primary: it forfeits the
  chance to make self-heal *more* impressive (a killed builder's half-finished wall resumed
  by its replacement) and splits the product into two stories.

## Consequences

- The self-heal pitch is strengthened, not threatened: the LLM is additive muscle on a
  skeleton that already works without it.
- There is now a hard invariant to protect: **no Model-seam call may sit on the path of an
  award, a lease renewal, or an expiry.** Generation is async and its result is optional Task
  state. This is enforced **mechanically**, not just by review: a Go import-graph test asserts
  that `internal/harness/model` is not in the import closure of the hot-path packages
  (allocation/auction, lease/heartbeat, expiry, single-writer tick), so a model call wired
  into the hot loop fails CI. The coordinator may still touch the harness to **append
  pre-computed ops** to a Task's spec — that is data movement, not a Model-seam call.
- The current hard-coded renderer geometry is promoted to a load-bearing **fallback**, so it
  must stay correct, not be deleted when the harness lands.
