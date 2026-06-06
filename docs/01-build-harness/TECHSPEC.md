# Build Harness — Technical Specification

> The AI construction layer over the [SwarmBuild MVP](../00-mvp/TECHSPEC.md).
> Domain language: [CONTEXT.md](../../CONTEXT.md) (load-bearing — Architect, Build contract,
> Build harness, Build spec, Model seam, Build envelope).
> Load-bearing decisions: [adr/](./adr/) (0005–0007), continuing [docs/00-mvp/adr/](../00-mvp/adr/).
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
- **Lab-loop trace** (`internal/harness`, lab/bake only) — each bake writes a
  `<spec-key>.trace.json` beside the cached spec: the Build contract, every Generator
  iteration, every Evaluator verdict, and the outcome (`accepted`|`fallback`, `quality_flag`,
  reason). Declarative data, no headline-path consumer; it is what makes "observed trace gaps"
  inspectable ([ADR-0008](./adr/0008-lab-loop-observability-and-layered-evaluator.md)).
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
BuildSpec = [ BuildOp ]               // ordered, append-only, durable Task state; renderer FOLDS it
BuildOp {
  op:    "place" | "move" | "delete", // "move"/"delete" = a harness revising earlier work (ADR-0009)
  id:    string,                       // stable op identity; "move"/"delete" target an earlier "place".id
  shape: "box" | "cylinder" | "sphere" | "model",   // "place" only; "model" = future glTF
  pos:   Vec3, rot: Vec3, scale: Vec3,              // relative to the Task envelope frame
  material: { color, roughness?, metalness?, map? },// "map" (texture) = future
  model_ref?: string                                // future glTF reference
}
# validated-and-repaired against JSON schema server-side before accepted (ADR-0006);
# validation runs against the FOLDED result (envelope/collision), not single ops. A cached
# replay spec is place-only — a degenerate patch log that folds to itself (no re-bake).
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

### Evaluator verdict + lab-loop trace (lab/bake only) — [ADR-0008](./adr/0008-lab-loop-observability-and-layered-evaluator.md)
```
Verdict {
  hard_gate: { envelope: bool, collision: bool, done: bool },   // blocking safety invariants
  rubric: {                                                      // advisory quality, 0–2 + evidence
    done_coverage: { score:0..2, evidence:string },
    silhouette:    { score:0..2, evidence:string },             // from the vision pass (issue 06)
    coherence:     { score:0..2, evidence:string }
  }
}
Trace {                                  // <spec-key>.trace.json beside the cached spec
  contract:    BuildContract,
  iterations:  [ { gen_ops:[BuildOp], verdict:Verdict } ],
  outcome:     { result:"accepted"|"fallback", cached:bool,
                 quality_flag:"ok"|"low", reason:string }
}
# hard_gate=false on any field ⇒ refine or fall back. hard_gate all true ⇒ cacheable, always.
# soft score below threshold ⇒ quality_flag:"low" (never blocks); operator review lists it.
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
{ cmd: "placeBlueprint", blueprintId, origin:Vec3, rotation, mode?:"replay"|"live" } // drag-to-place
# joins existing: kill | killContainer | setLatency | setFailureProb | reloadDemo
# coordinator injects the pre-baked task DAG at origin; Auction proceeds as today.
# multiple blueprints allowed — each is just another DAG the Auction feeds on.
# mode defaults to "replay" (deterministic cache). "live" tags the DAG's Tasks so the winning
# Rover runs its harness on the build path (agent.Config.Mode=live; ADR-0009). Both can coexist.
```

## 5. The two paths, and the self-heal interaction

**Generation / "lab" path** (slow, agentic, off the critical path): Architect authors
contracts; per Task, the Build harness runs the Generator↔Evaluator loop until the contract's
done-criteria pass. The Evaluator emits a **layered verdict** ([ADR-0008](./adr/0008-lab-loop-observability-and-layered-evaluator.md)):
a **hard gate** (envelope + collision + done-criteria — boolean, blocking) every iteration,
plus a **soft rubric** (done-coverage / silhouette / coherence, 0–2 + evidence) that scores
quality without blocking. An optional **vision pass** (headless render of the real `Scene3D`,
screenshot to a vision model) runs once before freezing and supplies the `silhouette` score.
A spec that passes the hard gate is cached; if its soft score is low the cache entry is
**flagged** (`quality_flag: low`) for operator review, never withheld. Every bake writes a
**trace** beside the cached spec.

**Headline path** (fast, deterministic): drag a Blueprint in → tasks go live → Auction awards
→ the winning Rover **replays the cached spec**, streaming ops at choreographed pace → the
structure rises. Cache miss or any failure ⇒ **primitive fallback**; the Task still completes.

**Self-heal with a half-built structure:** kill a Rover mid-build → its Task returns to
UNCLAIMED **with its accumulated Build spec intact** → re-auction → the replacement Rover
**resumes appending** from the partial structure against the same contract. The wall keeps
rising where it stopped.

**Live path** (opt-in, per placement — [ADR-0009](./adr/0009-live-build-mode-runs-the-harness-on-the-work-path.md)):
drag a Blueprint in with `mode: "live"` → its Tasks are tagged `live` → the winning Rover runs
its Build harness **in its work phase** (`agent.Config.Mode = live`), streaming each refine
iteration as **patch ops** (`place`/`move`/`delete`) on `build.op.<task>`, so the structure
**grows and visibly self-corrects** in the world step by step. This **deliberately runs the
model on the build path** — the scoped break of ADR-0005 the live mode exists for. Failure
**heals, it does not fall back**: the harness loop retries; past a per-Rover threshold the Rover
**dies** through the normal expiry → re-auction path; the replacement **folds the durable patch
log and continues the loop live**. A **circuit breaker** finishes a Task with the primitive
op-source only after >≈3 builder deaths on it (bounds a systemic model outage), so dependents
still unblock and the dome still closes. The **replay** path above stays the default and the
bulletproof fallback; a `replay` dome and a `live` dome can stand in the same world.

