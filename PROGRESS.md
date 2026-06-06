# Progress Log

The continuity record for agent sessions. Read this first at startup; update it before you
stop. `feature_list.json` is the per-feature source of truth; this file is the narrative of
*where we are now* and *what to do next*. Architectural decisions live in the ADRs
(`docs/mvp/adr/`, `docs/build-harness/adr/`) — record new decisions there, not here.

## Current Verified State

- **Repository root:** `/Users/tuba/Dev/projects/gs-fiap-space` (branch `docs/build-harness`)
- **Standard startup path:** `./init.sh` (Go baseline; `WEB=1 ./init.sh` to include the dashboard)
- **Standard verification path:** `make check` (vet + lint + race tests); `./deploy/smoke.sh` for end-to-end self-heal
- **Backend baseline:** ✅ green @ `fedd919` — `go vet` ok, `golangci-lint` 0 issues, `go test -race -shuffle=on ./...` all pass (go1.25.5)
- **Web baseline:** ✅ green @ `fedd919` — `tsc -b && vite build` TS-clean, `vitest` 7 files / 60 tests pass (`WEB=1 ./init.sh`)
- **End-to-end (smoke.sh):** ✅ green this session — gateway connected, `wall-1` self-heal (expiry → re-auction) fired, `dome-cap` complete (dome closed end-to-end)
- **MVP (issues 01–11):** implemented and merged — all `passing` in `feature_list.json`
- **Build-harness (bh-01..bh-07):** implemented as 7 stacked PRs (#4,#5,#7,#8,#6,#9,#10) and integrated on `bh/integration` — all `passing` in `feature_list.json` with evidence
- **Current highest-priority unfinished feature:** `bh-08` — Live build mode (the Rover runs the harness in the world). **Design complete, not yet implemented** (ADR-0009 + issue 08; grill-with-docs 2026-06-06). Topology C still deferred (no trace gap, ADR-0008).
- **Current blocker:** none — awaiting the user's visual quality review of generated geometry (deferred per plan)
- **Plan status:** build-harness plan fully implemented. `bh/integration` (off `bh/07` + merged `bh/05`) passes the full combined gate: `make check` (vet + golangci-lint 0 issues + `go test -race -shuffle=on ./...`), `cd web && npm run build && npm test` (100 tests), `./deploy/smoke.sh` PASS, and the import-graph arch test (Model/lab/vision off the hot path).

## Next Steps

1. **Visual review (user):** inspect generated/baked geometry quality on stage; flag any spec that "looks wrong" → it becomes the first documented trace gap that could justify topology (C) sub-agents (ADR-0008).
2. **Land the stack:** merge the 7 stacked PRs in dependency order (#4 → #5 → {#7 → #8 → #9 → #10} and #6 off #5), or fast-track `bh/integration` as a single PR to `main` (already conflict-resolved + green).
3. Keep the invariant sacred: no harness/Model-seam call on the award/lease/expiry path (mechanically enforced by the arch test). Re-run `./deploy/smoke.sh` before any demo.

## Session Log

### Session 001 — 2026-06-05
- **Goal:** Evolve the repo harness and agentic workflows per the Harness Engineering course.
- **Completed:** Added the State + Lifecycle subsystems the harness was missing — `feature_list.json` (full MVP + build-harness backlog), this `PROGRESS.md`, `init.sh` (canonical startup/verify), `docs/harness/` (README, clean-state checklist, session-handoff, evaluator rubric, QUALITY.md). Evolved `AGENTS.md` with a Startup Workflow, Definition of Done, WIP=1 work rule, and an End-of-Session routine.
- **Verification run:** `make check` → exit 0 (vet ok, lint 0 issues, all backend tests pass); `WEB=1 ./init.sh` → exit 0 (web build TS-clean, vitest 7 files / 60 tests pass); `./deploy/smoke.sh` → exit 0 (full end-to-end: gateway healthy, self-heal fired, dome closed).
- **Evidence captured:** baseline recorded above and in `feature_list.json` (@ `fedd919`).
- **Files/artifacts updated:** `AGENTS.md`, `README.md`, `init.sh`, `feature_list.json`, `PROGRESS.md`, `docs/harness/*`.
- **Known risk / unresolved:** none — backend, web, and end-to-end baselines all verified green this session.
- **Next best step:** `bh-01` (see Next Steps).

### Session 002 — 2026-06-05
- **Goal:** Compare the `docs/build-harness/` plan against the Learn Harness Engineering course (read all 12 lectures + resource library + skills via sub-agents) and harden it; then audit the repo-level coding harness.
- **Completed:** (1) Grilled three gaps to decisions and wrote them in — new [ADR-0008](./docs/build-harness/adr/0008-lab-loop-observability-and-layered-evaluator.md) (lab-loop trace sidecar + layered Evaluator: hard gate + soft rubric, advisory flag never blocks); updated ADR-0005 (hot-path invariant now mechanically enforced by an import-graph test); TECHSPEC §3/§4/§5/§7/§8/§10/§11; issues 03/04/06; README (ADR-0008 + a "harness" disambiguation note). (2) Audited the repo harness with harness-creator (80/100; 4 of 5 FAILs are validator root-only/keyword blind spots, not real gaps). Synced `feature_list.json` `bh-03/bh-04/bh-06` to the hardened plan; minor canonical-phrasing tweaks in `AGENTS.md`.
- **Verification run:** docs + harness-state changes only — no Go/web source touched, so baselines remain green @ `fedd919` (re-run `./init.sh` / `./deploy/smoke.sh` before a demo). `git diff --stat` confirms only `docs/build-harness/*`, `AGENTS.md`, `feature_list.json`, `PROGRESS.md` changed.
- **Files/artifacts updated:** `docs/build-harness/adr/0008-*` (new), `docs/build-harness/adr/0005-*`, `docs/build-harness/TECHSPEC.md`, `docs/build-harness/README.md`, `docs/build-harness/issues/03,04,06`, `AGENTS.md`, `feature_list.json`, `PROGRESS.md`.
- **Known risk / unresolved:** none — plan-level changes only; no behavior changed.
- **Next best step:** `bh-01` (unchanged).

### Session 004 — 2026-06-06
- **Goal:** Design a new milestone slice — make a live-generated Build spec actually build *in the world* (operator request: "the robots didn't build anything" when running the lab live).
- **Completed:** grill-with-docs design session resolving the full decision tree for **live build mode** (`bh-08`). Decisions: (1) truly live on the build path — the Rover runs the harness inline in `work()`, the deliberate scoped break of ADR-0005; (2) model wired into `internal/agent` (live path only); (3) coexist via `agent.Config.Mode {replay|live}`, archtest **rescoped** to the self-heal core; (4) per-refine-iteration streaming so the world self-corrects (option B); (5) self-correction via an append-only **patch-op log** (place/move/delete) the renderer folds; (6) failure heals — retry → die → resume-live (no primitive on the normal path); (7) primitive **circuit breaker** after ≈3 builder deaths per Task; (8) per-placement `mode` on `placeBlueprint`. Wrote **ADR-0009**, **issue 08**, extended **TECHSPEC** §4/§5/§6/§7/§8/§9/§10/§11, amended **CONTEXT.md** (Build spec → patch log; new term Build mode), updated both READMEs + `feature_list.json` (bh-08 not_started).
- **Verification run:** docs + planning only — no Go/web source touched; baselines remain green @ `fedd919`. `feature_list.json` validates as JSON; `git status` shows only docs/CONTEXT/feature_list/PROGRESS + the two new files.
- **Files/artifacts updated:** `docs/build-harness/adr/0009-*` (new), `docs/build-harness/issues/08-*` (new), `docs/build-harness/{TECHSPEC,README}.md`, `docs/build-harness/issues/README.md`, `CONTEXT.md`, `feature_list.json`, `PROGRESS.md`.
- **Known risk / unresolved:** live mode is a real ADR-0005 scope change — the rescoped archtest must be implemented carefully so the self-heal core stays model-free. Systemic-outage cascade is bounded by the circuit breaker but its thresholds need tuning on the real laptop (TECHSPEC §10).
- **Next best step:** implement `bh-08` (consider `/gsd:plan-phase` or the `to-issues`/`tdd` flow); start with the patch-op schema + renderer fold (extends bh-01), then `agent.Config.Mode` live path, then resume-live + circuit breaker.

### Session 003 — 2026-06-06
- **Goal:** Implement the entire `docs/build-harness/` plan (bh-01..bh-07) via orchestrated worktrees + multi-agent workers, as stacked PRs.
- **Completed:** All 7 slices, each in its own worktree by a dedicated worker (code-review + tests + e2e per slice), landed as stacked PRs: bh-01 #4 (build-spec wire seam + renderer interpreter + fallback), bh-02 #5 (streamed durable resumable ops + resume-on-kill convergence), bh-03 #7 (Model seam + openai-go/v3 + bake one + import-graph arch test), bh-04 #8 (Generator↔Evaluator loop + layered verdict + trace + bake-all, 13/13 quality_flag:ok), bh-05 #6 (drag-to-place + Architect contracts + palette), bh-06 #9 (bake-time headless-Chrome vision pass + Gemini provider-swap proof), bh-07 #10 (live lab mode + agent console + CC0 glTF/textures). Topology-C sub-agents deferred (no trace gap, ADR-0008).
- **Verification run:** per-slice `make check` + web + `./deploy/smoke.sh` green; then a full integration on `bh/integration` (off `bh/07` with `bh/05` merged — only additive web-import conflicts in `App.tsx`/`Scene3D.tsx`, resolved): combined `make check` (vet + golangci-lint 0 issues + `go test -race -shuffle=on ./...` all ok), `cd web && npm run build && npm test` (100 tests), `./deploy/smoke.sh` PASS (gateway connected, `wall-1` self-heal, `dome-cap` closed), import-graph arch test green (Model/lab/vision off the hot path, incl. gateway).
- **Live LLM:** `OPENAI_API_KEY` + `GEMINI_API_KEY` via gitignored `.env`; live bakes committed declarative specs/traces + CC0 assets — no key committed (verified).
- **Files/artifacts updated:** see PRs #4–#10; `feature_list.json` (bh-01..07 → passing w/ evidence), this `PROGRESS.md`.
- **Known risk / unresolved:** user's visual quality review of generated geometry is deferred (per plan); the 7 stacked PRs await merge (or fast-track `bh/integration`).
- **Next best step:** visual review on stage; merge the stack (or `bh/integration`) to `main`.
