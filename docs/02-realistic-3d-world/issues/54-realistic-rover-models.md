# Realistic rover model (Rover3D render swap)

- **Issue:** [#54](https://github.com/IamP5/fiap-gs-space-connect/issues/54)
- **Epic:** [#46](https://github.com/IamP5/fiap-gs-space-connect/issues/46)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK

## What to build

Swap the `Rover3D` primitive body (`Scene3D.tsx`) for a realistic glTF **rover Asset**, keeping the existing invisible hit-proxy as the sole pickable surface (relies on #48). This is the **worker-entity render**, NOT a Build-spec Task Asset — it does **not** go through the Asset catalog; every Rover uses the configured rover Asset.

**Top pick: NASA RASSOR** (Regolith Advanced Surface Systems Operations Robot — NASA's lunar regolith/construction robot, the most on-theme worker), `master` branch, already `.glb` (~6.3 MB): `3D Models/Regolith Advanced Surface Systems Operations Robot (RASSOR)/…glb`. Alternates: Perseverance (5.0 MB), Robonaut 2 (1.1 MB), or the Quaternius LowPoly Animated Robot (CC0). Condition + Draco via #52. NASA assets: credit `NASA / <author>`, strip any insignia. If animated, drive AnimationMixer in useFrame with invalidate() gated to active beats only.

## Acceptance criteria

- [ ] Rover3D renders a glTF rover Asset (self-hosted, conditioned, credited) with primitive fallback
- [ ] Hit-proxy remains the sole pickable surface; click-to-kill stays deterministic (#48)
- [ ] Asset conditioned/compressed via #52 (decimate/Draco for the NASA model); no insignia
- [ ] Any animation invalidates only during active beats; idle stays 0 fps

## Blocked by

- [#48](https://github.com/IamP5/fiap-gs-space-connect/issues/48)
- [#52](https://github.com/IamP5/fiap-gs-space-connect/issues/52)
