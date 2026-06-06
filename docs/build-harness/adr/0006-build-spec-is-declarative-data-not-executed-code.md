# A Build spec is declarative data the renderer interprets, never executed code

**Status:** accepted

A Build harness emits a **Build spec** — an ordered list of declarative build operations
(primitives/models with transform + material) carried as durable Task state in the snapshot.
The renderer **interprets** it. We do **not** `eval` LLM-authored JavaScript/Three.js in the
dashboard.

## Context

The feature was first described as workers emitting "three.js code to be injected in our
webapp." Taken literally that means `eval()`/`new Function()` on model output in the browser.
That is arbitrary code execution in the dashboard, and it breaks the load-bearing invariant
of the frontend: the dashboard is a **pure re-render of the server-authoritative snapshot**
([ADR-0004](../../mvp/adr/0004-react-three-fiber-3d-built-2d-first.md)), which is what makes
it safe, testable, reconnect-proof, and unable to lie about World Model state. Executed code
also cannot be cached, replayed, or validated, and a bad snippet can crash the renderer
mid-demo.

## Decision

- The worker emits a **Build spec**: structured, engine-agnostic build ops. It is just more
  durable Task state; the scene renders it the same pure way it renders everything today.
- The spec is **validated-and-repaired** server-side against a JSON schema before it is
  accepted (reject malformed, re-ask once) — the same hook the Evaluator's analytic gate
  uses, and necessary because the provider's structured-output layer is only best-effort.
- The schema is **forward-compatible**: primitives + procedural materials now, with
  first-class slots for model references (glTF) and texture maps later, without changing the
  seam. (Shipping real glTF/textures stays gated on licensed/CC0 assets per ADR-0004.)
- For the "agent really wrote it" effect, stream the emitted spec into a live console panel —
  the spec is shown as authored, but **interpreted, not executed**.

## Considered options

- **Eval'd Three.js code** — rejected: arbitrary code execution in the dashboard, violates
  ADR-0004's pure-re-render invariant, non-deterministic, non-cacheable, can crash the scene
  during the money shot.
- **A sandboxed builder API** (a tiny `box()`/`place()` DSL run in a locked-down
  worker/iframe) — rejected for now as unnecessary complexity: a declarative spec gives the
  same expressiveness for primitives with none of the sandbox-escape surface.

## Consequences

- The Build spec slots into the existing wire snapshot as a new optional Task field; the
  renderer gains a spec-interpreter but stays a pure function of state.
- Specs are cacheable and replayable, which is what makes the deterministic headline path
  possible ([ADR-0007](./0007-hybrid-generation-with-durable-resumable-build-specs.md)).
- The schema is now an interface contract: changing it is a coordinated Go-wire + TS-wire +
  renderer change, like any other snapshot field.
