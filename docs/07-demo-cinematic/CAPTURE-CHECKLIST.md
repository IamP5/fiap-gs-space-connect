# Epic 07 — Cinematic capture checklist (dress rehearsal)

The take-day operator checklist for recording a clean 2:30 run of
`DEMO-CINEMATIC-SCRIPT.md`. This is the **operator run-sheet**; the environment
setup (k8s overlay bring-up, the dedicated-Chrome / chrome-devtools MCP launch,
the `logs.sh` aggregation, the climax-trail log assertions) lives in its sibling
**`CAPTURE-RECIPE.md`** — read that first, then use this sheet during the take.

The take runs on the **k8s cinematic overlay** (#160), not `VITE_MOCK`: the mock
is one frozen frame with a no-op `send()` (`web/src/hooks/useSnapshot.ts:40`), so
it cannot drive the Self-heal. (Pure-Scenery cues — copy `]`/`[`, marker `M`/`B`,
orbit-open `O` — *can* be rehearsed under `VITE_MOCK=1` at `/?reel=1`, but the
canonical climax take needs the live swarm.)

---

## 1. Capture hygiene (set once, before any take)

- **Fixed record window size.** Lock the browser window to a fixed capture size
  (e.g. 1920×1080) and don't resize mid-take — the burned-in copy and marker
  reticles are positioned for a stable frame. Keep the same size across every
  take so re-cuts intercut cleanly.
- **Replay build mode (no model latency).** Keep `liveMode` **OFF** (the hotbar
  "LLM Generated" toggle, default `false` = deterministic Replay). The replay
  path has no model-generation latency, so placements resolve instantly and the
  build pacing is repeatable — this is the canonical A-roll. Live mode is for
  showing the harness off interactively, never for the locked take.
- **Latency starts at 0.** The Earth-uplink shim defaults to 0 ms; do **not**
  pre-set it. You drag it up to 2600 ms on cue at Beat 9 (see §3).
- **Arm the cinematic layer.** Load the dashboard with **`?reel=1`** (seeds the
  armed state at mount) — `http://localhost:5173/?reel=1` — or press **`R`** to
  toggle arming live. While disarmed every cue key is a no-op; while armed the
  `REEL ARMED` badge shows the hot keys. (`R` also disarms.)

---

## 2. Pre-roll — reset to the deterministic seed (before EVERY take)

One operator action resets the board to the known seed so each take starts
identically:

- **Click "Reload demo"** in the top bar (it fires `{cmd:"reloadDemo"}`), or
  re-load `/?reel=1`. The button's tooltip states the contract.
- On the k8s overlay this **re-seeds the worksite in-process on the live
  coordinator Pod** — it **re-holds the hero wall `lunar/wall-1` un-leasable**
  (so the climax target is always there for the `cueKill`) and **does NOT
  restart any Pod** (same coordinator Pod, verified in #160 — `feature_list`
  r3d-160 evidence). The roster mirrors `DomeRovers()`, so every run starts from
  the identical framing.
- **Determinism check:** two pre-roll runs must produce matching start framing
  (no RNG — fixed board, string tie-break; `killcontrol_test.go` proves the same
  rover heals every run). Capture the orbit-open frame on two pre-rolls and
  confirm they match.

Pre-roll is **not** a Pod bounce and **not** `down.sh`/`up.sh` — those are for
environment setup, not between takes.

---

## 3. The 15-beat operator run-sheet (beat → key/action)

The keys below are the real binds the prior slices shipped — verified in
`web/src/lib/cinematicArm.ts` (`R`, `K`), `web/src/lib/reel/copy.ts` (`]`/`[`),
`web/src/lib/reel/markerCue.ts` (`M`, `B`), `web/src/lib/reel/openArc.ts` (`O`).
All cue keys are **armed-only** and ignore OS key-repeat (one fire per physical
press); they yield to text-entry fields. Existing app keys: `H` (HUD hide),
`Escape` (cancel placement), `L`/`R-drag`/`scroll` (in-scene, only while placing).

Copy steps (`]` advances the cursor) walk `COPY_BEATS` in order; the run-sheet
notes each `]` press inline. Beat-locked copy lines (Beats 11–13) must be landed
**after** the real worksite event — see §4.

| # | Beat | Operator action / key | What lands |
|---|------|----------------------|------------|
| — | **Pre-roll** | Click **Reload demo** (or load `/?reel=1`) | Board reset to seed, hero wall re-held, no Pod restart (§2) |
| 1 | WANDERING | Be in **orbit** view; armed (`?reel=1` / `R`) | Dark-limb hold; idle CameraFeel sway |
| 2 | SUN REVEAL + SITES BLOOM | Press **`O`** (orbit-open arc); then **`]`** | Camera arcs so the *fixed* sun's godrays crest in, eases to `ORBIT_POSE` (~9 s); copy `wordmark-open` (`SWARMBUILD` + both marker labels) |
| 3 | STAKES + LOCK-ON | Press **`M`** (lock-on → lunar); **`]`**, **`]`** | Lunar marker lock-on pulse; copy `stake-regolith` then `stake-latency` |
| 3→4 | COMMIT | **Click the cyan Lunar marker** | Fires `runDescent('orbit','surface')` to the worksite |
| 4 | DESCENT | (camera move, no key) | Glare-masked descent settles into `LUNAR_SURFACE_POSE` |
| 5 | LUNAR BASE | (surface settles; HUD boots) | MissionHud + `ROVERS 6/6` live; staggered `hud--surface` boot |
| 6 | TAG THE ROVER + CALL | **`]`**, **`]`** | Copy `lunar-swarm` then `objective-shackleton` (poleward CTA) |
| 7 | GROUND-DRIVE | **Cycle site → Shackleton** (hotbar 📍 site chip) | Fires `runTraverse` — low race across regolith, dust-veil swap |
| 8 | ARRIVE SHACKLETON | **`]`** | Copy `card-shackleton` (`CONSTRUÍDA NO ESCURO`) |
| 9 | RETURN + LIVE BUILD | **Cycle site → Lunar**; **`]`**, **`]`**; **drag the latency slider to 2600 ms by hand** | Re-descend to Lunar dome; copy `lunar-dome` then `lunar-earth-watch`; Earth panel ticks to `+2.6s ATRÁS` (see §4 — manual drag, NOT a cue-key) |
| 10 | THE BOND | (low hero framing on the tagged rover) | Lease beam to its wall; idle sway off |
| 11 | **THE KILL** | Press **`K`** (cueKill); **THEN** land copy **`]`** *after* the rover dims | `{cmd:"cueKill"}` → Coordinator releases the hold, a Rover leases + drives + takes the in-process kill in place; Task-Ledger flips `lunar/wall-1` LEASED→UNCLAIMED; MissionHud 6/6→5/6. Copy `climax-kill` (`ROBÔ PERDIDO`) lands **after** the dim + beam-sever |
| 12 | **SELF-HEAL / SEAL** | (watch the re-auction); **THEN** **`]`** *after* the dome seals | Lease expires → re-auction → a survivor drives the gap and seats the cap; MissionHud recovers to 6/6, progress 100%. Copy `climax-seal` (`CÚPULA FECHADA`) lands **after** the seal |
| 13 | EARTH LAGS (thesis) | **`]`** *after* the seal, framed on the lagging Earth panel | Copy `climax-thesis` (`TERRA +2.6s ATRÁS …`) over the Earth panel reading `+2.6s ATRÁS` |
| 14 | HIDE & LIFT OFF | Press **`H`**; then it ascends | `H` fades the HUD (markers + bookend copy survive); `runDescent('surface','orbit')` lifts back through the glare to `ORBIT_POSE` |
| 15 | THE WIDE / HERO + CTA | Press **`B`** (bookend flip); **`]`**, **`]`**, **`]`** | `B` flips the Shackleton marker amber→cyan / `operacional`; copy `bookend-payoff` (both `operacional`), `bookend-cta`, `bookend-tech` fade up over the vista |

Notes:
- **`M`** cycles `null → lunar → shackleton → null`; one press at Beat 3 locks
  Lunar. **`B`** toggles the bookend flip (press once at Beat 15).
- **`O`** runs the open arc only in orbit; pressing it on the surface is inert,
  and a second press cancels mid-arc (settles cleanly into `ORBIT_POSE`). It is
  **fallback-ready** — if cut, the cold `ORBIT_POSE` hold + the descent glare
  carries "found by light," so the open never blocks the climax.
- The descent/traverse/ascent camera moves are the **existing** rigs (marker
  click, site cycle, `runDescent`) — no cinematic cue key drives them.

---

## 4. Two load-bearing manual rules (NOT cue-keys)

### 4a. Beat-locked copy — "land after the real event"

`copy.ts` tags each line **free** (advance anytime) vs **beat-locked**. The three
beat-locked lines are a **capture-discipline rule, NOT a gating engine** — the
overlay will happily show them early; the operator must not. Land each only
**after** its real worksite event fires (`BEAT_LOCKED_IDS` in `copy.ts`):

| `]`-step copy line | Land it AFTER… |
|--------------------|----------------|
| `ROBÔ PERDIDO · lease expirou` (Beat 11) | the rover dims + the lease beam severs (the cueKill fires) |
| `RE-LEILÃO → CÚPULA FECHADA · zero humano no loop` (Beat 12) | the survivor seats the final block + the dome seals |
| `TERRA +2.6s ATRÁS — nenhum comando humano chegaria a tempo.` (Beat 13) | the seal, framed against the Earth panel reading +2.6s behind |

Never name a beat before it happens (Domain-alignment outcome 4).

### 4b. Latency = manual slider drag to 2600 ms (Beat 9)

At Beat 9, **drag the real latency slider to 2600 ms by hand** (the ⏱ stress
popover in the hotbar) — it is **not** a cue-key. The shim is real server-side
(`internal/coordinator/earthuplink.go`), but a programmatic cue would desync the
slider's own *local* readout (`StressControls.tsx`) to "0 ms" (Domain-alignment
outcome 6, grilling round 2). After the drag, the Earth panel genuinely reads
`+2.6s ATRÁS`, carrying the latency through-line through the climax. Zero build —
this is the operator pacing the real event.

