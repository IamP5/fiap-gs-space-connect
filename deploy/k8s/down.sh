#!/usr/bin/env bash
# Tear down the SwarmBuild pod-per-rover swarm.
#
#   ./deploy/k8s/down.sh             # delete the swarmbuild namespace (keep the cluster)
#   ./deploy/k8s/down.sh --cluster   # also `kind delete cluster --name swarmbuild`
set -euo pipefail

CLUSTER=swarmbuild
NS=swarmbuild
DELETE_CLUSTER=0
[[ "${1:-}" == "--cluster" ]] && DELETE_CLUSTER=1

echo "▶ deleting namespace '${NS}' (all SwarmBuild workloads + RBAC)…"
kubectl delete namespace "${NS}" --ignore-not-found --wait=true

if [[ ${DELETE_CLUSTER} -eq 1 ]]; then
  echo "▶ deleting kind cluster '${CLUSTER}'…"
  kind delete cluster --name "${CLUSTER}"
  echo "✅ namespace and kind cluster '${CLUSTER}' removed."
else
  echo "✅ namespace '${NS}' removed (kind cluster '${CLUSTER}' kept)."
  echo "ℹ  pass --cluster to also delete the kind cluster."
fi
