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
- **Current highest-priority unfinished feature:** `bh-01` — Build-spec seam + renderer interpreter + fallback (no LLM)
- **Current blocker:** none
- **Plan status:** build-harness plan hardened against the Harness Engineering course — added [ADR-0008](./docs/build-harness/adr/0008-lab-loop-observability-and-layered-evaluator.md) (lab-loop trace + layered evaluator) and a mechanical import-graph hot-path test; `bh-03/bh-04/bh-06` in `feature_list.json` now reflect it.

## Next Steps

1. Begin `bh-01` when ready: define the Build-spec seam and a deterministic fallback so the renderer interprets a spec with **no LLM in the loop** (ADR-0005..0007).
2. Keep the invariant sacred: no harness call on the path of an award, lease renewal, or expiry — worst failure is "looks like today," never "demo breaks."
3. Re-run `./deploy/smoke.sh` before any demo to refresh end-to-end evidence.

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
