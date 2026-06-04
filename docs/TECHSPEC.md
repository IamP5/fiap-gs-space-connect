# SwarmBuild MVP — Technical Specification

> Demo/showcase implementation of the [SwarmBuild PRD](../PRD-SwarmBuild-MVP.md).
> Domain language: [CONTEXT.md](../CONTEXT.md). Load-bearing decisions: [docs/adr/](./adr/).
> Status: ready to build.

## 1. What this is

A swarm-orchestration demo whose entire pitch is a ~30-second money shot: **kill a rover, watch the worksite re-auction its task and heal itself — with no operator in the loop.** The lunar habitat dome rises; a rover dies mid-wall; another finishes the wall; the dome still closes.

The engineering substance is four pure, unit-tested **deep modules** (the real product) wrapped in a thin simulation + bus + 3D dashboard that exist to make those modules *visible*.

## 2. Constraints that shaped this spec

| Constraint | Consequence |
|---|---|
| **Builder is Claude Code** | Code volume is cheap; the bottleneck is human review/iteration, integration-timing correctness, and live robustness — not typing budget. Be ambitious on features, disciplined on the seams that break live. |
| **< 3 weeks to showcase** | Protect the tested core first; sequence so a working demo exists early (2D), then polish. |
| **Some react-three-fiber exposure** | 3D is achievable but scope-guarded; 2D scaffold is the safety net. |
| **Demo runs live on a Mac (Docker Desktop)** | Every moving part is a stage risk. Harden NATS bootstrap; default the live kill to in-proc, not `docker kill`. |

## 3. Resolved architecture

```
                          ┌────────────────────────────────────────────┐
   Browser (React)        │            Coordinator process (Go)         │
 ┌───────────────────┐    │  ┌──────────────────────────────────────┐  │
 │ react-three-fiber │    │  │   DEEP MODULES (pure, unit-tested)    │  │
 │   3D lunar scene  │    │  │  Allocation · Lease · World · Planner │  │
 │  (2D canvas scaffold   │  └──────────────────────────────────────┘  │
 │   built first)    │    │  ┌──────────────────────────────────────┐  │
 │                   │    │  │ Single-writer tick (serialised)       │  │
 │   kill / latency  │◄───┼──┤ Choreography (demo-pacing) module     │  │
 │   / failure ctrls │ WS │  │ Robot Agents ×5–6 (goroutines,        │  │
 └─────────┬─────────┘    │  │   --mode=inproc) ── NATS clients      │  │
           │ WebSocket    │  └──────────────────────────────────────┘  │
           │ (snapshot    │                    │                        │
           │  ~10Hz +     │            Bus Transport (NATS client)      │
           │  controls)   └────────────────────┼────────────────────────┘
           │                                    │
     ┌─────┴───────┐                    ┌───────┴────────┐
     │ WS Gateway  │◄───── NATS ───────►│  NATS server   │  JetStream + KV
     │ (Go)        │   tails subjects   │  (container)   │
     └─────────────┘                    └───────┬────────┘
                                                │ (encore only)
                                        ┌───────┴────────┐
                                        │ rover container │  same binary,
                                        │ --mode=container│  --mode=container
                                        └─────────────────┘
```

### Deep modules (the product — pure data in, decisions out, no NATS/sim imports)

- **Allocation Engine** — Contract Net. Input: a task announce + candidate rover states. Output: the winner or none. Cost function below; ineligible rovers (capability penalty = ∞) do not bid.
- **Lease Manager** — TTL + heartbeat over an **injectable logical clock**. Grant → renew → complete; expiry on heartbeat silence releases the task **exactly once** (idempotent).
- **World Model** — the task records and their status. Single authoritative writer in the live path; the conflict-free merge (CRDT) is implemented and property-tested but not exercised by the headline demo ([ADR-0003](./adr/0003-single-writer-live-path-crdt-as-tested-module.md)).
- **Task Planner** — blueprint → DAG. Rejects cycles at load; computes the **ready set**; marking a task DONE unblocks dependents.

### Frontier modules (integration, not unit-tested)

