#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
BASE_URL="${1:-http://127.0.0.1:7300}"
BACKEND_LOG="${BACKEND_LOG:-/tmp/lab_core_backend_full_smoke.log}"

cd "${ROOT_DIR}"
rm -f core/backend/data/database.sqlite
mkdir -p core/backend/data/generated

yarn dev:backend > "${BACKEND_LOG}" 2>&1 &
PID=$!

cleanup() {
  kill "${PID}" >/dev/null 2>&1 || true
  wait "${PID}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in $(seq 1 30); do
  if curl -fsS "${BASE_URL}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -fsS "${BASE_URL}/health" >/dev/null
node scripts/testing/full_system_smoke_test.mjs "${BASE_URL}"
