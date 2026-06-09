---
version: alpha
name: Spasex-design-analysis
description: An inspired interpretation of Spasex's design language — a mission-oriented aerospace brand built on pure black canvas, full-bleed photographic and video heroes of rockets and Mars landscapes, and uppercase D-DIN display type set in tight vertical leading. UI chrome is intentionally minimal: a single ghost outlined pill button per band, all-caps eyebrow microtext, and a fixed top nav over photography. The system is unapologetically austere — black, white, and the imagery itself. The same negation extends to the live product — an in-world, No Man's Sky–style diegetic Mission HUD that renders as emitted light — type, hairlines, line-art glyphs, and bloom-lit reticles over the 3D scene — never as opaque boxed panels.

colors:
  primary: "#000000"
  ink: "#000000"
  on-primary: "#ffffff"
  on-primary-mute: "#f0f0fa"
  canvas-night: "#000000"
  canvas-night-soft: "#0a0a0a"
  canvas-light: "#ffffff"
  canvas-cool: "#f0f0fa"
  hairline-on-dark: "#3a3a3f"
  hairline-on-light: "#e0e0e8"
  link-on-dark: "#ffffff"
  link-blue-fallback: "#0000ee"
  ink-mute: "#5a5a5f"
  hud-cyan: "#3fd0e6"
  hud-amber: "#f5a623"
  signal-ok: "#2ecc71"
  signal-warn: "#f5a623"
  signal-down: "#e74c3c"
  signal-idle: "#9aa4b2"

typography:
  display-xxl:
    fontFamily: "D-DIN-Bold, Arial Narrow, Arial, Verdana, sans-serif"
    fontSize: 80px
    fontWeight: 700
    lineHeight: 0.95
    letterSpacing: 1.6px
  display-xl:
    fontFamily: "D-DIN-Bold, Arial Narrow, Arial, Verdana, sans-serif"
    fontSize: 60px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: 1.2px
  display-lg:
    fontFamily: "D-DIN-Bold, Arial Narrow, Arial, Verdana, sans-serif"
    fontSize: 48px
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: 0.96px
  body-lg:
    fontFamily: "D-DIN, Arial, Verdana, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: 0.32px
  body-md:
    fontFamily: "D-DIN, Arial, Verdana, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0.32px
  button-cap:
    fontFamily: "D-DIN, Arial, Verdana, sans-serif"
    fontSize: 13.008px
    fontWeight: 700
    lineHeight: 0.94
    letterSpacing: 1.17px
  micro-cap:
    fontFamily: "D-DIN, Arial, Verdana, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 2.0
    letterSpacing: 0.96px
  caption:
    fontFamily: "D-DIN, Arial, Verdana, sans-serif"
    fontSize: 13.008px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0

rounded:
  xs: 4px
  sm: 8px
  md: 16px
  pill: 32px
  full: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 18px
  xl: 24px
  xxl: 32px
  huge: 48px

components:
  button-ghost-on-dark:
    backgroundColor: "{colors.canvas-night}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-cap}"
    rounded: "{rounded.pill}"
    padding: 18px 24px
  button-ghost-on-light:
    backgroundColor: "{colors.canvas-light}"
    textColor: "{colors.ink}"
    typography: "{typography.button-cap}"
    rounded: "{rounded.pill}"
    padding: 18px 24px
  button-filled-cool:
    backgroundColor: "{colors.canvas-cool}"
    textColor: "{colors.ink}"
    typography: "{typography.button-cap}"
    rounded: "{rounded.pill}"
    padding: 18px 24px
  text-input:
    backgroundColor: "{colors.canvas-light}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.xs}"
    padding: 12px 16px
  card-photo-band:
    backgroundColor: "{colors.canvas-night}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-md}"
    rounded: "{rounded.xs}"
    padding: 0px
  card-shop-product:
    backgroundColor: "{colors.canvas-light}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    padding: 16px
  nav-bar-overlay:
    backgroundColor: "{colors.canvas-night}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-cap}"
    rounded: "{rounded.xs}"
    padding: 24px 32px
  link-on-dark:
    backgroundColor: "{colors.canvas-night}"
    textColor: "{colors.link-on-dark}"
    typography: "{typography.body-md}"
    rounded: "{rounded.xs}"
    padding: 0px
  link-on-light:
    backgroundColor: "{colors.canvas-light}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.xs}"
    padding: 0px
  footer-dark:
    backgroundColor: "{colors.canvas-night}"
    textColor: "{colors.on-primary}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: 32px 24px
  hud-readout:
    backgroundColor: "transparent"
    textColor: "{colors.on-primary}"
    typography: "{typography.micro-cap}"
    rounded: "{rounded.xs}"
    padding: 0px
  hud-hairline-rule:
    backgroundColor: "transparent"
    textColor: "{colors.on-primary}"
    typography: "{typography.micro-cap}"
    rounded: "{rounded.xs}"
    padding: 0px
  hud-progress-thread:
    backgroundColor: "transparent"
    textColor: "{colors.hud-cyan}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: 0px
  hud-reticle:
    backgroundColor: "transparent"
    textColor: "{colors.hud-cyan}"
    typography: "{typography.micro-cap}"
    rounded: "{rounded.xs}"
    padding: 0px
  hud-corner-frame:
    backgroundColor: "transparent"
    textColor: "{colors.on-primary}"
    typography: "{typography.micro-cap}"
    rounded: "{rounded.xs}"
    padding: 0px
  hud-glyph:
    backgroundColor: "transparent"
    textColor: "{colors.on-primary}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: 0px
  hud-scrim:
    backgroundColor: "{colors.canvas-night}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-md}"
    rounded: "{rounded.full}"
    padding: 0px
