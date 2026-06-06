# Build Harness — Technical Specification

> The AI construction layer over the [SwarmBuild MVP](../mvp/TECHSPEC.md).
> Domain language: [CONTEXT.md](../../CONTEXT.md) (load-bearing — Architect, Build contract,
> Build harness, Build spec, Model seam, Build envelope).
> Load-bearing decisions: [adr/](./adr/) (0005–0007), continuing [docs/mvp/adr/](../mvp/adr/).
> Status: ready to build (layered on the shipped deep core + sim + bus + 3D dashboard).

## 1. What this is

Rovers stop merely flipping a Task to DONE and instead **generate the geometry they build**.
A leader **Architect** turns a Blueprint into per-Task **Build contracts**; whichever Rover
wins a Task at Auction runs a **Build harness** (an LLM Generator + Evaluator loop) that
emits a declarative **Build spec**; the structure rises op-by-op in the 3D scene as the
swarm works. The user drags pre-authored Blueprints into the world like a game.

It is layered **strictly on the output side**. The Auction, Lease, World Model, and self-heal
stay deterministic and untouched ([ADR-0005](./adr/0005-llm-build-harness-augments-deterministic-swarm.md)).
The killer feature: a Rover killed mid-build leaves a **durable, resumable** half-built
structure its replacement finishes — self-heal made *more* impressive, not less.

## 2. Constraints that shaped this spec