---

## 5. Cross-references

- **`CAPTURE-RECIPE.md`** — environment: `up.sh --cinematic`, the dedicated-Chrome
  / chrome-devtools MCP launch (resolves the Epic-06 profile lock), `logs.sh`
  aggregation, and the §5 climax-trail log assertions (screen + logs must agree).
- **`IMPLEMENTATION-PLAN.md`** Slice 6 — the dress-rehearsal slice spec.
- **`DEMO-CINEMATIC-SCRIPT.md`** §3 beat sheet, §4 climax shot-by-shot, §6
  on-screen copy (the verbatim source of `copy.ts`).
- **`adr/0011-…`** — interactive Choreography / backend-orchestrated `cueKill`.

---

## 6. Acceptance gate (who verifies what)

- **This slice (#159) self-verifies:** `cd web && npm run build && npm test`; the
  pre-roll affordance (Reload-demo button + tooltip) and the cue keys exercised
  under `VITE_MOCK=1` at `/?reel=1` (Scenery cues no-op cleanly when disarmed,
  fire when armed).
- **The full 15-beat k8s + chrome-devtools MCP + `kubectl logs` walkthrough is
  run by the integration gate (coordinator)** on the merged
  `feat/07-demo-cinematic` branch — a single `kind-swarmbuild` cluster + a single
  chrome-devtools browser serialize that e2e at the orchestrator level. The
  climax-trail log assertions (`cueKill → award → in-process kill in place →
  Expiry → Re-auction → survivor award → DONE → seal → revive only after seal)
  are that gate's proof.