---

## Overview

Spasex's design language is an exercise in negation: pure black canvas, white display type set in tight vertical leading and uppercase, full-bleed photography or autoplaying rocket-launch video as the only chrome. There is no brand color beyond black-and-white; there are no decorative shapes; there are no card grids or pricing tables on the marketing pages. Every band is a single full-viewport photograph or video paired with one all-caps headline at `{typography.display-xxl}` (80px D-DIN-Bold) and one ghost-outlined pill CTA. The composition is closer to a film title card than a SaaS landing page.

The brand's depth is photographic. Mars landscapes, rocket exhaust plumes, the F9 booster on a launchpad at sunset — these are the design system. Type sits over them at high opacity with no scrim, no gradient overlay; the photographs are graded so the type lands cleanly. When type does need a background, it sits on `{colors.canvas-night-soft}` (a barely-lifted near-black) with a 1px hairline in `{colors.hairline-on-dark}`.

Typography splits between **D-DIN-Bold** for display tiers (uppercase, tight tracking, condensed feel) and **D-DIN** regular for body and button labels. There is no third family — even pricing on the shop site uses the same two cuts. The display sizes are unusually tight in vertical leading (0.95–1.25) and unusually loose in horizontal tracking (1.6px positive at 80px) — the brand feels engineered rather than designed.

**Key Characteristics:**
- Single canvas: pure `{colors.canvas-night}` (`#000000`) for marketing; `{colors.canvas-light}` only on the shop site.
- Display tier in uppercase D-DIN-Bold with positive horizontal tracking (1.6px at 80px) — the brand's typographic signature.
- Full-bleed photography or autoplaying video as the dominant decorative element; type sits directly on imagery with no scrim.
- Single ghost-outlined pill CTA per band, at `{rounded.pill}` 32px radius — never filled, never accent-colored.
- All-caps eyebrow microtext (`{typography.micro-cap}` and `{typography.button-cap}`) with positive 0.96–1.17px tracking — every chrome element shouts in caps.
- Fixed top nav overlaid on photography — no opaque background, just white-on-image.
- Tight 0.95 line-height on the 80px display — vertical compression is the engineering aesthetic.
- **In-world Mission HUD is diegetic** — type, hairlines, line-art glyphs, and bloom-lit reticles emitted directly over the live 3D scene, with no opaque panels (see *In-World Mission HUD (Diegetic)*).

## Colors

> **Source pages:** home (`/`), `/shop`, `/vehicles/starship`, `/humanspaceflight/overview`, `/mission`.

### Brand & Accent
The brand has no accent colors. Black and white do all the chromatic work; photography supplies every other hue.

### Surface
- **Canvas Night** (`{colors.canvas-night}` — `#000000`): Default marketing canvas. Pure black, no tint.
- **Canvas Night Soft** (`{colors.canvas-night-soft}` — `#0a0a0a`): Barely-lifted near-black for content sections that need a subtle separation from the pure-black hero.
- **Canvas Light** (`{colors.canvas-light}` — `#ffffff`): The shop site's product surface.
- **Canvas Cool** (`{colors.canvas-cool}` — `#f0f0fa`): A pale cool-blue-white used as the secondary surface on the shop site and as the hover-canvas of certain ghost buttons.
- **Hairline on Dark** (`{colors.hairline-on-dark}` — `#3a3a3f`): 1px borders on dark surface chrome.
- **Hairline on Light** (`{colors.hairline-on-light}` — `#e0e0e8`): Borders on shop-site cards.

