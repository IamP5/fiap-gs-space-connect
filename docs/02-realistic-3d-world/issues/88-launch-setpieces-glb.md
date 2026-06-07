# Launch set-pieces: Crawler + Mobile Launcher + Gantry + Apollo LM (NASA GLBs)

- **Issue:** [#88](https://github.com/IamP5/fiap-gs-space-connect/issues/88)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK · **Relates:** #56
- **Wave:** Space-view realism (2) · **Research:** [`space-view-realism.md`](../space-view-realism.md) §7
- **⚠️ Status note:** All four GLBs already shipped on main (PR #71). Kept open by user decision; treat as verify/no-op unless re-scoping.

## What to build

Populate the launch-infrastructure set-pieces with verified NASA-PD GLBs: **Crawler-Transporter** (1.63 MB), **Mobile Launcher** assembled (198 KB), **Gantry** (1.39 MB), **Apollo Lunar Module** (717 KB). Self-host + condition; decorative (`raycast={()=>null}`), primitive fallbacks; strip any insignia.

## Acceptance criteria

- [ ] Crawler, Mobile Launcher, Gantry, Apollo LM GLBs self-hosted + conditioned
- [ ] Placed as decorative scenery (`raycast={()=>null}`); primitive fallback per model
- [ ] Bounded draw calls; 0 idle fps; no NASA insignia decals
- [ ] NASA-PD credits recorded (per-model author)
- [ ] lint+test+build green + screenshot

## Blocked by

- #52 (asset conditioning pipeline)
