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

# Same stable pidfile up.sh writes its auto port-forward PIDs to.
PF_PIDFILE="${TMPDIR:-/tmp}/swarmbuild-portforward.pids"

# --- stop the auto port-forwards ---------------------------------------------
# Reap the exact PIDs up.sh recorded, then a pkill fallback in case the pidfile
# is stale or missing (e.g. up.sh from an older run). Every step is guarded with
# `|| true` so `set -e` doesn't abort when there's nothing to kill, and a MISSING
# pidfile is fine — the `[[ -f ]]` guard skips the read entirely.
echo "▶ stopping port-forwards…"
if [[ -f "${PF_PIDFILE}" ]]; then
  while read -r pid; do
    [[ -n "${pid}" ]] && kill "${pid}" 2>/dev/null || true
  done < "${PF_PIDFILE}"
  rm -f "${PF_PIDFILE}" || true
fi
pkill -f "port-forward.*svc/web 5173" || true
pkill -f "port-forward.*svc/gateway 8080" || true

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
