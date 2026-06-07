# Twinkling stars + meteor streaks

- **Issue:** [#106](https://github.com/IamP5/fiap-gs-space-connect/issues/106)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK
- **Wave:** Cinematic beauty & immersion (3) · **Research:** [`cinematic-beauty-immersion.md`](../cinematic-beauty-immersion.md)

## What to build

Make the sky alive. Extend the existing starfield `onBeforeCompile` patch (`SpaceEnvironment.tsx:244`) with a per-star `aPhase` attribute and a `uTime` uniform so `gl_PointSize *= 0.7 + 0.3 * sin(uTime * freq + aPhase)` — stars twinkle. Add occasional **meteor streaks** (a reusable `Line` that fades over ~800ms, firing every 3–8s).

This is the first intentional **idle animation**: a `useFrame` drives `uTime` and calls `invalidate()` each tick. To stay polite it **pauses when the tab is hidden** (`visibilitychange`/`document.hidden`); meteors only invalidate while active. The scene stays a pure function of the snapshot (decoration is snapshot-independent).

Research: `docs/02-realistic-3d-world/cinematic-beauty-immersion.md` (Wave 3).

## Acceptance criteria

- [ ] Per-star `aPhase` + `uTime`; sin-based `gl_PointSize` twinkle
- [ ] Meteor streaks every ~3–8s via a reusable fading `Line`
- [ ] `useFrame` drives `uTime` + `invalidate`; PAUSES on `document.hidden`
- [ ] Snapshot purity preserved (decorative, snapshot-independent)
- [ ] lint+test+build green + orbit screenshot/clip

## Blocked by

None - can start immediately
