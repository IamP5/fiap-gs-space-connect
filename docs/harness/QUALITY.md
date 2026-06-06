# Quality Document

Codebase health over time — graded per product domain and architectural layer, for both
humans and agents. A new session reads this to know **where to prioritise** before touching
anything. Refresh it after a significant session and before starting a new phase; this is a
periodic (weekly-ish) scan, distinct from the per-session clean-state checklist.

**Grading scale:** **A** = all verification passing, clean, agent-legible, stable tests ·
**B** = working, minor gaps · **C** = partial verification or legibility/stability issues ·
**D** = not working / major structural problems.

_Last full scan: 2026-06-05 (Session 001). Backend graded against a green `make check` and web against a green `WEB=1 ./init.sh` (vitest 7 files / 60 tests) @ `fedd919`; e2e (`smoke.sh`) graded from code + history, not a fresh Docker run this session._

## Product Domains

| Domain | Grade | Verification | Agent Legibility | Test Stability | Key Gaps | Last Updated |
|---|---|---|---|---|---|---|
| Self-heal (expiry + re-auction) | A | Passing (`internal/core/lease`, `internal/coordinator`) | Clear; load-bearing in CONTEXT.md | Stable | — | 2026-06-05 |
| Allocation / Auction (Contract Net) | A | Passing (`internal/core/allocation`) | Clear | Stable | — | 2026-06-05 |
| Planner / World Model (DAG, ready set) | A | Passing (`internal/core/planner`, `internal/core/world`) | Clear | Stable | — | 2026-06-05 |
| Rover agent loop (move, battery, bid, recover) | A | Passing (`internal/agent`) | Clear | Stable (CI flake fixed: ed80c6b, 72ee37c) | — | 2026-06-05 |
| Kill / recovery | A | Passing (`internal/killer`, `internal/agent`) | Clear | Stable | — | 2026-06-05 |
| Choreography / demo pacing | B | Passing unit (`internal/demo`); pacing manual | Clear | Stable | Visual pacing has no automated assertion | 2026-06-05 |
| Dashboard (React + R3F 3D) | A | Passing — build TS-clean, vitest 7 files / 60 tests | Layered `src/`, no barrels | Stable | Visual/3D checks still manual | 2026-06-05 |
| Failure / latency sliders + Earth telemetry | B | Backend tested; slider behavior manual | Clear | Stable | Manual-only end behavior | 2026-06-05 |
| CRDT partition (stretch) | B | Tested module (ADR-0003); narrative manual | Clear | Stable | Stretch; reconciliation demoed manually | 2026-06-05 |
| Container / k8s encore (stretch) | B | Manual (kubectl-delete); compose via smoke.sh | Clear | n/a (infra) | Stretch; no automated k8s assertion | 2026-06-05 |
| Build harness (AI construction layer) | D | None yet — docs/specs only | Spec'd in CONTEXT.md + docs/build-harness | n/a | Entire layer unimplemented (`bh-01..07`) | 2026-06-05 |

## Architectural Layers

| Layer | Grade | Boundary Enforcement | Agent Legibility | Key Gaps | Last Updated |
|---|---|---|---|---|---|
| Core deep modules (`internal/core/*`) | A | Pure, no I/O; the substance | Excellent (unit-tested, table-driven) | — | 2026-06-05 |
| Bus contract (`internal/bus`) | A | NATS behind a contract (ADR-0002) | Clear (`bustest` helpers) | — | 2026-06-05 |
| Orchestration (`agent`, `coordinator`, `gateway`, `demo`) | A | Single-writer live path (ADR-0003) | Clear | — | 2026-06-05 |
| Wiring (`internal/wire`, `cmd/*`) | A | Thin mains; deps wired in `wire` | Clear | No unit tests (thin by design) | 2026-06-05 |
| Web (`web/src`) | A | Layered; pure re-render of snapshot (ADR-0004) | Clear | Build TS-clean, vitest green | 2026-06-05 |
| Model seam (build harness) | D | Not built — will isolate the LLM SDK | Spec'd (CONTEXT.md) | Unimplemented | 2026-06-05 |

## Change History

### 2026-06-05
- **Changes:** Established the harness operating system (State + Lifecycle subsystems); first full quality scan.
- **Domains promoted:** all MVP domains graded A/B against green `make check`.
- **Demoted:** none.
- **New gaps identified:** build-harness layer is D (unimplemented); e2e (`smoke.sh`) grade still rests on history, not a fresh Docker run.
- **Gaps closed:** repo previously had no machine-readable feature state or session-continuity artifacts — now present; web baseline verified green (Dashboard + Web layer promoted to A).
