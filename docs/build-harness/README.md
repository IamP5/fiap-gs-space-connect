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
[docs/mvp/adr/](../mvp/adr/)):

- [ADR-0005](./adr/0005-llm-build-harness-augments-deterministic-swarm.md) — the harness
  **augments, never replaces** the deterministic swarm; it is best-effort and the core
  never blocks on it.
- [ADR-0006](./adr/0006-build-spec-is-declarative-data-not-executed-code.md) — a Build spec
  is **declarative data the renderer interprets, never executed code** (upholds ADR-0004).
- [ADR-0007](./adr/0007-hybrid-generation-with-durable-resumable-build-specs.md) — **hybrid
  timing**: the headline replays cached, evaluator-approved specs; live generation lives in
  a "lab" path. Specs are **durable and resumable** across a Rover kill.

## The one-paragraph mental model

The **Auction** (deterministic, unchanged) decides *who* builds *what* and *when*. The
**Architect** turns a Blueprint into per-Task **Build contracts** (what + "done"). Whichever
Rover wins a Task runs a **Build harness** — a **Generator** sub-agent emits **Build spec**
ops, an **Evaluator** sub-agent judges them against the contract — and the ops stream into
the World Model and rise in the scene. The LLM is reached through a **Model seam** (swap
GPT-class → Gemini → local by config). If any of that fails, the Task falls back to today's
primitive geometry: the dome still closes.
