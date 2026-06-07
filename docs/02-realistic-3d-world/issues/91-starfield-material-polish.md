# Star-field + material micro-polish: star variance, Moon anisotropy, tone-map exposure

- **Issue:** [#91](https://github.com/IamP5/fiap-gs-space-connect/issues/91)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK
- **Wave:** Space-view realism (2) · **Research:** [`space-view-realism.md`](../space-view-realism.md) §1, §4, §6

## What to build

Depth/crispness polish now that the Milky-Way background exists: bake **per-vertex size/brightness (power-law) + slight color variance** into the hand-rolled star points (or reduce its count since the band carries most stars), bump **Moon texture `anisotropy` to max**, and set an explicit **`toneMappingExposure ≈ 1.1`** (verify the void stays near-black). All static.

## Acceptance criteria

- [ ] Star points: per-vertex size/brightness (power-law) + slight color variance, baked in `useMemo` (no useFrame)
- [ ] Moon textures `anisotropy` → renderer max
- [ ] `toneMappingExposure` ≈ 1.1; void still reads near-black
- [ ] 0 idle fps; lint+test+build green + orbit & surface screenshots

## Blocked by

- #83 (Milky-Way star background — determines the star-field's role)
