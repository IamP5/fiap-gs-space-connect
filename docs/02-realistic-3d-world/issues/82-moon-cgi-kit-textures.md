# Real Moon surface: CGI Moon Kit color + baked LOLA normal map

- **Issue:** [#82](https://github.com/IamP5/fiap-gs-space-connect/issues/82)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK
- **Wave:** Space-view realism (2) · **Research:** [`space-view-realism.md`](../space-view-realism.md) §1, §5

## What to build

Replace the Moon's textures with NASA **CGI Moon Kit (SVS 4720)** data: self-host the LROC color map downscaled to the existing budget, and **bake a normal map offline from the LOLA elevation (LDEM)** so relief lines up with the albedo. Apply with matte-regolith params; keep the primitive fallback. Do **not** use a `displacementMap` (silhouette cracks on equirect poles).

## Acceptance criteria

- [ ] CGI Moon Kit color map self-hosted, downscaled within budget, `SRGBColorSpace`
- [ ] Normal map baked offline from the LOLA LDEM, `NoColorSpace`
- [ ] Material matte: `metalness 0`, `roughness ~0.95–1.0`, `envMapIntensity 0`
- [ ] Primitive fallback retained (ADR-0004); `invalidate()` once on load
- [ ] `displacementMap` NOT used
- [ ] NASA-PD credit recorded in CREDITS.md ("NASA's Scientific Visualization Studio")
- [ ] 0 idle fps; lint+test+build green + orbit screenshot

## Blocked by

None — coordinate the look with #81
