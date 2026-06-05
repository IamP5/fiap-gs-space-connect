# Container Encore — `docker kill` a real Rover

> Issue 11 · PRD stories 37, 38 · [ADR-0001](./adr/0001-in-process-rovers-with-container-encore.md) · [ADR-0002](./adr/0002-nats-on-the-critical-path.md) · [TECHSPEC](./TECHSPEC.md)

The headline live demo heals a Rover that dies **in-process** (a flag-flip, <100 ms,
deterministic). The **encore** proves the Rovers are genuinely separate systems: the
**same agent binary** runs as a standalone container (`R7`), joins the swarm over the
real NATS bus, and is killed by a real `docker kill` — and the swarm Self-heals the
exact same way, over the same bus. It is an **optional encore**, run only after the
safe in-proc heal has already landed (ADR-0001).

## How the kill path flows

```
dashboard  ──{cmd:"killContainer", robot:"R7"}──▶  gateway  ──▶  NATS control.command
                                                                       │
                                                                       ▼
                                                              killer sidecar
                                                   (allowlist R7 → swarmbuild-rover-encore)
                                                                       │
                                                          docker kill swarmbuild-rover-encore
                                                                       │
                                                                       ▼
                                            container goes silent → Lease TTL-expires
                                                                       │
                                                                       ▼
                                              coordinator Re-auctions the orphaned task
                                                                       │
                                                                       ▼
                                              a standby Rover wins and finishes it — heal
```

The browser **never** touches `docker.sock`. It only emits a `wire.Control` frame
(`{cmd:"killContainer", robot:"R7"}`). The gateway relays any control frame
transparently onto `control.command` (`wire.SubjControl`). The **killer sidecar** is
the sole holder of the docker socket; it maps the target Robot to a container name
through its operator-configured allowlist and shells out to `docker kill` (argv form,
no shell — see `internal/killer`). This `killContainer` command is distinct from the
soft in-proc `kill` (handled by the Robot Agent, which flips itself dead): no agent
acts on `killContainer`, only the sidecar does.

Because the killed container simply stops heartbeating, the heal is **not scripted**:
the Lease TTL-expires in the coordinator exactly as it would for any silent death, the
task returns to `UNCLAIMED`, and the next auction Re-auctions it to a standby Rover —
the identical Expiry → Re-auction → Self-heal path as the in-proc headline, here driven
over a real container boundary and the real bus (ADR-0002: the encore is only meaningful
*because* the bus is real).

## How to run it

The encore services live alongside the core stack in
[`deploy/docker-compose.yml`](../deploy/docker-compose.yml):

```sh
docker compose -f deploy/docker-compose.yml up --build
# dashboard at http://localhost:5173
```

This brings up `nats`, `coordinator`, `gateway`, `web`, plus the two encore services:

| Service        | container_name            | Role                                                        |
| -------------- | ------------------------- | ----------------------------------------------------------- |
| `rover-encore` | `swarmbuild-rover-encore` | `R7` — the same agent binary, `--mode=container`, over NATS |
| `killer`       | (default)                 | sidecar; `docker kill`s the mapped container on command     |

`R7` joins the swarm over NATS like any other Rover (its own bids, heartbeats, and
telemetry), capable of every dome task type (`foundation,wall,dome-cap`) so it can win
and finish a Re-auctioned task. The killer is configured with
`KILLER_TARGETS=R7=swarmbuild-rover-encore`: the allowlist that maps Robot `R7` to the
container the sidecar may kill. A Robot id **not** in that allowlist can kill nothing.

To trigger the encore, click the encore kill control in the dashboard (which emits
`{cmd:"killContainer", robot:"R7"}`). The killer does `docker kill
swarmbuild-rover-encore`; watch `R7`'s task orphan, its Lease drain and expire, and a
standby Rover Re-auction and finish it — the dome still closes.

The encore services are **not** required for the core demo or `make smoke`
([`deploy/smoke.sh`](../deploy/smoke.sh) asserts the in-proc heal and the dome closing,
which run entirely on the in-process roster). Adding the encore is purely additive.

