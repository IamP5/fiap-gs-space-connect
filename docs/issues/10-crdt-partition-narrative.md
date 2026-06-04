# CRDT partition narrative — property tests + optional live toggle

> Type: HITL (stretch) · PRD stories: 18, 19, 20, 21, 22 · [TECHSPEC](../TECHSPEC.md) · [ADR-0003](../adr/0003-single-writer-live-path-crdt-as-tested-module.md)

## What to build

The partition-tolerance story, which the live path deliberately does not exercise (it is single-writer). Property tests prove the World Model merge is commutative, idempotent, and resolves concurrent claims on the same task deterministically (lower `robot_id`) — pre-scripted as the green, runnable answer to a skeptical distributed-systems evaluator. Optionally, a live partition toggle splits two rovers onto stale local state and reconciles on reconnect, with explicit state labels — built only if the spine, choreography, and 3D are solid, and never run before the headline heal has landed.

## Acceptance criteria

- [ ] Property tests: the same operation set applied in any order yields identical state; merge is commutative and idempotent
- [ ] Concurrent claims on the same task resolve deterministically to the lower `robot_id`
- [ ] The tests run as a clean, green, pre-scripted reveal
- [ ] (Optional) A partition toggle visibly splits and reconciles two views with explicit PARTITIONED / RECONCILING / CONVERGED labels
- [ ] If built, the toggle never runs before the headline heal

## Blocked by

- [05 — Habitat dome blueprint](./05-habitat-dome-blueprint.md)
