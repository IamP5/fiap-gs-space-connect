# Build Harness — the AI construction layer

The agentic layer that sits **on top of** the deterministic swarm. It never decides
*who* builds or *when* (the Auction owns that, untouched) — it only produces *what a
completed Task looks like*: each Rover runs an LLM **Build harness** that generates a
declarative **Build spec**, and the structure rises op-by-op as the swarm works.

The swarm still self-heals deterministically; the harness adds the visible construction —
and because a killed Rover's half-built structure is durable, the replacement resumes it,
which makes the self-heal beat *stronger*, not weaker.

**Read first:** [CONTEXT.md](../../CONTEXT.md) — the domain language is load-bearing
(Architect, Build contract, Build harness, Build spec, Model seam, Build envelope all live
there). Then [TECHSPEC.md](./TECHSPEC.md).

**Load-bearing decisions** (these continue the system ADR sequence from
[docs/00-mvp/adr/](../00-mvp/adr/)):

- [ADR-0005](./adr/0005-llm-build-harness-augments-deterministic-swarm.md) — the harness
  **augments, never replaces** the deterministic swarm; it is best-effort and the core
  never blocks on it.
- [ADR-0006](./adr/0006-build-spec-is-declarative-data-not-executed-code.md) — a Build spec
  is **declarative data the renderer interprets, never executed code** (upholds ADR-0004).
- [ADR-0007](./adr/0007-hybrid-generation-with-durable-resumable-build-specs.md) — **hybrid
  timing**: the headline replays cached, evaluator-approved specs; live generation lives in
  a "lab" path. Specs are **durable and resumable** across a Rover kill.
- [ADR-0008](./adr/0008-lab-loop-observability-and-layered-evaluator.md) — **lab-loop
  observability**: each bake writes a **trace sidecar**, and the Evaluator emits a layered
  verdict — a **hard gate** (boolean, blocking safety invariants) plus a **soft rubric**
  (0–2 quality scores + evidence) that flags but never blocks. The `quality_flag: low`
  population is the inspectable trigger for the (B)→(C) topology move.
- [ADR-0009](./adr/0009-live-build-mode-runs-the-harness-on-the-work-path.md) — **live build
  mode**: an opt-in, per-placement mode where a Rover runs its harness *on the build path* and
  the structure self-corrects in the world step by step. **Deliberately scopes ADR-0005** (the
  self-heal core stays model-free; replay stays the bulletproof default). Failure heals through
  the existing expiry → re-auction path (retry → die → resume live), with a primitive
  circuit-breaker as the last resort.

> **A note on "harness."** This document uses *Build harness* in the **product** sense
> (CONTEXT.md): the in-product LLM Generator↔Evaluator loop a Rover runs to emit geometry.
> That is distinct from the **coding-agent harness** — the repo scaffolding
> (`AGENTS.md`, feature state, `init.sh`, clean-state handoff) that makes the *agent
> implementing this plan* reliable. The two are unrelated concerns; when this folder says
> "harness" unqualified, it means the product Build harness.

## The one-paragraph mental model

The **Auction** (deterministic, unchanged) decides *who* builds *what* and *when*. The
**Architect** turns a Blueprint into per-Task **Build contracts** (what + "done"). Whichever
Rover wins a Task runs a **Build harness** — a **Generator** sub-agent emits **Build spec**
ops, an **Evaluator** sub-agent judges them against the contract — and the ops stream into
the World Model and rise in the scene. The LLM is reached through a **Model seam** (swap
GPT-class → Gemini → local by config). If any of that fails, the Task falls back to today's
primitive geometry: the dome still closes.
