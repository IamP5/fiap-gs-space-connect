# Camera feel: idle drift, inertial damping, zoom exposure, parallax starfield

- **Issue:** [#109](https://github.com/IamP5/fiap-gs-space-connect/issues/109)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK
- **Wave:** Cinematic beauty & immersion (3) · **Research:** [`cinematic-beauty-immersion.md`](../cinematic-beauty-immersion.md)

## What to build

Make interacting with the camera feel magical. Add a gentle **idle auto-drift** after ~4s of no input (±3° azimuth sine sway or `autoRotate ~0.5`; any input cancels instantly). Add **inertial damping** to the controls. **Zoom-responsive exposure/bloom** lift as you push in. Subtle **parallax** of the starfield on drag. The idle drift loops, so it uses `useFrame` + `invalidate()` and **pauses when the tab is hidden**.

Research: `docs/02-realistic-3d-world/cinematic-beauty-immersion.md` (Wave 3).

## Acceptance criteria

- [ ] Idle drift after ~4s no-input; any interaction cancels immediately
- [ ] Controls inertial damping enabled
- [ ] Zoom-responsive exposure/bloom lift
- [ ] Parallax starfield response on drag
- [ ] Idle loop pauses on `document.hidden`; 0 idle fps when drift disabled/hidden
- [ ] lint+test+build green + interaction clip

## Blocked by

None - can start immediately
