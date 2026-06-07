# Lighting & framing grade: FOV 50, surface rim/fill lights, earthshine falloff, fog dedupe+tint

- **Issue:** [#101](https://github.com/IamP5/fiap-gs-space-connect/issues/101)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK
- **Wave:** Cinematic beauty & immersion (3) · **Research:** [`cinematic-beauty-immersion.md`](../cinematic-beauty-immersion.md)

## What to build

A cinematic grade on top of the Wave-2 lighting (#81). Widen camera **FOV 42→50** (`Scene3D.tsx:1789`) and adjust surface min/maxDistance so framing holds. Add a **surface-only cool rim light** and a **warm sun-side fill** so rover/dome silhouettes separate from the regolith. Replace the static orbit earthshine with a **1/r² falloff** from `EARTH_POSITION`. Consolidate the **duplicated surface `<fog>`** block (declared twice, `Scene3D.tsx:1470` and `1519`, in different light-rig branches) and warm its tint from pure black toward a deep blue-grey for atmospheric depth. Static — 0 idle fps preserved.

Research: `docs/02-realistic-3d-world/cinematic-beauty-immersion.md` (Wave 3).

## Acceptance criteria

- [ ] FOV 50; surface distance clamps adjusted so framing holds
- [ ] Surface-only cool rim light + warm sun-side fill (gated `onSurface`)
- [ ] Earthshine uses 1/r² falloff from `EARTH_POSITION`, pale steel-blue retained
- [ ] Duplicate `<fog>` consolidated to one; warm tint (~`#0a0f1a`)
- [ ] Void still reads near-black in orbit; sun stays hard white
- [ ] 0 idle fps preserved; lint+test+build green + orbit & surface screenshots

## Blocked by

None - can start immediately
