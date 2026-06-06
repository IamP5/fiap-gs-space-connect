# Stretch — live lab mode, sub-agents (C), glTF + textures

> Type: HITL · Build sequence step 7 (stretch) · [TECHSPEC](../TECHSPEC.md) · respects
> [ADR-0006](../adr/0006-build-spec-is-declarative-data-not-executed-code.md),
> [ADR-0004](../../00-mvp/adr/0004-react-three-fiber-3d-built-2d-first.md) · see memory:
> build-harness-agent-topology

## What to build

Build only with a clear spare slot, after the spine is solid. Three independent stretches,
each cut-able on its own:

- **In-app live "lab" mode** — drag a Blueprint and watch **genuinely live** generation
  (Generator↔Evaluator running in-app), with the emitted Build spec streamed into a live
  **agent console** panel. The headline still replays cache; this is the on-demand
  "watch it think" demo, off the critical path.
- **Specialized sub-agents (topology C)** — graduate the Evaluator from one judge to multiple
  specialized sub-agents (e.g. structural validator, style critic, parallel evaluators
  voting). **Gated on observed trace gaps** ("passes analytic, looks wrong" recurring), never
  added speculatively.
- **Custom glTF models + textures** — exercise the Build spec's `model_ref` / material `map`
  slots with real assets. **Gated on sourcing licensed/CC0 assets** (ADR-0004 forbids
  fetching unlicensed art); the schema is already ready.

## Acceptance criteria

- [ ] (Lab mode) A Blueprint can be generated live in-app; the agent console streams the emitted Build spec; the headline still uses cache
- [ ] (Sub-agents) Topology C is introduced only where a documented trace gap justifies it; the Generator/Evaluator split is preserved
- [ ] (Assets) glTF `model_ref` + texture `map` render from licensed/CC0 assets; primitive fallback still applies on missing assets
- [ ] Each stretch is independently revertible and never blocks the headline

## Blocked by

- [06](./06-vision-evaluator-and-provider-swap.md)
