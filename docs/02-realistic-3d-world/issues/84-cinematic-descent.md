# Cinematic orbit→surface descent: pitch-ramp + asymmetric easing + parallax

- **Issue:** [#84](https://github.com/IamP5/fiap-gs-space-connect/issues/84)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** HITL (cinematic feel — needs a design-review sign-off)
- **Wave:** Space-view realism (2) · **Research:** [`space-view-realism.md`](../space-view-realism.md) §3

## What to build

Upgrade the orbit→surface descent (existing single ~1.5s rAF) to feel like the **SVS 4444** flythrough: a **pitch ramp** (camera rotates from nadir to a low oblique so the horizon rises only in the final ~15%); **asymmetric easing** (ease-in departure, fast middle, hard ease-out landing); a **subtle lateral arc + parallax** (small X drift, optional 1–3° roll zeroed at arrival); and **slim the glare** to a brief off-center sun-bloom tied to the scene swap. Reverse mirrors it.

## Acceptance criteria

- [ ] Pitch ramp via quaternion slerp / lookAt lerp (nadir → oblique); horizon rises in final ~15%
- [ ] Asymmetric easing (fast middle, slow arrival)
- [ ] Subtle arc/parallax (small X offset; optional tiny roll zeroed at arrival)
- [ ] Glare slimmed to an off-center bloom occluding the swap for only a few frames
- [ ] Single rAF still stops after the move → 0 idle fps; controls re-enabled after
- [ ] Reverse surface→orbit works; pick/click-to-kill intact
- [ ] lint+test+build green + mid-flight and settled screenshots

## Blocked by

None — can start immediately
