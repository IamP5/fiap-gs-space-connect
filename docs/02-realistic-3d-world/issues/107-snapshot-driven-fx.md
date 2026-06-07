# Snapshot-driven FX: rover wheel dust, bid-war strobe, resurrection shockwave

- **Issue:** [#107](https://github.com/IamP5/fiap-gs-space-connect/issues/107)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK
- **Wave:** Cinematic beauty & immersion (3) · **Research:** [`cinematic-beauty-immersion.md`](../cinematic-beauty-immersion.md)

## What to build

Visceral feedback driven by snapshot changes — **demand-safe**: each fires only on the existing snapshot/beat tick, so 0 idle fps holds. (1) **Rover wheel dust**: on a rover position delta, emit ~15 fading regolith particles via a single drei `<Instances>` draw call. (2) **Bid-war strobe**: a higher-frequency halo strobe + bloom-intensity spike during auction contention. (3) **Resurrection shockwave**: an expanding ring + grey→bright body lerp on the `revived` beat.

Research: `docs/02-realistic-3d-world/cinematic-beauty-immersion.md` (Wave 3).

## Acceptance criteria

- [ ] Rover dust on position delta via drei `Instances` (one draw call), fades out
- [ ] Bid-war strobe (halo + bloom intensity spike) during contention
- [ ] Resurrection shockwave (expanding ring + color lerp) on the `revived` beat
- [ ] All effects driven by snapshot/beat changes — no idle animation; 0 idle fps preserved
- [ ] Scene stays a pure function of the snapshot; pick/click-to-kill intact
- [ ] lint+test+build green + screenshots/clip

## Blocked by

None - can start immediately
