# Epic 07 — Production-Ready Cinematic Demo: Implementation Plan

## Context

`docs/07-demo-cinematic/DEMO-CINEMATIC-SCRIPT.md` locks a 2:30, 15-beat shooting
script for the SwarmBuild money shot (kill a rover mid-wall at the sunlit **Lunar
Base** → lease expires → swarm re-auctions → a neighbour seals the dome → Earth
reads +2.6s behind → `H` to hide HUD → ascend back to orbit). The script is
source-verified and most beats are **HAVE-NOW**. This plan turns the remaining
**NEEDS-SMALL** gaps into a set of small, independent builds.

A parallel codebase audit (Explore + Plan agents) confirmed the script's claims at
exact line anchors, and surfaced the one real architectural snag: **the backend
auto-fires the scripted kill ~900ms after `lunar/wall-1` is leased — which happens
early in the build (~t≈10s), not at the 1:36 climax mark**, and not necessarily when
the camera is in position.

**Decisions locked with the user:**
1. **Delivery = minimal builds + manual operation.** No timed auto-sequencer. Each
   gap is an independent affordance the operator fires live during a take.
2. **Kill sync = frontend push-kill.** A cue fires `send({cmd:'kill',robot})` on
   whoever holds `lunar/wall-1`, and a new backend `Cinematic()` pacing **disables the
   early auto-kill** (`KillTarget=""`). The operator owns *when* the real kill lands.
3. **Trigger = live keybinds/buttons** (playable live, not capture-only). The new
   cues ship as a thin operator "cue layer", with `Rehearsal()` staying the default
   non-reel demo pacing behind an env flag.

**Outcome:** a demo build where an operator can walk the camera + HUD through all 15
beats live (or to record a clean replay-mode take), with the climax kill landing on
cue on the correct rover, deterministically.

## Domain alignment (grilling outcomes, 2026-06-07)

A `/grill-with-docs` pass reconciled this plan with `CONTEXT.md` + ADR-0004. Key
resolutions (the glossary was updated inline):

