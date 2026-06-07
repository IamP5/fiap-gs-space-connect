# Terrain microrelief: high-frequency displacement noise octave

- **Issue:** [#105](https://github.com/IamP5/fiap-gs-space-connect/issues/105)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK
- **Wave:** Cinematic beauty & immersion (3) · **Research:** [`cinematic-beauty-immersion.md`](../cinematic-beauty-immersion.md)

## What to build

The regolith ground displacement (`Scene3D.tsx:~1012`) is smooth sine waves. Add a **high-frequency second noise octave** to the terrain vertex displacement so the surface reads as chaotic regolith instead of rolling dunes. ~10k verts, computed once at build — 0 idle fps preserved.

Research: `docs/02-realistic-3d-world/cinematic-beauty-immersion.md` (Wave 3).

## Acceptance criteria

- [ ] High-frequency second octave added to terrain displacement
- [ ] Surface reads as fine regolith, not smooth waves
- [ ] Vertex count unchanged; computed once (no `useFrame`)
- [ ] 0 idle fps preserved; lint+test+build green + surface close-up screenshot

## Blocked by

None - can start immediately
