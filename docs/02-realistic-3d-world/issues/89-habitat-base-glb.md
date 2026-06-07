# Habitat/base GLBs: Habitat Demonstration Unit + Base Station + Astronaut

- **Issue:** [#89](https://github.com/IamP5/fiap-gs-space-connect/issues/89)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK · **Relates:** #55, #59
- **Wave:** Space-view realism (2) · **Research:** [`space-view-realism.md`](../space-view-realism.md) §7
- **⚠️ Status note:** Habitat Demonstration Unit already shipped on main (PR #70). Genuinely missing: **Base Station + Astronaut** scale props. Kept open by user decision — rescope to just those if desired.

## What to build

Populate the habitat/base set with verified NASA-PD GLBs: **Habitat Demonstration Unit** (parts 1+2), **Base Station** (filler structure), and an **Astronaut** figure for scale. Self-host + condition; integrate via the Asset catalog seam with primitive fallbacks.

## Acceptance criteria

- [ ] Habitat Demonstration Unit (p1+p2), Base Station, Astronaut GLBs self-hosted + conditioned
- [ ] Integrated via the Asset/catalog seam; primitive fallback per model
- [ ] Bounded draw calls; 0 idle fps; no insignia decals
- [ ] NASA-PD credits recorded (per-model author)
- [ ] lint+test+build green + screenshot

## Blocked by

- #52 (asset conditioning pipeline)
