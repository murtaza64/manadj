#!/usr/bin/env bash
# PROTOTYPE (mix-editor) — one-command dev loop for the two-track arranger.
# Starts the backend from the MAIN workspace (real library DB lives there),
# reuses it if already running, starts vite on 5174 (CORS-allowed), and opens
# the prototype in the browser.
set -euo pipefail

MAIN_WORKSPACE="/Users/murtaza/manadj"
BACKEND_URL="http://localhost:8000"
PROTO_URL="http://localhost:5174/?proto=mix"

if ! curl -s -o /dev/null --max-time 1 "$BACKEND_URL/docs"; then
  echo "[proto] backend not running — starting it from $MAIN_WORKSPACE"
  (cd "$MAIN_WORKSPACE" && nohup uv run uvicorn backend.main:app --host 127.0.0.1 --port 8000 \
    > /tmp/manadj-proto-backend.log 2>&1 &)
  echo "[proto] waiting for backend (log: /tmp/manadj-proto-backend.log)"
  for _ in $(seq 1 120); do
    curl -s -o /dev/null --max-time 1 "$BACKEND_URL/docs" && break
    sleep 0.5
  done
else
  echo "[proto] reusing backend already on :8000"
fi

# Open the browser once vite is up.
(sleep 2 && open "$PROTO_URL") &

cd "$(dirname "$0")/../frontend"
exec npm run dev -- --port 5174 --strictPort
