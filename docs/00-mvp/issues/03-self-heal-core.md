# Self-heal core — heartbeat, lease expiry, re-auction

> Type: AFK · PRD stories: 7, 9, 10, 11, 13, 14, 15, 16, 25, 40 · [TECHSPEC](../TECHSPEC.md)

## What to build

The heart of the product, programmatically demonstrable (the interactive kill is the next slice). A working rover renews its lease via heartbeat. When heartbeats stop beyond the TTL, the Lease Manager expires the lease **exactly once** and releases the task to UNCLAIMED, which is re-announced for a fresh auction and picked up by another eligible rover that completes it — with no human intervention.

Two correctness guards that the swarm flagged as pitch-breaking if missed:

- A **single-writer tick goroutine** serialises award and expiry so they can never interleave (no double-assignment).
- `apply()` is guarded by a task `version` / Lamport stamp so a redelivered expiry or duplicate re-announce across at-least-once delivery cannot double-award.

This slice owns the **one integration test** over the full expiry → re-auction → reassignment handoff.

```
UNCLAIMED --award--> LEASED --heartbeat--> LEASED --complete--> DONE
                     LEASED --TTL expires | rover lost--> UNCLAIMED (re-auction)
```

## Acceptance criteria

- [ ] A rover renewing heartbeats keeps its lease (TTL resets); silence beyond the limit expires it
- [ ] Lease release is exactly-once (idempotent) even under duplicate/redelivered expiry events
- [ ] An expired task is re-announced and reassigned to another eligible rover that completes it
- [ ] The single-writer tick serialises award vs expiry; no task is ever assigned to two rovers on screen
- [ ] A rover reporting execution failure (lost capability) releases its task promptly for re-auction
- [ ] A task with no eligible rover stays UNCLAIMED and visible (pending)
- [ ] An integration test exercises expiry → re-auction → reassignment end-to-end; Lease unit tests use the injectable clock
- [ ] TTL is configured ≥ ~3× the heartbeat interval; auction/grant/expiry events are logged for audit

## Blocked by

- [02 — Rovers move and drain battery](./02-rovers-move-and-drain-battery.md)
