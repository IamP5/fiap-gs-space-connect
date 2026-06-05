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
[PRD-SwarmBuild-MVP.md](./PRD-SwarmBuild-MVP.md), [docs/TECHSPEC.md](./docs/TECHSPEC.md),
[docs/adr/](./docs/adr/). The optional container encore (`docker kill` a real Rover that
heals over the bus) is documented in [docs/encore.md](./docs/encore.md).

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
## After each implementation

Run this gate after every change, then commit — never leave the tree red:

```sh
make lint                      # golangci-lint — must report 0 issues
go build ./...                 # must compile clean
go test -race ./...            # all backend tests must pass
# web changes also: (cd web && npm run build && npm test)
```

Only once lint, build, and tests all pass, commit the change (Conventional Commits,
below). One focused commit per logical change.

## Commits — Conventional Commits

`type(scope): subject` — imperative mood, ≤72 chars, focused single-purpose commits.

- **types:** `feat` `fix` `refactor` `perf` `docs` `test` `build` `ci` `chore`
- **scopes:** `core` `coordinator` `gateway` `agent` `wire` `bus` `web` `deploy`
- e.g. `feat(coordinator): expire leases on heartbeat silence`

## Skills

Installed under [`.agents/skills/`](./.agents/skills/), grouped by area:
- `golang-*` — backend (testing, concurrency, error-handling, project-layout, security…)
- `vercel-*`, `web-design-guidelines` — web dashboard
- `r3f-*` — react-three-fiber, for the upcoming 3D renderer

Match the skill family to the directory you're touching.

> **▼ Rule #1 (again) — Analyze first, then explore the skills.**
> Understand the project and the specific task, **then** pull in the matching skill from
> `.agents/skills/` so every change is guided by the relevant best-practice skill.
