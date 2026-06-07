# Day/night Earth (Blue+Black Marble) + atmospheric rim shell

- **Issue:** [#86](https://github.com/IamP5/fiap-gs-space-connect/issues/86)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK
- **Wave:** Space-view realism (2) · **Research:** [`space-view-realism.md`](../space-view-realism.md) §2

## What to build

Upgrade Earth from a self-lit marble to a **two-map day/night material** plus a cheap atmospheric rim. Self-host NASA **Blue Marble** (day) + **Black Marble** (city-lights); show warm-gold lights only on the dark side; add an **atmospheric rim** via a back-side additive shell (×1.02–1.04, `depthWrite:false`, cool blue). Keep the primitive fallback. (Pays off mainly once Earth grows on screen.)

## Acceptance criteria

- [ ] Blue Marble day + Black Marble night-emissive maps self-hosted (downscaled), correct color spaces
- [ ] City lights warm gold (`#FFC061`), emissive only on the dark side
- [ ] Atmospheric rim: back-side additive shell (×1.02–1.04, depthWrite false, cool blue)
- [ ] Primitive marble fallback retained; `invalidate()` once on load
- [ ] NASA-PD credits recorded (Blue Marble: Next Generation; Black Marble)
- [ ] 0 idle fps; lint+test+build green + orbit screenshot

## Blocked by

None — can start immediately
