# The SwarmBuild Harness

> The **harness** is everything outside the model that lets a coding agent start, stay
> in scope, verify its work, and resume across sessions: instructions, state,
> verification, scope, lifecycle. A capable model in a bare repo still fails — *check the
> harness before you blame the model.*

This folder is the operating system for agent work on SwarmBuild. It complements — does
not replace — the engineering docs (`CONTEXT.md`, `DESIGN.md`, `docs/00-mvp/`,
`docs/01-build-harness/`). Those say *what we're building*; the harness says *how a session
runs*.

It is adapted from the [Harness Engineering course](https://walkinglabs.github.io/learn-harness-engineering/en/)
(see [`.agents/skills/harness-creator/`](../../.agents/skills/harness-creator/)) to this
repo's actual stack (Go deep modules + NATS + React/R3F dashboard + Docker demo).

## The five subsystems → where they live here

| Subsystem | Purpose | Artifact in this repo |
|---|---|---|
| **Instructions** | Startup path, working rules, definition of done | [`AGENTS.md`](../../AGENTS.md), [`CONTEXT.md`](../../CONTEXT.md) (domain language), `docs/` |
| **State** | Current feature, status, evidence, next step | [`feature_list.json`](../../feature_list.json), [`PROGRESS.md`](../../PROGRESS.md) |
| **Verification** | Checks the agent must pass before claiming done | [`init.sh`](../../init.sh), `make check`, [`deploy/k8s/up.sh`](../../deploy/k8s/up.sh), CI |
| **Scope** | Stops overreach and half-finished work | `feature_list.json` (WIP=1 + dependency DAG), `docs/**/issues/`, ADRs |
| **Lifecycle** | Makes the next session restartable | Startup/End-of-session routines in `AGENTS.md`, [`clean-state-checklist.md`](./clean-state-checklist.md), [`session-handoff.md`](./session-handoff.md) |

Quality tracking sits on top: [`evaluator-rubric.md`](./evaluator-rubric.md) scores a single
session's output; [`QUALITY.md`](./QUALITY.md) tracks codebase health over time.

## The load-bearing rules (the whole harness in five lines)

1. **One active feature at a time** (WIP = 1). Finish-and-verify before starting the next.
2. **`passing` requires recorded evidence** — a verification command actually ran. "Code is written" is not done.
3. **Never skip or weaken verification** to look complete.
4. **The repo is the system of record.** Durable artifacts over chat history; what's not in the repo doesn't exist for the next agent.
5. **Leave a clean state.** Build green, tests green, state files updated, no debug cruft — every session.

## How a session runs

- **Start:** follow `AGENTS.md` → *Startup Workflow* (read `PROGRESS.md` + `feature_list.json`, run `./init.sh`, pick the one highest-priority unfinished feature).
- **During:** stay on that feature; respect `CONTEXT.md` vocabulary and the relevant `.agents/skills/`; meet the *Definition of Done* before marking anything `passing`.
- **End:** run the [clean-state checklist](./clean-state-checklist.md), update `PROGRESS.md` + `feature_list.json`, commit, and (for a larger handoff) fill [`session-handoff.md`](./session-handoff.md).

## Files in this folder

- [`clean-state-checklist.md`](./clean-state-checklist.md) — the end-of-session exit gate.
- [`session-handoff.md`](./session-handoff.md) — compact handoff between sessions (overwrite each time).
- [`evaluator-rubric.md`](./evaluator-rubric.md) — score a session's output before accepting it.
- [`QUALITY.md`](./QUALITY.md) — per-module health grades, refreshed periodically.
- [`issue-tracking.md`](./issue-tracking.md) — label tiers (epic/feature/task/bug/refactor + area), the PR→issue closing convention, and the `issue-sync` Action safety net.

> **Keep the harness small enough that agents actually follow it.** As the models improve,
> delete harness rules that have become unnecessary overhead — harness debt is technical debt.
