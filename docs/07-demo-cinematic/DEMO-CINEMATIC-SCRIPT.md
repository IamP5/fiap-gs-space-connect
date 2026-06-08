# SwarmBuild — Demo Cinematic Shooting Script (FINAL CUT / Roteiro Travado)

> Produced by a specialist film-room (cinematographer · game-feel · narrative · editor ·
> tech-art) + a source-verified feasibility pass + an adversarial table-read. Claims below
> were checked against the codebase, e.g.: scripted kill is hardcoded to `lunar/wall-1`
> (demo.go:99, via `Rehearsal()` main.go:60); 6 rovers/site; dome = 4 foundations + 8 walls
> + 1 cap = 13 tasks; Earth latency defaults to 0 (the "+1.8s" was a mock artifact);
> INTRO_MS=4500 / TRANSITION_MS=1500 / TRAVERSE_MS=2900; MissionHud + `H` HUD-fade are wired.

## Changes from draft

- **Climax moved to LUNAR BASE (sunlit), not Shackleton.** Ground truth: the auto-firing scripted kill is hardcoded to `lunar/wall-1` (demo.go:99, via `Rehearsal()` in main.go:60), and the comment warns the heal was deliberately kept *same-site*. Shooting the money shot at Shackleton would have killed a rover off-camera at the lunar dome. Lunar's sun also guarantees the death + takeover are *visible* — fixing the "death-in-the-dark" legibility risk for free. Shackleton is now the awe/dread *arrival* (mood), not the load-bearing climax. Act structure flips accordingly: **Lunar = the site where failure happens and heals; Shackleton = the hard place we just conquered.**
- **One latency through-line: 2.6s.** Killed the incoherent 1.8s (a mock artifact; live default is 0). The latency slider is now *explicitly scripted UP to 2600ms* at build-start so the Earth panel genuinely reads behind in the live demo. Beat 13 reframed honestly: not "healed before Earth could see" (false), but "a human round-trip command could never arrive in time." Removed "snaps caught-up" (the shim is FIFO-trailing, it does not snap).
- **HUD counts now match the engine.** ROVERS **6/6 → 5/6** (single kill); dome shown as a **% progress bar** (true total is 13 tasks), never a fake unit count. Copy written to *match what MissionHud computes live*.
- **Build budget re-classed honestly.** MissionHud (rover dip/recover + progress bar) and the **'H' HUD-fade** are **HAVE-NOW** (verified wired in App.tsx) — they are now the primary on-screen proof, not a needs-build gamble. Added the **Task-Ledger task-id flip** (LEASED→UNCLAIMED→LEASED-new-id) as a *have-now* engineering proof that does not depend on Epic 06.
- **Front compressed + real cut list.** Act 1 reconciled with the true 4500ms intro rig (no 20s of phantom drift). The climax window widened to the true ~15–20s heal arc; victim task placed adjacent to a survivor for a short readable drive; per-phase on-camera targets pinned. Explicit mechanical trim path added.
- **Orbit bookend close added (post-table-read, on request).** After the thesis we hit `H`, ascend back to orbit, and resolve on the whole lit Moon with both markers operational — ending the film inverted to its open. Verified HAVE-NOW: the ascent reuses the symmetric `runDescent` rig (`Scene3D.tsx:3266`/`:3523`) and `H` fades the panels but leaves the in-world markers (pure vista + two diamonds). Runtime relocked **2:18 → 2:30**.

---

## 1. Logline & Runtime

**Logline:** A camera lost in lunar dark is found by the sun, commits to a working outpost, kneels beside one rover — then watches it die mid-wall and the swarm silently re-auction the task and seal the dome anyway, with nobody on Earth close enough to help.

**Locked runtime:** **2:30** (150s). Mechanical trim path to **~2:12** is in Section 3 — and it touches *only* establishing beats. **The climax and the orbit bookend are never cut.**

**Bookend (closing structure):** the film *ends the way it opened, inverted* — after the heal + thesis we hit `H`, lift back through the glare to orbit, and settle on the whole lit Moon with both worksites now operational. We left the dark adrift; we return to the wide as the swarm holds. (Feasibility verified: the ascent reuses the same symmetric `runDescent` rig, `Scene3D.tsx:3266`/`:3523` — HAVE-NOW.)

