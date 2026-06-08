# [Epic] Floating game-like HUD — view-gated, minimal, NMS-style orbit markers

> **Status: SHIPPED ✅** — all 6 slices built and merged to `main` (branch
> `feat/06-hud-redesign`). `tsc -b` clean + 195 web tests green. `feature_list.json`
> `r3d-147..r3d-152` → `passing`. **Outstanding follow-ups:** capture the 8-shot
> verification screenshots ([VERIFICATION.md](./VERIFICATION.md)) and the in-world
> orbit-marker fade-in (R3F, not CSS-reachable). All boxes below delivered:
>
> - [x] #147 foundation · [x] #148 NMS markers · [x] #149 hotbar · [x] #150 Mission HUD · [x] #151 placement gestures · [x] #152 motion + polish

- **Issues:** no umbrella epic ticket; published as 6 slices on `IamP5/fiap-gs-space-connect`:
  [#147](https://github.com/IamP5/fiap-gs-space-connect/issues/147) foundation ·
  [#149](https://github.com/IamP5/fiap-gs-space-connect/issues/149) hotbar ·
  [#151](https://github.com/IamP5/fiap-gs-space-connect/issues/151) placement gestures ·
  [#150](https://github.com/IamP5/fiap-gs-space-connect/issues/150) Mission HUD ·
  [#148](https://github.com/IamP5/fiap-gs-space-connect/issues/148) NMS markers ·
  [#152](https://github.com/IamP5/fiap-gs-space-connect/issues/152) motion+polish
- **Labels:** `area:frontend`, `type:feature` / `type:refactor`
- **Type:** Epic (frontend-only — React HUD + R3F marker mesh; no backend, no wire changes)
- **Dependency order:** #147 & #148 unblocked → #149, #150 (need #147) → #151 (needs #149) → #152 (needs #148–#151)
- **Builds on:** [two-site-lunar-surface](../04-two-site-lunar-surface/README.md)
  (orbit markers #137, surface sites #134–138) and
  [app-init-refactor](../05-app-init-refactor/README.md) (orbit is the default view,
  preload-everything splash).
- **ADR(s) to honor:** ADR-0004 (scene/HUD are a pure re-render of the snapshot;
  selection + transient placement are the only client state). **NB:** the demand-loop /
  0-idle-fps budget was **dropped** — the scene runs `frameloop="always"` and
  `useFrame` is unrestricted (see `AGENTS.md`). A subtle always-on marker pulse is
  therefore free; keep `dpr ≤ ~1.5` + bounded draw calls as hygiene.

## What to build

Replace the always-on wall of opaque panels with a **floating, game-like HUD that
shows only what matters in the current view**, and rework the two weakest panels
(Blueprints, Task ledger). Two axes drive visibility: `viewMode` (orbit | surface)
and `activeSite` (lunar | shackleton).

1. **Orbit = the site picker.** Slim top bar over the cinematic Moon vista and the
   two **3D reticle markers** — nothing else. The ledger, blueprint palette, stress
   sliders, and Earth panel (all dead weight from orbit) are gone here.
2. **Surface = build + stress.** A bottom **hotbar** (the build palette as
   footprint-glyph icons + an `LLM Generated` toggle + failure/latency popovers + a
   site chip), a compact **Mission HUD** widget that tells the self-heal story at a
   glance, the **Earth uplink** widget (the latency drama), and a contextual
   **Kill panel**.
3. **NMS-style orbit markers.** Swap the flat ring + glow disc + stubby beacon for an
   **in-world glowing line-diamond reticle** — billboarded, occluding behind the
   limb, bloom halo, subtle pulse, hover lock-on — with **in-world SDF text**
   (`LUNAR BASE · operational` / `SHACKLETON · in construction`).

### Why

Running the demo confirmed the HUD is the weak point. In **orbit** you can't even see
a worksite, yet the entire left wall is TASK LEDGER + BLUEPRINTS + FAILURE + LATENCY
— answering questions nobody's asking and competing with the hero shot. The
Blueprints panel is a text-list-of-cards with a clumsy slider-driven placement
sub-panel; the Task ledger enumerates every task id/assignee (debug-grade) while the
3D scene already shows the rovers building. The orbit markers read as flat "landing
splats" that foreshorten at the orbit angle.

The fix is **context**: each view shows only its own controls, rendered as solid
floating game-UI panels, with the build palette as a proper **bottom hotbar** and the
ledger as a **progress HUD** that visibly dips and recovers under stress — turning the
data mirror into part of the self-heal narrative.

## Locked decisions (from the grill)

| Decision | Choice |
| --- | --- |
| HUD model | Slim top bar + bottom hotbar (actions) + corner readout widgets, **view-gated** |
| Skin | **Solid game-UI panels** — opaque, beveled, strong borders, drop shadow; cyan primary / amber warning |
| Orbit survivors | Top bar only: wordmark · connection pill · Reload demo · Surface/Orbit toggle · (+ the two 3D markers). **No** ledger/blueprints/stress/Earth. |
| Surface hotbar | One unified bottom bar: footprint-glyph blueprint icons · `☐ LLM Generated` · `⚠`/`⏱` popovers · `📍` site chip |
| `LLM Generated` toggle | **Persistent** hotbar checkbox, default **off** (Replay); checked ⇒ Live. Replaces the per-placement Replay/Live toggle. |
| Placement | Pick glyph → ghost follows cursor, **camera locks**, **L-click place · R-drag rotate · scroll zoom · ESC/re-click cancel**; context menu suppressed. No big sub-panel — just a cursor-anchored validity tick + key hint. |
| Site switch | Orbit: click a marker. Surface: **hotbar site chip** cycles Lunar↔Shackleton with a re-descent. No site toggle in either top bar. |
| Task ledger | **Mission HUD** widget: build progress bar `done/total` + `rovers N/M alive` (both dip + recover under failure). Click to **expand** the full task list; legend → hover tooltip. |
| Blueprint icons | **Footprint glyphs** generated from the catalog's real `rel` positions (top-down schematic of what you drop). |
| Orbit markers | **In-world 3D line-diamond reticle**, billboarded, occludes behind limb, bloom halo, subtle pulse, hover lock-on. **In-world SDF text** (name + status word). No build numbers (preserves the surface payoff). |
| Motion | Surface panels **slide/fade in on landing**, out on return (synced to the transition driver); markers fade in on the vista. **Cinematic key `H`** fades all HUD out/in for clean screenshots. |

## Success criteria

- Orbit view shows **only** the top bar + two markers; ledger/blueprints/stress/Earth
  are not in the DOM (or fully faded out) in orbit.
- Surface view shows the hotbar + Mission HUD + Earth + (contextual) Kill panel.
- Blueprint placement works end-to-end with the new gestures (L-place, R-rotate,
  scroll-zoom, ESC-cancel) and the persistent `LLM Generated` toggle threads `mode`
  into the `placeBlueprint` control unchanged.
- Mission HUD's progress + rover counts visibly drop when Failure spikes and recover
  as the swarm heals.
- Orbit markers occlude behind the Moon's limb and read crisp at the orbit angle;
  clicking one still descends to that site.
- `H` toggles all HUD; orbit↔surface panel transitions are animated and don't fight
  the existing glare-masked descent.
- No new global client state beyond what App already owns (selection, placement,
  viewMode, activeSite) + a `hudHidden` flag and the persistent `liveMode` toggle.

See [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) for the phased, source-verified plan.