## Why the killer needs its own image

The default runtime image ([`deploy/Dockerfile`](../deploy/Dockerfile)) is
`distroless/static` — no shell, no `docker` CLI. The killer must shell out to
`docker kill`, so it has a dedicated build,
[`deploy/Dockerfile.killer`](../deploy/Dockerfile.killer), whose runtime stage is
`docker:cli` (alpine-based, ships the docker client). Compose mounts
`/var/run/docker.sock` **only** into the killer (read-only is enough for `docker
kill`). This is the single privileged seam of the whole stack — the browser, gateway,
coordinator and rovers never get the socket.

### Security guard (golang-security)

A browser-controlled Robot id can never reach a shell, and can never kill an arbitrary
container:

- The target container is **never** a browser string — it is the operator-configured
  allowlist value (`KILLER_TARGETS`). A Robot id absent from the allowlist kills
  nothing (the command is a logged no-op, never an error).
- `docker kill` is invoked in **argv form** (`exec.CommandContext("docker", "kill",
  container)`) — no `sh -c`, so the container name cannot be interpreted as a command.

## Rehearsal note (macOS / Docker Desktop) — DO THIS BEFORE PRESENTING

Per ADR-0001, the container encore is **the most platform-specific, flake-prone path**
in the whole demo: it depends on Docker Desktop's `docker.sock` bind-mount and the
docker daemon being reachable from inside the killer container. **Rehearse it on the
actual presentation laptop before presenting**, not just in CI:

1. `docker compose -f deploy/docker-compose.yml up --build` and confirm all services
   come up (the gateway `/healthz` reports `"connected":true`, and `R7` appears in the
   dashboard roster).
2. Trigger the encore kill from the dashboard and **watch the heal end-to-end** — the
   orphaned task must Re-auction and a standby must finish it.
3. If `docker kill` fails inside the sidecar, check that the socket mount resolved
   (`docker compose exec killer docker ps` should list containers) — on Docker Desktop
   for Mac the socket path can differ; the compose mount targets the in-VM
   `/var/run/docker.sock`, which Docker Desktop provides.

Run the in-proc headline (`make smoke` / the live flag-flip kill) **first**; the
container encore is the optional follow-up, so a flake in this path never blocks the
core money shot.

## The Adapter seam — how a second capability profile compiles (spin-off proof)

ADR-0001's thesis is **one agent binary, two hosts** — `--mode=inproc` (goroutine in
the coordinator) and `--mode=container` (standalone). The container encore is the proof
that the *host* is interchangeable. The complementary proof, required by issue 11, is
that the *capability profile* is interchangeable too: the same binary + the same
`agent.Config` is the **Adapter seam** that lets a SECOND, different rover compile and
join with no code change.

A Rover's behaviour is fully determined by its `agent.Config` — its `Capabilities`
(what task types it can bid on) and its starting state — passed in at construction.
The `--capabilities` flag on `cmd/agent` is the seam: it parses a comma-separated
capability list straight into `agent.Config.Capabilities`. `R7` already exercises a
second profile in compose (`--capabilities=foundation,wall,dome-cap`); a spin-off rover
with a *different* skill set — say a survey/inspection rover that only does one task
type — is a one-line change:

```yaml
rover-survey:
  build: { context: .., dockerfile: deploy/Dockerfile, args: { TARGET: ./cmd/agent } }
  container_name: swarmbuild-rover-survey
  command: ["--mode=container", "--id=R8", "--capabilities=survey"]
  environment: { NATS_URL: nats://nats:4222 }
```

No new binary, no fork of the agent code — only a different `agent.Config` (here via
flags). The coordinator's auction already matches bids to task types against whatever
capabilities each Rover advertises, so a profile it has never seen before slots in and
bids only on the tasks it can do. That config-only seam is what makes a spin-off (a
different swarm, a different mission profile) a deployment change rather than an
engineering project. See [ADR-0001](./adr/0001-in-process-rovers-with-container-encore.md).
