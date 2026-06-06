# Launch infrastructure set-pieces (Scenery: crawler + launcher + LM)

- **Issue:** [#56](https://github.com/IamP5/fiap-gs-space-connect/issues/56)
- **Epic:** [#46](https://github.com/IamP5/fiap-gs-space-connect/issues/46)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK

## What to build

Add the requested "ship launching platform" as static NASA-PD **Scenery** set-pieces — non-diegetic decoration, not snapshot-driven, **not** in the Asset catalog. Place as static components in Scene3D (still via `model_ref` with a primitive fallback), scaled to the worksite.

**NASA picks** (`master`, already `.glb`, tiny — no DRACO needed): **Mobile Launcher** (`Mobile Launcher/…(assembled).glb`, 0.2 MB), **Crawler** (`Crawler/Crawler.glb`, 1.6 MB), **Gantry** (`Gantry/Gantry.glb`, 1.4 MB); lander: Apollo Lunar Module (0.7 MB) or InSight (panels deployed, 4.0 MB) or Viking (1.9 MB). Fetch via `raw.githubusercontent.com/nasa/NASA-3D-Resources/master/<encoded path>`. Credit NASA per courtesy; **strip any insignia**, no implied endorsement. (Per the grill: kept as knowingly non-diegetic Scenery — they imply activity the swarm isn't doing.)

## Acceptance criteria

- [ ] Crawler, mobile launcher, and a lander render as static Scenery with primitive fallback
- [ ] Placed as decoration (not snapshot-driven, not catalog Assets)
- [ ] Self-hosted in web/public/assets/, scaled sensibly, credited (NASA / author); no insignia
- [ ] Click-to-kill / deselect unaffected; idle stays 0 fps

## Blocked by

- [#48](https://github.com/IamP5/fiap-gs-space-connect/issues/48)
