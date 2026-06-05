#!/usr/bin/env bash
# Bring up the SwarmBuild pod-per-rover swarm on a local kind cluster: build the
# five images, load them into the cluster (no registry needed), apply the
# manifests, wait for rollouts, then auto-start the port-forwards.
#
# This is the opt-in "every Rover is a Pod" variant (ADR-0001). The fast headline
# is still `docker compose -f deploy/docker-compose.yml up`; this one shows each
# rover as its own Pod. The dashboard KILL is a recoverable in-process outage
# (the rover goes dark in place and revives after ~6s), identical to the other
# modes — the Pod is NOT deleted.
#
#   ./deploy/k8s/up.sh
# Brings everything up AND port-forwards web→localhost:5173 and
# gateway→localhost:8080 automatically; then just open http://localhost:5173.
# Stop the forwards (and the swarm) with ./deploy/k8s/down.sh.
set -euo pipefail

CLUSTER=swarmbuild
NS=swarmbuild
# Resolve the repo root from this script's location so it runs from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
K8S_DIR="${REPO_ROOT}/deploy/k8s"

# Stable locations for the auto port-forward bookkeeping. The pidfile lets
# down.sh (or a re-run of up.sh) find and kill the exact forwards we started;
# the logs are where a forward's stderr lands if it never comes up.
PF_PIDFILE="${TMPDIR:-/tmp}/swarmbuild-portforward.pids"
PF_LOG_DIR="${TMPDIR:-/tmp}"
PF_WEB_LOG="${PF_LOG_DIR}/swarmbuild-pf-web.log"
PF_GATEWAY_LOG="${PF_LOG_DIR}/swarmbuild-pf-gateway.log"

echo "▶ ensuring kind cluster '${CLUSTER}' exists…"
# Track whether the cluster already existed. On a RE-RUN (cluster present), the
# running Pods keep their old images even after `kind load` refreshes the node's
# images — `kubectl apply` is a no-op when the Deployment spec is unchanged. So we
# must force a rollout restart below to pick up the rebuilt images. On a first run
# (fresh cluster) the Pods are created from the just-loaded images, so no restart.
CLUSTER_PREEXISTED=0
if kind get clusters 2>/dev/null | grep -qx "${CLUSTER}"; then
  echo "  ✓ cluster '${CLUSTER}' already present"
  CLUSTER_PREEXISTED=1
else
  kind create cluster --name "${CLUSTER}"
fi

echo "▶ building images (TARGET-parameterised Go builds + web + killer-k8s)…"
docker build -f "${REPO_ROOT}/deploy/Dockerfile" \
  --build-arg TARGET=./cmd/coordinator \
  -t swarmbuild-coordinator:dev "${REPO_ROOT}"
docker build -f "${REPO_ROOT}/deploy/Dockerfile" \
  --build-arg TARGET=./cmd/gateway \
  -t swarmbuild-gateway:dev "${REPO_ROOT}"
docker build -f "${REPO_ROOT}/deploy/Dockerfile" \
  --build-arg TARGET=./cmd/agent \
  -t swarmbuild-agent:dev "${REPO_ROOT}"
docker build \
  --build-arg VITE_WS_URL=ws://localhost:8080/ws \
  -t swarmbuild-web:dev "${REPO_ROOT}/web"
docker build -f "${REPO_ROOT}/deploy/Dockerfile.killer.k8s" \
  --build-arg TARGET=./cmd/killer \
  -t swarmbuild-killer-k8s:dev "${REPO_ROOT}"

echo "▶ loading images into kind cluster '${CLUSTER}'…"
for img in \
  swarmbuild-coordinator:dev \
  swarmbuild-gateway:dev \
  swarmbuild-agent:dev \
  swarmbuild-web:dev \
  swarmbuild-killer-k8s:dev; do
  echo "  • ${img}"
  kind load docker-image "${img}" --name "${CLUSTER}"
done

echo "▶ applying manifests (kubectl apply -k ${K8S_DIR})…"
kubectl apply -k "${K8S_DIR}"

