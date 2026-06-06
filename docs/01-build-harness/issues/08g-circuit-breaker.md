# bh-08·G — Circuit breaker: primitive op-source finishes a Task after ≈3 builder deaths

> Type: AFK · GitHub [#38](https://github.com/IamP5/fiap-gs-space-connect/issues/38) ·
> [TECHSPEC](../TECHSPEC.md) §5, §8 · governed by
> [ADR-0009](../adr/0009-live-build-mode-runs-the-harness-on-the-work-path.md)

## What to build

Bound a **systemic** live-mode failure (bad key, provider outage, rate-limit) that would
otherwise cascade — every Rover retrying, dying, and depleting the swarm while a Task never
completes and its dependents stay stuck forever. The coordinator tracks, per Task, how many times
it has been re-auctioned **because its builder died** (the [08f](./08f-failure-heals.md) death
path). When that count crosses a threshold (≈3), the Task is finished with the deterministic
**primitive op-source** as a last resort, so dependents unblock and the dome still closes.

Primitive is the swarm's **final safety net** in live mode — never its normal path. The
re-auction-death count is a concrete, inspectable signal.

Fully testable deterministically with a fake `Model` that always fails.

## Acceptance criteria

- [ ] The coordinator counts, per Task, re-auctions caused by a builder death (distinct from ordinary expiry/kill)
- [ ] After the threshold (≈3, configurable) the Task is completed via the primitive op-source and flips DONE; dependents unblock
- [ ] Below the threshold, behaviour is [08f](./08f-failure-heals.md)'s retry → die → resume-live (no primitive)
- [ ] Integration test: a fake always-failing `Model` causes 3 builder deaths, then the breaker finishes the Task with primitive geometry and the dome closes
- [ ] `make check` green; replay mode and normal (non-systemic) self-heal unaffected

## Blocked by

- [08c](./08c-per-placement-mode-toggle.md) (#34)
- [08f](./08f-failure-heals.md) (#37)
