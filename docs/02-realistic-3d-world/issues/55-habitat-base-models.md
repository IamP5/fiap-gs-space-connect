# Habitat/base Assets — populate the Asset catalog

- **Issue:** [#55](https://github.com/IamP5/fiap-gs-space-connect/issues/55)
- **Epic:** [#46](https://github.com/IamP5/fiap-gs-space-connect/issues/46)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK
- **ADR:** [0010 — live-mode curated Asset catalog](../../01-build-harness/adr/0010-live-mode-curated-asset-catalog.md)

## What to build

Map realistic habitat/base **Assets** to the existing dome/wall/foundation/module build vocabulary and **register them in the Asset catalog** (ADR-0010) so both replay and live modes can place them by key (primitive fallback intact).

**NASA picks** (`master`, already `.glb`, via `raw.githubusercontent.com/nasa/NASA-3D-Resources/master/…`): **Habitat Demonstration Unit** parts 1+2 (0.5 / 0.7 MB — literal NASA surface habitat), **Radome** (0.8 MB — clean dome), Base Station (0.02 MB), ESAS Crew Module (0.01 MB). **CC0 alternates:** Quaternius Ultimate Space Kit Geodesic Dome + Kenney Space Station Kit modules. Condition via #52; credit NASA / author, strip insignia. Rising-by-completion structure logic unchanged.

## Acceptance criteria

- [ ] Habitat Assets registered as Asset-catalog entries (key → model_ref + task types + normalization transform)
- [ ] dome/wall/foundation/module ops render the Assets with primitive fallback
- [ ] Assets self-hosted in web/public/assets/, conditioned, and credited in CREDITS.md (no insignia)
- [ ] Rising-dome completion ordering still reads correctly
- [ ] Click-to-kill / deselect unaffected; idle stays 0 fps

## Blocked by

- [#48](https://github.com/IamP5/fiap-gs-space-connect/issues/48)
- [#59](https://github.com/IamP5/fiap-gs-space-connect/issues/59)
