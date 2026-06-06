# Streamed, durable, resumable build ops

> Type: AFK · Build sequence step 2 · [TECHSPEC](../TECHSPEC.md) · respects
> [ADR-0007](../adr/0007-hybrid-generation-with-durable-resumable-build-specs.md),
> [ADR-0005](../adr/0005-llm-build-harness-augments-deterministic-swarm.md)

## What to build

Make the structure rise **op-by-op** as a Rover works, and survive a kill — still **no LLM**.
A working Rover emits build ops incrementally on `build.op.<task_id>`; the coordinator
**appends** each op to the Task's durable Build spec; the accumulation rides the ~10 Hz
snapshot so the renderer shows the structure growing. The Rover's fixed "work" timer becomes
"emit ops until the contract's done-criteria are met" (a hardcoded op stream stands in for
the LLM here). Op emission is paced by the Choreography module so ops rise at watchable speed
(no 50-op dump in one tick).

The headline behaviour: when a Rover is **killed mid-build**, its Task returns to UNCLAIMED
**with the accumulated Build spec intact**; the replacement Rover **resumes appending** from
the partial structure against the same Task. The wall keeps rising where it stopped — it is
never regenerated from scratch.

## Acceptance criteria

- [ ] A Rover emits ops on `build.op.<task_id>`; the coordinator appends them to the Task's Build spec, mirrored to NATS KV
- [ ] Accumulated ops ride the snapshot; the renderer shows the structure growing op-by-op
- [ ] Op pacing flows through Choreography (derived from real emission, never fabricated)
- [ ] Killing a Rover mid-build returns the Task to UNCLAIMED **without losing accumulated ops**; the replacement resumes appending
- [ ] One integration test: a Rover with a partial Build spec is killed; the replacement resumes; the final op-set equals the uninterrupted op-set (convergence)
- [ ] With ops forced empty, Task completion + self-heal are byte-for-byte the pre-harness behaviour (best-effort invariant test)

## Blocked by

- [01](./01-build-spec-seam-and-renderer-fallback.md)
