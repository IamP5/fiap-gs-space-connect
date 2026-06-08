# SwarmBuild on Kubernetes — pod-per-rover swarm

This is the **opt-in "every Rover is a Pod" variant** of the SwarmBuild demo. It
runs each Rover as its own Kubernetes Pod, so `kubectl get pods` shows the swarm
topology directly. The dashboard **KILL Rx is a recoverable in-process outage**
(identical to the other modes): the rover goes dark **at its current position**
(the Pod keeps running — it is **not** deleted), its **Lease** TTL-expires, the
swarm **Self-heals** by **Re-auction** onto a surviving Rover Pod, and then the
**same rover revives in place** after its outage window (`--recover-ms`, ~6s) —
all over the same real NATS bus as the headline demo.

> **Why not a real `kubectl delete pod`?** A deleted Pod restarts a *fresh* agent
> process that boots at its **start** position, and it comes back almost instantly
> — the opposite of a believable failure. We want the rover to stop *where it
> failed*, stay down for a beat while the swarm covers for it, then recover at that
> same spot. That requires the process (and its in-memory position) to survive the
> kill, so the headline KILL is handled in-process by the agent itself, in every
> mode. The real-process-death proof lives in the docker-compose **container
> encore** (R7), not here.

It is the counterpart to the fast in-proc demo, not a replacement (ADR-0001). The
headline money shot stays `docker compose -f deploy/docker-compose.yml up` — six
Rovers in-process inside the coordinator, paced for the ~30s wow. This variant
shows the same swarm with each rover as a distinct Pod, plus a cluster-aware
killer (retained for encore parity) with least-privilege RBAC.

## What's in here