- **Robot Agent** — behaviour tree (move → work → report), battery drain, safety reflexes, failure-probability injection. One binary, `--mode=inproc` (live) / `--mode=container` (encore); a **NATS client in both** ([ADR-0001](./adr/0001-in-process-rovers-with-container-encore.md), [ADR-0002](./adr/0002-nats-on-the-critical-path.md)).
- **Adapter (the seam)** — Go interface between core and world. Sim today; one lunar capability profile. The seam, not the deployment topology, is what enables mining/rescue spin-offs.
- **Bus Transport** — thin NATS wrapper (pub/sub, request-reply, KV).
- **Choreography (demo-pacing)** — **named, server-authoritative** module. Derives every visual beat from a *real* engine event, slowed/ordered for legibility. Never fabricates intermediate state. This is the load-bearing wall of the wow; it gets a home and a budget.
- **WS Gateway** — tails NATS, fans out one merged JSON snapshot (~10 Hz) to the browser; relays control messages back. The browser never speaks NATS directly.

## 4. Interface contracts

### NATS subjects
```
task.announce            task announced for auction
task.bid.<task_id>       rover bids
task.award               winner granted a lease
robot.heartbeat.<id>     lease renewal
robot.telemetry.<id>     position, battery, health, progress
earth.uplink             ← latency shim lives here ONLY (never on heartbeats)
```

### Cost function (Allocation Engine)
```
cost = w_dist·dist_to_task + w_bat·(1/battery) + w_cap·capability_penalty + w_load·current_load
# capability_penalty = ∞  → rover does NOT bid
# lowest cost wins; tie → lower robot_id (deterministic, auditable)
```

### Lease state machine (Lease Manager)
```
UNCLAIMED --award--------------------------> LEASED
LEASED    --heartbeat-----------------------> LEASED   (TTL reset)
LEASED    --complete------------------------> DONE     (terminal)
LEASED    --TTL expires | rover lost--------> UNCLAIMED (re-auction)
```

### Task record (World Model)
```
Task { task_id, type, deps:[task_id], status:UNCLAIMED|LEASED|DONE,
       assignee?:robot_id, lease_expiry?:ts, version:lamport }
# version guards apply() so a redelivered expiry / duplicate re-announce
# cannot double-award (exactly-once release across at-least-once delivery)
```

### WebSocket protocol
- Server → browser: full world snapshot ~10 Hz (state is a few KB; full snapshot is reconnect-safe with a pure stateless client). Plus a discrete event stream for choreography (`lease.expired`, `auction.won`, …).
- Browser → server: `{cmd: "kill"|"setLatency"|"setFailureProb", …}`.
- A visible **"all systems connected"** indicator; client is pure re-render (no client-side simulation drift).

## 5. The demo

### Blueprint DAG (lunar habitat dome)
```
foundation-1..4   (no deps)
   └─► wall-1..8   (each wall needs its foundation)
          └─► dome-cap  (needs all walls)
```
Demonstrates the Planner: walls can't start before their foundation; the dome can't close until every wall is up. **5–6 rovers.**

### Money-shot script (the ~30s)
1. 3D lunar site: 5–6 rovers, foundations DONE, walls in progress; task ledger top-left (UNCLAIMED/LEASED/DONE).
2. Rover R3 is driving to `wall-7`, a green lease beam connecting them; its battery ring drains.
3. Click R3 → **KILL**. Instantly (<100 ms): R3 sparks/goes dark, its lease beam severs, `wall-7` flips LEASED→UNCLAIMED with a red pulse.
4. A TTL ring over `wall-7` drains (~3–5 s, TTL ≥ 3× heartbeat) — the suspense beat.
5. Ring empties → expiry releases the task exactly once → re-auction ripple; nearest eligible rovers flash their bid; lowest-cost R5 glows as winner.
6. R5 breaks path, drives to `wall-7`, fresh green beam, completes it; segment solidifies/lights, ledger → DONE. **Click-to-DONE ≈ 12–20 s.**
7. Dome eventually closes — the worksite finished itself.

