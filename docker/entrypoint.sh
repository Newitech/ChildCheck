#!/usr/bin/env bash
# =============================================================================
# ChildCheck Docker entrypoint
#
# Responsibilities (in order):
#   1. Mint a default NEXTAUTH_SECRET if none was provided (one-time, persisted
#      to /app/config/.nextauth-secret so it stays stable across restarts).
#   2. Ensure the data subdirectories exist (photos, branding, backups).
#   3. Run `bun run db:push` to create / migrate the SQLite schema.
#   4. Start the realtime mini-service (Socket.io on port 3003) in the background.
#   5. Exec the Next.js standalone server (foreground, PID 1 under tini).
#
# Designed to be safe to re-run on every container start (idempotent).
# =============================================================================
set -euo pipefail

echo "[entrypoint] ChildCheck starting up..."

# --- 1. NEXTAUTH_SECRET -----------------------------------------------------
# NextAuth REQUIRES this. If the operator didn't pass one, mint a random one
# and persist it to the config volume so it stays the same across restarts
# (otherwise every restart invalidates all session cookies).
CONFIG_DIR="${CHILDCHECK_CONFIG_DIR:-/app/config}"
SECRET_FILE="${CONFIG_DIR}/.nextauth-secret"

if [ -z "${NEXTAUTH_SECRET:-}" ]; then
  mkdir -p "${CONFIG_DIR}"
  if [ -f "${SECRET_FILE}" ]; then
    export NEXTAUTH_SECRET="$(cat "${SECRET_FILE}")"
    echo "[entrypoint] NEXTAUTH_SECRET loaded from ${SECRET_FILE}"
  else
    export NEXTAUTH_SECRET="$(openssl rand -hex 32)"
    echo "${NEXTAUTH_SECRET}" > "${SECRET_FILE}"
    chmod 600 "${SECRET_FILE}"
    echo "[entrypoint] NEXTAUTH_SECRET generated and saved to ${SECRET_FILE}"
  fi
fi

# --- 2. Data subdirectories -------------------------------------------------
DATA_DIR="${CHILDCHECK_DATA_DIR:-/app/data}"
mkdir -p "${DATA_DIR}/photos" "${DATA_DIR}/branding" "${DATA_DIR}/backups"
echo "[entrypoint] data dir = ${DATA_DIR}"

# --- 3. Database schema push ------------------------------------------------
echo "[entrypoint] running prisma db:push..."
bun run db:push
echo "[entrypoint] db:push complete"

# --- 4. Start realtime mini-service (background) ----------------------------
# The mini-service is a small Socket.io server on port 3003 (see
# mini-services/realtime/index.ts). We run it under `bun` with --hot disabled
# (production). Logs are forwarded to stdout/stderr of the main container.
REALTIME_PORT="${REALTIME_PORT:-3003}"
echo "[entrypoint] starting realtime mini-service on port ${REALTIME_PORT}..."
(
  cd /app/mini-services/realtime
  exec bun index.ts
) &
REALTIME_PID=$!
echo "[entrypoint] realtime pid=${REALTIME_PID}"

# Propagate signals to the realtime child too.
trap 'echo "[entrypoint] received shutdown signal, stopping realtime..."; kill -TERM ${REALTIME_PID} 2>/dev/null || true' TERM INT

# Give it a beat to bind, then warn (don't fail) if it's not up — the Next.js
# server doesn't strictly depend on realtime at boot.
sleep 1
if kill -0 ${REALTIME_PID} 2>/dev/null; then
  echo "[entrypoint] realtime is running"
else
  echo "[entrypoint] WARNING: realtime mini-service exited early — check logs above"
fi

# --- 5. Start Next.js standalone server (foreground) ------------------------
# Next.js standalone server.js honours HOSTNAME + PORT env vars.
# Use bun (already the runtime in this image) to execute it.
echo "[entrypoint] starting Next.js standalone server on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}..."
exec bun server.js
