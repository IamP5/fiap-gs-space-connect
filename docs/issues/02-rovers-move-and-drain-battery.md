# Rovers move and drain battery; the cost function uses real state

> Type: AFK · PRD stories: 8, 23, 26, 28 · [TECHSPEC](../TECHSPEC.md)

## What to build

Rovers stop completing instantly. A rover now interpolates toward its task's position over time, drains battery as it moves and works, and publishes telemetry (position, battery, current load) on `robot.telemetry.*`. The Allocation cost function consumes this real state, so the demonstrably nearest / most-charged eligible rover wins an auction:

```
cost = w_dist·dist_to_task + w_bat·(1/battery) + w_cap·capability_penalty + w_load·current_load
# capability_penalty = ∞  → the rover does NOT bid
```

The 2D canvas reflects live positions and battery from telemetry.

## Acceptance criteria

- [ ] A rover moves by visual interpolation toward its task; arrival triggers work, then completion
- [ ] Battery drains during movement and work and is reported in telemetry
- [ ] The cost function uses distance, 1/battery, and current load with configurable weights; the nearest/most-charged eligible rover wins
- [ ] A rover whose capability penalty is infinite does not submit a bid
- [ ] The canvas reflects live rover positions and battery levels from telemetry
- [ ] Allocation tests cover: lowest valid cost wins; adding a strictly-worse rover never changes the winner

## Blocked by

- [01 — Walking skeleton](./01-walking-skeleton.md)