| File | What it is |
| --- | --- |
| `base/00-namespace.yaml` | Namespace `swarmbuild` (scopes the killer's RBAC). |
| `base/10-nats.yaml` | NATS (JetStream, `-m 8222`) Deployment + Service — the swarm bus. |
| `base/20-coordinator.yaml` | Coordinator with `COORDINATOR_ROVERS=external` (zero in-process Rovers). |
| `base/30-gateway.yaml` | WS Gateway Deployment + Service (`:8080`). |
| `base/40-web.yaml` | Dashboard (nginx) Deployment + Service (`:80`). |
| `base/50-rover-r1.yaml` … `55-rover-r6.yaml` | One Deployment per Rover, R1..R6. |
| `base/60-killer.yaml` | Killer ServiceAccount + Role + RoleBinding + Deployment. |
| `base/kustomization.yaml` | The pod-per-rover base. |
| `kustomization.yaml` | Thin root that re-exports `base/` so `kubectl apply -k deploy/k8s/` is the unchanged default deploy. |
| `overlays/cinematic/kustomization.yaml` | Epic 07 cinematic overlay (ADR-0011): `COORDINATOR_ROVERS=cinematic`, standalone Rover Pods dropped. |
| `up.sh` / `down.sh` | kind-based bring-up (auto port-forwards web+gateway) / teardown (stops the forwards). `up.sh --cinematic` applies the overlay. |
| `logs.sh` | Tail every service during a take (coordinator + gateway + NATS + killer + any Rover Pods); `--climax` greps just the cueKill→heal trail. |

### Cinematic overlay (Epic 07, ADR-0011)

The Epic 07 demo runs the cinematic overlay, which flips the coordinator to
`COORDINATOR_ROVERS=cinematic` — the in-process `lunar-R*` / `shackleton-R*` swarm
holds the hero wall (`lunar/wall-1`) un-leasable until an operator **`cueKill`** cue,
then orchestrates release → lease → **in-process kill in place** (no Pod delete) →
Lease Expiry → Re-auction → a surviving Rover seals the dome. Because that pacing
keeps the in-process swarm, the overlay **drops the six standalone Rover Pods** (under
site-gated auction they'd sit idle); the cinematic fleet lives in the coordinator Pod.
See `overlays/cinematic/kustomization.yaml` for the full rationale and the
`cinematic-external` Go follow-up note, and `docs/07-demo-cinematic/CAPTURE-RECIPE.md`
for the chrome-devtools-MCP capture recipe (dedicated Chrome profile + remote-debug).

```sh
./deploy/k8s/up.sh --cinematic     # bring up the cinematic overlay + port-forwards
./deploy/k8s/logs.sh --cinematic   # tail all services; assert the take e2e from the logs
kubectl kustomize deploy/k8s/overlays/cinematic/   # render-only validation (no cluster)
```

The Rover roster (ids, positions, batteries, capabilities) mirrors
`internal/demo/demo.go` `DomeRovers()` exactly, so the board is identical to the
in-proc headline: R1..R6 at `x = -50 + 20*(i-1)`, `y = -70`, battery
`1.0 - 0.05*(i-1)` (R1=1.00 … R6=0.75), each capable of
`foundation,wall,dome-cap`, `--mode=container`, `--heartbeat-ms=700`.

## Quickstart

Prereqs: `docker`, `kind`, and `kubectl` on your PATH.

```sh
./deploy/k8s/up.sh
```

`up.sh` creates a kind cluster named `swarmbuild` (if absent), builds the five
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

Once you're in the dashboard, the in-app **"Reload demo"** button restarts the
demo workflow — it rebuilds the dome from scratch with **no pod restart** (the
Coordinator resets its board over the bus), so you can re-run the heal beat
without re-running `up.sh`.

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
  → the in-pod agent for Rx handles it ITSELF (the killer ignores it — KILLER_ON_KILL=false):
      • clears alive, stops bidding/heartbeating, abandons any in-flight task
      • stays put at its FAILURE position, keeps emitting alive=false telemetry
  → its Lease TTL-expires (heartbeat silence)
  → the orphaned Task Re-auctions
  → a surviving Rover Pod wins and finishes it → Self-heal; the dome still closes
  → ~6s later the SAME rover revives IN PLACE (alive=true at its failure spot) and bids again
```

The Pod is never deleted — the rover's process (and its position) survive the
outage, which is exactly what lets it come back where it went down rather than
teleporting to its start position. The killer Deployment and its pod-delete RBAC
remain in the manifests for parity with the compose **container encore**
(`killContainer`), but with `KILLER_ON_KILL=false` they take no part in a plain
KILL. (`killContainer` is not wired in this k8s topology — there is no R7 Pod.)

## RBAC — the single privileged seam

Deleting a Rover Pod is the **only** privileged action in the stack, and only the
`killer` ServiceAccount can do it. (With `KILLER_ON_KILL=false` the killer only
ever exercises this for a `killContainer` encore, which this k8s topology does not
send — but the least-privilege scoping is retained so the seam stays honest):

- a namespaced **Role** (`killer-pod-deleter`) grants `get`, `list`, `delete` on
  **pods only**, in the **`swarmbuild` namespace only** — no ClusterRole, no
  exec, no other resources;
- a **RoleBinding** ties that Role to the `killer` ServiceAccount;
- only the killer Deployment sets `serviceAccountName: killer`, so only its Pod
  mounts that token.

The browser, the gateway, the coordinator, and the Rover Pods never get it. This
is the Kubernetes mirror of the docker-compose variant, where only the killer
sidecar mounts `docker.sock`.

## Images

The deployment expects these five local images, kind-loaded by `up.sh` (or pushed
to a registry your cluster can pull, if you adapt the manifests):

| Image | Built from |
| --- | --- |
| `swarmbuild-coordinator:dev` | `deploy/Dockerfile`, `TARGET=./cmd/coordinator` |
| `swarmbuild-gateway:dev` | `deploy/Dockerfile`, `TARGET=./cmd/gateway` |
| `swarmbuild-agent:dev` | `deploy/Dockerfile`, `TARGET=./cmd/agent` |
| `swarmbuild-web:dev` | `web/`, `VITE_WS_URL=ws://localhost:8080/ws` |
| `swarmbuild-killer-k8s:dev` | `deploy/Dockerfile.killer.k8s` (`./cmd/killer` + `kubectl`) |

`Dockerfile.killer.k8s` is the Kubernetes twin of `deploy/Dockerfile.killer`:
same killer binary, but its runtime carries a pinned static `kubectl` (copied
from `bitnami/kubectl:1.31`) instead of the docker CLI, and it runs as non-root —
its only privilege is the ServiceAccount token, not a uid.