The hot-path invariant is **rescoped, not dropped**: the self-heal core (allocation/auction,
lease/heartbeat, expiry, single-writer tick, World Model, Planner) still must not import the
Model seam; only the Rover work phase may (see §7, §8).

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
8. **Live build mode** ([ADR-0009](./adr/0009-live-build-mode-runs-the-harness-on-the-work-path.md)).
   Per-placement `mode:"live"`; the Rover runs the harness inline in its work phase, streaming
   self-correcting **patch ops** per refine iteration; retry → die → resume-live failure path
   with a primitive circuit breaker; **rescope** the import-graph archtest to the self-heal
   core. The deliberate, scoped break of ADR-0005 — replay stays the default and the fallback.

Each step is demoable; the headline survives stopping after any step (earlier steps fall back
to richer-primitive or fewer Blueprints, never to "broken"). Steps 1–7 keep the model off the
build path entirely; step 8 is the one place that — opt-in, per placement — runs it on the
build path, with the self-heal core still mechanically model-free.

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
- **Hot-path invariant — architecture test** (mechanical, in `go test -race ./...`): asserts
  `internal/harness/model` is not in the import closure of the **self-heal core** packages
  (allocation/auction, lease/heartbeat, expiry, single-writer tick, World Model, Planner).
  Promotes the §8 grep to an executable check that fails CI the moment a Model-seam call is
  wired into the self-heal loop ([ADR-0005](./adr/0005-llm-build-harness-augments-deterministic-swarm.md)).
  **Rescoped by [ADR-0009](./adr/0009-live-build-mode-runs-the-harness-on-the-work-path.md):**
  the Rover *work phase* (`internal/agent`, live mode) is allowed to import the Model seam; the
  test asserts the core stays model-free, not the whole hot path.
- **Live-mode failure/heal — integration test**: with the `Model` forced to fail in live mode,
  the harness retries, the Rover dies past threshold, the Task re-auctions, and a replacement
  folds the patch log and continues; after >≈3 builder deaths the circuit breaker finishes the
  Task with primitive geometry and dependents unblock (the dome still closes).
- **Evaluator verdict + trace — unit tests** (lab/bake): the hard gate stays boolean and
  blocking; a hard-gate failure forces refine/fallback; a passing-but-low-scoring spec is
  cached with `quality_flag: low`; the trace round-trips and lists every iteration's verdict.
- **Pre-demo bake + smoke**: regenerate/validate every demo Blueprint's specs to cache; assert
  cache hits for the headline before presenting.

## 8. Live-robustness checklist

- [ ] No Model-seam call in the **self-heal core** (allocation / lease / heartbeat / expiry /
      tick / World Model / Planner) — enforced by the rescoped import-graph architecture test in
      `go test -race ./...`, not a manual grep (ADR-0005, ADR-0009). Live mode may call the model
      in the Rover work phase only.
- [ ] **Replay** (default) headline runs entirely from **cache**; cache-hit asserted in pre-demo
      smoke. Live mode is opt-in per placement and never the default.
- [ ] Live mode: a stalling model heals (retry → die → resume-live) and never freezes a Task;
      the circuit breaker guarantees completion after >≈3 builder deaths.
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
live generation as the *default* headline (it is opt-in per placement — ADR-0009 — never the
default; the deterministic replay stays the money shot); fine-tuning or training; multi-model
ensembles; persistence of specs beyond the cache + NATS KV.

## 10. Open decisions (deliberately deferred)

| Decision | Current call | Revisit when |
|---|---|---|
| First provider/model | GPT-class via openai-go/v3 + base_url swap | If Gemini fidelity needed → native `genai` SDK behind the seam |
| Evaluator depth | (B) Generator+Evaluator, layered verdict (hard gate + soft rubric), 1–3 iters | (C) specialized sub-agents when the `quality_flag: low` set in the bake traces is non-trivial and concentrated (ADR-0008) |
| Vision pass | Bake/lab only | If analytic-only specs read as low quality on stage |
| Ollama strict json_schema | Treat as unverified; prefer native `format` | If a local-model demo is wanted |
| Live-mode retry / death thresholds | Per-Rover retry on each call; Rover dies after a small N of failures; circuit breaker after ≈3 builder deaths per Task (ADR-0009) | Tune once observed on the real laptop + provider latency |
| Live-mode model | Same provider/model as bake (openai-go/v3 + base_url swap) | If a faster/cheaper model is needed for interactive latency |

## 11. Project layout (proposed additions)
```
/internal/harness          Go — Architect, Build harness (Generator/Evaluator), spec cache,
                                validation + repair, fallback. Shared package; agent imports it.
/internal/harness/model    Go — the Model seam (interface) + openai-go/v3 adapter (base_url swap)
/internal/wire             Go — (extend) TaskView.build_spec; build.op / build.contract subjects
/internal/agent            Go — (extend) work phase emits ops until contract done; resume-on-kill.
                                LIVE mode (ADR-0009): imports the Model seam, runs the harness
                                loop inline, streams patch ops, retry→die→resume-live + breaker
/internal/coordinator      Go — (extend) append ops to Task spec; placeBlueprint injection
/web/src/components         (extend) Scene3D spec-interpreter; blueprint palette + drag-to-place
/web/src/lib                (extend) build-spec → mesh mapping; agent console panel
/bake                      Go — offline spec generation → cache + per-spec trace.json (pre-demo,
                                like smoke.sh); emits the operator review (fell-back ∪ low-quality)
```