### Text
- **On Primary** (`{colors.on-primary}` — `#ffffff`): Default text on dark canvas; the dominant text color across the marketing site.
- **On Primary Mute** (`{colors.on-primary-mute}` — `#f0f0fa`): Slightly cooled-white used for secondary text on dark surfaces — barely distinguishable from `{colors.on-primary}` but enough to suggest a hierarchy.
- **Ink** (`{colors.ink}` — `#000000`): Default text on light surfaces (shop site).
- **Ink Mute** (`{colors.ink-mute}` — `#5a5a5f`): Secondary text on light surfaces.

### Link
- **Link on Dark** (`{colors.link-on-dark}` — `#ffffff`): Underlined inline link on dark canvas.
- **Link Blue Fallback** (`{colors.link-blue-fallback}` — `#0000ee`): The browser default that appears in unstyled fallback contexts — documented for completeness, not used as a brand color.

### Diegetic HUD Signal Tints

> **In-world product only — not marketing-brand accents.** The black-and-white rule still governs every marketing surface. The live dashboard admits a tightly-rationed set of *signal tints*, used **only as emitted light** (stroke, glow, text) over the 3D scene — never as fills, never on marketing pages. This mirrors No Man's Sky's monochrome-plus-single-tint HUD.

- **HUD Cyan** (`{colors.hud-cyan}` — `#3fd0e6`): Primary holographic tint — the active / Lunar-Base context and interactive affordances (active hotbar slot, focus, the build thread).
- **HUD Amber** (`{colors.hud-amber}` — `#f5a623`): Secondary tint — the Shackleton context and caution.
- **Signal OK / Warn / Down / Idle** (`{colors.signal-ok}` `#2ecc71` · `{colors.signal-warn}` `#f5a623` · `{colors.signal-down}` `#e74c3c` · `{colors.signal-idle}` `#9aa4b2`): Live-telemetry status — working/done, bidding/leased, dead/kill-target, idle/unclaimed. These encode *data*, not chrome.

## Typography

### Font Family

The display tier is **D-DIN-Bold** — a condensed industrial sans inspired by the German DIN 1451 standard (used on autobahn road signage and engineering blueprints). When unavailable, fall back to **Arial Narrow**, then Arial, then Verdana — the fallback chain prioritizes width compression over ornament.

The UI tier is **D-DIN** (regular weight) — the same family at standard width — used for body, button labels, and captions.

