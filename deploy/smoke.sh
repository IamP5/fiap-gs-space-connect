#!/usr/bin/env bash
# Pre-demo smoke test (TECHSPEC §7): bring the stack up and assert the bus,
# gateway, and the end-to-end auction are healthy before presenting.
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

echo "▶ waiting for the auction to drive both tasks to DONE…"
done_ok=0
for i in $(seq 1 30); do
  if $COMPOSE logs coordinator 2>/dev/null | grep -q "complete task=task-b"; then
    echo "  ✓ both tasks completed end-to-end"
    done_ok=1
    break
  fi
  sleep 1
done
[[ $done_ok -eq 1 ]] || { echo "✗ tasks did not complete"; $COMPOSE logs coordinator --tail=40; exit 1; }

echo "✅ SMOKE PASS — NATS + coordinator + gateway healthy; auction completed."
if [[ $KEEP -eq 1 ]]; then
  echo "ℹ stack left running: web http://localhost:5173 · gateway :8080 (--keep)"
fi
exit 0
