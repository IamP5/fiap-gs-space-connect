# Hybrid generation timing, with durable and resumable Build specs

**Status:** accepted

The headline self-heal demo **replays cached, evaluator-approved Build specs**
deterministically. Genuinely-live generation lives in a separate "lab" path. A Task's Build
spec is **durable** and accumulates **op-by-op**, so a Rover killed mid-build leaves a
partial structure its replacement **resumes** — it is never regenerated from scratch.

## Context

The vision is live, visible, incremental construction ("build multiple objects until the
task is done"). But a live LLM call is slow (seconds), non-deterministic, and can fail —
the polar opposite of a ~30-second deterministic money shot demoed live on a Mac, where
every moving part is a stage risk (TECHSPEC §2). The Anthropic harness loop is "5–15
iterations over multi-hour sessions," which cannot touch the headline. Separately, the
self-heal beat now involves a *half-built* structure: what happens to it on kill is a real
choice that either reinforces or muddies the pitch.

## Decision

- **Two paths.** The agentic depth (Generator↔Evaluator refine loop, sprint/Build contracts,
  fresh-agent-per-Task handoffs) runs in **generation / "lab" mode**, where slowness and
  iteration are free, and freezes an approved spec to cache. The **headline replays** that
  frozen spec — bulletproof and reproducible. The model's unreliability never reaches the
  money shot.
- **Streamed, durable, append-only specs.** Build ops accumulate on the Task (just as the
  World Model accumulates state today) and ride the ~10 Hz snapshot, so the structure rises
  op-by-op. The accumulated ops *are* the durable partial state.
- **Resume on kill.** When a Rover is killed mid-build, the Task returns to UNCLAIMED with
  its partial Build spec intact; the replacement Rover continues appending from there against
  the same Build contract. This is the Anthropic "state lives in durable artifacts so a
  re-spawned worker resumes" principle applied verbatim — and it makes the self-heal beat
  *stronger*: "we killed the builder and another finished its half-laid wall."
- **Cache key** = `{blueprintId, taskId, contract-hash, model}`. Hit → replay (headline);
  miss → fallback primitive (headline) or live generation (lab).

## Considered options

- **Fully live generation in the headline** — rejected: makes the money shot depend on N
  LLM calls not timing out or drifting; a single stall reads as a broken demo.
- **Pre-generated only, no live path** — rejected: forfeits the genuine "watch it think"
  capability the feature is partly for; kept as the *bake* step, not the *only* step.
- **Discard the partial spec on kill and regenerate** — rejected: the structure visibly
  "restarts," which muddies the self-heal beat; durable-resume is both simpler on stage and
  the stronger story.

## Consequences

- The build harness reinforces the existing self-heal narrative instead of competing with it.
- A bake/caching step joins the demo prep (like the pre-demo smoke test); the live "lab"
  capability is demonstrable on demand, off the critical path.
- The harness must emit ops in append-only chunks (not one final blob), and the worker's
  fixed "work" timer (`internal/agent`) becomes "emit ops until the contract's done-criteria
  are met" — paced by the Choreography module so ops rise at watchable speed.
