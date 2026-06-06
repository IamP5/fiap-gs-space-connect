# bh-08·C — Per-placement replay/live toggle on drag-to-place

> Type: AFK · GitHub [#34](https://github.com/IamP5/fiap-gs-space-connect/issues/34) ·
> [TECHSPEC](../TECHSPEC.md) §4 · governed by
> [ADR-0009](../adr/0009-live-build-mode-runs-the-harness-on-the-work-path.md)

## What to build

Let the operator **choose replay or live per Blueprint placement** on drag-to-place. Extend the
`placeBlueprint` control with `mode: "replay" | "live"` (default `replay`). The web palette/ghost
exposes the choice; the coordinator **tags the injected DAG's Tasks** with the mode, and a Rover
winning a `live`-tagged Task builds with `agent.Config.Mode = live`. Multiple Blueprints coexist,
so a replay dome and a live dome can stand in the same world.

Cuts end-to-end: web toggle → `control.command` → coordinator injection/tagging → Rover routing.

## Acceptance criteria

- [ ] `placeBlueprint` control carries `mode: "replay" | "live"`, defaulting to `replay`; existing placements unchanged
- [ ] The drag-to-place palette/ghost exposes a replay/live choice before drop
- [ ] The coordinator tags the placed DAG's Tasks with the chosen mode (single writer; bounds validation unchanged)
- [ ] A Rover winning a `live`-tagged Task builds in live mode; a `replay`-tagged Task replays as today
- [ ] A replay Blueprint and a live Blueprint coexist in the same world simultaneously
- [ ] Coordinator + web tests cover the mode flow; `make check` + web tests green

## Blocked by

- [08b](./08b-live-mode-core.md) (#33)
