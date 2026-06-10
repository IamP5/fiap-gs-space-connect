#!/usr/bin/env bash
set -euo pipefail

CLUSTER=swarmbuild
NS=swarmbuild
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
K8S_DIR="${REPO_ROOT}/deploy/k8s"

WORKLOADS=(coordinator gateway web rover-r1 rover-r2 rover-r3 rover-r4 rover-r5 rover-r6)
ROLLOUTS=(nats coordinator gateway web rover-r1 rover-r2 rover-r3 rover-r4 rover-r5 rover-r6)

PF_PIDFILE="${TMPDIR:-/tmp}/swarmbuild-portforward.pids"
PF_LOG_DIR="${TMPDIR:-/tmp}"
PF_WEB_LOG="${PF_LOG_DIR}/swarmbuild-pf-web.log"
PF_GATEWAY_LOG="${PF_LOG_DIR}/swarmbuild-pf-gateway.log"

echo "▶ ensuring kind cluster '${CLUSTER}' exists…"
CLUSTER_PREEXISTED=0
if kind get clusters 2>/dev/null | grep -qx "${CLUSTER}"; then
  echo "  ✓ cluster '${CLUSTER}' already present"
  CLUSTER_PREEXISTED=1
else
  kind create cluster --name "${CLUSTER}"
fi

echo "▶ building images…"
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

echo "▶ loading images into kind cluster '${CLUSTER}'…"
for img in \
  swarmbuild-coordinator:dev \
  swarmbuild-gateway:dev \
  swarmbuild-agent:dev \
  swarmbuild-web:dev; do
  echo "  • ${img}"
  kind load docker-image "${img}" --name "${CLUSTER}"
done

echo "▶ ensuring namespace + LLM secret (for live build mode) before apply…"
kubectl create namespace "${NS}" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
if [[ -f "${REPO_ROOT}/.env" ]]; then
  kubectl -n "${NS}" create secret generic swarmbuild-llm \
    --from-env-file="${REPO_ROOT}/.env" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  echo "  ✓ secret 'swarmbuild-llm' synced from .env → live build mode ENABLED on the rovers"
else
  echo "  ⚠ no ${REPO_ROOT}/.env → live build mode OFF (placements replay baked specs)."
fi

echo "▶ applying manifests (kubectl apply -k ${K8S_DIR})…"
kubectl apply -k "${K8S_DIR}"

echo "▶ pruning resources removed from the manifests (killer sidecar)…"
kubectl -n "${NS}" delete \
  deployment/killer \
  serviceaccount/killer \
  role/killer-pod-deleter \
  rolebinding/killer-pod-deleter \
  --ignore-not-found

if [[ ${CLUSTER_PREEXISTED} -eq 1 ]]; then
  echo "▶ cluster pre-existed → restarting deployments to pick up rebuilt images…"
  kubectl -n "${NS}" rollout restart deployment "${WORKLOADS[@]}"
fi

echo "▶ waiting for rollouts to be ready…"
for dep in "${ROLLOUTS[@]}"; do
  echo "  • deployment/${dep}"
  kubectl -n "${NS}" rollout status "deployment/${dep}" --timeout=120s
done

echo
echo "✅ SwarmBuild pod-per-rover swarm is up."

echo
echo "▶ starting port-forwards (web→localhost:5173, gateway→localhost:8080)…"
pkill -f "port-forward.*svc/web 5173" || true
pkill -f "port-forward.*svc/gateway 8080" || true

nohup kubectl -n "${NS}" port-forward svc/web 5173:80 \
  > "${PF_WEB_LOG}" 2>&1 &
PF_WEB_PID=$!
nohup kubectl -n "${NS}" port-forward svc/gateway 8080:8080 \
  > "${PF_GATEWAY_LOG}" 2>&1 &
PF_GATEWAY_PID=$!
printf '%s\n%s\n' "${PF_WEB_PID}" "${PF_GATEWAY_PID}" > "${PF_PIDFILE}"

wait_forward() {
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
echo "The board starts EMPTY — this is your sandbox. Pick a Blueprint from the"
echo "dashboard hotbar (dome / solar-array / comms-mast) and drop it on the regolith;"
echo "the Rover Pods drive over and build it live."
echo
echo "Mid-build, hit KILL Rx — the rover suffers a recoverable OUTAGE: it goes dark"
echo "at its current position (the Pod keeps running), its Lease expires, the swarm"
echo "self-heals onto a neighbour, then the SAME rover revives in place after ~6s."
echo "The in-app \"Reload demo\" button clears the board so you can place another."
echo
echo "Tail every service with: ./deploy/k8s/logs.sh"
echo
echo "Tear down (also stops the port-forwards) with: ./deploy/k8s/down.sh"
