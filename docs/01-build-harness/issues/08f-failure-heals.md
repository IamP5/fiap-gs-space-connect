# bh-08·F — Failure heals: harness retries → Rover dies past threshold → re-auction

> Type: AFK · GitHub [#37](https://github.com/IamP5/fiap-gs-space-connect/issues/37) ·
> [TECHSPEC](../TECHSPEC.md) §5, §8 · governed by
> [ADR-0009](../adr/0009-live-build-mode-runs-the-harness-on-the-work-path.md); upholds
> [ADR-0005](../adr/0005-llm-build-harness-augments-deterministic-swarm.md)

## What to build

Route live-mode model failure **through self-heal** rather than around it: the harness loop
**retries** a failed/invalid/timed-out model call; after a per-Rover threshold of failures the
Rover **dies** — it releases its lease / stops heartbeating, so the existing expiry → re-auction
path reassigns the Task to another Rover. An LLM that won't cooperate becomes just another dead
robot. **No primitive fallback on this path** (that is the circuit-breaker last resort,
[08g](./08g-circuit-breaker.md)).

Fully testable deterministically with a fake `Model` forced to fail.

## Acceptance criteria

- [ ] The harness loop retries a failed/invalid/timed-out model call (bounded retry per call)
- [ ] After a configurable per-Rover failure threshold the Rover dies via the existing lease-release / expiry path (no special supervisory logic)
- [ ] The dead Rover's Task re-auctions and a replacement picks it up (self-heal unchanged); no primitive geometry on this path
- [ ] Integration test with a fake failing `Model`: retries occur, the Rover dies past threshold, the Task re-auctions
- [ ] `make check` green; replay mode unaffected

## Blocked by

- [08b](./08b-live-mode-core.md) (#33)
