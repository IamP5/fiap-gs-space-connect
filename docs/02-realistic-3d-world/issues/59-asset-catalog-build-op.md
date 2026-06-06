# Asset catalog + catalog-key Build op (wire + schema)

- **Issue:** [#59](https://github.com/IamP5/fiap-gs-space-connect/issues/59)
- **Epic:** [#46](https://github.com/IamP5/fiap-gs-space-connect/issues/46)
- **Labels:** `area:backend`, `area:frontend`, `type:feature`
- **Type:** AFK
- **ADR:** [0010 — live-mode curated Asset catalog](../../01-build-harness/adr/0010-live-mode-curated-asset-catalog.md)

## What to build

Introduce the **Asset catalog** and a catalog-key reference on Build ops, per ADR-0010. Define the closed Asset catalog structure carried by the Build contract; each entry pairs an Asset **key** with a resolved `model_ref` + suited task types + a **per-Asset normalization transform `{scale, offset, rotation}`** (applied on top of the op transform so a raw Asset fits its Build envelope deterministically — geometry-level fixes like up-axis/normals/center are baked offline in #52; this transform handles per-placement fit/orientation). Add an Asset-key field to the Build op in BOTH wire schemas (`internal/.../wire.go` and `web/src/types/wire.ts`) alongside the existing `model_ref` slot. Add server-side resolution key → `model_ref` when interpreting a spec; the browser only ever receives resolved, self-hosted URLs. A default global catalog may back contracts that don't specify one.

Catalog keys follow a stable slug convention (e.g. the NASA folder slug); **each `.glb` variant is a distinct key** (the closed set the Model picks from).

## Acceptance criteria

- [ ] Asset catalog type defined (key → model_ref + task types + normalization transform), carried by the Build contract
- [ ] Catalog entry carries a normalization transform `{scale, offset, rotation}` applied to the Asset
- [ ] Build op gains an Asset-key field in Go wire + TS wire, kept in sync
- [ ] key → model_ref resolution implemented server-side; browser receives only resolved URLs
- [ ] Stable key slug convention; each `.glb` variant = distinct key
- [ ] Replay specs can reference Assets by catalog key
- [ ] Unit tests for catalog resolution + a default/global catalog fallback

## Blocked by

None - can start immediately