# On a re-run, the Deployment specs are unchanged, so the existing Pods keep
# their stale images even though `kind load` just refreshed the node. Force a
# rollout so every Pod is recreated against the freshly-loaded image — otherwise
# code changes silently don't take (e.g. a rebuilt coordinator that ignores the
# new reloadDemo control, or a web bundle missing the latest UI).
if [[ ${CLUSTER_PREEXISTED} -eq 1 ]]; then
  echo "▶ cluster pre-existed → restarting deployments to pick up rebuilt images…"
  kubectl -n "${NS}" rollout restart deployment --all
fi

echo "▶ waiting for rollouts to be ready…"
for dep in nats coordinator gateway web killer \
  rover-r1 rover-r2 rover-r3 rover-r4 rover-r5 rover-r6; do
  echo "  • deployment/${dep}"
  kubectl -n "${NS}" rollout status "deployment/${dep}" --timeout=120s
done

echo
echo "✅ SwarmBuild pod-per-rover swarm is up."

# --- auto port-forward --------------------------------------------------------
# Kill any STALE forwards from a previous run first, so re-running up.sh is
# idempotent. `|| true` keeps `set -e` from aborting when none are running.
echo
echo "▶ starting port-forwards (web→localhost:5173, gateway→localhost:8080)…"
pkill -f "port-forward.*svc/web 5173" || true
pkill -f "port-forward.*svc/gateway 8080" || true

# Start both forwards detached so they survive this script exiting. nohup +
# background + redirected output means a closed terminal won't take them down;
# their PIDs go in a stable pidfile (overwritten each run) for down.sh to reap.
nohup kubectl -n "${NS}" port-forward svc/web 5173:80 \
  > "${PF_WEB_LOG}" 2>&1 &
PF_WEB_PID=$!
nohup kubectl -n "${NS}" port-forward svc/gateway 8080:8080 \
  > "${PF_GATEWAY_LOG}" 2>&1 &
PF_GATEWAY_PID=$!
printf '%s\n%s\n' "${PF_WEB_PID}" "${PF_GATEWAY_PID}" > "${PF_PIDFILE}"

# Wait until each forward actually accepts connections before declaring success.
# Bounded poll (~30s, 0.5s sleep). A forward that never comes up is a warning,
# not a hard failure — the cluster is up regardless, so the script must not abort
# here under `set -e` (hence the `if ! …` guards around the poll helper).
wait_forward() {
  # $1 = human label, $2 = curl URL to probe, $3 = log path for the hint.
  local label="$1" url="$2" log="$3" i
  for ((i = 0; i < 60; i++)); do
    if curl -sf -o /dev/null --max-time 1 "${url}"; then
      echo "  ✓ ${label} ready (${url})"
      return 0
    fi
    sleep 0.5
  done
  echo "  ⚠ ${label} did not come up within 30s — see ${log}" >&2
  echo "    (the cluster is still up; retry with: kubectl -n ${NS} port-forward …)" >&2
  return 1
}

# The gateway exposes /healthz; the web nginx serves / (200). Probe each. Don't
# let a failing probe abort the script — capture the outcome and report at the end.
PF_OK=1
if ! wait_forward "gateway" "http://localhost:8080/healthz" "${PF_GATEWAY_LOG}"; then
  PF_OK=0
fi
if ! wait_forward "web" "http://localhost:5173/" "${PF_WEB_LOG}"; then
  PF_OK=0
fi

echo
if [[ ${PF_OK} -eq 1 ]]; then
  echo "✅ open http://localhost:5173"
else
  echo "⚠ swarm is up but a port-forward didn't become ready — see the logs above."
  echo "  Try opening http://localhost:5173 anyway; the forwards may still be settling."
fi
echo
echo "Hit KILL Rx on the dashboard — the rover suffers a recoverable OUTAGE: it"
echo "goes dark at its current position (the Pod keeps running), its Lease expires,"
echo "the swarm self-heals onto a neighbour, then the SAME rover revives in place"
echo "after ~6s. The in-app \"Reload demo\" button rebuilds the dome with no restart."
echo
echo "Tear down (also stops the port-forwards) with: ./deploy/k8s/down.sh"
