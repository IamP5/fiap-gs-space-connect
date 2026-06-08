# Epic 06 — HUD redesign: visual verification + screenshot checklist

> Live (browser) verification for the floating game-like HUD, capping the epic at
> **P4 — Motion + polish (#152)**. The automated gate (`npx tsc -b --noEmit &&
> npx vitest run`, 195 tests) is green; this file covers the parts only a running
> browser can confirm — the animated view transitions, the `H` cinematic-hide
> compose, the Earth/Kill restyle, and the screenshot pass.

## How to run the app

```sh
cd web
VITE_MOCK=1 npm run dev    # UI with no backend — deterministic mock snapshot at :5173
# or, against a live stack:  npm run dev
```

No screenshot script exists in-repo. The orchestrator captures shots **live**
with the `chrome-devtools` MCP tools (`navigate_page` → `take_screenshot`),
landing files in `.screenshots/` (where prior epic shots already live).

## Animated transition — what to look for

- Toggle **Orbit → Surface** (top-bar view toggle, or click an orbit marker). The
  surface panels (Mission HUD top-left, Hotbar bottom-centre, Earth uplink
  bottom-right) should **slide up + fade IN** as the glare-masked descent *settles*
  — i.e. they appear just AFTER the glare peak (~0.8s into the ~1.5s descent), not
  before it and not fighting the flash.
- Toggle **Surface → Orbit**. The same panels **fade OUT** quickly under the ascent;
  orbit ends clean (top bar + the two 3D markers only).
- The transition is **pure CSS** off the `viewMode` flip — there is no second JS
  animation clock (Risk #5). Confirm by inspecting `.hud-stage`: it carries
  `hud--surface` or `hud--orbit`; the surface panels carry `hud-surface-panel`.

## `H` cinematic-hide compose — what to look for

- Press **`H`** at rest (orbit and surface): the entire HUD cross-fades out, leaving
  a pure 3D scene; press again to bring it back.
- Press **`H` MID-transition** (start a descent, then hit `H` before it settles):
  the HUD must still go fully hidden — `hud--hidden` on the wrapper zeroes opacity
  and that multiplies the children's fade, so hide always wins regardless of the
  surface/orbit state. The two effects compose, they do not fight.
- While hidden, clicks must pass THROUGH to the scene (orbit-drag still works) — the
  wrapper drops `pointer-events`. Verify a hidden HUD never eats a click.

## Earth + Kill restyle — what to look for

- **Earth uplink** sits **bottom-right**, **Kill panel** **top-right**. Both now wear
  the shared `.panel` game-UI skin (opaque beveled plate + drop shadow) — visually
  consistent with the Hotbar and Mission HUD. (The legacy flat-card bg/border was
  removed so the `.panel` skin wins.)
- **Kill is contextual**: it renders ONLY for a *live selected rover*. Click a rover
  → it appears top-right with an armed KILL; killing it → it shows DOWN, then
  dismiss clears it. With nothing selected, no Kill panel is in the DOM.

## Screenshot checklist (capture these)

Default view is **orbit**. For each surface shot, toggle to surface and let the
descent settle (panels animated in) before capturing. Capture each scene twice:
**HUD-on**, then press **`H`** and capture **HUD-hidden** (pure scene).

| # | Scene | HUD | Suggested filename |
|---|-------|-----|--------------------|
| 1 | Orbit vista (both markers) | on | `.screenshots/hud-152-orbit-on.png` |
| 2 | Orbit vista | `H` hidden | `.screenshots/hud-152-orbit-hidden.png` |
| 3 | Lunar surface (Mission HUD + Hotbar + Earth) | on | `.screenshots/hud-152-lunar-on.png` |
| 4 | Lunar surface | `H` hidden | `.screenshots/hud-152-lunar-hidden.png` |
| 5 | Shackleton surface | on | `.screenshots/hud-152-shackleton-on.png` |
| 6 | Shackleton surface | `H` hidden | `.screenshots/hud-152-shackleton-hidden.png` |
| 7 | Lunar surface, rover selected (Kill panel top-right) | on | `.screenshots/hud-152-kill-panel.png` |
| 8 | Mid orbit→surface transition (panels sliding in) | on | `.screenshots/hud-152-transition.png` |

Steps per shot:

1. `cd web && VITE_MOCK=1 npm run dev`; open `http://localhost:5173`.
2. Wait for the splash to clear (preload settles).
3. Drive the view: orbit is default; click a marker or the top-bar toggle to descend;
   the Hotbar `📍` site chip cycles Lunar ↔ Shackleton.
4. For Kill (#7): on the surface, click a rover, then capture before killing.
5. For each scene capture HUD-on, press `H`, capture HUD-hidden, press `H` to restore.

## Known limitation (noted, not a regression)

- **Orbit marker fade-in is in-world (R3F), not CSS-reachable.** The two NMS markers
  live as drei meshes in `SkyBodies` on the celestial bloom layer — there is no DOM
  hook for a CSS fade, and P4 scope forbids touching the marker / Scene3D transition
  logic. The DOM HUD transition (the priority) is fully delivered; a marker fade
  would be a follow-up inside `SkyBodies` (a `useFrame` opacity ramp keyed on the
  rendered `shown === "orbit"`), out of scope here.
