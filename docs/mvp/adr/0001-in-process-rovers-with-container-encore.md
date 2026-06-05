# Rovers run as in-process goroutines for the live demo, not one container each

**Status:** accepted

The original instinct was to simulate each rover as its own Docker container ("each robot is a real system"). We instead run rovers as goroutine-hosted agents inside the coordinator process for the **live** demo, and keep `docker kill` of a real container only as an **optional encore**.

## Context

The single acceptance criterion is the ~30-second "kill a rover, watch the swarm heal" money shot, demoed live on a Mac laptop (Docker Desktop). A debate of four architects — including one tasked with making the strongest case for container-per-rover — converged on rejecting containers as the live substrate.

## Decision

One agent binary, two hosts:
- `--mode=inproc` — rovers are goroutines in the coordinator; the headline **kill is a flag-flip (<100 ms, deterministic, repeatable identically ten times in a row)**.
- `--mode=container` — the same binary runs as a standalone container; used only for the optional encore.

Rovers are genuinely independent agents in **both** modes (own behaviour tree, own battery, own bids and heartbeats over the real bus), so the "each rover is a real autonomous system" thesis stays literally true. The coordinator cannot tell which host a rover runs in — that equivalence is the whole point.

## Considered options

- **Container-per-rover as the live substrate** — rejected: the kill is *invisible on screen* (a halo turning red looks identical whether it was `docker kill` or a goroutine flag-flip), `docker kill` adds 1–3 s of teardown jitter inside the 30 s budget, and the `docker.sock` path is the single most flake-prone, most platform-specific link — exactly on the Mac/Docker-Desktop projector laptop. We would pay real fragility for authenticity the audience cannot see.

## Consequences

- The "real distributed system" claim is demonstrated by the real bus and the optional encore, not by container count.
- The encore (`docker kill` a real rover container that then heals over the bus) is the one place containers pay off — and only after the safe in-proc heal has already landed. See [0002](./0002-nats-on-the-critical-path.md): the encore is only meaningful because the bus is real.
- Physical/physics fidelity (kinematics, terrain, collision) is explicitly **not** built — it adds nothing to the lease/auction self-heal story and is out of PRD scope. Rover movement is visual interpolation only.
