# Construction prop Assets (catalog) + PBR materials on build tasks

- **Issue:** [#57](https://github.com/IamP5/fiap-gs-space-connect/issues/57)
- **Epic:** [#46](https://github.com/IamP5/fiap-gs-space-connect/issues/46)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK
- **ADR:** [0010 — live-mode curated Asset catalog](../../01-build-harness/adr/0010-live-mode-curated-asset-catalog.md)

## What to build

Stage construction props and material skins the swarm assembles, and **register the task-placed props in the Asset catalog** (ADR-0010, keyed to the panel/mast task types) so replay and live can place them by key.

**NASA prop picks** (`master`, already `.glb`): **Tall Dish** (separable dish/post/turntable parts, ~1.7 MB — great posable antenna/comms-mast), **70-meter Dish** (2.2 MB), **Solar Sail Concept** (0.2 MB — panel proxy), **Tether** (0.5 MB — strut). **CC0 alternates:** Kenney Space/Space Station, Quaternius MegaKit/Essentials. Apply ambientCG CC0 PBR sets (Solar Panel 002, Metal Plates 006) tiled onto primitive build ops (cheaper than glb) via the PBR SpecPrimitive from #53. Condition NASA assets via #52; credit, strip insignia.

## Acceptance criteria

- [ ] Task-placed prop Assets registered as Asset-catalog entries (keyed to suited task types)
- [ ] Solar-array / panel ops use the CC0 solar PBR skin; metal ops use the metal-plates skin
- [ ] At least one prop Asset wired via the catalog with primitive fallback
- [ ] All textures/Assets self-hosted, conditioned, downscaled, credited (no insignia)
- [ ] Idle stays 0 fps

## Blocked by

- [#53](https://github.com/IamP5/fiap-gs-space-connect/issues/53)
- [#59](https://github.com/IamP5/fiap-gs-space-connect/issues/59)
