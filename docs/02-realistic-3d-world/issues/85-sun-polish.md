# Sun polish: limb darkening + faint chromatic glow sprites

- **Issue:** [#85](https://github.com/IamP5/fiap-gs-space-connect/issues/85)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK
- **Wave:** Space-view realism (2) · **Research:** [`space-view-realism.md`](../space-view-realism.md) §4

## What to build

Improve the Sun's distant-star believability with static `CanvasTexture` sprites (no new assets): a **limb-darkening** gradient overlay (bright center → warmer/dimmer edge) and a **faint chromatic glow** (one warm + one cool, offset, additive). Keep the core white. Mirrors the existing Sun sprite construction.

## Acceptance criteria

- [ ] Limb-darkening overlay sprite (CanvasTexture, additive, static)
- [ ] Faint warm + cool offset chromatic-glow sprites
- [ ] Core stays white; all sprites `toneMapped:false`, `fog:false`, `raycast={()=>null}`
- [ ] Guards `typeof document`; disposes textures on unmount; no `useFrame`
- [ ] Not added to the bloom layer; 0 idle fps
- [ ] lint+test+build green + orbit screenshot

## Blocked by

None — can start immediately
