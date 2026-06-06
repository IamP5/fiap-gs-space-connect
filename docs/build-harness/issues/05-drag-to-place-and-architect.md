# Drag-to-place + Architect contracts + palette

> Type: AFK · Build sequence step 5 · [TECHSPEC](../TECHSPEC.md) · respects
> [ADR-0005](../adr/0005-llm-build-harness-augments-deterministic-swarm.md) ·
> parallelises with 03/04 (works on fallback geometry before any LLM)

## What to build

The game-like authoring path. A **blueprint palette** lists pre-authored Blueprints (the
habitat dome + a couple of new ones — e.g. solar array, comms mast). The user drags one into
the world; a **ghost preview** follows the cursor showing each Task's **Build envelope** as
its footprint; the user sets **origin + rotation** and confirms. This emits a new
`placeBlueprint{blueprintId, origin, rotation}` Control command (alongside the existing
`kill`/`setLatency`/`reloadDemo`); the coordinator validates placement (world bounds, terrain,
no-overlap with existing structures) and injects the Blueprint's **pre-baked task DAG** at the
origin. The **Auction proceeds exactly as today**.

The **Architect** authors each Task's **Build contract** (what + done + envelope) for the
catalog Blueprints — pre-baked, not live (live decomposition is deferred to lab, slice 07).
**Multiple Blueprints** may be placed in one world; each is just another DAG the Auction feeds
on. This slice works end-to-end on **fallback geometry**, so it can land before 03/04.

## Acceptance criteria

- [ ] A blueprint palette shows pre-authored Blueprints; dragging one shows a ghost preview with per-Task build envelopes
- [ ] Confirming emits `placeBlueprint{blueprintId, origin, rotation}`; the gateway relays it to `control.command`
- [ ] The coordinator validates bounds/terrain/no-overlap before injecting the pre-baked DAG; invalid placement is rejected with feedback
- [ ] Injected Tasks auction and build via the unchanged Auction/Lease/self-heal flow
- [ ] Multiple Blueprints can be placed and built concurrently in one world
- [ ] Architect-authored Build contracts exist for every catalog Blueprint (pre-baked)

## Blocked by

- [02](./02-streamed-durable-resumable-ops.md)
