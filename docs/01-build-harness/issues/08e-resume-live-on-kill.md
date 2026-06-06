# bh-08·E — Resume-live on kill: replacement folds the patch log and continues the live loop

> Type: HITL · GitHub [#36](https://github.com/IamP5/fiap-gs-space-connect/issues/36) ·
> [TECHSPEC](../TECHSPEC.md) §5 · governed by
> [ADR-0009](../adr/0009-live-build-mode-runs-the-harness-on-the-work-path.md); upholds
> [ADR-0007](../adr/0007-hybrid-generation-with-durable-resumable-build-specs.md)

## What to build

Make resume-on-kill **live**: when a Rover is killed mid-live-build, its Task returns to
UNCLAIMED with the **durable patch log intact**; the replacement Rover wins it, **folds the patch
log to the current geometry, and continues the live harness loop** from where it stopped —
genuinely picking up the half-built wall and thinking onward. Reuses the existing kill → expiry →
re-auction machinery; the patch log is the durable partial state.

This is the signature self-heal beat, now with live AI. Composes with
[08d](./08d-iteration-streaming.md)'s iteration streaming.

HITL: live model + human review of the resumed build.

## Acceptance criteria

- [ ] Killing a Rover mid-live-build returns the Task UNCLAIMED with its patch log intact (never discarded/restarted)
- [ ] The replacement Rover folds the patch log and **continues the live loop** against the same Build contract — no restart from scratch
- [ ] The final structure is coherent (resumed work composes with the partial); dependents unblock on completion
- [ ] Integration test: a live Rover with a partial patch log is killed; a replacement resumes live and the Task completes
- [ ] Manual: kill a live builder on the laptop; another robot's AI continues the half-built wall; `make check` green

## Blocked by

- [08a](./08a-patch-op-build-spec.md) (#32)
- [08b](./08b-live-mode-core.md) (#33)
