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
- **Current blocker:** none — awaiting the user's visual quality review of generated geometry (deferred per plan). Topology-C sub-agents still deferred (no trace gap, ADR-0008).

## Next Steps

1. **Visual review (user):** inspect generated/baked + live geometry quality on stage; flag any spec that "looks wrong" → it becomes the first documented trace gap that could justify topology (C) sub-agents (ADR-0008).
2. **Clean smoke on this host:** kill the leftover `kubectl port-forward` on `127.0.0.1:8080` (from the long-running kind cluster) before running `./deploy/smoke.sh`, or the wrapper hangs on its gateway gate (the swarm itself is fine). Also: run `golangci-lint cache clean` after pruning `.claude/worktrees/` or lint reports phantom issues from deleted files.
3. Keep the invariant sacred: no harness/Model-seam call on the award/lease/expiry **self-heal core** (mechanically enforced by the rescoped arch test; live build path is the one deliberate scoped exception, ADR-0009). Re-run `./deploy/smoke.sh` before any demo.

## Session Log

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
