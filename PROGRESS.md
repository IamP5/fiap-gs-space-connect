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
- **End-to-end (smoke.sh):** not re-run this session (requires Docker; last known-good on `main`)
- **MVP (issues 01–11):** implemented and merged — all `passing` in `feature_list.json`
- **Current highest-priority unfinished feature:** `bh-01` — Build-spec seam + renderer interpreter + fallback (no LLM)
- **Current blocker:** none

## Next Steps

1. Begin `bh-01` when ready: define the Build-spec seam and a deterministic fallback so the renderer interprets a spec with **no LLM in the loop** (ADR-0005..0007).
2. Keep the invariant sacred: no harness call on the path of an award, lease renewal, or expiry — worst failure is "looks like today," never "demo breaks."
3. Re-run `./deploy/smoke.sh` before any demo to refresh end-to-end evidence.

## Session Log

### Session 001 — 2026-06-05
- **Goal:** Evolve the repo harness and agentic workflows per the Harness Engineering course.
- **Completed:** Added the State + Lifecycle subsystems the harness was missing — `feature_list.json` (full MVP + build-harness backlog), this `PROGRESS.md`, `init.sh` (canonical startup/verify), `docs/harness/` (README, clean-state checklist, session-handoff, evaluator rubric, QUALITY.md). Evolved `AGENTS.md` with a Startup Workflow, Definition of Done, WIP=1 work rule, and an End-of-Session routine.
- **Verification run:** `make check` → exit 0 (vet ok, lint 0 issues, all backend tests pass); `WEB=1 ./init.sh` → exit 0 (web build TS-clean, vitest 7 files / 60 tests pass).
- **Evidence captured:** baseline recorded above and in `feature_list.json` (@ `fedd919`).
- **Files/artifacts updated:** `AGENTS.md`, `README.md`, `init.sh`, `feature_list.json`, `PROGRESS.md`, `docs/harness/*`.
- **Known risk / unresolved:** `smoke.sh` (end-to-end) not re-run this session (requires Docker); MVP `passing` statuses rest on the green backend + web suites + git history, not a fresh full e2e.
- **Next best step:** `bh-01` (see Next Steps).
