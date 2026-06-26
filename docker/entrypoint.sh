#!/usr/bin/env bash
# =============================================================================
# ChildCheck Docker entrypoint
#
# Responsibilities (in order):
#   1. Mint a default NEXTAUTH_SECRET if none was provided (one-time, persisted
#      to /app/config/.nextauth-secret so it stays stable across restarts).
#   2. Ensure the data subdirectories exist (photos, branding, backups).
#   3. Run `bun run db:push` to create / migrate the SQLite schema.
#   4. Check that PORT + REALTIME_PORT are free on this container (fail fast
#      with a clear, actionable message if either is already bound).
#   5. Start the realtime mini-service (Socket.io on REALTIME_PORT) in the
#      background.
#   6. Exec the Next.js standalone server (foreground, PID 1 under tini).
#
# Designed to be safe to re-run on every container start (idempotent).
#
# Port overrides:
#   Both ports default to the conventional values (3000 / 3003). Operators can
#   override either by setting the env vars in `docker run -e PORT=3001 ...` or
#   in the `environment:` block of `docker-compose.yml`. When doing so, they
#   MUST also update the matching `ports:` host mapping so Docker publishes
#   the new port. See docs/deployment/docker.md + docs/deployment/configuration.md.
# =============================================================================
set -euo pipefail

echo "[entrypoint] ChildCheck starting up..."

# ----------------------------------------------------------------------------
# Port-availability helper
# ----------------------------------------------------------------------------
# check_port(port) → returns 0 if the port is FREE, 1 if it's already bound.
#
# We prefer three increasingly-portable probes:
#   1. `ss -tln`        — iproute2, present on most Debian/Ubuntu bases.
#   2. /proc/net/tcp    — always available on Linux, no external deps.
#   3. bash /dev/tcp    — last-ditch fallback (opens a TCP connect; if it
#                          succeeds the port is in use, if it fails it's free).
#
# We deliberately do NOT use `lsof` or `netstat` — they're not guaranteed to
# be installed in slim images.
check_port() {
  local port="$1"

  # 1. ss (iproute2).
  if command -v ss >/dev/null 2>&1; then
    if ss -tlnH 2>/dev/null | awk '{print $4}' | grep -E "[:.]${port}\$" >/dev/null 2>&1; then
      return 1
    fi
    return 0
  fi

  # 2. /proc/net/tcp (+ tcp6) — parse the local-address column, decode the
  #    port (hex, last 4 chars of the 8-char address field).
  #    Only attempt this when /proc/net/tcp is actually readable; otherwise
  #    fall through to the /dev/tcp probe below (matches the pattern used by
  #    the install scripts' port_in_use() helper).
  if [ -r "/proc/net/tcp" ]; then
    local proc_files=("/proc/net/tcp")
    [ -r "/proc/net/tcp6" ] && proc_files+=("/proc/net/tcp6")
    local f line addr port_hex
    for f in "${proc_files[@]}"; do
      while IFS= read -r line; do
        # Skip the header.
        case "${line}" in *"local_address"*) continue ;; esac
        addr="$(awk '{print $2}' <<<"${line}")"
        [ -z "${addr}" ] && continue
        port_hex="${addr##*:}"
        # 0x00 is decimal 0; we want a numeric compare.
        if [ -n "${port_hex}" ]; then
          local port_dec
          port_dec="$(( 16#${port_hex} ))"
          if [ "${port_dec}" -eq "${port}" ]; then
            return 1
          fi
        fi
      done < "${f}"
    done
    # Parsed /proc/net/tcp successfully + didn't find the port → it's free.
    return 0
  fi

  # 3. /dev/tcp fallback — reached only when neither ss nor /proc/net/tcp
  #    were usable. Opens a TCP connect to 127.0.0.1:port; if the connect
  #    succeeds the port is in use, if it fails (ECONNREFUSED) the port is
  #    free. This is the most portable probe (works in any bash build with
  #    /dev/tcp enabled, no external deps).
  if (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null; then
    exec 3>&- 3<&-
    return 1
  fi
  return 0
}

# Resolve ports up-front so error messages + log lines are accurate.
PORT="${PORT:-3000}"
REALTIME_PORT="${REALTIME_PORT:-3003}"

# The runtime user the app runs as (created in the Dockerfile).
APP_USER="childcheck"
APP_UID="$(id -u "${APP_USER}")"
APP_GID="$(id -g "${APP_USER}")"

