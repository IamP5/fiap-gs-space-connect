# Progress Log

The continuity record for agent sessions. Read this first at startup; update it before you
stop. `feature_list.json` is the per-feature source of truth; this file is the narrative of
*where we are now* and *what to do next*. Architectural decisions live in the ADRs
(`docs/00-mvp/adr/`, `docs/01-build-harness/adr/`) — record new decisions there, not here.

## Current Verified State

- **Repository root:** `/Users/tuba/Dev/projects/gs-fiap-space` (branch `docs/01-build-harness`)
- **Standard startup path:** `./init.sh` (Go baseline; `WEB=1 ./init.sh` to include the dashboard)
- **Standard verification path:** `make check` (vet + lint + race tests); `./deploy/smoke.sh` for end-to-end self-heal
- **Branch:** `main` (the whole build-harness milestone is merged — PR #12 @ `25ce08a`)
- **Backend baseline:** ✅ green @ `25ce08a` — `go vet` ok, `golangci-lint` 0 issues, `go test -race -shuffle=on ./...` all pass incl. `internal/harness/live` + the rescoped archtest (go1.25.5)
- **Web baseline:** ✅ green @ `25ce08a` — `tsc -b && vite build` TS-clean, `vitest` 10 files / 111 tests pass (`WEB=1 ./init.sh`)
- **End-to-end:** ✅ verified this session — live compose stack up; coordinator logs assert `msg=expiry task=wall-1 … returned to UNCLAIMED` (self-heal) then `msg=complete task=dome-cap by=R1` (dome closed). The `deploy/smoke.sh` *wrapper* can't pass its host `/healthz` gate on this laptop: a stale `kubectl port-forward` (kind cluster, `swarmbuild-control-plane`) is holding `127.0.0.1:8080` and shadows the compose gateway — environment collision, not a regression. Kill that port-forward (or run smoke on a clean host) to get a green wrapper.
- **MVP (issues 01–11):** all `passing` in `feature_list.json`; GitHub issues #13–#23 closed; milestone "SwarmBuild MVP" closed.
- **Build-harness (bh-01..bh-08):** all `passing` in `feature_list.json` with evidence; GitHub issues #24–#38 closed; milestone "Build Harness" closed. **All 19 features now `passing` — no open work in the tracker.**
- **Realistic-3d-world (epic #46): ✅ COMPLETE — all 59 features `passing`.** Wave 3 cinematic polish (#99,#101–109) + Wave 4 living orbit (#112) + r3d-100 (Texture fidelity) all on `main`; **r3d-110 (Sun GodRays + anamorphic streak) + r3d-111 (Material tier polish) merged to `main` 2026-06-07** (operator signed off) via branch `wave3/godrays-material-polish` (feat `96221e0` + perf `737a6cd`). `feature_list.json`: **59/59 `passing`**. Epic #46 can close (its three remaining children — #100/#110/#111 — are all done). Build-harness + MVP milestones remain closed; backend baseline unchanged.

## Next Steps

1. **Close epic #46** on GitHub (all 59 children `passing`/merged) and close issues
   #110/#111 if the merge auto-close didn't fire (the merge commit carries `Closes
   #110`/`Closes #111`). Realism milestone is feature-complete.
2. **Push `main`** when ready — the r3d-110/111 merge is local only (commits
   `96221e0`, `737a6cd`, and the merge commit). Nothing has been pushed to the remote.
3. **Branch hygiene:** `wave3/godrays-material-polish` (now merged) plus the older
   `wave4/living-orbit` + `wave3/integration` + merged `worktree-agent-*` heads can be
   deleted. Keep the invariant sacred on the backend self-heal core (ADR-0009); re-run
   `./deploy/smoke.sh` before any demo.

## Session Log

### Session 010 — 2026-06-07 — Epic 04 (two-site lunar surface) + Epic 05 (app-init refactor), parallel batch
- **Goal:** Implement BOTH epics and converge them onto one testable feature branch,
  `feat/two-site-and-app-init` (cut from `main`). No human review until done; user tests
  locally at the end. Orchestrated as a wave/DAG (the two epics co-edit App.tsx/Scene3D.tsx/
  SkyBodies.tsx/scene.ts and their plans mandate a landing order — a flat parallel fan-out
  would conflict).
- **Execution:** Wave 1 = 3 independent beachheads in parallel worktrees — **#134** scale
  unification (PR #141), **#135** backend SiteID (PR #140), **#128** remove 2D scene
  (PR #139). Then a sequential frontend spine, each rebased on the growing integration tip —
  **#129** loading screen + preload (PR #142), **#130** orbit default + immediate idle
  (PR #143), **#136** two-site surface (PR #144), **#137** orbit markers + descend, supersedes
  **#131** (PR #145), **#138** surface↔surface transition + Shackleton polish (PR #146).
- **State:** all 8 PRs target and are merged into `feat/two-site-and-app-init` (NOT `main`).
  Verified on the integration tip: `go build ./... && go test ./...` green; `cd web &&
  npm run build` TS-clean, `npm run lint` 0 errors, **178 vitest tests pass**;
  `grep -rn "WorldCanvas|hitTest" web/src` clean. Integration smoke via chrome-devtools MCP
  (VITE_MOCK): boot → splash → orbit default with two lit labeled markers + idle drift →
  marker descent → surface site toggle plays the ~900ms match-cut and settles. Console clean
  (only the benign mock-WS 404 + pre-existing ANGLE glBlitFramebuffer warning).
- **`feature_list.json`:** r3d-128/129/130/134/135/136/137/138 → `passing` with evidence;
  r3d-131 → `passing` (SUPERSEDED by r3d-137). Epic 04 entries (r3d-134..138, epic 133) added.
- **Note:** GitHub issues #128 and #131 were already CLOSED but their code was never written —
  implemented here. **Next:** user tests `feat/two-site-and-app-init` locally, then merges to
  `main`; on merge, re-close #128/#131 as appropriate and close epics #127/#133. Branch base
  for all 8 PRs is the feature branch, so the user can land the whole batch as one.

### Session 009 — 2026-06-07
- **Goal:** Implement the last two open Wave-3 slices under epic #46 — **#110 Sun GodRays + lens flare** and **#111 Material tier polish** — now unblocked (#99 merged). Branch `wave3/godrays-material-polish`.
- **Completed:**
  - **#110:** surfaced a shared `sunRef` from `SkyBodies`/`SunBody` (the core disc mesh) up through `SceneContents` into `CinematicFX`, and added a `<GodRays>` pass **after** both bloom passes (density 0.5 / decay 0.93 / weight 0.3 / samples 80, SCREEN blend), orbit-gated + null-safe. Added a procedural **anamorphic lens-flare streak** sprite (`makeAnamorphicStreakTexture`) to the Sun's additive flare stack, orbit-gated via `showStreak`. The Wave-4 orbit Sun is decoupled off-frame (dark-crescent hero), so the effect is correctly dormant in the default pose and reveals as the camera orbits toward the Sun (Moon limb occludes the shafts).
  - **#111:** per-tier dome roughness in `TaskBlock` (cap 0.75 / walls 0.88 / foundation 0.95); new **`polishGltfMaterials()`** in `lib/textureFidelity.ts` — clearcoat on `metalness>0.3` (in-place `MeshStandardMaterial`→`MeshPhysicalMaterial` upgrade, originals disposed once, textures shared), URL-keyed solar anisotropy (`/solar|panel/`), `*window*` emissive (#FFD8A0) on the celestial bloom layer — run **once on the cached glTF source** in both `loadGLTF` + `loadScenery` so every clone inherits it. `DecorRocks` gained the vendored Poly Haven "Rock Boulder Dry" `nor_gl` + `rough` maps (512, CC0, credited) with max anisotropy + per-channel swallowed-catch fallback.
- **Verification run:** `cd web` → `npm run build` (tsc -b clean), `npm run lint` clean, `npx vitest run` **156 passed** (13 files). **chrome-devtools MCP** (VITE_MOCK): surface shows boulders with real PBR microrelief + clearcoat metal (no console errors); orbit default keeps the dark-crescent hero (GodRays dormant); orbiting toward the Sun shows the disc starburst + anamorphic streak + god-ray glow occluded by the Moon limb. Screenshots saved under `.screenshots/` (untracked).
- **Files/artifacts updated:** `web/src/lib/textureFidelity.ts`, `web/src/components/{Scene3D,SkyBodies,DecorRocks,LaunchScenery}.tsx`, `web/public/assets/textures/rock_boulder_dry_{nor_gl,rough}_512.jpg` (new) + `CREDITS.md`, `docs/02-realistic-3d-world/issues/{110,111}-*.md`, `feature_list.json` (r3d-110/111 → in_progress + evidence), `PROGRESS.md`.
- **Perf follow-up (same session):** operator flagged a perf drop from the new effects. Profiling (chrome-devtools): main thread/JS clean (CLS 0, nothing flagged) and **surface holds the 120fps vsync cap** → the regression is **GPU-fragment-bound and orbit-only**, dominated by the new GodRays multi-pass (this dev machine has too much headroom to expose it via FPS, so it bites only on weaker hardware). Fix in `Scene3D.tsx`: **frustum-cull GodRays** — a cheap per-frame NDC projection of the Sun toggles `resolution.scale` 0.5↔0.05 on transition only (no shader recompile), so the *default off-frame orbit pose* (the common view) pays ≈nothing; plus **samples 80→60** (lib default, identical look). Surface untouched (GodRays is orbit-only); #111 material quality untouched. Re-verified green + no console errors + rays preserved when the Sun is in frame.
- **Known risk / unresolved:** (1) Emissive windows + solar glint are wired but **latent** on the current vendored asset set (no `*window*` submeshes; `solar-panel.glb` isn't in the default mock scene) — a correct ADR-0004 no-op until such assets are placed. (2) `MeshPhysicalMaterial` upgrade runs once per cached source; the upgraded materials live for the session like the originals. (3) Pre-existing benign ANGLE/macOS `glBlitFramebuffer` EffectComposer warning persists (documented Session 008).
- **Merged (end of session):** operator signed off on the screenshots → branch `wave3/godrays-material-polish` (feat `96221e0` + perf `737a6cd`) merged to `main` via a `--no-ff` merge; flipped r3d-110/111 → `passing` (59/59) and ticked the epic checklist. Local only — not yet pushed.
- **Next best step:** push `main` + close epic #46 / issues #110/#111 on GitHub; delete the merged branch.

### Session 008 — 2026-06-07
- **Goal:** Polish the living Earth marble on `wave4/living-orbit` — the operator caught it "collapsing": flickering black textures looping as it turned, a hard warm "double-image" terminator stripe, a too-bright/blown-out day side, an over-fast spin, and a too-gross day/night divide. Iterated by eye across five commits against operator screenshots.
- **Completed (chronological, all `web/src/components/SkyBodies.tsx` unless noted):**
  1. **`520e0a2` — calmed the marble.** Slowed `EARTH_SPIN` 0.03→0.008 + `CLOUD_SPIN` 0.042→0.011 (the fast spin made two minified equirect maps counter-shear into temporal moire); softened the warm band (dropped the `band *= band` squaring that peaked it into a stripe, widened ~1.7×, halved strength); widened `uTermWidth`; added `uDayExposure` (0.6) + cloud `uOpacity` 0.9→0.55 to tame the blown-out day side.
  2. **`b3eecb2` — smooth terminator like the Moon.** Added `uNightFill` (0.08): a faint COOL earthshine wash of the day geography across the dark hemisphere so the night side reads as dim blue-lit earth, not a pure-black cutout → the day/night boundary became a grey→grey gradient (the same reason the Moon's terminator is soft). Softened the day ramp (diffuse exponent 0.8→1.3).
  3. **`fbae5db` — moodier/darker.** `uDayExposure` 0.6→0.44 (darker day) + `uNightFill` 0.08→0.055 (darker dark side), both scaled together so the gradient is preserved.
  4. **`3ae800b` — removed the warm divider band.** Operator wanted the amber sunset band gone entirely: deleted `termGlow` + the unused `uTermColor` uniform. Soft terminator (carried by `uTermWidth`/diffuse/night-fill) stays.
  5. **`1f3d277` — the REAL flicker fix: `logarithmicDepthBuffer`.** The "flickering black textures" survived the spin slowdown because it was never spin aliasing — it was **depth-buffer z-fighting**. The Earth is THREE near-coincident concentric shells (surface ×1.0, cloud ×1.012, atmosphere rim ×1.03) at z≈4.7k, hard against the 8000 far plane; with `near=0.1` a standard hyperbolic depth buffer can't resolve the gap, so the cloud/rim flicker on/off every frame. Enabled `logarithmicDepthBuffer` (Scene3D.tsx) for resolvable precision across 0.1–8000; the Earth/cloud/rim custom ShaderMaterials opt in via `logdepthbuf_*` GLSL chunks (built-ins get it free). (Briefly tried a `depthTest:false` compositing workaround first — it killed the flicker but the operator preferred the log-depth quality, so that was backed out.)
- **Verification run:** `cd web && npm run build` (tsc -b clean) + `npx vitest run` (**150 passed**, 12 files) + `npm run lint` clean at each step. **chrome-devtools MCP** drove the orbit view after every change; final state confirmed flicker-free with a clean soft terminator, tamed moody day side, no warm stripe, blue limb glow intact, Moon hero unchanged.
- **Files/artifacts updated:** `web/src/components/SkyBodies.tsx`, `web/src/components/Scene3D.tsx` (logarithmicDepthBuffer), `PROGRESS.md`.
- **Known risk / unresolved:** (1) On ANGLE/macOS a benign `GL_INVALID_OPERATION glBlitFramebuffer` warning is logged — a PRE-EXISTING EffectComposer depth-stencil quirk (present with or without log depth), does not affect the render; documented in the Canvas `gl` comment. (2) `uTermWidth` currently sits at `0` (committed); the visible terminator smoothness is carried by the diffuse ramp + night-fill, so it reads soft regardless — left as-is since the operator approved that look. (3) Surface-view Earth shares this shader, so its day side is slightly dimmer too (decorative; worksite lighting untouched).
- **Merged + harness sync (end of session):** PR **#124** (`wave4/living-orbit` → `wave3/integration`) merged, then **#125** (`wave3/integration` → `main`) merged after CI green — landing Wave 3 (#99,#101–109) + Wave 4 (#112) on `main`. GitHub auto-closed the per-issue PRs #113–119/#121–123 + their issues. Updated `feature_list.json` (r3d-101 in_progress→passing, r3d-112 evidence/notes → merged + log-depth) and this `PROGRESS.md` (Current Verified State + Next Steps). **Remaining open under epic #46:** r3d-100 (PR #120 needs rebase — NOT in main), r3d-110, r3d-111.
- **Next best step:** rebase + land PR #120 (r3d-100), then pick up r3d-110/r3d-111 (now unblocked).

### Session 007 — 2026-06-07
- **Goal:** Fix the orbit-view polish items the operator flagged on `wave4/living-orbit`: a Moon shadow that "shifts" on the surface→orbit transition then nearly vanishes, an Earth day/night terminator that was too hard, day-side texture "dots" crawling as Earth turns, an Earth disc clipping the right frame edge, and the teal-when-occluded sun flare — re-grading the default orbit composition toward the SVS #14992 reference (dark side to the left, smooth terminator).
- **Completed:** (1) **Re-aimed `ORBIT_SUN_POSITION`** from behind the Moon (Moon→Sun·Moon→Cam ≈ −0.75, ~87% dark → read as "disappeared" against the void) to a **near-half-lit** ≈ +0.06 with the lit hemisphere screen-RIGHT, so a dramatic terminator sweeps the disc and the **dark side falls on the left** (operator ask). (2) **Lifted orbit earthshine** (150k→1.35M, sized to the farther Earth berth) + bumped `ORBIT_ENV_INTENSITY` 0.035→0.05 so the Moon's shadow side shows **readable crater/maria detail** (reference look) instead of black — this is what stops it "vanishing." (3) **Killed the transition "shift"** — `EnvironmentGrade` now uses `useLayoutEffect`, so the env-intensity grade is applied *before* the first orbit frame paints (was a `useEffect` one-frame pop at the surface=1.0 IBL value). (4) **Softer Earth terminator** — `uTermWidth` 0.12→0.24 + glint shininess 60→30 (broader, less speckle). (5) **Fixed the day-side "dots"** — the city-flicker/ocean-glint shaders used high spatial-frequency `sin(vUv*160/120/90/70)` terms that aliased into crawling speckle on the small marble; dropped to ~14/11/22/18 at lower amplitude. (6) **Earth no longer clips** — pushed the berth farther (`EARTH_POSITION` → ~4.7k from camera, ~4° across) so it tucks into the ~10° gap between the Moon limb and the frame edge with idle-drift margin, day-side y held ≈ −460 so the surface-sky Earth is unchanged. (7) **De-teal'd the occluded flare** — desaturated the cool chromatic sun sprite (176,200,255 → 206,216,240) + lower opacity/offset.
- **Verification run:** `cd web && npm run build` (tsc -b clean) + `npx vitest run` (**150 passed**, incl. `scene.test.ts` against the new constants) + `npm run lint` clean. **chrome-devtools MCP** confirmed: settled orbit = dramatic dark-left Moon with readable shadow-side craters + Earth a clean day/night marble framed off the upper-right limb with margin; mid-transition frame shows the *same* dramatic shading (no bright-flat pop); surface view still fully lit (decoupling intact).
- **Files/artifacts updated:** `web/src/lib/scene.ts` (`ORBIT_SUN_POSITION`, `EARTH_POSITION`), `web/src/components/Scene3D.tsx` (`EnvironmentGrade` → `useLayoutEffect`, `ORBIT_ENV_INTENSITY`, earthshine intensity), `web/src/components/SkyBodies.tsx` (Earth `uTermWidth`/`uGlintShininess` + shimmer/flicker frequencies, cool flare tint/offset/opacity), `PROGRESS.md`.
- **Known risk / unresolved:** orbit/surface still share one `EARTH_POSITION` (+ earthshine origin), so future re-framing of one view must re-check the other; the lunar-base **marker beacon** pokes a teal spike off the Moon's left limb in the bare canvas but is occluded by the left UI panel in normal use. Tuned by eye — re-verify if the reference target or panel layout changes.
- **Next best step:** open a PR from `wave4/living-orbit` (covers Sessions 006–007).

### Session 006 — 2026-06-07
- **Goal:** Restructure the orbit view's sun/lighting + effects for NASA SVS #14992 ultra-realism (operator ref image): dark-side crescent Moon, Earth with a real day/night terminator + ocean sun-glint, drifting clouds — on branch `wave4/living-orbit`.
- **Completed:** (1) **Dropped the demand-loop / 0-idle-fps budget** — `frameloop="always"` + unrestricted `useFrame`; amended ADR-0004 invariant (3), AGENTS.md, `space-view-realism.md` §6, and `112-living-earth.md` (operator-approved). (2) **Decoupled the sun** — new `ORBIT_SUN_POSITION` (lib/scene.ts) back-lights the orbit Moon to a thin crescent; surface keeps `SUN_POSITION` so the worksite stays lit (`directionalLight`/`SunBody` view-conditional). (3) **Living Earth** — replaced the cheap day/night trick with a custom `ShaderMaterial`: real terminator, masked city lights w/ flicker, soft warm sunset band (limb-faded), **ocean specular sun-glint** (shimmered), slow rotation; + a drifting NASA-PD **cloud shell** (`earth_clouds_2048.jpg`, CREDITS updated). (4) **Dark-side Moon** — root-caused the "grey Moon": the HDR **IBL** (not the lights) was flooding it despite `envMapIntensity:0`; added `EnvironmentGrade` to drop `scene.environmentIntensity` to 0.035 in orbit (surface keeps 1.0 for rover reflections); tuned earthshine + dimmed the Moon rim halo. (5) Extracted `SpaceLights` so the rig renders in BOTH the snapshot + pre-snapshot branches. (6) Fixed an Earth terminator **orange-streak** artifact (foreshortened warm band at the limb) — limb-faded + softened to a clean amber.
- **Verification run:** `cd web && npm run build` (tsc -b clean) + `npx vitest run` (150 passed) + eslint clean; **chrome-devtools MCP** drove orbit + surface screenshots vs the reference (dark crescent Moon + Earth day/night + glint confirmed; worksite still lit). Iterated `ORBIT_SUN_POSITION`/env/earthshine by eye.
- **Files/artifacts updated:** `web/src/lib/scene.ts`, `web/src/components/{Scene3D,SkyBodies,SpaceEnvironment}.tsx`, `web/public/assets/textures/earth_clouds_2048.jpg` (new) + `CREDITS.md`, `docs/00-mvp/adr/0004-*`, `AGENTS.md`, `docs/02-realistic-3d-world/space-view-realism.md`, `docs/02-realistic-3d-world/issues/112-living-earth.md`, `feature_list.json` (r3d-112 → passing), `PROGRESS.md`.
- **Known risk / unresolved:** orbit IBL is global — `EnvironmentGrade` toggles `scene.environmentIntensity` per view (verify if other orbit IBL-lit bodies appear later). Sun flare reads teal when the warm core is occluded behind the Moon (cosmetic, pre-existing #85 sprite). Earth framing sits near the right edge at full idle-drift; settled `ORBIT_POSE` keeps it in frame.
- **Next best step:** open a PR from `wave4/living-orbit`; optional polish — warm the occluded sun flare, nudge `EARTH_POSITION` so Earth never clips at idle-drift extremes.

### Session 005 — 2026-06-06
- **Goal:** Reconcile the tracker with reality — update `feature_list.json` and the GitHub issues to reflect that the build-harness milestone (incl. `bh-08` Live Build Mode) is merged to `main`.
- **Completed:** Confirmed the full `bh-08` epic (08a–08g) plus follow-ups (panel/mast task types, live-capable rover pods, refine cap 30) landed on `main` via PR #12 (`25ce08a`). Verified the baseline before flipping status: `make check` exit 0 (after `golangci-lint cache clean` — a stale cache was reporting phantom issues from removed `.claude/worktrees/` copies), web build TS-clean + `vitest` 10 files / 111 tests, and live compose stack showing `wall-1` self-heal + `dome-cap` complete in the coordinator logs. Marked `bh-08` `passing` with evidence (all 19 features now passing). Closed GitHub issues #24–#38 with commit/PR mappings; added #31–#38 to the "Build Harness" milestone; closed both milestones ("SwarmBuild MVP", "Build Harness"). Pruned a stale git worktree ref under `.claude/worktrees/`.
- **Verification run:** `make check` → exit 0 (vet ok, golangci-lint 0 issues, race tests all ok, go1.25.5); `cd web && npm run build && npm test` → TS-clean + 111 tests pass; live `docker compose up` → self-heal + dome-close asserted from coordinator logs. `feature_list.json` validates as JSON (19/19 passing).
- **Files/artifacts updated:** `feature_list.json` (bh-08 → passing), `PROGRESS.md`; GitHub issues #24–#38 closed + milestones closed (no repo file change).
- **Known risk / unresolved:** `deploy/smoke.sh`'s wrapper can't pass its host `/healthz` gate on this laptop — a leftover `kubectl port-forward` (kind cluster) holds `127.0.0.1:8080` and shadows the compose gateway. Environment collision, not a product regression; kill the port-forward for a green wrapper. Doc/tracker changes are **uncommitted** in the working tree (on `main`).
- **Next best step:** visual quality review of live/baked geometry (user); otherwise the milestone backlog is empty.

### Session 001 — 2026-06-05
- **Goal:** Evolve the repo harness and agentic workflows per the Harness Engineering course.
- **Completed:** Added the State + Lifecycle subsystems the harness was missing — `feature_list.json` (full MVP + build-harness backlog), this `PROGRESS.md`, `init.sh` (canonical startup/verify), `docs/harness/` (README, clean-state checklist, session-handoff, evaluator rubric, QUALITY.md). Evolved `AGENTS.md` with a Startup Workflow, Definition of Done, WIP=1 work rule, and an End-of-Session routine.
- **Verification run:** `make check` → exit 0 (vet ok, lint 0 issues, all backend tests pass); `WEB=1 ./init.sh` → exit 0 (web build TS-clean, vitest 7 files / 60 tests pass); `./deploy/smoke.sh` → exit 0 (full end-to-end: gateway healthy, self-heal fired, dome closed).
- **Evidence captured:** baseline recorded above and in `feature_list.json` (@ `fedd919`).
- **Files/artifacts updated:** `AGENTS.md`, `README.md`, `init.sh`, `feature_list.json`, `PROGRESS.md`, `docs/harness/*`.
- **Known risk / unresolved:** none — backend, web, and end-to-end baselines all verified green this session.
- **Next best step:** `bh-01` (see Next Steps).

### Session 002 — 2026-06-05
- **Goal:** Compare the `docs/01-build-harness/` plan against the Learn Harness Engineering course (read all 12 lectures + resource library + skills via sub-agents) and harden it; then audit the repo-level coding harness.
- **Completed:** (1) Grilled three gaps to decisions and wrote them in — new [ADR-0008](./docs/01-build-harness/adr/0008-lab-loop-observability-and-layered-evaluator.md) (lab-loop trace sidecar + layered Evaluator: hard gate + soft rubric, advisory flag never blocks); updated ADR-0005 (hot-path invariant now mechanically enforced by an import-graph test); TECHSPEC §3/§4/§5/§7/§8/§10/§11; issues 03/04/06; README (ADR-0008 + a "harness" disambiguation note). (2) Audited the repo harness with harness-creator (80/100; 4 of 5 FAILs are validator root-only/keyword blind spots, not real gaps). Synced `feature_list.json` `bh-03/bh-04/bh-06` to the hardened plan; minor canonical-phrasing tweaks in `AGENTS.md`.
- **Verification run:** docs + harness-state changes only — no Go/web source touched, so baselines remain green @ `fedd919` (re-run `./init.sh` / `./deploy/smoke.sh` before a demo). `git diff --stat` confirms only `docs/01-build-harness/*`, `AGENTS.md`, `feature_list.json`, `PROGRESS.md` changed.
- **Files/artifacts updated:** `docs/01-build-harness/adr/0008-*` (new), `docs/01-build-harness/adr/0005-*`, `docs/01-build-harness/TECHSPEC.md`, `docs/01-build-harness/README.md`, `docs/01-build-harness/issues/03,04,06`, `AGENTS.md`, `feature_list.json`, `PROGRESS.md`.
- **Known risk / unresolved:** none — plan-level changes only; no behavior changed.
- **Next best step:** `bh-01` (unchanged).

### Session 004 — 2026-06-06
- **Goal:** Design a new milestone slice — make a live-generated Build spec actually build *in the world* (operator request: "the robots didn't build anything" when running the lab live).
- **Completed:** grill-with-docs design session resolving the full decision tree for **live build mode** (`bh-08`). Decisions: (1) truly live on the build path — the Rover runs the harness inline in `work()`, the deliberate scoped break of ADR-0005; (2) model wired into `internal/agent` (live path only); (3) coexist via `agent.Config.Mode {replay|live}`, archtest **rescoped** to the self-heal core; (4) per-refine-iteration streaming so the world self-corrects (option B); (5) self-correction via an append-only **patch-op log** (place/move/delete) the renderer folds; (6) failure heals — retry → die → resume-live (no primitive on the normal path); (7) primitive **circuit breaker** after ≈3 builder deaths per Task; (8) per-placement `mode` on `placeBlueprint`. Wrote **ADR-0009**, **issue 08**, extended **TECHSPEC** §4/§5/§6/§7/§8/§9/§10/§11, amended **CONTEXT.md** (Build spec → patch log; new term Build mode), updated both READMEs + `feature_list.json` (bh-08 not_started).
- **Verification run:** docs + planning only — no Go/web source touched; baselines remain green @ `fedd919`. `feature_list.json` validates as JSON; `git status` shows only docs/CONTEXT/feature_list/PROGRESS + the two new files.
- **Files/artifacts updated:** `docs/01-build-harness/adr/0009-*` (new), `docs/01-build-harness/issues/08-*` (new), `docs/01-build-harness/{TECHSPEC,README}.md`, `docs/01-build-harness/issues/README.md`, `CONTEXT.md`, `feature_list.json`, `PROGRESS.md`.
- **Known risk / unresolved:** live mode is a real ADR-0005 scope change — the rescoped archtest must be implemented carefully so the self-heal core stays model-free. Systemic-outage cascade is bounded by the circuit breaker but its thresholds need tuning on the real laptop (TECHSPEC §10).
- **Next best step:** implement `bh-08` (consider `/gsd:plan-phase` or the `to-issues`/`tdd` flow); start with the patch-op schema + renderer fold (extends bh-01), then `agent.Config.Mode` live path, then resume-live + circuit breaker.

### Session 003 — 2026-06-06
- **Goal:** Implement the entire `docs/01-build-harness/` plan (bh-01..bh-07) via orchestrated worktrees + multi-agent workers, as stacked PRs.
- **Completed:** All 7 slices, each in its own worktree by a dedicated worker (code-review + tests + e2e per slice), landed as stacked PRs: bh-01 #4 (build-spec wire seam + renderer interpreter + fallback), bh-02 #5 (streamed durable resumable ops + resume-on-kill convergence), bh-03 #7 (Model seam + openai-go/v3 + bake one + import-graph arch test), bh-04 #8 (Generator↔Evaluator loop + layered verdict + trace + bake-all, 13/13 quality_flag:ok), bh-05 #6 (drag-to-place + Architect contracts + palette), bh-06 #9 (bake-time headless-Chrome vision pass + Gemini provider-swap proof), bh-07 #10 (live lab mode + agent console + CC0 glTF/textures). Topology-C sub-agents deferred (no trace gap, ADR-0008).
- **Verification run:** per-slice `make check` + web + `./deploy/smoke.sh` green; then a full integration on `bh/integration` (off `bh/07` with `bh/05` merged — only additive web-import conflicts in `App.tsx`/`Scene3D.tsx`, resolved): combined `make check` (vet + golangci-lint 0 issues + `go test -race -shuffle=on ./...` all ok), `cd web && npm run build && npm test` (100 tests), `./deploy/smoke.sh` PASS (gateway connected, `wall-1` self-heal, `dome-cap` closed), import-graph arch test green (Model/lab/vision off the hot path, incl. gateway).
- **Live LLM:** `OPENAI_API_KEY` + `GEMINI_API_KEY` via gitignored `.env`; live bakes committed declarative specs/traces + CC0 assets — no key committed (verified).
- **Files/artifacts updated:** see PRs #4–#10; `feature_list.json` (bh-01..07 → passing w/ evidence), this `PROGRESS.md`.
- **Known risk / unresolved:** user's visual quality review of generated geometry is deferred (per plan); the 7 stacked PRs await merge (or fast-track `bh/integration`).
- **Next best step:** visual review on stage; merge the stack (or `bh/integration`) to `main`.

### Session 011 — 2026-06-07 — Close Epic 04 (#133) + Epic 05 (#127)
- **Goal:** Close the two parallel epics now that their work is on `main`, and sync the repo.
- **Verified before closing:** all 9 slices CLOSED on GitHub (#128–#131, #134–#138) and
  `feature_list.json` `r3d-128..131`, `r3d-134..138` all `passing`. The work shipped to `main`
  via the `feat/06-hud-redesign` → `main` full-stack merge (PR #153, Session 009).
- **Action:** closed **#133** (two-site lunar surface) and **#127** (app-init refactor) in `gh`
  with closure comments. This completes the "close epics #127/#133" step queued in Session 010.
- **State:** only open epic remaining is **#62** (NL Blueprint authoring — separate milestone).
  No code/tracker drift — `feature_list.json` and PROGRESS already reflected `passing`.

### Session 009 — 2026-06-07
- **Goal:** Implement Epic 06 (floating game-like HUD, `docs/06-hud-redesign/`) via a subagent swarm, then visual-polish, commit, and merge the stack to `main`.
- **Completed:** All 6 slices via orchestrated subagents (Wave 1: #147 foundation ‖ #148 NMS markers; then #149 hotbar → #150 Mission HUD → #151 placement gestures → #152 motion+polish — five serialize through `App.tsx`/`dashboard.css`). New: `TopBar`, `Hotbar`, `StressControls`, `MissionHud` + `lib/footprintGlyph`, `lib/missionStats`; deleted `BlueprintPalette`/`ControlsPanel`/`TaskLedger`. Declarative camera-lock (`enableRotate={!placing}`). Then an operator visual-polish pass: floating transparent top bar (no header plate), dropped "dashboard" sublabel, removed Mission HUD scrollbars (compact + expanded-list x-scroll), text-pill LLM toggle (no checkbox, `:has` fill), diamond site glyph tinted by site. `feature_list.json` `r3d-147..152` added → `passing`.
- **Verification run:** `cd web && npx tsc -b --noEmit` clean + `npx vitest run` **195 tests** (16 files; +13 new) + `vite build` green. **Live screenshot pass deferred** — the chrome-devtools MCP is blocked locally by the open-Chrome profile lock (8-shot checklist in `docs/06-hud-redesign/VERIFICATION.md`).
- **Merge:** `feat/06-hud-redesign` → `main` carried the full unmerged stack (Epic 04 #128/#134-138, Epic 05 #129/#130, Epic 07 docs, camera fixes, HUD #147-152) — the HUD depends on that stack and can't be cherry-picked alone (operator chose "merge full stack").
- **Files/artifacts updated:** `web/src/**` (HUD components + `dashboard.css`/`index.css`), `docs/06-hud-redesign/{README,VERIFICATION}.md`, `feature_list.json`, `PROGRESS.md`. Commit also carried pre-existing surface-camera/scene WIP (`scene.ts`, `LaunchScenery`, `transition`/`scene` tests) entangled in shared files.
- **Known risk / unresolved:** screenshot artifacts not captured (visual verification pending); in-world orbit-marker fade-in deferred; `#134` (Epic 04 scale) still OPEN on GitHub though its work is now on `main`.
- **Next best step:** capture the 8 verification screenshots on a clean browser; decide on `#134` closure.
