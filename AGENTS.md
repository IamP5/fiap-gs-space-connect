# AGENTS.md

> **▲ Rule #1 — Analyze first, then explore the skills.**
> Before writing any code, (1) read the relevant project docs/code to understand the
> task in context, **then** (2) browse [`.agents/skills/`](./.agents/skills/) and load the
> skill(s) that match the work. Always work with the task-relevant skill — never start
> from memory alone when a matching skill exists.

## What this is

**SwarmBuild** — swarm-intelligence orchestration for autonomous construction in hostile,
high-latency environments. MVP: rovers build a lunar habitat dome, and the worksite
**reorganises itself when a rover fails — no operator in the loop.** The whole pitch is a
~30s money shot: kill a rover mid-wall → its task re-auctions → another rover finishes it
→ the dome still closes (`self-heal = expiry + re-auction`).

Engineering substance = four pure, unit-tested Go **deep modules** (`allocation`, `lease`,
`world`, `planner`), wrapped in a thin sim + NATS bus + dashboard that make them *visible*.

**Read these first:** [CONTEXT.md](./CONTEXT.md) (domain language — load-bearing),
[PRD-SwarmBuild-MVP.md](./docs/00-mvp/PRD-SwarmBuild-MVP.md), [docs/TECHSPEC.md](./docs/00-mvp/TECHSPEC.md),
[docs/adr/](./docs/00-mvp/adr/). The optional container encore (`docker kill` a real Rover that
heals over the bus) is documented in [docs/encore.md](./docs/00-mvp/encore.md).

## Session lifecycle (start here)

**Startup workflow — at startup, do this first:**
1. `pwd` to confirm the repo root, then read [`PROGRESS.md`](./PROGRESS.md) (current verified
   state + next step) and [`feature_list.json`](./feature_list.json) (per-feature status).
2. `git log --oneline -5` for recent context.
3. Run `./init.sh` (sync deps + baseline gate). **If the baseline is already red, fixing it
   is your first task** — never stack new work on a broken base.
4. Pick the **one** highest-priority feature that isn't `passing`. Work only on it.

**Work rules:** one feature at a time (WIP = 1, exactly one active feature); finish *and verify* before starting
the next; no "while I'm here" refactors or parallel features. The repo is the system of
record — durable artifacts (`feature_list.json`, `PROGRESS.md`, ADRs) over chat history.

The full harness (state, verification, scope, lifecycle, quality) is documented in
[`docs/harness/`](./docs/harness/).

## Layout

```
cmd/                                                 Go — thin main packages (binaries)
internal/core/  internal/wire/  internal/bus/        Go — deep modules + bus contract
internal/agent/  internal/coordinator/  internal/gateway/  internal/demo/   orchestration
web/                                                 React + Vite dashboard
deploy/                                              docker-compose + smoke.sh
```

Application code is private under `internal/` (standard Go layout); `main` packages stay
thin under `cmd/` (parse flags, wire dependencies, call `Run()`).

## Commands

```sh
# Go
make lint                      # golangci-lint (or: golangci-lint run ./...)
go build ./...                 # must compile clean
go test -race ./...            # all backend tests
go vet ./...

# Web (from web/)
npm test                       # vitest
npm run build                  # tsc -b && vite build — must be TS-clean
VITE_MOCK=1 npm run dev        # UI with no backend

# Full demo / pre-demo smoke
docker compose -f deploy/docker-compose.yml up --build   # dashboard at :5173
./deploy/smoke.sh                                         # build, assert healthy, tear down
```

## Conventions

- **Domain language is load-bearing.** Use the CONTEXT.md vocabulary exactly (Rover,
  Coordinator, Task, Lease, Expiry, Re-auction, Self-heal, World Model…) and avoid the
  listed synonyms — in code, comments, and commits.
- **Go:** idiomatic, race-clean, table-driven tests. See the `golang-*` skills.
- **Web:** layered `src/` (`components/ hooks/ lib/ types/ mocks/ styles/`); pure logic
  lives in `lib/` with co-located `*.test.ts`; **no barrel files**; the dashboard stays a
  pure re-render of the server snapshot (ADR-0004). See `vercel-react-best-practices`,
  `web-design-guidelines`, and `r3f-*` (for the future 3D renderer).
## Definition of Done

A feature is done only when these pass **in order** (don't proceed to a level if the prior
one fails):

```sh
go build ./...                 # 1. compiles clean
make lint                      # 1. golangci-lint — 0 issues
go test -race ./...            # 2. unit + integration tests pass
# web changes also: (cd web && npm run build && npm test)
./deploy/smoke.sh              # 3. end-to-end — REQUIRED when the change crosses components
```

…and then: the behavior is implemented, the verification **actually ran**, and the evidence
(commit + result) is recorded in `feature_list.json`. "Code is written" is not done —
unit tests alone can't catch interface/state/error-propagation defects across the
core → bus → gateway → screen seam. Only a passed verification flips a feature to `passing`.

## End of session

Never leave the tree red. Run the [clean-state checklist](./docs/harness/clean-state-checklist.md),
then commit (Conventional Commits, below) — one focused commit per logical change:

1. Build + lint + tests green (`./init.sh`).
2. Update `PROGRESS.md` and `feature_list.json`; record any blocker.
3. Remove debug cruft; ensure `./init.sh` runs clean from a fresh checkout.
4. For a larger handoff, fill [`session-handoff.md`](./docs/harness/session-handoff.md).

## Commits — Conventional Commits

`type(scope): subject` — imperative mood, ≤72 chars, focused single-purpose commits.

- **types:** `feat` `fix` `refactor` `perf` `docs` `test` `build` `ci` `chore`
- **scopes:** `core` `coordinator` `gateway` `agent` `wire` `bus` `web` `deploy`
- e.g. `feat(coordinator): expire leases on heartbeat silence`

## Issues & labels

Full convention: [`docs/harness/issue-tracking.md`](./docs/harness/issue-tracking.md). In short:

- **Label every issue with one `type:` + one `area:`.** Tiers: `type:epic` (tracks
  child slices, never worked directly) · `type:feature` (one demoable slice) ·
  `type:task` (chore, no user-visible change) · `type:bug` · `type:refactor`.
  Areas: `area:frontend` `area:backend` `area:docs` `area:infra`.
- **Name the issue your PR delivers in the title** — `type(scope): subject (#NN)` —
  and add `Closes #NN` in the body. Merging to `main` then closes it (GitHub +
  the `issue-sync` Action safety net). `Relates`/`Blocked by`/`Refs #NN` never close.
- **Three trackers stay in sync per merge:** GitHub issue → closed (automatic);
  `feature_list.json` feature → `passing` + evidence; epic docs checklist → ticked
  — the last two **in the same PR**. Features map to issues by `issue`/`epic` fields
  and the `r3d-<issue>` id (`passing` ⇔ closed). Full rules:
  [`docs/harness/issue-tracking.md`](./docs/harness/issue-tracking.md).

## Skills

Installed under [`.agents/skills/`](./.agents/skills/), grouped by area:
- `golang-*` — backend (testing, concurrency, error-handling, project-layout, security…)
- `vercel-*`, `web-design-guidelines` — web dashboard
- `r3f-*` — react-three-fiber, for the upcoming 3D renderer

Match the skill family to the directory you're touching.

> **▼ Rule #1 (again) — Analyze first, then explore the skills.**
> Understand the project and the specific task, **then** pull in the matching skill from
> `.agents/skills/` so every change is guided by the relevant best-practice skill.
