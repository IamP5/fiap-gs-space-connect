# SwarmBuild

Swarm-intelligence orchestration for autonomous construction in hostile, high-latency
environments. The MVP scenario: rovers build a lunar habitat dome before humans arrive,
and the worksite **reorganises itself when a rover fails — with no operator in the loop.**

The whole pitch is a ~30-second money shot: kill a rover mid-wall, watch its task
re-auction and another rover finish the wall; the dome still closes.

- Product thesis & domain language: [CONTEXT.md](./CONTEXT.md)
- Product requirements: [PRD-SwarmBuild-MVP.md](./PRD-SwarmBuild-MVP.md)
- Technical spec: [docs/TECHSPEC.md](./docs/TECHSPEC.md)
- Load-bearing decisions: [docs/adr/](./docs/adr/)
- Build backlog (vertical slices): [docs/issues/](./docs/issues/)

## Architecture

The engineering substance is four pure, unit-tested **deep modules** (the real product),
wrapped in a thin simulation + NATS bus + 3D dashboard that exist to make those modules
*visible*. See TECHSPEC §3.

```
/cmd                  Go — coordinator / agent / gateway binaries (thin mains) ← built
/internal/core        Go — deep modules (allocation, lease, world, planner)    ← built
/internal/wire        Go — NATS subjects + JSON message/snapshot contract      ← built
/internal/bus         Go — NATS wrapper (connect/retry, pub/sub, KV) + server  ← built
/internal/agent       Go — robot agent (bid/execute/heartbeat)                 ← built
/internal/coordinator Go — single-writer tick, auction, lease, world, KV       ← built
/internal/gateway     Go — NATS→WebSocket fan-out + /healthz                   ← built
/internal/demo        Go — blueprint + rover roster for the demo scenario      ← built
/web                  React + Vite — 2D canvas scaffold (→ 3D later)           ← built
/deploy               docker-compose.yml (nats, coordinator, gateway, web)     ← built
```

Application code lives under `internal/` (standard Go layout — private, not importable
by other modules); the `main` packages stay thin under `cmd/`.

## Run the stack

```sh
# Full stack in Docker (NATS + coordinator + gateway + web):
docker compose -f deploy/docker-compose.yml up --build
# → dashboard at http://localhost:5173, gateway WS/health at :8080
# Pre-demo smoke (build, assert healthy + auction completes, tear down):
./deploy/smoke.sh            # add --keep to leave it running
```

## Deep core (built)

Four pure modules under `internal/core/`, importing only `swarmbuild/internal/core/domain`
+ stdlib — no
NATS, no simulation, no wall clock. This is the PRD's real acceptance: it ships fully
tested even if everything after is cut (TECHSPEC §6 step 1).

| Module | Package | What it does |
|---|---|---|
| **Domain contract** | `internal/core/domain` | Shared types: `Task`, `RobotID`, `TaskStatus`, `Vec2`, `Lamport`, `Clock`/`Tick`, `RoverState`. The single contract the four modules agree on. |
| **Allocation Engine** | `internal/core/allocation` | Contract Net auction. `cost = w_dist·dist + w_bat·(1/battery) + w_load·load`; ineligible rovers (capability ∞) don't bid; lowest cost wins; tie → lower `RobotID`. |
| **Lease Manager** | `internal/core/lease` | TTL + heartbeat over an injectable logical clock. Grant → renew → complete; expiry on heartbeat silence releases the task **exactly once** (idempotent). |
| **World Model** | `internal/core/world` | Authoritative single-writer task state + a pure, property-tested CRDT `Merge` (commutative, idempotent, associative; concurrent-claim tiebreak by lower rover id). Live path uses the single writer; the CRDT is proven in tests (ADR-0003). |
| **Task Planner** | `internal/core/planner` | Blueprint → DAG. Rejects cycles and dangling deps at load; computes the **ready set** (deps all DONE); marking a task DONE unblocks dependents; deterministic topological order. |

### Run the tests

```sh
go test -race ./...
go vet ./...
```

## Build sequence

Robustness-first, cut-able tail (TECHSPEC §6). Status:

1. ✅ **Deep core + tests** — the four modules above.
2. ⬜ Sim + coordinator (goroutine rovers, behaviour tree, single-writer tick, integration test).
3. ⬜ NATS on the path (auction/telemetry/uplink; KV mirror; hardened bootstrap).
4. ⬜ WS gateway + 2D canvas scaffold (kill→heal→complete visible — first demoable milestone).
5. ⬜ Choreography (pace beats off real events).
6. ⬜ react-three-fiber 3D (swap renderer; 2D stays as fallback).
7. ⬜ Stretch: container encore; live CRDT partition toggle.
