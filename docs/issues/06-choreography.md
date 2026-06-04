# Choreography / demo-pacing — make the heal legible

> Type: HITL (rehearsal/legibility review) · PRD stories: 33, 34 · [TECHSPEC](../TECHSPEC.md)

## What to build

A **named, server-authoritative** demo-pacing module that turns a millisecond-fast auction into a watchable 12–20 s arc. It surfaces the beats — a draining TTL ring over the orphaned task, bid numbers flashing above bidding rovers, a winner glow, the replacement driving over, the segment solidifying. Every beat is derived from a **real engine event**; intermediate state is never fabricated (a winner shown must be the rover that actually gets the lease). A demo-config block and a scripted initial board state make runs reproducible.

This is the load-bearing wall of the wow — it gets its own home, not frontend afterthought.

## Acceptance criteria

- [ ] Each visual beat (TTL drain, bid flash, winner glow, drive-over, segment solidify) is triggered by a real engine event, not synthesized
- [ ] The full kill → heal reads legibly in ~12–20 s; all timings are tunable from one demo-config block
- [ ] A scripted board state reproduces the same demo run-to-run
- [ ] No on-screen state ever contradicts the World Model
- [ ] Human review confirms the heal "reads" to a first-time viewer (the HITL gate)

## Blocked by

- [05 — Habitat dome blueprint](./05-habitat-dome-blueprint.md)
