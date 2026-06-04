# SwarmBuild MVP — Issues

Vertical tracer-bullet slices of the [TECHSPEC](../TECHSPEC.md). Each cuts end-to-end (core → NATS → state → gateway → screen) and is demoable on its own. Build the spine in order; branches can parallelise.

```
1 ─ 2 ─ 3 ─ 4 ─ 5 ─ 6 ─ 7        (critical spine)
        ├─ 8                      (failure-prob slider)
        └─ 9                      (latency slider)
            5 ─ 10                (CRDT partition — stretch)
            5 ─ 11                (container encore — stretch)
```

| # | Slice | Type | Blocked by |
|---|---|---|---|
| [01](./01-walking-skeleton.md) | Walking skeleton — one task auctioned & completed end-to-end | AFK | — |
| [02](./02-rovers-move-and-drain-battery.md) | Rovers move & drain battery; cost function | AFK | 01 |
| [03](./03-self-heal-core.md) | Self-heal core — heartbeat, expiry, re-auction | AFK | 02 |
| [04](./04-kill-control.md) | Kill control — live headline | AFK | 03 |
| [05](./05-habitat-dome-blueprint.md) | Habitat dome blueprint + 5–6 swarm | AFK | 04 |
| [06](./06-choreography.md) | Choreography / demo-pacing | HITL | 05 |
| [07](./07-react-three-fiber-3d.md) | react-three-fiber 3D scene | HITL | 06 |
| [08](./08-failure-probability-slider.md) | Failure-probability slider | AFK | 03 |
| [09](./09-latency-slider.md) | Latency slider + Earth-uplink shim | AFK | 03 |
| [10](./10-crdt-partition-narrative.md) | CRDT partition narrative (stretch) | HITL | 05 |
| [11](./11-container-encore.md) | Container encore (stretch) | HITL | 05 |

> No issue tracker is configured for this project; these files are the issue backlog. Decisions they must respect: [ADR-0001..0004](../adr/). Domain vocabulary: [CONTEXT.md](../CONTEXT.md).
