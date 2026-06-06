# Add <SpaceEnvironment>: starfield + self-hosted HDR IBL backdrop

- **Issue:** [#50](https://github.com/IamP5/fiap-gs-space-connect/issues/50)
- **Epic:** [#46](https://github.com/IamP5/fiap-gs-space-connect/issues/46)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK

## What to build

New static, snapshot-independent `<SpaceEnvironment>` component rendered inside `<Canvas>` before the snapshot guard and outside the snapshot-derived group (same category as the existing static terrain + light rig). Contains a hand-rolled `THREE.Points` starfield (positions in useMemo, no useFrame) and a self-hosted `<Environment files="/assets/hdr/space_2k.hdr">` providing both the skybox background and PBR image-based lighting. Vendor a small (~2k) CC0/CC-BY HDR. Replace the flat black background with the Environment, keeping black as graceful fallback if the HDR fails. Renders the cubemap once; `invalidate()` once on HDR load.

## Acceptance criteria

- [ ] Static starfield renders with no per-frame useFrame work
- [ ] Self-hosted HDR drives skybox + IBL (visible reflections on metallic materials); no CDN/preset fetch
- [ ] Falls back to black background if the HDR fails to load
- [ ] invalidate() called once on HDR load; idle stays 0 fps
- [ ] Directional light + SelectiveBloom halo path still intact
- [ ] HDR credited in CREDITS.md

## Blocked by

- [#47](https://github.com/IamP5/fiap-gs-space-connect/issues/47)
