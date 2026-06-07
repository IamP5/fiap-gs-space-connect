# Cinematic beats: intro orbital fly-in, Earthrise hero shot, launch + screen shake

- **Issue:** [#108](https://github.com/IamP5/fiap-gs-space-connect/issues/108)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK
- **Wave:** Cinematic beauty & immersion (3) · **Research:** [`cinematic-beauty-immersion.md`](../cinematic-beauty-immersion.md)

## What to build

Signature wow-moments, each animating only for its duration then returning to idle. (1) **Intro orbital fly-in** on first mount, reusing the glare-masked orbit→surface descent (#84) stretched to ~4.5s so the experience opens from deep space. (2) An **`earthrise-hero`** beat: disable controls, lerp the camera to frame Earth over the lunar horizon, hold, restore. (3) A **`launch`** beat: additive exhaust billboards + godray flare + decaying Perlin camera shake. Add the new beat kinds to `lib/choreography.ts`.

Research: `docs/02-realistic-3d-world/cinematic-beauty-immersion.md` (Wave 3).

## Acceptance criteria

- [ ] Intro fly-in on first mount (reuses the descent rig; ~4.5s; controls disabled then restored)
- [ ] `earthrise-hero` beat frames Earth over the horizon, holds, restores controls
- [ ] `launch` beat: exhaust + flare + decaying screen shake
- [ ] Each beat animates for its duration then returns to 0 idle fps
- [ ] Reverse/cleanup correct; pick/click-to-kill intact after
- [ ] lint+test+build green + screenshots/clips of each beat

## Blocked by

None - can start immediately
