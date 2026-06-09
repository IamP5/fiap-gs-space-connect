#!/usr/bin/env bash
set -uo pipefail

NS=swarmbuild

FOLLOW=1
SINCE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-follow) FOLLOW=0; shift ;;
    --since)     SINCE="${2:-}"; shift 2 ;;
    -h|--help)
      echo "usage: $0 [--since 5m] [--no-follow]"; exit 0 ;;
    *) echo "unknown arg: $1 (try --help)" >&2; exit 2 ;;
  esac
done

ROLES=(nats coordinator gateway)

SINCE_ARG=()
[[ -n "${SINCE}" ]] && SINCE_ARG=(--since "${SINCE}")

if command -v stern >/dev/null 2>&1; then
  echo "▶ tailing all SwarmBuild services with stern (label app=swarmbuild)…"
  STERN_ARGS=(--namespace "${NS}" --selector app=swarmbuild --timestamps)
  [[ -n "${SINCE}" ]] && STERN_ARGS+=(--since "${SINCE}")
  [[ ${FOLLOW} -eq 0 ]] && STERN_ARGS+=(--no-follow)
  exec stern "${STERN_ARGS[@]}"
fi

echo "▶ stern not found → tailing per-role with kubectl logs (Ctrl-C to stop)…"
for r in 1 2 3 4 5 6; do
  if kubectl -n "${NS}" get deployment "rover-r${r}" >/dev/null 2>&1; then
    ROLES+=("rover-r${r}")
  fi
done

PIDS=()
cleanup() { for p in ${PIDS[@]+"${PIDS[@]}"}; do kill "${p}" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

FOLLOW_ARG=(-f)
[[ ${FOLLOW} -eq 0 ]] && FOLLOW_ARG=()

for role in "${ROLES[@]}"; do
  kubectl -n "${NS}" logs "deployment/${role}" \
    ${FOLLOW_ARG[@]+"${FOLLOW_ARG[@]}"} --tail=50 \
    ${SINCE_ARG[@]+"${SINCE_ARG[@]}"} --prefix 2>/dev/null &
  PIDS+=($!)
done

wait
