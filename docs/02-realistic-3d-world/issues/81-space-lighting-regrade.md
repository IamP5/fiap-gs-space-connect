# Space lighting re-grade: subtle earthshine, dark void, side-lit terminator

- **Issue:** [#81](https://github.com/IamP5/fiap-gs-space-connect/issues/81)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** HITL (subjective color science — needs a design-review screenshot sign-off)
- **Wave:** Space-view realism (2) · **Research:** [`space-view-realism.md`](../space-view-realism.md) §1–§2

## What to build

Re-grade the orbit/space lighting to match the NASA SVS references (4720 CGI Moon Kit, 14992 phases, 14959 Moon models). The scene currently reads over-lit and over-saturated-blue. Make **earthshine a subtle cool whisper** (not a blue glow), **darken** the shadow fill (hemisphere + ambient), push the **void near-black**, keep the **sun hard and white**, raise the Moon near-material `normalScale` to ~0.5, and ensure the **orbit preset frames the Moon with a visible soft side-lit terminator** (sun off-axis from the camera→Moon line — the single biggest free realism win). No new assets.

Target palette: sun `#FFF6EC`; earthshine `#A8BFDA` at ~0.10–0.18× sun; hemisphere `#FFE9CC`/`#1A1814` ~0.25; ambient `#0E1014` ~0.10–0.15.

## Acceptance criteria

- [ ] Earthshine dimmed to ~0.10–0.18× sun intensity and desaturated (pale steel-blue)
- [ ] Hemisphere + ambient lowered; void reads near-black
- [ ] Sun stays hard white; Moon stays mid-grey (lit limb not blown out)
- [ ] Moon near-material `normalScale` ≈ 0.5 (far material stays ~0.35)
- [ ] Orbit preset shows a visible soft terminator (sun off-axis)
- [ ] 0 idle fps; pick/click-to-kill intact; no mesh added to the bloom layer
- [ ] lint+test+build green + orbit & surface screenshots

## Blocked by

None — can start immediately