---

## 2. Story Spine (3 acts)

**ACT 1 — THE WHY (0:00–0:30).** We drift in the Moon's shadow, lost, until the sun rakes the limb and finds us; the camera settles into the orbit hero pose. Two worksite markers are already glowing under the flare (labels land here). We learn the stakes in two terse lines — regolith kills robots, and Earth is **2.6s** too far to help — then lock onto **Lunar Base** and commit, descending through the glare.

**ACT 2 — THE WORKING OUTPOST + THE HARD PLACE (0:30–1:30).** Lunar Base is sunlit and alive: the swarm building under towering launch hardware. We watch one specific rover *win* its task — we tag it. The mission then sends us to the hard place: a dust-veil ground drive over the rim into Shackleton's shadowed bowl, where the dense outpost stands as proof we can build anywhere. Then we **return to Lunar Base** for the live build — because that is where the truth gets tested.

**ACT 3 — THE MONEY SHOT, THE THESIS & THE BOOKEND (1:30–2:30).** On Lunar Base's sunlit floor we kneel beside the rover we tagged — then kill it mid-wall. The lease expires, the Task Ledger flips the wall to UNCLAIMED, the Mission HUD rover count dips, the wall stalls with an open gap. Then with **nobody at the controls** a neighboring rover wins the re-auction, drives the short gap, and seats the final block — the dome seals. The Earth uplink reads **+2.6s BEHIND**: a human command could never have arrived in time. Then we press **'H'**: the HUD dissolves, the camera lifts off the sealed dome and **rises back through the glare to orbit**, settling on the whole lit Moon — both diamond markers now reading *operational*, the swarm holding far below. Wordmark + thesis land over the pure vista. We left the dark adrift; we return to the wide, and it's built.

> **Staging note (load-bearing):** Lunar = sunlit **climax** site (deterministic kill lives here, death is *visible*). Shackleton = dark **arrival** site (awe/dread, mood only). This is the inverse of the draft and is the single most important correction.

---

## 3. Beat Sheet

