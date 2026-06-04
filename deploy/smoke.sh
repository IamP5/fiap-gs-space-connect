#!/usr/bin/env bash
# Pre-demo smoke test (TECHSPEC §7): bring the stack up and assert the bus and
# gateway are healthy, the scripted kill triggers self-heal, and the swarm closes
# the dome end-to-end — before presenting.
#
#   ./deploy/smoke.sh            # build, bring up, assert, then tear down
#   ./deploy/smoke.sh --keep     # leave the stack running after asserting
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose -f deploy/docker-compose.yml"
KEEP=0
[[ "${1:-}" == "--keep" ]] && KEEP=1

cleanup() { [[ $KEEP -eq 0 ]] && $COMPOSE down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "▶ building + starting stack…"
$COMPOSE up -d --build

echo "▶ waiting for gateway /healthz to report connected…"
ok=0
for i in $(seq 1 60); do
  body=$(curl -fs http://127.0.0.1:8080/healthz 2>/dev/null || true)
  if [[ "$body" == *'"connected":true'* ]]; then
    echo "  ✓ gateway connected: $body"
    ok=1
    break
  fi
  sleep 1
done
[[ $ok -eq 1 ]] || { echo "✗ gateway never reported connected"; $COMPOSE logs --tail=40; exit 1; }

echo "▶ waiting for the scripted kill to trigger self-heal (wall-1 expiry → re-auction)…"
heal_ok=0
for i in $(seq 1 40); do
  # slog renders as: msg=expiry task=wall-1 … note="returned to UNCLAIMED"
  if $COMPOSE logs coordinator 2>/dev/null | grep -q "msg=expiry task=wall-1"; then
    echo "  ✓ wall-1 lease expired and returned to UNCLAIMED for re-auction"
    heal_ok=1
    break
  fi
  sleep 1
done
[[ $heal_ok -eq 1 ]] || { echo "✗ self-heal never triggered (no wall-1 expiry)"; $COMPOSE logs coordinator --tail=40; exit 1; }

echo "▶ waiting for the swarm to close the dome (dome-cap DONE)…"
done_ok=0
for i in $(seq 1 60); do
  # The keystone completing means every foundation + wall is DONE and the dome closed.
  if $COMPOSE logs coordinator 2>/dev/null | grep -q "msg=complete task=dome-cap"; then
    echo "  ✓ dome-cap complete — the dome closed end-to-end after self-heal"
    done_ok=1
    break
  fi
  sleep 1
done
[[ $done_ok -eq 1 ]] || { echo "✗ dome never closed (dome-cap not complete)"; $COMPOSE logs coordinator --tail=40; exit 1; }

echo "✅ SMOKE PASS — NATS + coordinator + gateway healthy; self-heal fired and the dome closed."
if [[ $KEEP -eq 1 ]]; then
  echo "ℹ stack left running: web http://localhost:5173 · gateway :8080 (--keep)"
fi
exit 0