1. **This is "interactive Choreography", not a "reel".** Drop "reel/cinematic" as a
   coined umbrella. The operator cues that fire *real* worksite events (the **Kill**)
   are **Choreography** in its new **interactive** pacing mode (operator-paced vs. the
   demo package's scripted pacing) — `CONTEXT.md` Choreography now names both modes.
   The camera moves, copy overlays, and marker styling are **Scenery** (non-diegetic,
   no World Model state). Avoid the banned "demo mode / scripting / staging" naming for
   any mode flag.
2. **Kill ownership = backend-orchestrated `cueKill`** *(REVISED 2026-06-08 — see the
   hardening round below; the original "browser fires the raw `{cmd:'kill'}`" was reversed
   on timing evidence).* The operator triggers; the Coordinator executes. → **ADR-0011**.
3. **Site markers are Scenery.** `operacional / em construção` denotes *site
   established*, NOT dome-complete (the Lunar marker already reads `operacional` before
   its dome seals). The Beat-15 flip is a legitimate **Scenery** transition; the dome's
   true completion stays in the snapshot-derived MissionHud/Task-Ledger. `statusOverride`
   is fine as a Scenery mutation.
4. **Copy must never name a beat before it happens.** `copy.ts` splits **free
   narration** (advance anytime) from **beat-locked** climax lines (`ROBÔ PERDIDO`,
   `CÚPULA FECHADA`, `+2.6s ATRÁS`) which the operator lands *after* the real worksite
   event — a documented capture-checklist rule, not a gating engine.
5. **Orbit-open = camera-arc, not sun-arc.** Arc the *camera* so the fixed sun's
   GodRays crest into frame (reuse pose-lerp + Wave-4 `frameloop="always"`); never
   animate the sun's position. Built last, fallback-ready.
6. **Latency = drag the real slider by hand.** No cue-key (the slider's local state
   would desync to "0 ms"). Zero build; deletes the latency cue from Slice 6.

## Implementation hardening (grilling round 2, 2026-06-08)

A `/grill-me` pass with code exploration surfaced a **plan-breaking timing reality** and
re-targeted the test environment. These supersede the relevant points above:

- **The kill window is sub-1-second; the build is a ~20s sprint.** `lunar/wall-1` is
  LEASED at ~2.4s and DONE ~0.6–1.1s later (`agent.go:327` `opEvery=120ms`, a wall = 5
  ops); the whole dome finishes in ~20s. A human cannot pace a manual kill against that,
  and by 1:36 the dome would have finished ~70s earlier. **So:**
  - **Re-pace the build to film length** — cinematic Coordinator auction/lease windows +
    a new Rover-agent `--op-every-ms` flag (cadence is hard-coded today).
  - **Hold the hero wall** (`lunar/wall-1`) un-leasable until the cue, so the climax
    target is always there (no race).
- **Climax = backend-orchestrated `cueKill`** (reverses Domain-alignment #2 / original
  ADR-0011). Operator presses one key → `{cmd:'cueKill'}` → the **Coordinator** releases
  the hold, positions a Rover, and fires the kill. "Which rover / when" stays in Go
  (deterministic, tested). The browser only **arms + triggers**.
- **Topology = k8s pod-per-rover, in-process kill.** Runs on `deploy/k8s/`
  (`COORDINATOR_ROVERS=external`, 6 Rover Pods); the kill is the in-process outage
  (`KILLER_ON_KILL=false`) — the Rover darkens **in place**, keeps its position, **never
  a pod delete**. The victim's **`--recover-ms` is tuned long** (≥ heal arc) so it stays
  down through the seal (any revive lands after the dome closes).
- **Test harness = the k8s stack, not the mock.** `web/src/hooks/useSnapshot.ts:40` —
  the `VITE_MOCK` snapshot is one frozen frame with a no-op `send()`, so it **cannot**
  drive the Self-heal. Heal/e2e slices (#154/#155/#159) run on the **k8s cinematic
  overlay** (#160) via `up.sh` → `localhost:5173`; pure-Scenery visual checks
  (#156/#157/#158) may use `VITE_MOCK`. The overlay also resolves the **Epic-06
  chrome-profile lock** and adds **`kubectl logs` aggregation across all services** so a
  take is asserted e2e (screen *and* logs agree).

**New slice:** **#160 (`type:task` · `area:infra`)** — k8s cinematic overlay +
chrome-mcp capture harness + log aggregation. Blocks #155/#159; depends on #154.

---

## Verified ground truth (trust these anchors)

- **Camera rigs (HAVE-NOW):** `Scene3D.tsx` — `runDescent(from,to,durationMs,toSite?)`
  (:3266, symmetric orbit↔surface, dispatched :3523), `runTraverse` (:3399),
  `TRANSITION_MS=1500` (:2150), `INTRO_MS=4500` (:2153), `TRAVERSE_MS=2900` (:2160).
  Poses `ORBIT_POSE` (:2130), `LUNAR_SURFACE_POSE`/`SURFACE_POSE` (:2098/2110),
  `SHACKLETON_SURFACE_POSE` (:2111). Intro auto-plays once **only in surface**
  (:3542-3571). `<CameraFeel active={!placing&&!transitioning}/>` (:3691, `lib/cameraFeel.ts`).
- **Orbit gap:** in orbit there is **no wander and no sun-arc** — only a static
  `ORBIT_POSE` + ±3° idle sway. (Beats 1–2 need a small build or accept the cold-hold fallback.)
- **Markers:** `SkyBodies.tsx` `SITE_MARKERS` const (:1243-1259) — Lunar cyan `#38e1ff`
  "operational", Shackleton amber `#ffb347` "in construction". **Hardcoded — no runtime
  flip.** Hover lock-on + ±4% pulse + SDF text already built. Marker click → `onSelectSite`.
- **App state (HAVE-NOW):** `App.tsx` owns `viewMode`/`activeSite`/`selected`/`hudHidden`
  (`H` key :93-104 → `hud--hidden` opacity:0 + pointer-events:none, Canvas is *outside*
  that wrapper so markers survive). `send()` already emits `{cmd:'kill',robot}` (:144),
  `{cmd:'reloadDemo'}` (:165), `{cmd:'setLatency',value}`, `{cmd:'placeBlueprint'}`.
  `MissionHud` (dips/recovers via `missionStats`, pure snapshot derivation),
  `EarthPanel` (real lag), `KillPanel` (hand-fire, two-step) all live.
- **Latency:** real **server-side** shim (`internal/coordinator/earthuplink.go`), driven
  by `{cmd:'setLatency',value}`. The slider in `StressControls.tsx:34` holds *local*
  state, so a programmatic cue-key would desync the slider readout — the operator
  **drags the real slider** to 2600ms by hand instead (grilling outcome 6; zero build).
- **Backend (HAVE-NOW):** `demo.Rehearsal()` (demo.go:88) — AuctionWindow 900ms,
  HeartbeatEvery 700ms, TTLFactor 6 (TTL 4.2s), KillAfterLeased 900ms,
  `KillTarget="lunar/wall-1"`. `External()` (:110) already shows the `KillTarget=""`
  pattern that suppresses the scripted kill (gate at :151). Fully deterministic (fixed
  board, string tie-break, no RNG — `killcontrol_test.go` proves same rover heals every
  run). Wired at `cmd/coordinator/main.go:60`.

---

## Approach: operator-driven interactive Choreography + Scenery

No `requestAnimationFrame` auto-timeline. Each beat's *new* element gets a small,
self-contained affordance the operator fires by key (and/or button). The operator paces
the take by hand; the engine self-heal and all existing camera moves
(descent/traverse/ascent/marker-click) are reused as-is. Per the grilling outcome, the
new layer is **interactive Choreography** (the cues that fire *real* worksite events —
the **Kill**) **+ Scenery** (camera moves, copy overlays, marker styling — non-diegetic,
no World Model state). The `?reel=1` flag / `lib/reel/` paths are just capture-tooling
tokens, not a new domain concept.

The cue layer is **additive client UI state** (same ADR-0004 carve-out as
`selected`/`hudHidden`) — it invents **zero** new snapshot/wire fields.

### Slice 1 — Backend `Cinematic()` pacing (unblocks the climax)
**Why first:** without this the auto-kill fires at ~t≈10s and ruins every manual take.
- `internal/demo/demo.go`: add `Cinematic()` — a `Rehearsal()` copy with
  `KillTarget=""` (reuse the exact suppression `External()` uses, :113/:151) so
  `DomeScenario` arms **no** scripted kill, but **keeps** the in-process 6-rover swarm
  (unlike `External()` which also sets `NoInProcRovers`). Keep all widened windows
  (TTL 4.2s etc.) so the *operator-fired* kill still heals in the legible ~15–20s arc.
- `cmd/coordinator/main.go:60`: select `Cinematic()` behind a new env value
  (`COORDINATOR_ROVERS=cinematic` or `REEL=1`); `Rehearsal()` stays the default.
- Test: extend `internal/demo/demo_test.go` — `Cinematic()` yields 13 tasks/site, 6
  rovers/site, and **zero** `ScriptedKills`. (`go test -race ./internal/demo/...`)

### Slice 2 — "Cue-kill the wall-1 leaseholder" (the money shot trigger)
Operator presses one key at beat C2; the correct rover dies regardless of manual
selection. This *is* the "frontend push-kill" — **interactive Choreography**, recorded
as the deliberate exception to "the demo package is the choreography home" in
**`docs/07-demo-cinematic/adr/0011-…md`**.
- `App.tsx`: add a guarded keydown (mirror the `H` handler :93-104) that does
  `const r = snapshot?.tasks.find(t => t.id === "lunar/wall-1")?.assignee;`
  `if (r) send({cmd:"kill", robot:r});`. Read the real `assignee` field name from
  `types/wire.ts` first. Only active in cinematic mode (see Slice 6).
- Optional aid: when armed, briefly highlight that rover (reuse `selected`) so the
  operator sees the target before firing — this also serves the Beat 6 "tag the rover".

### Slice 3 — On-screen cinematic copy overlay (Beats 2,3,6,8,9,11–13,15)
The script is dense with burned-in PT-BR copy; this is the highest-leverage build.
- New `web/src/components/CinematicCopy.tsx` + `web/src/styles/reel.css`. A copy layer
  rendered as a **sibling of `.hud-stage`** (App.tsx:363) — *outside* it — so the
  bookend wordmark/CTA **survives `H`** at Beat 14, while the HUD fades.
- Operator advances copy with a key (e.g. `]`/`[` to step a cursor through an ordered
  array of `{lines, variant}` lifted verbatim from script §6; variants: wordmark /
  stake / objective / card / thesis / cta). No auto-advance.
- **Copy split (grilling outcome 4):** `copy.ts` tags each line **free narration**
  (advance anytime) vs **beat-locked** (`ROBÔ PERDIDO`, `CÚPULA FECHADA`, `+2.6s ATRÁS`).
  The operator must land beat-locked lines *after* the real worksite event — a documented
  capture-checklist rule, NOT a gating engine ("never name a beat before it happens").
- Copy strings live in `web/src/lib/reel/copy.ts` (pure data, co-located test optional).

### Slice 4 — Orbit-open camera-arc (Beats 1–2)
The one genuinely-new camera capability. Build it as a scene-mounted rig that runs
**only while a prop flag is on** — same pattern as `CameraFeel`, *not* an imperative
handle (less invasive given the existing one-effect-owns-the-camera invariant).
- `web/src/components/Scene3D.tsx`: add a `<CinematicOpen active={cinematicOpen}/>`
  rig (near `CameraFeel`, :3691) that, when active, runs a slow lateral drift along the
  dark limb + **arcs the camera** so the *fixed* sun's `GodRays`/`CELESTIAL_BLOOM` crest
  into frame, easing into `ORBIT_POSE`. **Camera-arc, NOT sun-arc** (grilling outcome 5):
  the sun stays at `ORBIT_SUN_POSITION` (moving it would be physically wrong + snapshot-
  independent motion); reuse the existing `lerpPose`/easing + `frameloop="always"`
  (ADR-0004 Wave-4) + `setTransitioning` discipline so `CameraFeel`/OrbitControls don't
  fight it. Plumb a `cinematicOpen` prop from App.
- **Fallback (script-sanctioned):** if this slips, the cold static `ORBIT_POSE` hold +
  the descent glare carries "found by light". Ship the fallback rather than block.

### Slice 5 — Marker lock-on cue + label flip (Beats 3, 6, 15)
- `SkyBodies.tsx`: thread two optional props through `SiteMarkers` (:1446) → `SiteMarker`
  (:1295): `lockedSite?: SiteId` (force the existing hover lock-on state from a cue) and
  `statusOverride?` (flip Shackleton amber→cyan / "operacional" at the bookend). Visuals
  already exist; we only drive them externally. **The flip is a Scenery transition**
  (markers are Scenery — "operacional" = site established, not dome-complete; grilling
  outcome 3), so it asserts no World Model state.
- `Scene3D.tsx` + `App.tsx`: plumb both from cue-layer state, set by keybinds.
- Fallbacks: manual mouse-hover for lock-on; leave "em construção" if the flip slips.

### Slice 6 — Cue-mode arming + capture hygiene
- **Arming:** a `cinematic` flag in `App.tsx` (URL `?reel=1` **and** a keybind toggle,
  per the "live keybind/button" decision). When off, every cue handler no-ops, so the
  normal app is byte-for-byte unchanged.
- **Latency (Beat 9): drag the existing slider by hand** to 2600ms (grilling outcome
  6). The server shim is real (EarthPanel reads `+2.6s ATRÁS`); a cue-key was rejected
  because the slider's local state (`StressControls.tsx:34`) would desync to "0 ms".
  Zero build — this is interactive Choreography, the operator paces the real event.
- **Capture hygiene:** document a fixed record window size; keep `liveMode` OFF (replay
  path, no model latency); pre-roll `send({cmd:"reloadDemo"})` to reset the board to the
  deterministic seed before a take. (`docs/07-demo-cinematic/` capture checklist.)
- **Staggered HUD boot (Beat 5):** already free via the `hud--surface` CSS on the
  descent (App.tsx:356). No build unless tuning — explicitly out of scope.

---

## Files touched (summary)

| Area | File | Change |
|---|---|---|
| Backend | `internal/demo/demo.go` | add `Cinematic()` (Rehearsal copy, `KillTarget=""`, keep in-proc swarm) |
| Backend | `cmd/coordinator/main.go` (:60) | select `Cinematic()` behind env flag |
| Backend | `internal/demo/demo_test.go` | assert Cinematic: 13 tasks/site, 6 rovers/site, 0 scripted kills |
| Web | `web/src/App.tsx` | `cinematic` arm flag; cue keybinds (kill-leaseholder, copy step, lock-on, marker flip — **no** latency cue, slider is hand-dragged); mount `CinematicCopy` as sibling of `.hud-stage` |
| Web (new) | `web/src/components/CinematicCopy.tsx`, `web/src/styles/reel.css`, `web/src/lib/reel/copy.ts` | burned-in PT-BR copy layer + script §6 strings |
| Web | `web/src/components/Scene3D.tsx` | `<CinematicOpen>` orbit rig; thread `cinematicOpen`, `lockedSite`, `statusOverride` props |
| Web | `web/src/components/SkyBodies.tsx` (:1295/1446) | optional `lockedSite` + `statusOverride` props on markers |

**Build order:** Slice 1 (unblocks climax) → 2 (money-shot trigger) → 3 (copy, highest
leverage) → 5 (markers) → 4 (orbit open, has a fallback) → 6 (arm + hygiene). WIP=1;
each slice is independently demoable and committed on its own.

---

## Verification

Per `AGENTS.md` Definition of Done, in order:
- **Backend:** `go build ./...` · `make lint` · `go test -race ./internal/demo/... ./internal/coordinator/...`
  (the new `Cinematic()` test + existing selfheal/liveheal/killcontrol stay green).
- **Web:** `cd web && npm run build && npm test` (TS-clean; co-located `copy.ts`/director tests).
- **End-to-end (the real proof):** `COORDINATOR_ROVERS=cinematic docker compose -f
  deploy/docker-compose.yml up --build`, open the dashboard with `?reel=1`, and walk the
  beats by hand:
  1. confirm **no** auto-kill fires during the build (Slice 1);
  2. at the climax, press the cue-kill key → the rover holding `lunar/wall-1` dies,
     lease expires, Task-Ledger flips LEASED→UNCLAIMED, MissionHud dips 6/6→5/6, a
     neighbour wins the re-auction and seals the dome, MissionHud recovers (Slices 1–2);
  3. drag the latency slider to 2600ms by hand → EarthPanel reads `+2.6s ATRÁS` (Slice 6);
  4. step the copy overlay, fire marker lock-on + bookend flip, press `H`, ascend via
     the existing surface→orbit `runDescent` (Slices 3–5).
- Optionally capture a fixed-window replay-mode take to validate the full 2:30 reads.

---

## Slice checklist (published 2026-06-08 via `/to-issues`)

No umbrella epic ticket (flat, like Epic 06 #147–152). Each slice is `type:feature`,
all-AFK, with chrome-devtools MCP acceptance criteria (functionality + look-and-feel).

- [x] **S1 · #154** `feat(*): Cinematic External pacing + hero-wall hold + cueKill` · `area:backend` · `r3d-154` · blocked by: none
- [x] **INFRA · #160** `task(infra): k8s cinematic overlay + chrome-mcp harness + log aggregation` · `area:infra` · `r3d-160` · blocked by: #154
- [x] **S2 · #155** `feat(web): cinematic arm + cueKill trigger` · `area:frontend` · `r3d-155` · blocked by: #154
- [x] **S3 · #156** `feat(web): cinematic copy overlay (survives H, beat-locked rule)` · `area:frontend` · `r3d-156` · blocked by: #155
- [ ] **S4 · #157** `feat(web): marker lock-on cue + bookend label flip (Scenery)` · `area:frontend` · `r3d-157` · blocked by: #155
- [ ] **S5 · #158** `feat(web): orbit-open camera-arc — found by light (fallback-ready)` · `area:frontend` · `r3d-158` · blocked by: #155
- [ ] **S6 · #159** `feat(web): dress rehearsal — deterministic pre-roll + full-beat walkthrough (k8s)` · `area:frontend` · `r3d-159` · blocked by: #155–158, #160

**Per-merge sync (per `docs/harness/issue-tracking.md`):** the delivering PR titles
`type(scope): subject (#NN)` + `Closes #NN`; flips the `feature_list.json` feature to
`passing` **with evidence**; and ticks the box above — all three in the same PR.

---

## Grilling: done (2026-06-07)

`/grill-with-docs` ran and reconciled this plan against the domain model — see the
**Domain alignment** section above. It updated `CONTEXT.md` (Choreography pacing modes;
Scenery now covers the markers) and created **`adr/0011-interactive-choreography-browser-
fires-the-kill.md`**. The plan is domain-aligned and ready to break into Epic 07 issues
(one `type:feature` per slice, WIP=1, Slice 1 first).