| Constraint | Consequence |
|---|---|
| **The ~30s deterministic money shot is sacred** | No harness call may sit on the path of an award, lease renewal, or expiry. Headline **replays cached specs**; live generation is a separate path ([ADR-0007](./adr/0007-hybrid-generation-with-durable-resumable-build-specs.md)). |
| **LLM calls are slow, non-deterministic, can fail** | Harness is **best-effort**; every Task has a deterministic **primitive fallback** (today's `tierOf`). The core never blocks on the model. |
| **Dashboard is a pure re-render of the snapshot** (ADR-0004) | The worker emits **declarative data, never executed code** ([ADR-0006](./adr/0006-build-spec-is-declarative-data-not-executed-code.md)). Build spec is a new durable Task field. |
| **Swap model vendors easily** | A narrow **Model seam**; `openai-go/v3` behind it, swap `base_url` for OpenAI / Gemini / local. Start GPT-class. |
| **A Rover may be a goroutine or a k8s pod** (ADR-0001) | Harness lives in a **shared package** imported by `internal/agent`, so the same code runs in-proc or per-pod; `kubectl delete pod` kills a robot **mid-build**. |
| **Evolve to custom models + textures later** | Build-spec schema is **forward-compatible** (model/texture slots) from day one; shipping assets stays gated on CC0 licensing. |

## 3. Resolved architecture

```
   Browser (React + r3f)              Coordinator process (Go)
 ┌──────────────────────┐    ┌──────────────────────────────────────────────┐
 │  Scene3D renders      │    │  DETERMINISTIC CORE (unchanged, untouched)    │
 │  accumulated Build    │    │   Allocation · Lease · World · Planner        │
 │  spec ops, op-by-op   │    │   single-writer tick · Choreography           │
 │                       │◄───┤                                               │
 │  Blueprint palette    │ WS │  Rover ×N  (goroutine | container | pod)       │
 │  drag-to-place ghost  │    │   └─ Build harness  ◄── shared package ──┐    │
 │  + live agent console │    │        Generator ↔ Evaluator loop        │    │
 └──────────┬───────────┘    │        emits streamed Build spec ops      │    │
            │ placeBlueprint  │                  │                        │    │
            │ + snapshot      └──────────────────┼────────────────────────┘    │
            │ (build_spec ops)                   │  Model seam (interface)      │
      ┌─────┴──────┐                     ┌───────┴────────┐   └── openai-go/v3 ─┐
      │ WS Gateway │◄──── NATS ─────────►│  NATS server   │      base_url swap: │
      └────────────┘                     └────────────────┘      OpenAI/Gemini/ │
                                                                  local         │
                                          ┌──────────────┐                      │
                                          │  Architect   │  Blueprint → Build   │
                                          │  (generation │  contracts;          │
                                          │   /lab path) │  bake → spec cache    │
                                          └──────────────┘                      │
```

### New / changed modules

- **Architect** (`internal/harness`, generation/lab path) — Planner agent. Blueprint → per-Task
  **Build contracts** (what + "done" + envelope). In the demo, contracts and specs are
  **pre-baked**; live decomposition is a lab capability.
- **Build harness** (`internal/harness`, shared package imported by `internal/agent`) — per
  Rover. A **Generator** sub-agent emits Build spec ops; an **Evaluator** sub-agent judges
  them. Bounded refine loop (start at 1–3 iterations); the Generator/Evaluator split is the
  article's strongest quality lever. Topology starts at **(B)**, evolves to specialized
  sub-agents **(C)** only on observed trace gaps.
- **Model seam** (`internal/harness/model`) — one narrow interface; `openai-go/v3` adapter
  behind it; provider selected by config. Always **validate-and-repair** the structured
  output against the Build-spec JSON schema.
- **Spec cache + fallback** (`internal/harness`) — keyed `{blueprintId, taskId, contract-hash,
  model}`. Hit → replay; miss → primitive fallback (headline) or live generation (lab).
- **Renderer spec-interpreter** (`web/src/components/Scene3D.tsx` + `lib/`) — interprets a
  Task's accumulated Build spec ops into meshes; falls back to today's `tierOf` geometry when
  absent. Stays a pure function of the snapshot.

### What does NOT change

The four deep modules, the Auction cost function, the Lease state machine, the single-writer
tick, the self-heal mechanic, the snapshot-is-truth invariant. The harness reads world state
and writes optional Task geometry; it touches none of the allocation logic.

## 4. Interface contracts

### Build contract (Architect → Build harness)
```
BuildContract {
  task_id, type,                       // ties to the existing Task
  envelope: { center:Vec3, size:Vec3 },// the Build envelope — bounds output must stay within
  done:     { ... },                   // measurable "done": e.g. min coverage / target silhouette
  style?:   { ... }                    // optional aesthetic guidance
}
```

### Build spec (Build harness → World Model → snapshot)  — forward-compatible
```
BuildSpec = [ BuildOp ]               // ordered, append-only, durable Task state
BuildOp {
  op:    "place",
  shape: "box" | "cylinder" | "sphere" | "model",   // "model" = future glTF
  pos:   Vec3, rot: Vec3, scale: Vec3,              // relative to the Task envelope frame
  material: { color, roughness?, metalness?, map? },// "map" (texture) = future
  model_ref?: string                                // future glTF reference
}
# validated-and-repaired against JSON schema server-side before accepted (ADR-0006)
```

### Model seam (the swap boundary)
```go
// internal/harness/model
type Model interface {
    // Generate returns structured JSON validated against the caller's schema.
    Generate(ctx context.Context, req Request) (json.RawMessage, error)
}
// Config: { provider, base_url, model, api_key }. openai-go/v3 behind it.
// OpenAI → api.openai.com/v1 · Gemini → generativelanguage.googleapis.com/v1beta/openai/
// local → localhost:11434/v1 . Strict response_format json_schema + own validation pass.
```

### New NATS subjects
```
build.op.<task_id>      a single appended Build spec op (Rover → coordinator)
build.contract.<task_id>  the Build contract for a Task (Architect/bake → coordinator)
# coordinator appends ops to the Task's durable Build spec; snapshot carries the accumulation
```

### Snapshot extension (`internal/wire`, `web/src/types/wire.ts`)
```
TaskView {  ...existing... ,
  build_spec?: BuildOp[]   // accumulated ops; absent ⇒ renderer uses primitive fallback
}
```

### New control command (`web` → gateway → `control.command`)
```
{ cmd: "placeBlueprint", blueprintId, origin:Vec3, rotation }   // drag-to-place
# joins existing: kill | killContainer | setLatency | setFailureProb | reloadDemo
# coordinator injects the pre-baked task DAG at origin; Auction proceeds as today.
# multiple blueprints allowed — each is just another DAG the Auction feeds on.
```

## 5. The two paths, and the self-heal interaction

**Generation / "lab" path** (slow, agentic, off the critical path): Architect authors
contracts; per Task, the Build harness runs the Generator↔Evaluator loop until the contract's
done-criteria pass; the analytic gate (envelope + collision + done-criteria) runs every
iteration, an optional **vision pass** (headless render of the real `Scene3D`, screenshot to
a vision model) runs once before freezing; the approved spec is cached.

**Headline path** (fast, deterministic): drag a Blueprint in → tasks go live → Auction awards
→ the winning Rover **replays the cached spec**, streaming ops at choreographed pace → the
structure rises. Cache miss or any failure ⇒ **primitive fallback**; the Task still completes.

**Self-heal with a half-built structure:** kill a Rover mid-build → its Task returns to
UNCLAIMED **with its accumulated Build spec intact** → re-auction → the replacement Rover
**resumes appending** from the partial structure against the same contract. The wall keeps
rising where it stopped.

## 6. Build sequence (robustness-first, cut-able tail)

1. **Build-spec contract + renderer interpreter + fallback.** Add `build_spec` to the wire
   snapshot; teach `Scene3D` to interpret ops with `tierOf` as fallback. Render a hardcoded
   sample spec. *No LLM yet* — proves the seam end-to-end and that the fallback is invisible.
2. **Streamed, durable, resumable ops.** `build.op.<task_id>` accumulation on the Task; ops
   ride the snapshot; **resume-on-kill** wired and integration-tested (the one behaviour that
   must not break the pitch).
3. **Model seam + one provider.** `internal/harness/model` with `openai-go/v3`, GPT-class,
   strict json_schema + validate-and-repair. A single Build harness generates one Task's spec
   offline (bake), cached.
4. **Generator↔Evaluator loop + analytic gate.** Bounded refine; the Evaluator's analytic
   validation (envelope, collisions, done-criteria). Bake all demo Blueprints to cache.
5. **Drag-to-place + Architect.** `placeBlueprint` control, ghost preview showing envelopes,
   blueprint palette; Architect authors contracts (pre-baked for demo). Multiple blueprints.
6. **Vision evaluator pass** (lab/bake only) — headless render of real `Scene3D` → vision
   model → quality gate before freezing a spec. Provider-swap to Gemini proven by config.
7. **Stretch:** live "lab" mode in-app; specialized sub-agents (topology **C**); custom glTF
   + textures (gated on CC0 assets).

Each step is demoable; the headline survives stopping after any step (earlier steps fall back
to richer-primitive or fewer Blueprints, never to "broken").

## 7. Test strategy

- **Build-spec validation — unit tests** (pure, deterministic): malformed/over-envelope/
  colliding specs are rejected; repair re-ask path; schema round-trips Go↔TS.
- **Renderer interpreter — web unit tests** (`vitest`): ops → expected scene mapping; absent
  spec ⇒ exact current `tierOf` fallback (no visual regression).
- **Resume-on-kill — one integration test**: a Rover with a partial Build spec is killed; the
  replacement resumes and the final spec equals the uninterrupted spec (op-set convergence).
- **Model seam — contract test** with a fake `Model` (no network): the harness validates,
  repairs once, and falls back on exhaustion. Provider adapters covered by a thin live smoke,
  not unit.
- **Best-effort invariant — test**: with the `Model` forced to error, the Auction/lease/
  self-heal flow and Task completion are byte-for-byte the pre-harness behaviour.
- **Pre-demo bake + smoke**: regenerate/validate every demo Blueprint's specs to cache; assert
  cache hits for the headline before presenting.

## 8. Live-robustness checklist

- [ ] No harness call on the award / heartbeat / expiry path (grep the hot loop).
- [ ] Headline runs entirely from **cache**; cache-hit asserted in pre-demo smoke.
- [ ] `Model` failure / timeout ⇒ primitive fallback; Task still flips DONE; dependents unblock.
- [ ] Resume-on-kill verified on the actual laptop; partial wall continues, never restarts.
- [ ] Build-spec validation rejects over-envelope / colliding ops before they reach the scene.
- [ ] Op stream paced by Choreography (no 50-op dump in one 100 ms tick).
- [ ] `placeBlueprint` validates bounds / terrain / no-overlap before tasks go live.
- [ ] Renderer with `build_spec` absent is pixel-identical to today (fallback intact).
- [ ] API keys server-side only; never shipped to the browser.

## 9. Out of scope (deferred)

Free-form blueprint authoring (Architect live decomposition stays a lab capability); custom
glTF models + textures in the demo (schema-ready, gated on CC0 assets per ADR-0004);
specialized evaluator sub-agents / parallel voting (topology **C**, gated on trace gaps);
in-app live generation as the *headline* (lab path only); fine-tuning or training; multi-model
ensembles; persistence of specs beyond the cache + NATS KV.

## 10. Open decisions (deliberately deferred)

| Decision | Current call | Revisit when |
|---|---|---|
| First provider/model | GPT-class via openai-go/v3 + base_url swap | If Gemini fidelity needed → native `genai` SDK behind the seam |
| Evaluator depth | (B) Generator+Evaluator, 1–3 iters | (C) specialized sub-agents when traces show "passes analytic, looks wrong" |
| Vision pass | Bake/lab only | If analytic-only specs read as low quality on stage |
| Ollama strict json_schema | Treat as unverified; prefer native `format` | If a local-model demo is wanted |

## 11. Project layout (proposed additions)
```
/internal/harness          Go — Architect, Build harness (Generator/Evaluator), spec cache,
                                validation + repair, fallback. Shared package; agent imports it.
/internal/harness/model    Go — the Model seam (interface) + openai-go/v3 adapter (base_url swap)
/internal/wire             Go — (extend) TaskView.build_spec; build.op / build.contract subjects
/internal/agent            Go — (extend) work phase emits ops until contract done; resume-on-kill
/internal/coordinator      Go — (extend) append ops to Task spec; placeBlueprint injection
/web/src/components         (extend) Scene3D spec-interpreter; blueprint palette + drag-to-place
/web/src/lib                (extend) build-spec → mesh mapping; agent console panel
/bake                      Go — offline spec generation → cache (pre-demo, like smoke.sh)
```
