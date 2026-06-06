# bh-08·B — Live build mode core: Rover runs the harness inline + rescoped archtest

> Type: HITL · GitHub [#33](https://github.com/IamP5/fiap-gs-space-connect/issues/33) ·
> [TECHSPEC](../TECHSPEC.md) §5, §7 · governed by
> [ADR-0009](../adr/0009-live-build-mode-runs-the-harness-on-the-work-path.md); scopes
> [ADR-0005](../adr/0005-llm-build-harness-augments-deterministic-swarm.md)

## What to build

Make a Rover **run its Build harness inline in its work phase** when in live mode — the
deliberate, scoped break of ADR-0005 (model on the build path, **live mode only**). Add
`agent.Config.Mode {replay | live}`: `replay` is byte-for-byte today's cache/primitive stream
(zero model call); `live` runs the Generator↔Evaluator loop via the Model seam and streams the
resulting ops on `build.op.<task>`.

First cut may emit a **single accepted spec** (place-only ops are fine here; per-iteration
self-correcting patch streaming is [08d](./08d-iteration-streaming.md)). The coordinator/agent
process wires the Model seam + API key (server-side only, never shipped to the browser).

**Rescope the import-graph archtest:** the self-heal core (allocation/auction, lease/heartbeat,
expiry, single-writer tick, World Model, Planner) must still **not** import
`internal/harness/model`; the Rover work phase (`internal/agent`, live mode) now may.

HITL: exercises the live model and needs a human to eyeball generated geometry; covered
deterministically in CI by a fake `Model`, with a real-key smoke run manually.

## Acceptance criteria

- [ ] `agent.Config.Mode {replay | live}`; replay path byte-for-byte today's behaviour (no model call)
- [ ] In live mode the Rover runs the harness loop via the Model seam during work, emits generated ops on `build.op.<task>`; the Task completes and dependents unblock
- [ ] Contract test with a fake `Model` (no network): harness validates/repairs and the Rover builds from generated ops; a forced-error `Model` never crashes the swarm
- [ ] Import-graph archtest **rescoped** and green: `harness/model` absent from the self-heal core; allowed in `internal/agent`
- [ ] API key read server-side only; never reaches the browser
- [ ] Real-key smoke: a live-mode Rover builds one Task end-to-end (manual); `make check` + web tests green

## Blocked by

None — can start immediately.