### Controls
- **Kill** (headline: in-proc flag-flip). Optional **encore**: `docker kill` a real rover container via a killer sidecar (never expose `docker.sock` to the browser), run only *after* the safe heal lands.
- **Latency slider** — on-demand at the end (wired so it can be promoted into the arc with a one-line change). Throttles `earth.uplink` only; the swarm heals at full speed regardless ("Earth never knew").
- **Failure-probability slider** — injects random rover failures for stress (story 36).

## 6. Build sequence (robustness-first, cut-able tail)

1. **Deep core + tests** — the four modules, table-driven + property tests, injectable logical clock. This is the PRD's real acceptance; it ships fully tested even if everything after is cut.
2. **Sim + coordinator** — goroutine rovers, behaviour tree, battery, failure injection; **one single-writer tick goroutine** serialising award vs. expiry (kills the double-assignment race). Add the **one integration test** over the full lease-expiry → re-auction → reassignment handoff.
3. **NATS on the path** — auction/telemetry/uplink; KV mirror; harden bootstrap (healthcheck + retry/backoff + smoke test).
4. **WS gateway + 2D canvas scaffold** — entire kill→heal→complete visible and rock-solid in 2D. **This is a demoable milestone.**
5. **Choreography module** — pace the beats off real events; tune TTL/drive speed for legibility; scripted board state for run-to-run reproducibility.
6. **react-three-fiber 3D** — swap the renderer; hard scope guard (one CC0 model + primitives, fixed camera, bloom on halos only). 2D stays as rehearsed fallback.
7. **Stretch (only if solid):** container encore; live CRDT partition toggle.

## 7. Test strategy

- **Deep modules — unit/property tests** (deterministic, no network, no wall clock): Allocation (lowest valid cost wins; ineligible excluded; tie → lower id; adding a strictly-worse rover never changes the winner). Lease (TTL on grant; heartbeat extends; silence expires; release exactly once — injectable clock). World Model (merge commutative + idempotent; concurrent claims resolve deterministically; order-independent). Planner (ready set = deps-complete tasks; cycle rejected; completing unblocks dependents; correct topological order).
- **One integration test** over the coordinator's expiry → re-auction → reassignment handoff — the single bug class that breaks the pitch live and that no unit test covers.
- **Pre-demo smoke test** — bring the stack up, assert all subjects/KV reachable before presenting.

## 8. Live-robustness checklist

- [ ] Single-writer tick serialises award/expiry (no on-screen double-assignment).
- [ ] `version`/Lamport guard on `apply()` (exactly-once across at-least-once delivery).
- [ ] NATS bootstrap hardened; "all connected" indicator green before demo.
- [ ] TTL ≥ ~3× heartbeat interval (a slow tick must not false-expire a healthy rover).
- [ ] Latency shim on `earth.uplink` only, never on heartbeats.
- [ ] Click-to-kill hit-target hardened against raycast misfire.
- [ ] Scripted board state + demo-config block for reproducibility.
- [ ] 2D fallback rehearsed and current.

## 9. Out of scope (deferred)

Real hardware / ROS2 / Gazebo (keep only the Adapter seam); real lunar comms (latency is simulated); physics/regolith engine; mining/rescue capability profiles (seam only); multi-site federation; bus auth/security; durable persistence beyond in-memory + NATS KV; blueprint live-editing (story 5); session-replay UI (story 41); operator override UI (story 32).

## 10. Open decisions (deliberately deferred, low-stakes)

| Decision | Current call | Revisit when |
|---|---|---|
| Latency slider placement | On-demand at end (promotable via one-line change) | Rehearsal — promote into arc if it lands |
| Live CRDT partition toggle | Build only if core/choreography/3D are solid | After step 6 |
| Container `docker kill` encore | Build only with a clear spare slot, rehearsed on the actual laptop | After step 6 |

## 11. Project layout (proposed)
```
/core        Go — deep modules (allocation, lease, world, planner) + tests
/agent       Go — robot agent binary (--mode=inproc|container)
/coordinator Go — single-writer tick, choreography, sim, wiring
/gateway     Go — NATS→WebSocket fan-out
/web         React + Vite + react-three-fiber (2D scaffold → 3D)
/deploy      docker-compose.yml (nats, coordinator+gateway, web)
```
