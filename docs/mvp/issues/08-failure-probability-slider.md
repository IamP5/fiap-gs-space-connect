# Failure-probability slider — swarm under stress

> Type: AFK · PRD stories: 36 · [TECHSPEC](../TECHSPEC.md)

## What to build

A dashboard slider that sets a per-rover probability of spontaneous failure. Rovers die randomly at that rate, exercising the swarm under sustained stress and proving the self-heal holds up beyond a single scripted kill. Each induced failure flows through the normal expiry → re-auction → heal path. Branches off the self-heal core; independent of the dome/3D work.

## Acceptance criteria

- [ ] A slider sets failure probability, sent over the WebSocket as a control message
- [ ] Rovers fail randomly at the configured rate; each failure triggers normal expiry → re-auction → heal
- [ ] The swarm keeps completing the blueprint under sustained random failures
- [ ] Setting the probability to 0 stops induced failures

## Blocked by

- [03 — Self-heal core](./03-self-heal-core.md)
