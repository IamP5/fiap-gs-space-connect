# Live build mode runs the harness on the work path

**Status:** accepted

A new, opt-in **live Build mode** lets a Rover run its Build harness (a live model call)
*during its work phase*, generating geometry and visibly self-correcting it in the world step
by step. This **deliberately breaks [ADR-0005](./0005-llm-build-harness-augments-deterministic-swarm.md)'s
runtime invariant** (no model call on the build/award path) — **in live mode only**. The
deterministic **replay** headline is untouched and stays the default; the two modes coexist
and can run side by side. Live mode is chosen **per Blueprint placement**.

## Context

The shipped harness is built around one sacred rule (ADR-0005, ADR-0007): the live model
never touches the headline; the headline only *replays* frozen, pre-baked Build specs, and
the live Generator↔Evaluator loop lives off to the side in the lab path, streaming to a
**console that never touches the world Snapshot**. That makes the ~30s money shot bulletproof.

But it also means the product's headline capability — *watch a robot actually think and build*
— is never visible **in the world**. The operator asked for exactly that: a Rover that behaves
"as real as possible," running the LLM harness as it works, with the structure rising and
correcting part by part by the robot's own labour. That is genuinely live generation on the
build path — the one thing the original two-path design forbids.

The resolution is not to abandon the invariant but to **scope it**. The deterministic replay
path keeps every guarantee it has today. Live mode is a separate, explicitly-chosen mode that
accepts the model on the work path as the whole point, and routes the model's unreliability
**through the existing self-heal machinery** rather than around it.

## Decision

- **Two Build modes, chosen per placement.** `placeBlueprint` carries a `mode` of `replay`
  (default, deterministic cache — ADR-0007) or `live`. The placed Blueprint's Tasks are tagged
  with it; a Rover winning a tagged Task builds accordingly (`agent.Config.Mode`). A `replay`
  dome and a `live` dome can stand in the same world at once.
- **The Rover runs the harness inline.** In live mode `internal/agent` imports the Model seam
  (`internal/harness/model`) and runs the Generator↔Evaluator loop in its work phase. This is
  the deliberate, scoped break of ADR-0005's runtime rule.
- **The hot-path invariant is rescoped, not dropped.** The import-graph architecture test
  (ADR-0005, TECHSPEC §7) is narrowed: the **self-heal core** — allocation/auction,
  lease/heartbeat, expiry, the single-writer tick, World Model, Planner — must still **never**
  import `harness/model`. Only the Rover's work phase may. So "self-heal never depends on the
  LLM" survives mechanically; only *building* now may.
- **Iterations self-correct via patch ops; the log stays append-only.** Each refine pass
  streams its result as build operations that may `place`, `move`, or `delete` an earlier op
  (op identity makes a revision addressable). The durable Build spec remains an **append-only
  log of patches** the renderer **folds** into current geometry (ADR-0006 upheld: still
  declarative data, never executed; ADR-0004 upheld: still a pure re-render). The deterministic
  replay cache stays place-only — a degenerate patch log — and needs no re-bake.
- **Failure heals, it does not fall back.** The harness loop **retries** a failed/invalid model
  call. After a per-Rover threshold of failures the Rover **dies** — through the existing
  expiry → re-auction path, like any other dead robot. The replacement Rover **loads the
  durable patch log, folds it, and continues the live loop** from where it stopped. There is no
  primitive fallback on the normal path: the swarm heals by *reassignment*.
- **A circuit breaker protects the money shot.** To bound a *systemic* failure (bad key,
  provider outage) that would otherwise cascade — every Rover retrying, dying, and depleting the
  swarm while the Task never completes — a Task re-auctioned because its builder died more than a
  threshold number of times (≈3) is finished with the deterministic **primitive op-source** as a
  last resort, so dependents unblock and the dome still closes. Primitive is the swarm's *final*
  safety net in live mode, never its normal path.

## Considered options

- **Keep live strictly off the headline (status quo)** — rejected: it is the explicit thing the
  operator does *not* want; the "watch it think *in the world*" capability is the feature.
- **Live-bake-then-replay** (generate fully off-path, then replay the frozen spec into the
  world) — rejected: the model call finishes before anything is visible, so the world replays a
  pre-computed result; it is not the robot building live, just a faster bake. It remains
  available as the deterministic path; it is not what live mode is for.
- **Gateway runs the harness, streams ops over NATS to a puppet Rover** — rejected: keeps the
  archtest fully green and the key out of the coordinator, but the geometry originates in the
  gateway, so "the robot runs the harness" is a fiction. The operator wanted the Rover itself to
  build.
- **Primitive fallback as the normal failure path** — rejected by the operator: it degrades a
  live wall to dumb blocks on the first hiccup, which reads worse than self-heal and undercuts
  the live story. Retry-then-die-then-resume keeps every recovery *live*; primitive is demoted
  to the circuit-breaker last resort only.
- **Append-only place-only ops (no revision)** — rejected: a refine pass could then only pile
  more geometry on, never fix a misplaced piece, so the visible self-correction that motivates
  iteration-level streaming would be impossible. Patch ops preserve append-only durability while
  allowing genuine revision.

## Consequences

- **ADR-0005 is amended in scope:** its runtime "no model on the build path" rule now holds for
  **replay mode and the self-heal core**, not for the live work phase. The *structural* guard
  (self-heal core is model-free) is kept and re-asserted by the rescoped archtest.
- **ADR-0007 gains a third timing:** alongside "headline replays cache" and "lab generates
  off-path," there is now "live generation *on* the build path," selected per placement. Durable
  + resumable specs (its core promise) are reused verbatim — the patch log *is* the durable
  partial state, and resume-on-kill now continues *live*.
- **ADR-0006 is extended, not broken:** Build ops gain `move`/`delete` kinds and op identity, but
  remain declarative data the renderer folds and interprets — never executed code.
- **The agent package now imports the Model seam** (live path only) and the coordinator/agent
  process needs the API key in live runs; the key is still never shipped to the browser.
- **The self-heal demo gets stronger, not riskier:** killing a Rover whose AI is actively
  designing a wall, and watching another Rover's AI fold the half-built patch log and *keep
  thinking*, is a sharper beat than the deterministic kill — while the replay dome remains the
  bulletproof fallback if live is stalling on stage.
- **A new failure surface exists** (systemic model outage) bounded by the circuit breaker; its
  re-auction-death count is a concrete, inspectable signal, like ADR-0008's `quality_flag` set.
