#!/usr/bin/env bash
# Bring up the SwarmBuild pod-per-rover swarm on a local kind cluster: build the
# five images, load them into the cluster (no registry needed), apply the
# manifests, wait for rollouts, then print the port-forwards.
#
# This is the opt-in "every Rover is a Pod" variant (ADR-0001). The fast headline
# is still `docker compose -f deploy/docker-compose.yml up` — this one trades
# speed for a real `kubectl delete pod` kill seam.
#
#   ./deploy/k8s/up.sh
# Then run the printed port-forwards and open http://localhost:5173.
set -euo pipefail

CLUSTER=swarmbuild
NS=swarmbuild
# Resolve the repo root from this script's location so it runs from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
K8S_DIR="${REPO_ROOT}/deploy/k8s"

echo "▶ ensuring kind cluster '${CLUSTER}' exists…"
if kind get clusters 2>/dev/null | grep -qx "${CLUSTER}"; then
  echo "  ✓ cluster '${CLUSTER}' already present"
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

echo "▶ waiting for rollouts to be ready…"
for dep in nats coordinator gateway web killer \
  rover-r1 rover-r2 rover-r3 rover-r4 rover-r5 rover-r6; do
  echo "  • deployment/${dep}"
  kubectl -n "${NS}" rollout status "deployment/${dep}" --timeout=120s
done

echo
echo "✅ SwarmBuild pod-per-rover swarm is up."
echo
echo "Port-forward the dashboard and the gateway (two terminals, or background them):"
echo "  kubectl -n ${NS} port-forward svc/web 5173:80"
echo "  kubectl -n ${NS} port-forward svc/gateway 8080:8080"
echo
echo "Then open http://localhost:5173 and hit KILL Rx — the killer does a real"
echo "kubectl delete pod -l rover=Rx; its Lease expires and the swarm self-heals."
echo
echo "Tear down with: ./deploy/k8s/down.sh"
