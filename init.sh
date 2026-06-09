#!/usr/bin/env bash
# SwarmBuild — standard startup + verification path (harness entry point).
#
# This is the single command a coding-agent session runs at startup (AGENTS.md
# "Startup Workflow", step 5) and the baseline gate before any new work. It is
# idempotent and safe to re-run: it never launches a long-running server unless
# you explicitly ask it to.
#
#   ./init.sh                 # sync deps + run the baseline verification gate
#   FAST=1 ./init.sh          # Go only (skip the web build/test) — quick loop
#   WEB=1 ./init.sh           # also build + test the web dashboard
#   RUN_START_COMMAND=1 ./init.sh   # after verifying, bring up the full demo stack
#
# See docs/harness/README.md for how this fits the rest of the harness.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "==> Working directory: $PWD"

# --- Go backend: deep modules + orchestration (the substance) ----------------
echo "==> Syncing Go dependencies"
go mod download

echo "==> go build ./... (must compile clean)"
go build ./...

echo "==> go vet ./..."
go vet ./...

if command -v golangci-lint >/dev/null 2>&1; then
  echo "==> golangci-lint run ./... (must report 0 issues)"
  golangci-lint run ./...
else
  echo "!! golangci-lint not found — skipping lint. Install it for the full gate:"
  echo "   https://golangci-lint.run/welcome/install/"
fi

echo "==> go test -race -shuffle=on ./... (all backend tests)"
go test -race -shuffle=on ./...

# --- Web dashboard: opt-in (heavier; needs npm) ------------------------------
if [ "${WEB:-0}" = "1" ] && [ "${FAST:-0}" != "1" ]; then
  if command -v npm >/dev/null 2>&1; then
    echo "==> web: npm install"
    (cd web && npm install)
    echo "==> web: npm run build (tsc -b && vite build — must be TS-clean)"
    (cd web && npm run build)
    echo "==> web: npm test (vitest)"
    (cd web && npm test)
  else
    echo "!! npm not found — skipping web build/test."
  fi
else
  echo "==> Skipping web build/test (set WEB=1 to include the dashboard)."
fi

echo ""
echo "✅ Baseline verification passed. The repo is in a known-good state."
echo "   Full stack on k8s:  ./deploy/k8s/up.sh   (dashboard at http://localhost:5173)"
echo "   UI with no backend: (cd web && VITE_MOCK=1 npm run dev)"

if [ "${RUN_START_COMMAND:-0}" = "1" ]; then
  echo "==> Starting the full stack on kind…"
  exec ./deploy/k8s/up.sh
fi
