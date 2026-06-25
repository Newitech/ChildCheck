#!/usr/bin/env bash
set -euo pipefail

echo "[entrypoint] ChildCheck starting up..."

APP_USER="childcheck"
APP_UID="$(id -u "${APP_USER}")"
APP_GID="$(id -g "${APP_USER}")"

CONFIG_DIR="${CHILDCHECK_CONFIG_DIR:-/app/config}"
DATA_DIR="${CHILDCHECK_DATA_DIR:-/app/data}"
DB_DIR="$(dirname "${DATABASE_URL#file:}")"

# --- 1. Fix bind-mount permissions (run as root) ---
if [ "$(id -u)" = "0" ]; then
  echo "[entrypoint] fixing permissions on data/db/config dirs..."
  chown -R "${APP_UID}:${APP_GID}" "${DATA_DIR}" "${DB_DIR}" "${CONFIG_DIR}" 2>/dev/null || true
fi

# --- 2. NEXTAUTH_SECRET ---
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
    chown "${APP_UID}:${APP_GID}" "${SECRET_FILE}"
    echo "[entrypoint] NEXTAUTH_SECRET generated and saved"
  fi
fi

# --- 3. Data subdirectories ---
mkdir -p "${DATA_DIR}/photos" "${DATA_DIR}/branding" "${DATA_DIR}/backups"
echo "[entrypoint] data dir = ${DATA_DIR}"

# --- 4. Drop privileges ---
if [ "$(id -u)" = "0" ]; then
  echo "[entrypoint] dropping privileges to ${APP_USER}..."
  exec gosu "${APP_USER}" "$0" "$@"
fi

# --- 5. Database schema push ---
echo "[entrypoint] running prisma db:push..."
bunx prisma db push --skip-generate
echo "[entrypoint] db:push complete"

# --- 6. Start realtime mini-service ---
REALTIME_PORT="${REALTIME_PORT:-3003}"
echo "[entrypoint] starting realtime mini-service on port ${REALTIME_PORT}..."
(
  cd /app/mini-services/realtime
  exec bun index.ts
) &
REALTIME_PID=$!
trap 'kill -TERM ${REALTIME_PID} 2>/dev/null || true' TERM INT
sleep 1
if kill -0 ${REALTIME_PID} 2>/dev/null; then
  echo "[entrypoint] realtime is running"
else
  echo "[entrypoint] WARNING: realtime exited early"
fi

# --- 7. Start Next.js ---
echo "[entrypoint] starting Next.js on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}..."
exec bun server.js
