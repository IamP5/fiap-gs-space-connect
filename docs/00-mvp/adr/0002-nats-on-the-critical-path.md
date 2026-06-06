# NATS sits on the live critical path, not deferred behind a channels-only fallback

**Status:** accepted

Rovers communicate over NATS (JetStream + KV) for the live demo — carrying the auction, telemetry, and the Earth uplink — rather than auctioning over in-process Go channels with NATS deferred to post-MVP.

## Context

A leaner option exists: run the auction over in-process channels behind a thin `Bus` interface and treat NATS as a later swap. For a single-process demo that would remove infrastructure and a startup-race flake vector. But two things pull the other way: the product's credibility claim is "a decoupled autonomous swarm over a real bus," and — decisively — the chosen container encore ([0001](./0001-in-process-rovers-with-container-encore.md)) only demonstrates anything if separate processes talk over a real network bus.

## Decision

NATS (JetStream + KV) is load-bearing in the live path. The robot agent is a NATS client in **both** `inproc` and `container` modes (only the process boundary differs), so the two modes share one code path. Subjects carry `task.announce` / `task.bid` / `task.award`, `robot.heartbeat.*`, `robot.telemetry.*`; the World Model is mirrored to NATS KV; the latency slider is a delay shim on the **Earth-uplink subject only** — never on rover↔coordinator heartbeats (that would break the autonomy story).

## Considered options

- **In-process channels behind a `Bus` interface, NATS post-MVP** — rejected for the live demo because it silently kills the container encore (no real bus to die across) and reduces "distributed over a bus" to a tested seam rather than a running fact. Kept as a documented pressure-release valve only if the timeline collapses.

## Consequences

- The kill path gains a real failure surface: a JetStream stream / KV bucket bootstrap race can hang the first auction. Mitigation is mandatory and owned by the build — Compose healthcheck, coordinator retry/backoff, a pre-demo smoke test, and an "all systems connected" indicator on the dashboard.
- Exactly-once lease release must survive at-least-once delivery: guard `apply` with a task version / Lamport stamp so a redelivered expiry or duplicate re-announce cannot double-award a task. This is the integration seam most likely to break the pitch live and is covered by a dedicated integration test (see TECHSPEC).
