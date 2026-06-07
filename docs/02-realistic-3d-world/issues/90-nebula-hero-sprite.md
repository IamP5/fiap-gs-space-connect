# Nebula/supernova hero sprite (ESA/Hubble Veil Nebula, orbit view)

- **Issue:** [#90](https://github.com/IamP5/fiap-gs-space-connect/issues/90)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK
- **Wave:** Space-view realism (2) · **Research:** [`space-view-realism.md`](../space-view-realism.md) §4–§5

## What to build

Add a nebula/supernova **hero vista accent** in the orbit view using the **ESA/Hubble Veil Nebula** ("Witch's Broom", heic0712a — CC-BY 4.0, genuine black background) as a 2–4 layer **additive sprite stack** (mirrors the Sun sprite construction). Orbit-view-only (gated like the Moon globe), with a radial-gradient `CanvasTexture` fallback. Self-host the downscaled image.

> CC-BY = break-glass: lands only with the required in-app credits affordance / CREDITS.md entry.

## Acceptance criteria

- [ ] Veil Nebula image self-hosted (downscaled); 2–4 layer additive sprite stack
- [ ] Orbit-view-only (gated), `invalidate()` on the view toggle
- [ ] `toneMapped:false`, `depthWrite:false`, `fog:false`, `raycast={()=>null}`; NOT on the bloom layer
- [ ] Radial-gradient CanvasTexture fallback (ADR-0004)
- [ ] CC-BY credit recorded verbatim ("NASA, ESA, and the Hubble Heritage (STScI/AURA)-ESA/Hubble Collaboration. Acknowledgment: J. Hester (ASU)")
- [ ] 0 idle fps; lint+test+build green + orbit screenshot

## Blocked by

- #83 (Milky-Way star background — the nebula reads against it)
