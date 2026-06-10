# SwarmBuild on Kubernetes — pod-per-rover swarm

SwarmBuild runs each Rover as its own Kubernetes Pod, so `kubectl get pods` shows
the swarm topology directly. The dashboard **KILL Rx is a recoverable in-process
outage**: the rover goes dark **at its current position** (the Pod keeps running —
it is **not** deleted), its **Lease** TTL-expires, the swarm **Self-heals** by
**Re-auction** onto a surviving Rover Pod, and then the **same rover revives in
place** after its outage window (`--recover-ms`, ~6s) — all over a real NATS bus.

> **Why not a real `kubectl delete pod`?** A deleted Pod restarts a *fresh* agent
> process that boots at its **start** position, and it comes back almost instantly
> — the opposite of a believable failure. We want the rover to stop *where it
> failed*, stay down for a beat while the swarm covers for it, then recover at that
> same spot. That requires the process (and its in-memory position) to survive the
> kill, so the KILL is handled in-process by the agent itself.

The board boots **empty**: it is a sandbox you drop Blueprints onto and watch the
Pods build.

## What's in here

| File | What it is |
| --- | --- |
| `base/00-namespace.yaml` | Namespace `swarmbuild`. |
| `base/10-nats.yaml` | NATS (JetStream, `-m 8222`) Deployment + Service — the swarm bus. |
| `base/20-coordinator.yaml` | Coordinator (zero in-process Rovers; boots an **empty** board you place Blueprints onto). |
| `base/30-gateway.yaml` | WS Gateway Deployment + Service (`:8080`). |
| `base/40-web.yaml` | Dashboard (nginx) Deployment + Service (`:80`). |
| `base/50-rover-r1.yaml` … `55-rover-r6.yaml` | One Deployment per Rover, R1..R6. |
| `base/kustomization.yaml` | The pod-per-rover base. |
| `kustomization.yaml` | Thin root that re-exports `base/` so `kubectl apply -k deploy/k8s/` is the default deploy. |
| `up.sh` / `down.sh` | kind-based bring-up (auto port-forwards web+gateway) / teardown (stops the forwards). |
| `logs.sh` | Tail every service (coordinator + gateway + NATS + any Rover Pods). |

## Quickstart

Prereqs: `docker`, `kind`, and `kubectl` on your PATH.

```sh
./deploy/k8s/up.sh
```

`up.sh` creates a kind cluster named `swarmbuild` (if absent), builds the four
images, `kind load`s them (no registry needed — `imagePullPolicy: IfNotPresent`
uses the loaded local images), applies the manifests, waits for every rollout,
and then **auto-starts the port-forwards** for you: web→`localhost:5173` and
gateway→`localhost:8080`. It waits until both forwards actually accept
connections before printing `✅ open http://localhost:5173`.

Just open **http://localhost:5173**. The dashboard reaches the gateway at
`ws://localhost:8080/ws` (baked into the web image at build time), which the
gateway forward serves. Re-running `up.sh` is idempotent — it kills any stale
forwards from a previous run first.

The forwards run detached (via `nohup`); their PIDs are recorded in
`${TMPDIR:-/tmp}/swarmbuild-portforward.pids` and their logs in
`${TMPDIR:-/tmp}/swarmbuild-pf-{web,gateway}.log`. If a forward never comes up,
`up.sh` warns with the log path but leaves the cluster running.

With an API key in the repo-root `.env` (see `.env.example`), `up.sh` syncs it
into the optional `swarmbuild-llm` Secret, which the Rover Pods mount — a
Blueprint dropped in "LLM Generated" mode is then generated live by the rover's
Generator↔Evaluator loop. Without a key, every placement builds from the
built-in deterministic specs.

### Place a Blueprint and watch the Pods build it

The board starts **empty** — no dome, no structures, nothing mid-build. The
six Rover Pods join the swarm and idle on the regolith until you give them work:

1. Pick a Blueprint from the dashboard **hotbar** (dome, solar-array, or comms-mast).
2. Drop it on the surface. The placement is validated server-side (world bounds,
   no-overlap with anything already there) and its task DAG is injected into the live
   World Model.
3. The auction announces the new tasks; the Rover Pods bid, drive over, and build the
   structure op-by-op — the real auction / Lease / Re-auction engine fed by your
   placement.

Mid-build you can hit **KILL Rx** to watch the swarm self-heal (below). The in-app
**"Reload demo"** button **clears the board** over the bus with **no pod restart** —
it forgets every placed Blueprint and returns to the empty map, so you can start a
fresh placement without re-running `up.sh`.

Tear down (this also stops the auto port-forwards):

```sh
./deploy/k8s/down.sh            # stop forwards + delete the swarmbuild namespace (keep the cluster)
./deploy/k8s/down.sh --cluster  # also delete the kind cluster
```

`down.sh` reaps the recorded port-forward PIDs (with a `pkill` fallback) and
removes the pidfile before tearing down the namespace.

## How the kill flows

```
dashboard KILL Rx
  → control.command on NATS (relayed by the gateway)
  → the in-pod agent for Rx handles it ITSELF:
      • clears alive, stops bidding/heartbeating, abandons any in-flight task
      • stays put at its FAILURE position, keeps emitting alive=false telemetry
  → its Lease TTL-expires (heartbeat silence)
  → the orphaned Task Re-auctions
  → a surviving Rover Pod wins and finishes it → Self-heal; the dome still closes
  → ~6s later the SAME rover revives IN PLACE (alive=true at its failure spot) and bids again
```

## Images

The deployment expects these four local images, kind-loaded by `up.sh` (or pushed
to a registry your cluster can pull, if you adapt the manifests):

| Image | Built from |
| --- | --- |
| `swarmbuild-coordinator:dev` | `deploy/Dockerfile`, `TARGET=./cmd/coordinator` |
| `swarmbuild-gateway:dev` | `deploy/Dockerfile`, `TARGET=./cmd/gateway` |
| `swarmbuild-agent:dev` | `deploy/Dockerfile`, `TARGET=./cmd/agent` |
| `swarmbuild-web:dev` | `web/`, `VITE_WS_URL=ws://localhost:8080/ws` |