CONFIG_DIR="${CHILDCHECK_CONFIG_DIR:-/app/config}"
DATA_DIR="${CHILDCHECK_DATA_DIR:-/app/data}"
DB_DIR="$(dirname "${DATABASE_URL#file:}")"  # /app/db from file:/app/db/custom.db

# --- 1. Fix bind-mount permissions (run as root) ----------------------------
# The bind-mounted ./data, ./db, ./config directories on the host are typically
# owned by the host user (e.g. UID 1000), but the app runs as the childcheck
# user (UID 1001). chown them to the childcheck user so the app can read/write.
# This is the standard pattern (Postgres, MySQL, etc. official images).
echo "[entrypoint] fixing permissions on data/db/config dirs (chown → ${APP_USER})..."
chown -R "${APP_UID}:${APP_GID}" "${DATA_DIR}" "${DB_DIR}" "${CONFIG_DIR}" 2>/dev/null || {
  echo "[entrypoint] WARNING: could not chown all dirs — some may be read-only."
  echo "              If the app fails to write, check the host directory permissions."
}

# --- 2. NEXTAUTH_SECRET -----------------------------------------------------
# NextAuth REQUIRES this. If the operator didn't pass one, mint a random one
# and persist it to the config volume so it stays the same across restarts
# (otherwise every restart invalidates all session cookies).
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
    echo "[entrypoint] NEXTAUTH_SECRET generated and saved to ${SECRET_FILE}"
  fi
fi

# --- 3. Data subdirectories -------------------------------------------------
mkdir -p "${DATA_DIR}/photos" "${DATA_DIR}/branding" "${DATA_DIR}/backups"
echo "[entrypoint] data dir = ${DATA_DIR}"

# --- 4. Drop privileges + run the rest as the childcheck user ----------------
# Everything below (db:push, port checks, starting services) runs as the
# unprivileged childcheck user via gosu. We re-exec this same script under
# gosu so the rest of the logic runs unprivileged.
if [ "$(id -u)" = "0" ]; then
  echo "[entrypoint] dropping privileges to ${APP_USER} (uid ${APP_UID})..."
  exec gosu "${APP_USER}" "$0" "$@"
fi

# --- 5. Database schema push ------------------------------------------------
# Runs as the childcheck user (privileges already dropped above).
# --skip-generate: the Prisma client was generated during the Docker build
# (copied from the builder stage), so we don't need to regenerate it at runtime
# (which would fail anyway — node_modules is owned by root, the app runs as
# childcheck). db:push only applies the schema to the SQLite file.
echo "[entrypoint] running prisma db:push..."
bunx prisma db push --skip-generate
echo "[entrypoint] db:push complete"

# --- 6. Port-availability checks (fail fast) --------------------------------
# If PORT or REALTIME_PORT is already bound INSIDE this container, the Next.js
# server / realtime service would crash on listen() with EADDRINUSE. We catch
# it up-front with a clear, actionable message so the operator knows exactly
# what to change.
#
# NOTE: This checks from inside the container. The HOST port mapping is
# enforced by Docker's port-publishing layer; if the host port is in use,
# `docker compose up` itself will fail before this entrypoint even runs.

echo "[entrypoint] checking port availability (PORT=${PORT}, REALTIME_PORT=${REALTIME_PORT})..."

if ! check_port "${PORT}"; then
  echo ""
  echo "[entrypoint] ERROR: port ${PORT} is already in use inside this container."
  echo "              The Next.js server cannot bind to it."
  echo ""
  echo "              To use a different port:"
  echo "                1. Set PORT to a free value, e.g. PORT=3001"
  echo "                2. Update the host-side port mapping in docker-compose.yml:"
  echo "                     ports:"
  echo "                       - \"3001:3001\"   # host:container must both = PORT"
  echo "                3. Update NEXTAUTH_URL to include the new port:"
  echo "                     NEXTAUTH_URL=http://localhost:3001"
  echo "                4. Restart the container."
  echo ""
  echo "              Tip: run  ss -tlnp  inside the container to see what's bound."
  exit 1
fi

if ! check_port "${REALTIME_PORT}"; then
  echo ""
  echo "[entrypoint] ERROR: port ${REALTIME_PORT} is already in use inside this container."
  echo "              The realtime (Socket.io) mini-service cannot bind to it."
  echo ""
  echo "              To use a different realtime port:"
  echo "                1. Set REALTIME_PORT to a free value, e.g. REALTIME_PORT=3004"
  echo "                2. Update the host-side port mapping in docker-compose.yml:"
  echo "                     ports:"
  echo "                       - \"3004:3004\"   # host:container must both = REALTIME_PORT"
  echo "                3. Restart the container."
  echo ""
  echo "              NOTE: the frontend reads the realtime port from /api/config"
  echo "                    (which reads this env var), so no client rebuild is"
  echo "                    needed — browsers pick up the new port automatically."
  echo ""
  echo "              Tip: run  ss -tlnp  inside the container to see what's bound."
  exit 1
fi

echo "[entrypoint] ports ${PORT} + ${REALTIME_PORT} are free."

# --- 7. Start realtime mini-service (background) ----------------------------
# The mini-service is a small Socket.io server on REALTIME_PORT (see
# mini-services/realtime/index.ts). We run it under `bun` with --hot disabled
# (production). Logs are forwarded to stdout/stderr of the main container.
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

# --- 8. Start Next.js standalone server (foreground) ------------------------
# Next.js standalone server.js honours HOSTNAME + PORT env vars.
# Use bun (already the runtime in this image) to execute it.
echo "[entrypoint] starting Next.js standalone server on ${HOSTNAME:-0.0.0.0}:${PORT}..."
exec bun server.js
