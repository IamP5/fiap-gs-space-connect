# SwarmBuild

Swarm-intelligence orchestration for autonomous construction in hostile, high-latency
environments. The scenario: rovers build a lunar habitat dome before humans arrive,
and the worksite **reorganises itself when a rover fails — with no operator in the loop.**

The whole pitch is a ~30-second money shot: kill a rover mid-wall, watch its task
re-auction and another rover finish the wall; the dome still closes.

- Product thesis & domain language: [CONTEXT.md](./CONTEXT.md)
- Product requirements: [PRD-SwarmBuild-MVP.md](./docs/00-mvp/PRD-SwarmBuild-MVP.md)
- Technical spec: [docs/TECHSPEC.md](./docs/00-mvp/TECHSPEC.md)
- Load-bearing decisions: [docs/adr/](./docs/00-mvp/adr/)
- Working in this repo (the agent harness): [AGENTS.md](./AGENTS.md) · [feature_list.json](./feature_list.json) · [docs/harness/](./docs/harness/)

## Architecture

The engineering substance is four pure, unit-tested **deep modules** (the real product),
wrapped in a thin simulation + NATS bus + 3D dashboard that exist to make those modules
*visible*. See TECHSPEC §3.

```
/cmd                  Go — coordinator / agent / gateway binaries (thin mains)
/internal/core        Go — deep modules (allocation, lease, world, planner)
/internal/wire        Go — NATS subjects + JSON message/snapshot contract
/internal/bus         Go — NATS wrapper (connect/retry, pub/sub, KV) + server
/internal/agent       Go — robot agent (bid/execute/heartbeat, replay/live build)
/internal/coordinator Go — single-writer tick, auction, lease, world, KV
/internal/gateway     Go — NATS→WebSocket fan-out + /healthz
/internal/demo        Go — pacing + scenario assembly for the sandbox
/internal/harness     Go — Build harness (contracts, refine loop, replay cache)
/web                  React + Vite — 3D dashboard (react-three-fiber)
/deploy               k8s manifests + kind bring-up (pod-per-rover swarm)
```

Application code lives under `internal/` (standard Go layout — private, not importable
by other modules); the `main` packages stay thin under `cmd/`.

## Run the stack

Two supported ways to run SwarmBuild:

```sh
# 1. Full stack on a local kind cluster (NATS + coordinator + gateway + web +
#    six Rover Pods). Builds the images, loads them into kind, applies the
#    manifests, and port-forwards web→:5173 / gateway→:8080.
./deploy/k8s/up.sh           # → open http://localhost:5173
./deploy/k8s/down.sh         # tear down (add --cluster to delete the kind cluster)

# 2. Dashboard only, no backend (a hardcoded in-browser mock snapshot):
cd web && VITE_MOCK=1 npm run dev
```

The board starts empty: drop a Blueprint (dome / solar-array / comms-mast) from the
dashboard hotbar and the Rover Pods drive over and build it. Mid-build, KILL a rover —
it goes dark in place, its Lease expires, the swarm self-heals onto a neighbour, and
the same rover revives after ~6s. With an API key in `.env` (see `.env.example`),
placements dropped in "LLM Generated" mode are generated live by the rovers'
Generator↔Evaluator loop; without one, every placement builds from the built-in
deterministic specs.

See [deploy/k8s/README.md](./deploy/k8s/README.md) for the pod-per-rover details.

## Deep core

Four pure modules under `internal/core/`, importing only `swarmbuild/internal/core/domain`
+ stdlib — no NATS, no simulation, no wall clock.

| Module | Package | What it does |
|---|---|---|
| **Domain contract** | `internal/core/domain` | Shared types: `Task`, `RobotID`, `TaskStatus`, `Vec2`, `Lamport`, `Clock`/`Tick`, `RoverState`. The single contract the four modules agree on. |
| **Allocation Engine** | `internal/core/allocation` | Contract Net auction. `cost = w_dist·dist + w_bat·(1/battery) + w_load·load`; ineligible rovers (capability ∞) don't bid; lowest cost wins; tie → lower `RobotID`. |
| **Lease Manager** | `internal/core/lease` | TTL + heartbeat over an injectable logical clock. Grant → renew → complete; expiry on heartbeat silence releases the task **exactly once** (idempotent). |
| **World Model** | `internal/core/world` | Authoritative single-writer task state + a pure, property-tested CRDT `Merge` (commutative, idempotent, associative; concurrent-claim tiebreak by lower rover id). |
| **Task Planner** | `internal/core/planner` | Blueprint → DAG. Rejects cycles and dangling deps at load; computes the **ready set** (deps all DONE); marking a task DONE unblocks dependents; deterministic topological order. |

### Run the tests

```sh
go test -race ./...
go vet ./...
(cd web && npm test)
```