D-DIN is freely available from the **DIN Type Foundry** (and a free version under the same name is widely distributed). For maximum brand fidelity, use D-DIN directly; as a substitute, **Inter** at heavy weights (700+) with letter-spacing of 1.6px positive tracking approximates the rhythm. Avoid serif or humanist sans alternatives.

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.display-xxl}` | 80px | 700 | 0.95 | 1.6px | Hero headline (uppercase) |
| `{typography.display-xl}` | 60px | 700 | 1.2 | 1.2px | Section opener (uppercase) |
| `{typography.display-lg}` | 48px | 700 | 1.25 | 0.96px | Sub-section heading (uppercase) |
| `{typography.body-lg}` | 16px | 400 | 1.7 | 0.32px | Marketing body lead |
| `{typography.body-md}` | 16px | 400 | 1.5 | 0.32px | Default UI body |
| `{typography.button-cap}` | 13.008px | 700 | 0.94 | 1.17px | All-caps button label |
| `{typography.micro-cap}` | 12px | 400 | 2.0 | 0.96px | All-caps eyebrow / nav item |
| `{typography.caption}` | 13.008px | 400 | 1.5 | 0 | Helper / footer text |

### Principles
- **Uppercase across display.** Every display tier renders in uppercase. The brand never uses sentence-case display headlines.
- **Tight vertical leading on display.** 0.95 at 80px and 1.2 at 60px — the type stacks engineer-tight.
- **Wide horizontal tracking.** Positive 0.96–1.6px tracking on display sizes; positive 0.96–1.17px on caps eyebrows. The wide tracking is the brand's signature optical air.
- **No mono.** Code blocks are not part of the brand's typographic system.

### Note on Font Substitutes
**D-DIN** is freely available (the original DIN-style face under that name is widely distributed). When unavailable, use **Inter** at 700 weight with `letter-spacing: 1.6px`, `text-transform: uppercase`, and `line-height: 0.95` for display sizes — this matches the rhythm. Avoid Helvetica or Arial at default weights — the brand needs the condensed industrial cut. Avoid serif fallbacks entirely.

## Layout

### Spacing System
- **Base unit**: 8px (with denser sub-units 4 / 12 / 16 / 18 / 24).
- **Tokens**: `{spacing.xxs}` 4px · `{spacing.xs}` 8px · `{spacing.sm}` 12px · `{spacing.md}` 16px · `{spacing.lg}` 18px · `{spacing.xl}` 24px · `{spacing.xxl}` 32px · `{spacing.huge}` 48px.
- **Section padding**: full-viewport bands on marketing — no internal padding above/below; the photograph IS the section. On the shop site, sections use 48–64px vertical padding.

### Grid & Container
- Marketing pages have no container — every band is full-viewport-width, full-viewport-height (or close to it) with photography filling the entire frame.
- Shop product grid: 4-up at desktop, 2-up at tablet, 1-up at mobile.
- Type sits inside an inner ~1200px reading column centered horizontally over the full-bleed photograph.

### Whitespace Philosophy
The marketing pages have minimal traditional whitespace — the photograph occupies all space. "Whitespace" here means the dark sky in a rocket photograph or the empty stretch of Martian terrain. Negative space is photographic, not a UI choice. On the shop site whitespace returns to standard 32px grid gutters.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| 0 | Flat | Default — and the only level on marketing surfaces |
| 1 | Photographic — full-bleed image or video | The primary depth medium on marketing; photographs do all the lifting |
| 2 | Holographic — bloom / additive glow / parallax | Depth medium for the **in-world HUD only**: light, not shadow (see *In-World Mission HUD*) |

On **marketing surfaces** the brand does not use drop shadows, blurs, glows, or gradient overlays. Depth is photographic: a rocket launching at twilight has natural atmospheric depth that no CSS shadow could simulate. When type needs separation from imagery, the image is graded darker rather than scrimmed.

The **in-world HUD inverts this**: its depth medium *is* emitted light — bloom, additive glow, and parallax against the 3D scene — never a plate with a drop shadow. A diegetic readout reads as instrumentation glowing on the inside of a visor, not a card floating above the render.

### Decorative Depth
On marketing, photography and autoplaying rocket-launch video are the only decorative depth — no illustrations, no icons beyond a few minimal SVG arrow chevrons in nav and CTA hover states. In the live product, the diegetic vocabulary is thin **line-art glyphs** (blueprint footprints, hazard ⚠, latency ⏱, site 📍) and **bloom-lit reticles** — stroke-only, never filled.

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.xs}` | 4px | Form inputs (shop site) |
| `{rounded.sm}` | 8px | Shop product card chrome, video frames |
| `{rounded.md}` | 16px | Larger surface chrome |
| `{rounded.pill}` | 32px | Ghost outlined pill CTAs (the brand's signature button shape) |
| `{rounded.full}` | 9999px | Circular play-button overlays on video frames |

### Photography Geometry
Every photograph is full-viewport-bleed, edge-to-edge, never inset in a card on the marketing site. On the shop site, product photography sits inside `{rounded.sm}` 8px containers with no shadow. Aspect ratios on marketing photography vary with the source image — there is no enforced ratio; the photograph leads.

## Components

### Buttons

**`button-ghost-on-dark`** — the universal CTA on marketing surfaces.
- Background `{colors.canvas-night}` (transparent against the photographed canvas), 1px solid `{colors.on-primary}` border, text `{colors.on-primary}`, type `{typography.button-cap}` (uppercase, 13px / 700 / 1.17px tracking), padding `{spacing.lg} {spacing.xl}` (18px 24px), rounded `{rounded.pill}` 32px.

**`button-ghost-on-light`** — the same button on shop / light pages.
- Background `{colors.canvas-light}` (transparent against light canvas), 1px solid `{colors.ink}` border, text `{colors.ink}`, otherwise identical.

**`button-filled-cool`** — fill variant on shop product cards.
- Background `{colors.canvas-cool}`, text `{colors.ink}`, same pill geometry. Used as "Add to cart" or similar product CTAs.

### Cards & Containers

**`card-photo-band`** — full-bleed photographic band on marketing pages.
- Background `{colors.canvas-night}`, padding 0, rounded `{rounded.xs}`. The photograph fills the entire band; type and CTA sit overlaid.

**`card-shop-product`** — product card on the shop site.
- Background `{colors.canvas-light}`, padding `{spacing.md}` 16px, rounded `{rounded.sm}` 8px, 1px `{colors.hairline-on-light}` border. Product photo on top, name in `{typography.body-md}`, price in `{typography.body-md}` 700 weight, "Add to cart" button at the bottom.

### Inputs & Forms

**`text-input`** — form input on the shop site.
- Background `{colors.canvas-light}`, text `{colors.ink}`, type `{typography.body-md}`, padding `{spacing.sm} {spacing.md}` (12px 16px), rounded `{rounded.xs}` 4px, 1px `{colors.hairline-on-light}` border.

### Navigation

**`nav-bar-overlay`** — top nav across the marketing site.
- Background `{colors.canvas-night}` (transparent over the hero photo), text `{colors.on-primary}`, type `{typography.button-cap}` (uppercase). Logo wordmark on the left at ~147×19px, nav items horizontal in caps, padding `{spacing.xl} {spacing.xxl}` (24px 32px). The nav is fixed/sticky on scroll, retaining the overlay treatment.

### Signature Components

**Full-Bleed Photo / Video Hero** — every marketing band is a full-viewport photograph or autoplaying rocket-launch video. Type and CTA sit overlaid on the photograph at high opacity with no scrim. The photograph is graded so type lands cleanly without an overlay layer.

**Uppercase Display Headline** — the 80px D-DIN-Bold uppercase headline with 1.6px positive tracking is the brand's most recognizable typographic moment. Always uppercase, always bold-weight, always positively tracked.

**`link-on-dark`** — inline links on dark canvas.
- Text `{colors.link-on-dark}` (white) with persistent underline.

**`link-on-light`** — inline links on light canvas.
- Text `{colors.ink}` with persistent underline.

**`footer-dark`** — site-wide footer.
- Background `{colors.canvas-night}`, text `{colors.on-primary}`, type `{typography.caption}`, padding `{spacing.xxl} {spacing.xl}` (32px 24px). Holds nav columns in `{typography.micro-cap}` (uppercase), and a small legal/copyright row at the bottom.

## In-World Mission HUD (Diegetic)

> **Revision — supersedes the Epic 06 opaque-panel HUD** (`docs/06-hud-redesign/`). The `.panel` plate — `{colors.canvas-night-soft}` fill, 1px `{colors.hairline-on-dark}` border, bevel + drop shadow — is **retired as a HUD container**. Telemetry now renders diegetically, as light over the live scene.

The marketing language is an exercise in negation; the live SwarmBuild dashboard applies the same discipline to a moving 3D scene. The reference is the **No Man's Sky** HUD: the centre of the viewport stays clear, information clusters into the screen's corners and edges, and every element reads as **emitted light** — thin strokes, uppercase micro-type, line-art glyphs, and bloom-lit reticles — rather than a window laid over the render. Hello Games' stated aim was a UI "as minimal as they could have it, so as not to take away from the game itself." Ours is identical: the swarm and the lunar surface are the hero; the HUD is instrumentation glowing on the inside of a visor.

### Diegesis target (Fagerholt–Lorentzon)

The canonical game-UI taxonomy (Fagerholt & Lorentzon, *Beyond the HUD*, 2009) sorts every element on two axes — **fiction** (is it part of the world?) and **geometry** (is it in 3D space, or a 2D overlay?):

| Type | In 3D space? | In the fiction? | SwarmBuild use |
|---|---|---|---|
| **Diegetic** | yes | yes | In-world worksite reticles + labels; the build "thread" tracing the dome — light that lives in the scene |
| **Spatial** | yes | no | Placement ghost + cursor validity tick, selection rings — world-anchored, but the rovers can't "see" them |
| **Meta** | no | implied | Screen-edge glow / vignette on a Failure spike; the surface↔orbit view-glare |
| **Non-diegetic** | no | no | **Minimised.** Unavoidable corner readouts (`build N / total`, `rovers N/M`) render type-on-scene with no plate — so they read as visor instrumentation, not a windowed overlay |

The redesign moves the HUD **down-and-right** on that grid: kill the non-diegetic *plates*, keep the non-diegetic *text* but make it look diegetic (emitted, corner-anchored, bloom-touched), and push everything that can move into spatial / diegetic 3D.

### Principles (No Man's Sky, distilled)

1. **Centre stays clear.** The middle of the viewport is for the scene. Readouts cluster in the corners and along the edges (NMS keeps the centre open and pushes its sections to the screen edges). Zones: top-left = mission state · top-right = selected rover · bottom-centre = hotbar · bottom-right = Earth uplink.
2. **Light, not boxes.** No fills, no borders, no rounded rectangles. Legibility comes from the type — a four-way outline + soft halo — not a plate behind it. The only permitted background is a localised, edgeless **scrim** behind dense text (**`hud-scrim`**); never a bordered card.
3. **Monochrome + one tint.** Default ink is `{colors.on-primary}` white. Colour is rationed and only ever appears as emitted light (stroke / glow / text), never a fill: `{colors.hud-cyan}` for the active / Lunar context and interactive affordances, `{colors.hud-amber}` for the Shackleton context and caution; live status uses the signal set (`{colors.signal-ok}` / `{colors.signal-warn}` / `{colors.signal-down}` / `{colors.signal-idle}`). This mirrors NMS's monochrome-plus-single-tint scheme.
4. **Geometric line vocabulary.** Forms are stroked, not filled: the **diamond reticle**, **corner brackets** (a frame implied by its four corners, never closed), thin **hairline rules** that underline a value, **hexagon** status pips. Radius is effectively zero — the diegetic HUD does not use `{rounded.sm}`+ rounded-rectangle chrome.
5. **It belongs to the scene.** HUD light is additive and bloom-touched (it blooms on the same pass as the celestial bodies), carries a faint scanline / flicker, and — where world-anchored — parallaxes and occludes with the geometry. It should look projected onto a helmet visor, catching the scene's light.
6. **Restraint over completeness.** Show only what the current view needs (the Epic-06 surface / orbit view-gating stays). Detail is revealed on demand (expand, hover), never resident; let bloom, motion, and audio carry state that would otherwise need a label.

### Legibility without a panel

A box exists to make text readable over a busy render. Replace the box with type treatment:

- **Outline** — a four-way `text-shadow` (`-1px 0`, `1px 0`, `0 -1px`, `0 1px` in `{colors.canvas-night}`) draws a 1px ink contour so white type holds over a bright lunar highlight.
- **Halo** — a zero-offset blurred shadow (`0 0 6px` + `0 0 16px` `{colors.canvas-night}` at ~70%) floats a soft dark glow behind the glyphs.
- **Hairline anchor** — instead of a border, a single 1px `{colors.hairline-on-dark}` rule under a value gives the eye a baseline without enclosing it (**`hud-hairline-rule`**).
- **Localised scrim (last resort)** — only when a cluster is genuinely unreadable, a soft `{colors.canvas-night}` gradient fading to transparent sits *behind the text only* (**`hud-scrim`**). No edge, no radius, no rectangle.

### Layout zones

| Zone | Element (current class) | Diegetic treatment |
|---|---|---|
| Top-left | Mission readout (`.mission-hud`) | Title · `build N / total` · `rovers N/M` as type-on-scene; progress is a thin glowing **thread** (**`hud-progress-thread`**), not the boxed `.progress-bar`; `.panel` removed |
| Top-right | Selected rover (`.kill-panel`) | Rover id in display caps inside **`hud-corner-frame`**, keyed to `{colors.signal-down}` when KILL is armed; the action is a ghost-stroke control, no plate |
| Bottom-centre | Hotbar (`.hotbar`) | Line-art footprint glyphs (**`hud-glyph`**) on one hairline baseline; active slot glows `{colors.hud-cyan}`; panel fill dropped, glow / active states kept |
| Bottom-right | Earth uplink (`.earth-panel`) | Lag value + rows as type-on-scene with hairline rules; tinted `{colors.signal-ok}` / `{colors.signal-warn}` by live / lagging |
| World-space | Worksite reticles + labels (`SkyBodies`) | **Already diegetic — the model for everything else:** billboarded line-diamond + bloom halo + SDF caption |
| Centre | — | Always clear. Only the cursor-anchored placement tick may briefly enter it |

### Components

**`hud-readout`** — type-on-scene telemetry. No background. Labels in `{typography.micro-cap}` (uppercase, 0.96px tracking), values in `{typography.body-md}` or a display tier; white `{colors.on-primary}` by default, tinted only to signal live state. Legibility via the outline + halo above.

**`hud-hairline-rule`** — the anchor that replaces the panel border. A single 1px `{colors.hairline-on-dark}` line under or beside a readout; may glow to its context tint on focus.

**`hud-progress-thread`** — build progress as a ~2px glowing line in `{colors.hud-cyan}`, filling left-to-right with a soft bloom at the leading edge — no track plate. Dips and recovers live (snapshot-pure, ADR-0004).

**`hud-reticle`** — the canonical diegetic element (already shipped in `SkyBodies`). Billboarded line-diamond at a worksite, stroked in the site tint (`{colors.hud-cyan}` Lunar / `{colors.hud-amber}` Shackleton), bloom halo, subtle pulse, hover lock-on, SDF caption.

**`hud-corner-frame`** — four short 1px strokes marking only the corners of a region (the NMS bracket). Implies containment with no closed box and no fill; used for the selected-rover cluster, tinting `{colors.signal-down}` when armed.

**`hud-glyph`** — stroke-only line-art icon at `currentColor` (blueprint footprint, ⚠ hazard, ⏱ latency, 📍 site). Never filled; the active state is carried by stroke colour + glow, not a filled chip.

**`hud-scrim`** — the single permitted background: a soft `{colors.canvas-night}` gradient fading to transparent behind dense text only. No border, no radius edge, no rectangle. Use sparingly.

### Migration from the Epic-06 panels

| Current | Now |
|---|---|
| `.panel` — opaque `#0d0f14` fill, 1px `#2b313c` border, bevel + drop shadow | **Removed as a container.** No fill, no border, no bevel; legibility via outline / halo, structure via hairline rules + corner brackets |
| `.progress-bar` / `.progress-bar-fill` — boxed track | **`hud-progress-thread`** — trackless glowing line |
| `.badge` — bordered status chip | Hexagon / diamond status **pip** in the signal tint, or a tinted word + hairline — no bordered box |
| `.hotbar` panel fill | Hairline baseline + glowing active slot; fill removed |
| `.kill-panel` plate | **`hud-corner-frame`** + type-on-scene |
| `.topbar-pill` — bordered pill | Status **dot** + caps label, pill outline removed |
| `--panel-bg` / `--panel-edge` tokens | Retired for the HUD; replaced by outline / halo + `{colors.hairline-on-dark}` |

### Motion

- Keep the Epic-06 surface↔orbit slide + fade (`.hud-surface-panel`; surface readouts land *after* the descent glare peaks).
- Reticles pulse softly and lock-on at hover (existing).
- State changes ramp **glow**, not a background: a rover dies → its corner frame flares `{colors.signal-down}` then fades; a task completes → the progress thread's leading bloom ticks.
- HUD light blooms on the celestial pass. Keep `dpr ≤ ~1.5` and bounded draw calls (AGENTS.md render hygiene).

### HUD Do's and Don'ts

**Do**
- Render every readout as type-on-scene with an outline + halo for legibility.
- Keep the viewport centre clear; cluster to corners and edges.
- Use colour only as emitted light (stroke / glow / text), and only the cyan / amber / signal set.
- Imply structure with hairlines, corner brackets, and the diamond reticle — stroke, never fill.
- Reveal detail on demand; let bloom, motion, and audio carry state.

**Don't**
- Don't wrap a readout in an opaque panel, bordered card, or rounded-rectangle chip — that is the retired `.panel`.
- Don't reach for `backdrop-filter` blur or a beveled plate to gain legibility — use the type outline / halo.
- Don't fill glyphs or badges, and don't add colour beyond the signal set.
- Don't let HUD elements drift into the centre or occlude the swarm during the money shot.
- Don't reintroduce `{rounded.sm}`+ rounded-rectangle containers on the in-world HUD.

### References

- No Man's Sky HUD — diegetic ship display + helmet-projected suit readouts, "as minimal as they could have it": [Interface In Game](https://interfaceingame.com/games/no-mans-sky/) · [Game UI Database](https://www.gameuidatabase.com/gameData.php?id=293) · [NMS Wiki — Heads-Up Display](https://nomanssky.fandom.com/wiki/Heads-Up_Display) · [NMS Universal Font](https://github.com/NMSCD/No-Mans-Sky-Universal-Font).
- Fagerholt & Lorentzon, *Beyond the HUD: User Interfaces for Increased Player Immersion in FPS Games* (2009) — the diegetic / non-diegetic / spatial / meta framework: [thesis](https://www.semanticscholar.org/paper/Beyond-the-HUD-User-Interfaces-for-Increased-Player-Fagerholt-Lorentzon/16ee02a8839923752c6bc93f294bec67d73a586e) · [4-type explainer](https://nastyrodent.com/diegetic-and-non-diegetic-ui/) · [Diegetic Interface (TV Tropes)](https://tvtropes.org/pmwiki/pmwiki.php/Main/DiegeticInterface).
- *Dead Space* — the canonical fully-diegetic HUD (RIG-spine health, holographic inventory): "instrument, not overlay."
- Legibility without a panel — four-way `text-shadow` outline + zero-offset glow halo: [W3C text-shadow](https://www.w3.org/Style/Examples/007/text-shadow.en.html) · [text-shadow & accessibility](https://mrec.github.io/blog/2025/text-shadow/).

## Do's and Don'ts

### Do
- Use full-bleed photography or autoplaying video as the dominant decorative element on every marketing band.
- Render display tiers in uppercase D-DIN-Bold with positive 0.96–1.6px letter-spacing — the wide tracking is the signature.
- Use a single `{button-ghost-on-dark}` per band — the brand does NOT show two CTAs side by side on marketing surfaces.
- Pair every photograph with type that respects the imagery — no scrims, no gradients, no overlays. Grade the photo, not the canvas.
- Keep nav overlay-style (transparent, white-on-image) on marketing pages.
- In the live product, render the Mission HUD diegetically — type, hairlines, line-art glyphs, and bloom-lit reticles over the scene (see *In-World Mission HUD (Diegetic)*).

### Don't
- Don't introduce brand accent colors — black, white, and photography are the entire palette.
- Don't use drop shadows or gradient overlays on dark canvas — they fight the photography.
- Don't render display tiers in sentence-case or title-case — uppercase is the brand.
- Don't put filled buttons on marketing surfaces — the ghost outlined pill is the only marketing CTA.
- Don't use serif or humanist sans alternatives — the condensed industrial DIN cut is non-negotiable.
- Don't wrap the in-world Mission HUD in opaque or boxed panels — it renders diegetically as light over the scene (the retired `.panel`; see *In-World Mission HUD (Diegetic)*).

## Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|---|---|---|
| Wide | ≥ 1500px | Full hero photograph; max-content type column at 1200px |
| Desktop | 1280–1499px | Default desktop layout |
| Laptop | 961–1279px | Type column tightens; photo crops adjust |
| Tablet | 768–960px | Display drops 80 → 60px; nav compresses |
| Mobile | 600–767px | Display drops to 48px; ghost button retains pill shape |
| Small Mobile | < 600px | Display drops to 40px; nav becomes hamburger |

### Touch Targets
- Ghost pill buttons hit ≥ 50×50px due to the 18px vertical padding × 13px line-height. WCAG AAA compliant.
- Form fields stay at the 44px minimum height.

### Collapsing Strategy
- Display sizes stair-step 80 → 60 → 48 → 40px through the breakpoints.
- Photography re-crops to focal subject on smaller widths (rocket centered, Mars landscape centered).
- Top nav collapses to hamburger below 768px; menu retains the dark overlay treatment.
- Shop product grid stair-steps 4-up → 2-up → 1-up.

### Image Behavior
Marketing photography uses `srcset` for desktop / tablet / mobile with art-direction crops at major breakpoints. Mobile crops favor the central focal subject; wide crops favor environmental context (full launch pad, full Martian horizon).

## Iteration Guide

1. Focus on ONE component at a time.
2. Reference component names and tokens directly (`{colors.canvas-night}`, `{button-ghost-on-dark}`, `{rounded.pill}`).
3. Run `npx @google/design.md lint DESIGN.md` after edits.
4. Add new variants as separate entries.
5. Default body to `{typography.body-md}`; reserve `{typography.body-lg}` for marketing leads.
6. The black-and-white-only rule is load-bearing — adding a brand accent color breaks the system.
7. Ghost pill is the only marketing CTA; filled buttons live exclusively on the shop site.
8. The black-and-white rule governs **marketing**. The in-world HUD's cyan / amber / signal tints are the one sanctioned exception — functional, in-world, and only ever emitted as light (stroke / glow / text), never fills.
9. For the live product, design to *In-World Mission HUD (Diegetic)*: type-on-scene with an outline + halo, hairlines and corner brackets instead of panels, and the diamond reticle as the canonical element. Removing a `.panel` is a feature, not a regression.