| # | Time | Beat | Camera / Action | HUD / On-screen text | Sound | Feasibility | Have-now fallback |
|---|------|------|-----------------|----------------------|-------|-------------|-------------------|
| 1 | 0:00–0:06 | **WANDERING.** Open in the void on the Moon's shadow side, faint earthshine only. Drift laterally — no UI, sun off-frame. Lost. | Open at/near ORBIT_POSE with idle CameraFeel sway; slow lateral drift along the dark limb. | (none) | Sub-bass drone from silence; one distant comms ping. | **NEEDS-SMALL** ⟶ open-in-orbit + ~6s drift-fill (the 4500ms rig first-mounts in *surface*; in orbit there is currently no wander, just a static ORBIT_POSE hold). | If rewire slips: **cold static ORBIT_POSE hold with sway, no wander, no sun-arc** — the "found by light" read then moves to the descent glare (Beat 4). Cut Beats 1–2 to a 4s static hold. |
| 2 | 0:06–0:12 | **SUN REVEAL + SITES BLOOM.** Hard sun + godrays crest the limb and rake the terminator. Light *finds* us; both markers bloom in under the flare, labels readable as exposure stops down. | Arc so SunBody godrays + CELESTIAL_BLOOM crest in; flare blows then settles (~2s) easing toward ORBIT_POSE. **Both NMS line-diamond reticles fade in here with their labels** (cyan Lunar, amber Shackleton). | `SWARMBUILD` · `LUNAR BASE · operacional` · `SHACKLETON · em construção` | Drone resolves to a rising sustained chord on the flare; two soft marker chimes. | **NEEDS-SMALL** (pose/timing on the sun-arc; reticles already BUILT). | No literal orbit sunrise without the rewire — fall back to the descent glare carrying "found by light." Reticles + labels ship today; leave them statically pulsing. |
| 3 | 0:12–0:30 | **STAKES + LOCK-ON + COMMIT.** Two stakes lines only (labels already landed in Beat 2), ~7s each. Lunar Base plays a lock-on pulse; cyan select fires the descent. | Hold ORBIT_POSE. Two stakes lines stack; heartbeat under the latency line. Timer-driven lock-on on the cyan marker, then marker-select ⟶ runDescent. | `Regolito destrói robôs. Falha é esperada.` ⟶ `Terra a 2.6s: nenhum operador humano reage a tempo.` | Warm pad; heartbeat motif enters under the 2.6s line. | **NEEDS-SMALL** ⟶ timer-driven lock-on cue (reuses built hover state). | Leave reticle pulsing (free under frameloop=always) or a scripted 1s hover flash; click by hand. |
| 4 | 0:30–0:36 | **DESCENT — glare-masked commit.** Globe looms, sunlit limb flares white, scene swaps under the glare, horizon rises into the oblique surface pose. | runDescent('orbit','surface') TRANSITION_MS=1500: ~1s anticipation pull-in, easeInQuad depart, glare-peak swap, easeOutQuint arrival w/ pitch-up horizon. (6s = anticipation + 1.5s move + arrival settle.) | (none) | Whoosh into white; whoomph as surface lands; pad continues. | **HAVE-NOW** | Click by hand or 1-line scripted dispatch. Fully working today. |
| 5 | 0:36–0:46 | **LUNAR BASE — the working outpost.** Land sunlit: NASA lander, crawler + mobile launcher + gantry at true scale behind the swarm, already at work. Surface HUD boots in. | Settle LUNAR_SURFACE_POSE, gentle craning push to the worksite; rover dust puffs. Surface panels stagger-in (hotbar, Mission HUD wipe, Earth slide). | `LUNAR BASE` · build progress bar climbing · `ROVERS 6/6` (live from MissionHud) | Low servo hums, regolith crunch; confident mid-tempo pulse. | **HAVE-NOW** (MissionHud + counts ship live, App.tsx) + **NEEDS-SMALL** (staggered boot animation; set-piece dressing ~2h). | Static panels instead of staggered boot. Ensure LUNAR_SET_PIECES dress the frame so it isn't sparse. |
| 6 | 0:46–0:54 | **TAG THE ROVER + THE CALL.** We follow ONE rover as it *wins* the first visible auction and starts a wall — this is the one we'll lose. A HUD objective then points poleward; Shackleton chip pulses. | Brief follow on the winning rover (winner ring on it); then camera yaws toward the objective; Shackleton chip lock-on pulse. | `PRÓXIMA → SHACKLETON · cratera em sombra permanente` | Pad cools a half-step; tense rising sub-tone; ticking returns. | **HAVE-NOW** (auction + winner ring live) + **NEEDS-SMALL** (CTA/objective overlay ~4h). | Existing SITE toggle chip + a single on-screen CTA. Tagging the rover needs no build — just framing. |
| 7 | 0:54–1:02 | **GROUND-DRIVE to Shackleton (NOT a cut).** Camera dives low and RACES across regolith; warm dust brownout swallows frame; site swaps behind the veil; crest the crater rim. | runTraverse TRAVERSE_MS=2900: dive to SKIM_ALTITUDE, skim SKIM_OUT_DIST out, dust-veil plateau swap at t=0.5, race back and crest into SHACKLETON_SURFACE_POSE. | (none) | Engine-rush + gravel spray; brownout muffles audio; clears on reveal. | **HAVE-NOW** (r3d-138-03 confirms). | Fully working. Differentiated grammar from the descent: drop-in vs. race-across. |
| 8 | 1:02–1:14 | **ARRIVE SHACKLETON — dread + awe (mood beat).** Crest the dark bowl: grazing pole sun on the rim ridge, floor in cold shadow; 7 dressed assets + astronaut for scale. The hard place — and we already built it. | Crane down and IN over the rim; optional 1-breath earthrise on the crater horizon. CTA card fades in. | `SHACKLETON · CONSTRUÍDA NO ESCURO` *(built in the dark)* | Cold airy drone; sparse high shimmer on rim light; heartbeat present. | **HAVE-NOW** (7 dressed assets) + trivial CTA overlay (~1h). | Let the dense dressing + narration carry it if overlay slips. |
| 9 | 1:14–1:30 | **RETURN to Lunar Base — the live build.** Snap/drive back to the sunlit Lunar dome; rovers bid (amber halos), auctions resolve (winner rings), dome rises foundations ⟶ walls. **Latency slider driven UP to 2600ms here** — Earth panel goes behind for real. | Lock to a 3/4 working angle over the Lunar dome; bid-flash halos + winner rings; blocks rise. Mission HUD progress climbs. Earth panel ticks to `+2.6s ATRÁS`. | `CÚPULA HABITAT · fundações → paredes → selagem` · progress bar · `Terra observa, +2.6s atrás` | Rhythmic build pulse; each auction-win a bright tick; tempo creeping up. | **HAVE-NOW** (live engine; auto-place via DomeScenario; MissionHud progress live) + **NEEDS-SMALL** (script the latency slider to 2600ms on cue). | Latency can be raised by hand on the slider mid-take. Task Ledger backs the progress. |
| 10 | 1:30–1:36 | **THE BOND.** Drop to a low near-ground hero on the rover **we tagged in Beat 6** — wheels, dust, cyan lease beam to its wall task. The calm before the loss. | Low dolly to ground beside the *tagged* victim; shallow framing; lease beam visible; idle sway OFF (locked, deliberate). | (none) | Music thins to a single held note; isolated servo + lease-beam hum; percussion out. | **HAVE-NOW** | Straight framing on the live worker rover. No build. (Earned by the Beat-6 tag.) |
| 11 | 1:36–1:48 | **THE KILL (money shot pt.1).** Kill the framed rover mid-wall: red flash, body dims to a visible **cool-grey silhouette** (not black — sunlit floor guarantees it), lease beam SEVERS, half-built wall freezes with an open gap. | **Scripted kill auto-fires** (demo.go ScriptedKills/KillAfterLeased on `lunar/wall-1` — HAVE-NOW at *this* site). Hold on the dimming body; whip to the orphaned gap. **Task Ledger flips the wall LEASED ⟶ UNCLAIMED**; MissionHud rovers 6/6 ⟶ 5/6. | `ROBÔ PERDIDO · lease expirou` | MUSIC OUT on the kill — one hard impact + power-down whine, then silence. Let it land. | **HAVE-NOW** (backend-tested: selfheal/liveheal/killcontrol; deterministic kill at lunar/wall-1; MissionHud dip + Task-Ledger flip both ship live). | Primary proof = **Task-Ledger task-id flip** (no Epic 06 dependency). MissionHud dip is the upgrade. |
| 12 | 1:48–2:06 | **SELF-HEAL (money shot pt.2).** Lease EXPIRES, task RE-AUCTIONS; a **neighboring** survivor wins the bid-war, drives the **short** gap (3–4s, dust trail) to the *exact* abandoned slot, seats the final block. Cyan revive flash. Dome CLOSES. No operator. | Held wide reveals the bid-war strobe; **camera locked, unbroken shot** follows the winner to the *same* gap (spatial continuity = the proof); winner ring + revive pulse; cap seals. MissionHud rovers RECOVER to 6/6; progress hits 100%. | `RE-LEILÃO → CÚPULA FECHADA · zero humano no loop` · progress 100% | Music SLAMS back on the takeover — the drop; bid-war ticks crescendo to the win; triumphant chord on the cap. | **HAVE-NOW** (real re-auction; full frontend dramatization) + **NEEDS-SMALL** (timing-tune a Rehearsal copy so the FULL kill→seal arc lands in window; pin seed). | **Replay-mode take is the A-roll** (deterministic). Victim task placed adjacent to a survivor so the drive can't overrun. |
| 13 | 2:06–2:12 | **EARTH LAGS — the thesis.** Pull focus to the Earth uplink reading **+2.6s BEHIND**: Earth's telemetry is a delayed replay. A human command, even formed instantly, is 2.6s each way away — it could never have arrived in time. | Hold on the sealed dome; highlight the lagging Earth panel trailing the live state. | `TERRA +2.6s ATRÁS — nenhum comando humano chegaria a tempo.` | Single low "truth" note under a beat of silence. | **HAVE-NOW** (Earth uplink panel ships; latency was driven to 2600ms in Beat 9). | Already present; just frame it. No "snap caught-up" — the shim trails, FIFO. |
| 14 | 2:12–2:20 | **HIDE & LIFT OFF (bookend pt.1).** Press **'H'** — all HUD panels dissolve; the camera lifts off the sealed sunlit dome and **rises back through the glare to orbit** (Beat 4's descent, run in reverse). | 'H' toggles `hud--hidden` (App.tsx:352) — fades panels but **NOT** the in-world markers. runDescent('surface','orbit') TRANSITION_MS=1500: liftoff (horizon drops in beat 1), easeInQuad depart, glare-peak swap, easeOutQuint settle into ORBIT_POSE. | (none) | Music swells; whoosh up into white; pad opens out as space returns. | **HAVE-NOW** (symmetric ascent verified, Scene3D.tsx:3266/3523; 'H' fade App.tsx:352). | None needed. If 'H' timing is fussy, fade panels via the view-transition class on the ascent instead. |
| 15 | 2:20–2:30 | **THE WIDE / HERO + CTA (bookend pt.2).** Settle on the whole lit Moon — pure vista, no panels, only stars + sun + the **two in-world diamond markers, both now `operacional`**. Slow idle drift; wordmark + thesis fade up over the live scene (not a black slate). | Hold near ORBIT_POSE with idle CameraFeel sway; both reticles pulse (Shackleton flipped amber→cyan); logo + tagline fade in over the vista; soft star-twinkle. | `SWARMBUILD` · `LUNAR BASE · operacional` · `SHACKLETON · operacional` · then tagline (see §6) | Full pad resolves to a sustained warm chord; the opening comms-ping echoes once to bookend. | **HAVE-NOW** for the vista + markers + wordmark; **NEEDS-SMALL (~1h)** only for the Shackleton label flip amber→cyan. | Leave Shackleton reading `em construção`; the built dome below + wordmark still close it. |

**Runtime check:** 6+6+18+6+10+8+8+12+16+6+12+18+6+8+10 = **150s (2:30).** Act split: setup 0:36 / rising action 0:54 / climax + payoff + thesis + bookend 1:00.

**Mechanical ~2:12 trim path (−18s, establishing only):**
- Beat 3 18s → 12s (−6): drop to one stakes line (keep the 2.6s latency line; fold "falha é esperada" into VO).
- Beat 8 12s → 8s (−4): trim the Shackleton mood hold to a single crane-in, cut the earthrise breath.
- Beat 9 16s → 12s (−4): start later in the build (already at walls), shorter bid montage.
- Beat 5 10s → 8s (−2): tighter craning push.
- Beat 6 8s → 6s (−2): clip the objective hold.
**Result: ~2:12. Climax beats (10–13), the kill (11), and the orbit bookend (14–15) are untouched.**

---

## 4. The Climax, Shot-by-Shot (1:30–2:12, ~42s) — **LUNAR BASE, sunlit floor**

Six micro-beats. Stage on **Lunar Base** (the deterministic `lunar/wall-1` kill lives here — HAVE-NOW). Kill ONE clearly-framed rover. The sunlit floor guarantees the death and takeover are legible.

- **C1 — THE BOND (1:30–1:36, 6s).** Low ground-level dolly settles beside the rover **we tagged in Beat 6** seating a wall block; cyan lease beam to its task; wheel-dust. Idle sway off. *Sound:* music thins to one held note. *Purpose:* this is "the one we watched win," so the death is a *character* death.
- **C2 — THE KILL (1:36–1:42, 6s).** Scripted kill fires (`lunar/wall-1`). Red flash; body dims to a **visible cool-grey silhouette**; lease beam SNAPS; half-laid wall freezes with an open gap. *HUD:* `ROBÔ PERDIDO`; **Task Ledger wall flips LEASED ⟶ UNCLAIMED** (the id change IS the re-auction, legible to engineers); MissionHud 6/6 ⟶ 5/6. *Sound:* MUSIC OUT — impact + power-down whine. **Hold the silence.**
- **C3 — THE STALL (1:42–1:48, 6s).** ~2s held silence on the dimmed body; ~2s whip + hold on the open gap; ~2s for the stalled progress bar to register. The cap depends on this wall — without intervention it stays open. *Sound:* near-silence; faint alarm sub-pulse. *Purpose:* the pause before the heal is what makes the heal land.
- **C4 — THE RE-AUCTION (1:48–1:51, 3s).** `lease expirou` over the orphaned task; surviving rover halos strobe amber; **Task Ledger flips UNCLAIMED ⟶ LEASED (new rover id)**. *Sound:* tense rising; bid-war ticks begin. *Purpose:* the *mechanism* (lease expiry + re-auction), shown, not vibed.
- **C5 — THE TAKEOVER (1:51–2:06, ~15s — see widened budget).** Winner ring snaps on a **neighboring** rover; it drives the **short 3–4s** gap to the *exact* abandoned slot and seats the final blocks. Cyan revive flash. **Camera locked, unbroken from kill→same-gap→sealed** — spatial continuity is the proof. *HUD:* rovers RECOVER to 6/6. *Sound:* music SLAMS back — the drop; percussive "lock" on takeover. *Per-phase pins:* drive ~4s, seat+seal ~6s, dome-cap settle ~3s. **Replay-take = A-roll (deterministic seed).**
- **C6 — THE SEAL (folded into C5 tail / into Beat 13).** Cap seats; structure whole despite the death. *HUD:* `CÚPULA FECHADA · zero humano no loop` · progress 100%. *Sound:* resolving chord + chime. Cut into the latency thesis (Beat 13), then the **orbit bookend** (Beats 14–15): `H` to hide the HUD, ascend back through the glare, and resolve on the whole lit Moon with both markers operational — the inverse of the open.

**Director's notes:**
- **(a) Causality:** the kill target `lunar/wall-1` is a load-bearing wall the cap depends on (tierOf/tierHeight + isBuilt drive the dome), so the gap is causally necessary. ✔ Already true in the shipped scenario.
- **(b) Legibility (now easy):** sunlit Lunar floor means the dead body, severed beam, and open gap all read without any extra fill light. The cool-grey silhouette + cyan revive + amber bid halos carry it.
- **(c) Timing contract (explicit, not "to taste"):** Rehearsal sets TTL = 4.2s (TTLFactor 6 × 700ms), AuctionWindow 900ms, KillAfterLeased 900ms; doc-string arc reads in ~12–20s. **Budget = ~15–20s (C4–C5), matching the engine.** Place the victim's task adjacent to a survivor so the drive is a 3–4s traverse, not a cross-map haul. **Lock a known-good seed; the replay-mode take is the A-roll, not a backup.**
- **(d) The proof is spatial, not captioned:** the unbroken kill→same-gap→sealed shot proves "same task, new rover" with no HUD at all. The **Task-Ledger task-id flip** is the have-now engineering proof; the MissionHud dip is the upgrade. Keep the `+2.6s BEHIND` Earth panel framed through C2–C6 — proof the heal was autonomous.

---

## 5. Asset & Build Checklist

### HAVE-NOW (ships today, zero build)
- Orbit hero vista: stars/Milky Way, sun glare + CELESTIAL_BLOOM, lit Moon limb, Earth marble (integration-orbit.png).
- Two in-world NMS line-diamond markers w/ bloom halo, pulse, hover lock-on, in-world SDF text (BUILT, SkyBodies.tsx).
- Glare-masked DESCENT orbit⟶surface (runDescent, TRANSITION_MS=1500) — marker click wired to onSelectSite + onViewModeChange.
- Cinematic GROUND-DRIVE surface⟶surface traverse w/ dust brownout (TRAVERSE_MS=2900; r3d-138-03).
- Lunar Base assets: NASA lander, crawler + mobile launcher + gantry + base station (LUNAR_SET_PIECES).
- Shackleton outpost: 7 dressed pieces + carved crater bowl + grazing pole light + cold crater fill (crater-06-shackleton-final.png).
- Live build engine: coordinator + agent swarm + buildspec; dome decomposes 4 foundations ⟶ 8 walls ⟶ cap (13 tasks); 6 rovers/site; auction bidding; rover dust.
- **MissionHud:** rovers N/M alive that **DIP and RECOVER** + done/total progress bar — verified rendered & data-driven (App.tsx:20,313,358). *This is have-now proof, not a build gamble.*
- **'H' cinematic HUD-fade** (`hud--hidden`, App.tsx:88,352) — have-now. Fades HUD panels but **leaves the in-world R3F markers** (pure-vista close).
- **Orbit-return ASCENT** surface→orbit — the glare-masked liftoff for the bookend; reuses the symmetric `runDescent` rig (`Scene3D.tsx:3266`, dispatched at `:3523`), horizon-drop mirrored. Have-now.
- Hotbar, TopBar, KillPanel components — present & wired (hand-fire kill fallback available).
- **THE CLIMAX (at LUNAR):** real, backend-tested self-heal (selfheal_test.go / liveheal_test.go / killcontrol_test.go); deterministic scripted kill on `lunar/wall-1` via demo.Rehearsal() → DomeScenario (main.go:60) — **auto-fires at the lunar site, no live clicking, at the site we now shoot on.** Frontend dramatization: dim, lease-sever, bid-war strobe, winner ring, cyan revive. Task-Ledger task-id flip as engineering proof.
- Earth Uplink latency panel (defaults to 0; driven to 2600ms on cue in Beat 9).

### NEEDS-SMALL-BUILD (~1–1.5 dev-days total, NONE blocks the climax mechanism)
- **Open-in-orbit rewire + ~6s drift-fill** (~3h): the 4500ms intro first-mounts in surface; in orbit there is currently no wander/sun-arc, only a static hold. *(Beats 1–2; fallback = cold static open.)*
- **Timer-driven marker lock-on cue** (~3h): drive the built hover state from a timer. *(Beats 3, 6.)*
- **Script the latency slider to 2600ms on cue** (~1h): so the Earth panel reads `+2.6s BEHIND` live through the climax. *(Beat 9.)*
- **Lightweight surface overlays** (~4h): CTA + "go to Shackleton" objective + arrival card, standing in for the unbuilt Epic 06 surface hotbar redesign. *(Beats 6, 8.)*
- **Staggered HUD boot-in animation** synced to the descent driver (CSS, Epic 06). *(Beat 5; fallback = static panels — MissionHud itself already renders.)*
- **Scripted-kill FULL-ARC timing tune + seed pin** (~2h): tune a Rehearsal copy so kill→seal lands inside ~15–20s; lock the seed; cut the replay-mode A-roll. *(Beats 11–12.)*
- **Reliable LUNAR_SET_PIECES dressing** for the hero frame (~2h staging/config). *(Beats 5, climax.)*
- **Shackleton marker label flip `em construção` → `operacional`** (~1h): for the bookend payoff so both diamonds read operational on the final wide. *(Beat 15; fallback = leave it `em construção`.)*
- *(Optional polish)* thin volumetric rim god-ray on the Shackleton crest.

### NEEDS-BIG-BUILD — **CUT for the demo** (ship the fallback)
- ~~Camera starts INSIDE a lunar-base model and exits~~ — no interior shell, no portal logic. **Fallback (used):** glare-masked descent-and-reveal of the exterior base (Beats 4–5). More cinematic anyway.
- ~~TWO distinct NASA transport-rover assets~~ — only the worker GLB exists. **Fallback:** crawler + mobile launcher already read as transport/launch hardware; show 2–3 worker rovers driving.
- ~~Retarget the kill to Shackleton~~ — **explicitly rejected.** demo.go warns the cross-site case was avoided (heal must stay same-site); shooting the climax at Lunar is the honest, have-now, *and* more legible choice.

**Perf hygiene:** dpr capped [1,1.5]; selective bloom only on halos + celestial bodies; shared geometry; instanced dust/rocks. Climax frame is heaviest — shed DoF first, then god-rays. Record at fixed window size; keep the replay-mode take as the A-roll.

---

## 6. On-Screen Copy (PT-BR primary, EN in parens)

**Wordmark (Beat 2):** `SWARMBUILD`

**Markers (Beat 2) + Stakes (Beat 3):**
- `LUNAR BASE · operacional` (Lunar Base · operational)
- `SHACKLETON · em construção` (Shackleton · in construction)
- `Regolito destrói robôs. Falha é esperada.` (Regolith destroys robots. Failure is expected.)
- `Terra a 2.6s: nenhum operador humano reage a tempo.` (Earth at 2.6s: no human operator reacts in time.)

**Lunar Base (Beats 5–6):**
- `LUNAR BASE` · *(live HUD: ROVERS 6/6 + progress bar — do not burn in fixed counts)*
- `O enxame está construindo sozinho.` (The swarm is building on its own.)
- `PRÓXIMA → SHACKLETON · cratera em sombra permanente` (Next → Shackleton · permanently-shadowed crater)

**Shackleton arrival (Beat 8):**
- `SHACKLETON · CONSTRUÍDA NO ESCURO` (Shackleton · built in the dark)

**Lunar live build + latency (Beat 9):**
- `CÚPULA HABITAT · fundações → paredes → selagem` (Habitat Dome · foundations → walls → cap)
- `Terra observa, +2.6s atrás.` (Earth watches, +2.6s behind.)

**The climax (Beats 11–13):**
- `ROBÔ PERDIDO · lease expirou` (Rover lost · lease expired)
- `RE-LEILÃO → CÚPULA FECHADA · zero humano no loop` (Re-auction → dome closed · no human in the loop)
- `TERRA +2.6s ATRÁS — nenhum comando humano chegaria a tempo.` (Earth +2.6s behind — no human command could arrive in time.)

**Bookend close — over the orbit vista (Beat 15):**
- **Marker payoff:** `LUNAR BASE · operacional` · `SHACKLETON · operacional` (both worksites now operational)
- **Primary CTA:** `SwarmBuild — construção autônoma que se cura sozinha. Feita para a Lua, antes de chegarmos.` (SwarmBuild — autonomous construction that heals itself. Built for the Moon, before we arrive.)
- **Tech line (hold 1s under wordmark):** `Auto-cura = expiração de lease + re-leilão. Decisões na borda. Terra fora do loop.` (Self-heal = lease expiry + re-auction. Decisions at the edge. Earth out of the loop.)

**Optional VO (only these):** the two stakes lines (Beat 3) and the final thesis line (Beat 14). Everything else is on-screen text synced to live HUD events that name each mechanic at the exact frame it happens. **No burned-in rover/task counts** — let MissionHud render the true live numbers (6 rovers, 13-task dome as a %).

### Capture checklist — beat-locked copy (never name a beat before it happens)

The copy overlay (#156, `web/src/lib/reel/copy.ts`) is operator-advanced with `]`
(next) / `[` (prev) while cinematic mode is armed (`?reel=1` or `R`). Each line is
tagged **free** (advance any time) or **beat-locked**. The three **beat-locked**
lines NAME a live worksite event, so the operator MUST land them **after** the
real event fires on screen — never before (otherwise the Scenery fabricates
Choreography, which the domain model forbids). This is a documented capture rule,
NOT a gating engine (no World Model clock gates the cursor — ADR-0004 purity):

| Order | Line | Land it AFTER… |
|-------|------|----------------|
| 1 | `ROBÔ PERDIDO · lease expirou` (Beat 11) | the rover dims + the lease beam severs (the scripted kill fires) |
| 2 | `RE-LEILÃO → CÚPULA FECHADA · zero humano no loop` (Beat 12) | the survivor seats the final block + the dome seals |
| 3 | `TERRA +2.6s ATRÁS — nenhum comando humano chegaria a tempo.` (Beat 13) | the seal, framed against the Earth panel reading +2.6s behind |

Everything else (wordmark, stakes, objectives, the Shackleton card, the bookend
CTA) is **free** — safe to advance to at any point in the take.
