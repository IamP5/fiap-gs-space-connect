# Walking skeleton — one task auctioned and completed end-to-end

> Type: AFK · PRD stories: 1, 4, 12, 17, 27 · [TECHSPEC](../TECHSPEC.md)

## What to build

The thinnest complete path through every layer. The coordinator process loads a trivial hardcoded blueprint (two tasks, the second depending on the first) and spawns two rovers as goroutines (`--mode=inproc`), each a NATS client. One auction runs over NATS (`task.announce` → `task.bid` → `task.award`); the winning rover is granted a lease and "executes" the task instantly (no movement yet); the World Model updates and mirrors to NATS KV; the WS gateway pushes a ~10 Hz snapshot; and a bare 2D canvas renders the two rovers and each task transitioning UNCLAIMED → LEASED → DONE.

The four deep modules (Allocation, Lease, World, Planner) are pure (no NATS/sim imports) and get their first table-driven unit tests. NATS bootstrap is hardened from day one (healthcheck + retry/backoff) since the whole stack depends on it.

## Acceptance criteria

- [ ] `docker compose up` brings up NATS + coordinator + gateway + web; an "all systems connected" indicator turns green before anything runs
- [ ] A trivial 2-task blueprint loads; the Planner withholds the dependent task until its dependency is DONE
- [ ] One auction runs over NATS subjects; the lowest-cost eligible rover wins; ties break by lower `robot_id`
- [ ] The winner holds a lease; on completion the task → DONE and the World Model is mirrored to NATS KV
- [ ] The 2D canvas shows both rovers and each task transitioning UNCLAIMED → LEASED → DONE live over the WebSocket
- [ ] Allocation, Lease, World, and Planner have table-driven unit tests; Lease uses an injectable logical clock

## Blocked by

None — can start immediately.
