# Habitat dome blueprint + 5–6 rover swarm

> Type: AFK · PRD stories: 2, 3, 4 · [TECHSPEC](../TECHSPEC.md)

## What to build

Replace the trivial blueprint with the real lunar habitat dome DAG and scale the swarm to 5–6 rovers. This is the demo's actual content: the structure visibly rises, and killing a rover mid-wall still results in the dome closing.

```
foundation-1..4   (no deps)
   └─► wall-1..8   (each wall needs its foundation)
          └─► dome-cap  (needs all walls)
```

A blueprint whose dependencies form a cycle is rejected at load.

## Acceptance criteria

- [ ] The habitat dome blueprint loads: walls depend on their foundation; dome-cap depends on all walls
- [ ] A blueprint with a dependency cycle is rejected at submission with a clear error
- [ ] The ready set is correct at every stage (no wall before its foundation; no dome before all walls)
- [ ] 5–6 rovers operate concurrently and the dome visibly progresses to completion
- [ ] Killing a rover mid-wall: the wall is finished by another rover and the dome still closes
- [ ] Planner tests: ready set = deps-complete tasks; completing a task unblocks dependents; correct topological order

## Blocked by

- [04 — Kill control](./04-kill-control.md)
