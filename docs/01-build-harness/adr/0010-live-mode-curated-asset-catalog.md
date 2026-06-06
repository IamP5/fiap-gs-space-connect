# Live build mode places curated Assets from a closed, contract-carried Asset catalog

**Status:** accepted

Live Build mode may place licensed **Assets** (glTF models / textures), not just procedural
primitives — but the Model never emits a free-form `model_ref`. Each Build contract carries a
closed **Asset catalog** (validated Asset-key → `model_ref` pairs); a Rover's Build harness in
live mode emits only an **Asset key** from that catalog; the coordinator **rejects any
out-of-catalog key before it folds into the World Model**; and the renderer's mandatory
primitive fallback ([ADR-0004](../../00-mvp/adr/0004-react-three-fiber-3d-built-2d-first.md)) still
covers a runtime asset miss. Replay and live draw from the **same** catalog. This extends
[ADR-0009](./0009-live-build-mode-runs-the-harness-on-the-work-path.md) (live on the work path)
and [ADR-0006](./0006-build-spec-is-declarative-data-not-executed-code.md) (Build spec is data).

## Context

ADR-0009 put the Model on the live work path; ADR-0006's `model` op + `model_ref` slot let a
Build spec place a glTF. The realism work (`docs/02-realistic-3d-world/`) vendors curated,
licensed Assets (rovers, habitats, launch set-pieces) and wires them through the existing
`SpecModel` seam. The open question was whether **live** mode — where the Model emits ops *as
it works* — may place those Assets, and if so, how without reintroducing the two risks the
project is built to avoid:

- **Nondeterminism / hallucination** on the headline-adjacent work path: a Model free to emit
  any `model_ref` string can invent a path, point at a gone asset, or drift between runs.
- **Licensing exposure:** a free-form ref could pull in art outside the
  CC0 + NASA-PD posture (`docs/02-realistic-3d-world/`).

The operator wants live mode to compose real Assets + procedural geometry (not be primitive-
only), and for Blueprints to carry "a ready architecture to delegate to." The resolution is to
make the **space of Asset outcomes closed and pre-validated**, so live gains real Assets while
hallucinated/unlicensed refs become *structurally impossible*, not merely unlikely.

## Decision

- **The Build contract carries a closed Asset catalog.** A catalog is a set of entries pairing
  an opaque **Asset key** (e.g. `habitat.dome.large`) with a resolved `model_ref` and the task
  types it suits. It is the bounded "ready architecture" the swarm delegates to.
- **The Model emits an Asset key, never a path.** A live Build op references an Asset by catalog
  key (a new key field on the op). The model-seam prompt carries the short key list for that
  Task's catalog — not URLs. The server resolves key → `model_ref` when interpreting the spec.
- **The coordinator validates membership before the World Model fold.** An op whose Asset key is
  not in that Task's catalog is rejected and never becomes durable Build spec — the same
  single-writer chokepoint that guards every other op. So a bad key cannot reach the Snapshot.
- **Replay and live share one catalog.** The curated Assets from the realism milestone populate
  the catalog; a `replay` spec references the same keys a `live` Rover may choose. There is no
  separate "live assets" set.
- **Primitive fallback still covers runtime misses.** A validated key whose `.glb` is gone/slow
  at render time falls back to the primitive per ADR-0004 — the catalog bounds *choice*, the
  fallback bounds *delivery*.

## Considered options

- **Replay-only Assets; live stays primitive-procedural** — rejected by the operator: live
  should compose real Assets too, not just blocks + textures.
- **Free-form `model_ref` in live mode** — rejected: puts asset-choice nondeterminism and a
  licensing hole straight on the work path; hallucinated/gone/unlicensed refs become possible,
  guarded only by the render fallback (too late — a bad ref would already be durable state).
- **A single global Asset catalog (not per-contract)** — deferred: workable, but carrying the
  catalog on the Build contract lets the Architect scope *which* Assets a given Blueprint may
  use (and is the seam the NL-authoring epic will compose against). A global default catalog can
  still back contracts that don't specify one.

## Consequences

- **ADR-0006 is extended, not broken:** the Build op gains an Asset-key field, but the spec
  stays declarative data the renderer folds/interprets — never executed code. Keys resolve to
  the existing `model_ref` path through `SpecModel`.
- **The wire schema changes in two places** (`internal/.../wire.go` and `web/src/types/wire.ts`)
  and the coordinator's op-validation gains a catalog-membership check. The browser still never
  receives a free-form ref — only resolved, self-hosted asset URLs.
- **Curation becomes a prerequisite:** an Asset must be vendored into the catalog (licensed,
  self-hosted, keyed) before the swarm can place it. This is the intended cost — it is the gate
  that keeps the closed set licensed and present.
- **The Task-built realism issues** (#55 habitats, and the task-placed props in #57) become
  *catalog-population* work, feeding both modes. The rover (#54) is a `Rover3D` render swap (the
  worker entity, not a catalog-chosen Task Asset) and the launch infra (#56) is **Scenery**
  (static), so neither populates the catalog.
- **It is the foundation for natural-language Blueprint authoring** (a separate downstream
  epic): the Architect will author contracts that draw Assets from this catalog by key.
- **The "bulletproof headline" survives:** replay is unchanged; live's Asset choices are now a
  closed, validated, fallback-backed set, so adding real Assets to live does not widen the
  failure surface beyond what ADR-0009's retry→die→resume→circuit-breaker already handles.
