# Kill control — the live headline

> Type: AFK · PRD stories: 33, 34 · [TECHSPEC](../TECHSPEC.md)

## What to build

Make the self-heal interactive — the money shot. The dashboard sends a kill command over the WebSocket; the coordinator flips the target rover's `dead` flag in-process (<100 ms); the rover stops heartbeating and goes dark on screen; and the self-heal from slice 03 plays out live. The kill is the in-process flag-flip, not `docker kill` (see [ADR-0001](../adr/0001-in-process-rovers-with-container-encore.md)) — instant, deterministic, and identically repeatable.

## Acceptance criteria

- [ ] Clicking a rover surfaces a KILL affordance; clicking it sends `{cmd:"kill", robot}` over the WebSocket
- [ ] The rover dies in <100 ms (flag-flip), goes dark, and stops heartbeating
- [ ] Its task expires, re-auctions, and is completed by another rover — visible end-to-end with no further input
- [ ] Killing repeatedly produces identical healing (deterministic, reproducible ten times in a row)
- [ ] The click hit-target is reliable — no missed clicks

## Blocked by

- [03 — Self-heal core](./03-self-heal-core.md)
