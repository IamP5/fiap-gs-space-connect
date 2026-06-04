# The live World Model has a single authoritative writer; the CRDT is a tested module, not the running multi-master state

**Status:** accepted

For the live demo the coordinator is the single writer of the World Model. The conflict-free merge (CRDT) is built and property-tested as a deep module, but the running headline demo does not exercise multi-master reconciliation.

## Context

The PRD sells partition tolerance hard (concurrent claims resolving deterministically, order-independent merge). But the headline self-heal — lease expiry + re-auction — needs *no* merge at all: with one writer there are no concurrent claims to reconcile. Building full multi-master replication just to run the kill-and-heal demo would be weeks of fragile ceremony the audience never sees, and a botched live reconciliation reads as a bug right after a clean heal.

## Decision

- Live path: single authoritative writer (the coordinator), mirrored to NATS KV.
- The CRDT merge (LWW-element semantics over the task record, commutative + idempotent, deterministic concurrent-claim tiebreak by lower rover id) is implemented as a pure deep module and **property-tested** per PRD stories 18–22.
- The partition-tolerance claim is answered to a skeptical evaluator with the green convergence/idempotency tests, **pre-scripted**, not improvised live. A live partition toggle is built only if budget remains after the core, choreography, and frontend are solid — and never runs before the headline heal has landed.

## Considered options

- **Full multi-master CRDT in the live path** — rejected: unneeded for the acceptance criterion, weeks of cost, and visually indistinguishable from a glitch when it reconciles on stage.
- **Strong consensus (Raft) for shared state** — rejected per PRD: quorum breaks exactly when half the swarm is partitioned behind a crater, which is the scenario the product exists to survive.

## Consequences

- The headline proves **auto-heal** (lease + re-auction), not partition tolerance. That gap is honest and defensible *because it is pre-scripted*; the merge is real and proven, just in the test suite and the production/spin-off narrative rather than in pixels.
