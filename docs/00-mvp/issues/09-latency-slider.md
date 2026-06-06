# Latency slider + Earth-uplink shim — "Earth never knew"

> Type: AFK · PRD stories: 30, 35 · [TECHSPEC](../TECHSPEC.md)

## What to build

A latency slider that adds artificial delay to the `earth.uplink` subject **only** — never to robot↔coordinator heartbeats or the tactical loop ([ADR-0002](../adr/0002-nats-on-the-critical-path.md)). With latency cranked high, the Earth telemetry panel visibly lags while the swarm heals at full speed locally — proving autonomy does not depend on Earth. Placement is on-demand (the user's call), but wired so it can be promoted into the demo arc with a one-line change.

## Acceptance criteria

- [ ] The slider adds configurable delay to `earth.uplink` only; heartbeats and the tactical loop are unaffected
- [ ] At high latency, the Earth panel shows telemetry still in-flight while the swarm has already healed locally
- [ ] Autonomy (auction, lease, heal) is unaffected at any latency setting
- [ ] Placement is on-demand but promotable into the arc via a single config/script change

## Blocked by

- [03 — Self-heal core](./03-self-heal-core.md)
