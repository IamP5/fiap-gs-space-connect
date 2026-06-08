#!/usr/bin/env bash
# Aggregate the logs of EVERY SwarmBuild service during a take, so a run can be
# asserted end-to-end from the logs (not just the screen). Tails — interleaved,
# per-pod prefixed — the coordinator, gateway, NATS, the killer, and every
# Rover Pod present (six standalone Rovers in the default deploy; none in the
# cinematic overlay, where the fleet is in-process inside the coordinator).
#
#   ./deploy/k8s/logs.sh                 # tail all services live (follow)
#   ./deploy/k8s/logs.sh --cinematic     # same, but annotate the cinematic trail
#   ./deploy/k8s/logs.sh --since 5m      # replay the last 5m, then follow
#   ./deploy/k8s/logs.sh --no-follow     # dump current logs and exit
#   ./deploy/k8s/logs.sh --climax        # grep just the climax trail (no follow)
#
# Prefers `stern` (cleaner multi-pod tailing) when installed; otherwise falls back
# to backgrounded `kubectl logs -f` per role, reaped on exit.
#
# THE CLIMAX TRAIL to confirm in the cinematic take (`--cinematic`/`--climax`):
#   coordinator: "cueKill: hero wall released + kill armed"   (cue received)
#   coordinator: award task=lunar/wall-1 to=lunar-Rx          (hero wall leased)
#   coordinator: "scripted kill" rover=lunar-Rx               (in-process kill — NO pod delete)
#   coordinator: expiry task=lunar/wall-1 ... UNCLAIMED       (Lease Expiry)
#   coordinator: award task=lunar/wall-1 to=lunar-Ry          (Re-auction → survivor)
#   coordinator: complete task=lunar/wall-1 by=lunar-Ry       (Task DONE → dome sealed)
#   (a victim --recover-ms revive, if any, only appears AFTER the seal.)
set -uo pipefail

NS=swarmbuild

CINEMATIC=0
FOLLOW=1
CLIMAX=0
SINCE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cinematic) CINEMATIC=1; shift ;;
    --no-follow) FOLLOW=0; shift ;;
    --climax)    CLIMAX=1; FOLLOW=0; shift ;;
    --since)     SINCE="${2:-}"; shift 2 ;;
    -h|--help)
      grep -E '^# ' "$0" | sed 's/^# //'; exit 0 ;;
    *) echo "unknown arg: $1 (try --help)" >&2; exit 2 ;;
  esac
done

# Roles always present in both deploys. Rover Pods are added below only when they
# exist (the cinematic overlay has none — the swarm is in-process).
ROLES=(nats coordinator gateway killer)

# --climax: one-shot grep of the coordinator's climax trail, newest run only.
if [[ ${CLIMAX} -eq 1 ]]; then
  echo "▶ climax trail (coordinator) — cueKill → award → in-process kill → Expiry → Re-auction → DONE:"
  kubectl -n "${NS}" logs deployment/coordinator --tail=600 2>/dev/null \
    | grep -Ei 'cueKill|hero wall|scripted kill|expiry|award task=lunar/wall-1|complete task=lunar/wall-1|re-?auction|revive|recover' \
    || echo "  (no climax lines yet — fire the cueKill cue, then re-run)"
  exit 0
fi

SINCE_ARG=()
[[ -n "${SINCE}" ]] && SINCE_ARG=(--since "${SINCE}")

if [[ ${CINEMATIC} -eq 1 ]]; then
  echo "▶ cinematic take — fire {cmd:\"cueKill\"} at the climax; confirm this trail in the coordinator stream:"
  echo "    cueKill received → hero wall released+awarded → in-process kill (NO pod delete)"
  echo "    → Lease Expiry → Re-auction → survivor seals dome (Task DONE); victim revive only AFTER the seal."
  echo
fi

# Prefer stern if available: one process, clean per-pod prefixes, handles Pod
# churn (a revived rover) automatically.
if command -v stern >/dev/null 2>&1; then
  echo "▶ tailing all SwarmBuild services with stern (label app=swarmbuild)…"
  STERN_ARGS=(--namespace "${NS}" --selector app=swarmbuild --timestamps)
  [[ -n "${SINCE}" ]] && STERN_ARGS+=(--since "${SINCE}")
  [[ ${FOLLOW} -eq 0 ]] && STERN_ARGS+=(--no-follow)
  exec stern "${STERN_ARGS[@]}"
fi

# Fallback: background a `kubectl logs` per role and reap them all on exit. Add
# the standalone Rover Pods only when they exist (default deploy).
echo "▶ stern not found → tailing per-role with kubectl logs (Ctrl-C to stop)…"
for r in 1 2 3 4 5 6; do
  if kubectl -n "${NS}" get deployment "rover-r${r}" >/dev/null 2>&1; then
    ROLES+=("rover-r${r}")
  fi
done

PIDS=()
# `${PIDS[@]+...}` expands to nothing when no tails were started (set -u safe).
cleanup() { for p in ${PIDS[@]+"${PIDS[@]}"}; do kill "${p}" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

FOLLOW_ARG=(-f)
[[ ${FOLLOW} -eq 0 ]] && FOLLOW_ARG=()

# Background each `kubectl logs` DIRECTLY (no subshell/sed wrapper): --prefix
# already tags every line with its [pod/.../container], and capturing kubectl's
# own PID means cleanup() kills the real tail on Ctrl-C rather than an empty
# subshell that leaves an orphaned `kubectl logs -f` running.
#
# The `"${arr[@]+"${arr[@]}"}"` idiom expands to nothing when the array is empty
# WITHOUT tripping `set -u` (bash 3.2 on macOS errors on a bare "${empty[@]}").
# FOLLOW_ARG empties under --no-follow; SINCE_ARG is empty unless --since is given.
for role in "${ROLES[@]}"; do
  kubectl -n "${NS}" logs "deployment/${role}" \
    ${FOLLOW_ARG[@]+"${FOLLOW_ARG[@]}"} --tail=50 \
    ${SINCE_ARG[@]+"${SINCE_ARG[@]}"} --prefix 2>/dev/null &
  PIDS+=($!)
done

# Wait on all the tails. In follow mode this blocks until Ctrl-C (trap reaps the
# children); in --no-follow each kubectl exits on its own and `wait` returns.
wait
