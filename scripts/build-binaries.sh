#!/usr/bin/env bash
# =============================================================================
# ChildCheck — Build script for standalone binaries.
#
# Produces self-contained tarballs for four targets:
#   - linux-x64
#   - linux-arm64
#   - macos-arm64
#   - windows-x64
#
# Each tarball contains:
#   - bun (the Bun runtime binary for that platform)
#   - childcheck / childcheck.exe (a thin shell script that runs bun server.js)
#   - server.js (Next.js standalone server)
#   - node_modules/ (traced dependencies)
#   - .next/static/ (static chunks)
#   - public/ (manifest, icons, service worker)
#   - prisma/schema.prisma + node_modules/prisma/ (prisma CLI)
#   - mini-services/realtime/ (Socket.io mini-service)
#
# Usage:
#   bash scripts/build-binaries.sh            # build all 4 targets
#   bash scripts/build-binaries.sh linux-x64  # build one target
#   TARGETS="linux-x64,macos-arm64" bash scripts/build-binaries.sh
# =============================================================================
set -euo pipefail

# Delete the lockfile before any bun command forces a fresh resolution.
rm -f bun.lock

# Resolve project root (parent of the scripts/ directory).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

DIST_DIR="${PROJECT_ROOT}/dist"
mkdir -p "${DIST_DIR}"

# Default: build all four targets. Override with $TARGETS (comma-separated).
DEFAULT_TARGETS="linux-x64,linux-arm64,macos-arm64,windows-x64"
TARGETS_CSV="${TARGETS:-${DEFAULT_TARGETS}}"
if [ "${1:-}" != "" ]; then
  TARGETS_CSV="${1}"
fi

IFS=',' read -ra TARGETS <<< "${TARGETS_CSV}"

# Mapping: <target> -> extracted dir name inside the bun release zip.
# NOTE: Bun names ARM64 assets "aarch64", NOT "arm64".
declare -A BUN_DOWNLOAD=(
  ["linux-x64"]="bun-linux-x64"
  ["linux-arm64"]="bun-linux-aarch64"
  ["macos-arm64"]="bun-darwin-aarch64"
  ["windows-x64"]="bun-windows-x64"
)
declare -A BINARY_NAME=(
  ["linux-x64"]="childcheck"
  ["linux-arm64"]="childcheck"
  ["macos-arm64"]="childcheck"
  ["windows-x64"]="childcheck.exe"
)
declare -A BUN_BIN_NAME=(
  ["linux-x64"]="bun"
  ["linux-arm64"]="bun"
  ["macos-arm64"]="bun"
  ["windows-x64"]="bun.exe"
)
declare -A BUN_ZIP=(
  ["linux-x64"]="bun-linux-x64.zip"
  ["linux-arm64"]="bun-linux-aarch64.zip"
  ["macos-arm64"]="bun-darwin-aarch64.zip"
  ["windows-x64"]="bun-windows-x64.zip"
)

BUN_VERSION="${BUN_VERSION:-1.3.14}"
BUN_RELEASE_URL="https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}"

echo "============================================================"
echo " ChildCheck binary builder"
echo " Targets: ${TARGETS_CSV}"
echo " Project: ${PROJECT_ROOT}"
echo " Output:  ${DIST_DIR}"
echo " Bun:     ${BUN_VERSION}"
echo "============================================================"

# --- 0. Sanity checks -------------------------------------------------------
if ! command -v bun >/dev/null 2>&1; then
  echo "ERROR: bun is not installed (or not on PATH). Install from https://bun.sh"
  exit 1
fi

if [ ! -f "package.json" ]; then
  echo "ERROR: run from the project root (package.json not found)."
  exit 1
fi

if [ ! -f "scripts/launcher.ts" ]; then
  echo "ERROR: scripts/launcher.ts not found."
  exit 1
fi

# --- 1. Install root deps if needed ----------------------------------------
if [ ! -d "node_modules" ]; then
  echo "[build] installing root deps..."
  bun install
fi

# --- 2. Generate Prisma client + build Next.js ------------------------------
echo "[build] generating Prisma client..."
bun run --no-install db:generate

echo "[build] building Next.js (standalone)..."
bun run --no-install build

if [ ! -d ".next/standalone" ]; then
  echo "ERROR: .next/standalone not produced by the build."
  echo "Check next.config.ts has output: 'standalone'."
  exit 1
fi

# Always install realtime deps fresh (the source's node_modules may be stale
# or empty — a fresh install guarantees socket.io etc. are present and traced).
echo "[build] installing realtime mini-service deps..."
( cd mini-services/realtime && rm -f bun.lock && bun install --no-verify )

# --- 3. Download the Bun binary for the target platform ---------------------
download_bun() {
  local tgt="${1:-}"
  local zip_name=""
  local bin_name=""
  local url=""
  local tmp_dir=""
  if [ -z "${tgt}" ]; then
    echo "ERROR: download_bun called without a target" >&2
    exit 1
  fi
  zip_name="${BUN_ZIP[$tgt]}"
  bin_name="${BUN_BIN_NAME[$tgt]}"
  url="${BUN_RELEASE_URL}/${zip_name}"
  tmp_dir="$(mktemp -d)"
  echo "[build:${tgt}] downloading bun ${BUN_VERSION} for ${tgt}..." >&2
  curl -fsSL "${url}" -o "${tmp_dir}/bun.zip"
  # The zip extracts to <tmpdir>/bun-<target>/ which contains the bun binary.
  ( cd "${tmp_dir}" && unzip -q bun.zip )
  # Return the path to the directory containing the bun binary (stdout only).
  echo "${tmp_dir}/${BUN_DOWNLOAD[$tgt]}"
}

# --- 4. Build each target ---------------------------------------------------
for TARGET in "${TARGETS[@]}"; do
  BUN_FLAG="${BUN_DOWNLOAD[$TARGET]:-}"
  BIN_NAME="${BINARY_NAME[$TARGET]:-}"
  if [ -z "${BUN_FLAG}" ] || [ -z "${BIN_NAME}" ]; then
    echo "ERROR: unknown target '${TARGET}'. Supported: ${DEFAULT_TARGETS}"
    exit 1
  fi

  OUT_DIR="${DIST_DIR}/childcheck-${TARGET}"
  echo ""
  echo "[build:${TARGET}] ----------------------------------------"
  echo "[build:${TARGET}] target=${BUN_FLAG} out=${OUT_DIR}"

  # Clean + recreate the output dir.
  rm -rf "${OUT_DIR}"
  mkdir -p "${OUT_DIR}"

  # Download the bun binary for this platform.
  BUN_BIN_DIR="$(download_bun "${TARGET}")"

  # Copy the Bun binary into the output dir.
  echo "[build:${TARGET}] copying bun binary..."
  BUN_SRC="${BUN_BIN_DIR}/${BUN_BIN_NAME[$TARGET]}"
  cp "${BUN_SRC}" "${OUT_DIR}/bun"
  if [ "${BIN_NAME}" = "childcheck.exe" ]; then
    cp "${BUN_SRC}" "${OUT_DIR}/bun.exe"
  fi
  chmod +x "${OUT_DIR}/bun" "${OUT_DIR}/bun.exe" 2>/dev/null || true

  # Clean up the download temp dir (the whole tmp dir, not just the subdir).
  rm -rf "$(dirname "${BUN_BIN_DIR}")"

  # Copy the Next.js standalone bundle (server.js + traced node_modules +
  # .next/static + public/, per package.json "build" script).
  echo "[build:${TARGET}] copying Next.js standalone..."
  cp -R ".next/standalone/." "${OUT_DIR}/"

  # Make sure .next/static is present alongside server.js (the build script
  # already copied it into standalone, but be defensive).
  if [ ! -d "${OUT_DIR}/.next/static" ]; then
    mkdir -p "${OUT_DIR}/.next"
    cp -R ".next/static" "${OUT_DIR}/.next/static"
  fi
  if [ ! -d "${OUT_DIR}/public" ]; then
    cp -R "public" "${OUT_DIR}/public"
  fi

  # Copy the Prisma schema + a minimal node_modules containing just the prisma
  # CLI (so the launcher can run `prisma db push`).
  echo "[build:${TARGET}] copying prisma CLI..."
  mkdir -p "${OUT_DIR}/prisma"
  cp "prisma/schema.prisma" "${OUT_DIR}/prisma/schema.prisma"

  # Install just `prisma` into the output dir.
  ( cd "${OUT_DIR}" && bun init --no-install 2>/dev/null || true
    cat > package.json <<'PJSON'
{
  "name": "childcheck-runtime",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "prisma": "^6.11.1"
  }
}
PJSON
    rm -f bun.lock
    BUN_INSTALL_FROZEN_LOCKFILE=false bun install --production
  )

  # Copy the realtime mini-service CONTENTS (source + node_modules) so we
  # don't end up with a nested realtime/realtime directory.
  echo "[build:${TARGET}] copying realtime mini-service..."
  mkdir -p "${OUT_DIR}/mini-services/realtime"
  cp -R "mini-services/realtime/." "${OUT_DIR}/mini-services/realtime/"

  # Create empty data/db/config dirs (the launcher will populate them).
  mkdir -p "${OUT_DIR}/data" "${OUT_DIR}/db" "${OUT_DIR}/config"

  # Create the launcher script (shell for unix, batch for windows).
  echo "[build:${TARGET}] writing launcher script..."
  if [ "${BIN_NAME}" = "childcheck.exe" ]; then
    cat > "${OUT_DIR}/childcheck.bat" <<'BATEOF'
@echo off
cd /d "%~dp0"
set "PORT=%PORT%:3000"
set "HOSTNAME=%HOSTNAME%:0.0.0.0"
start "" .\bun.exe server.js
start "" .\bun.exe mini-services/realtime/index.ts
echo ChildCheck is starting on http://localhost:%PORT%
BATEOF
  else
    cat > "${OUT_DIR}/childcheck" <<'SHEOF'
#!/bin/bash
cd "$(dirname "$0")"
export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"

# Start Next.js server (foreground) + realtime mini-service (background).
./bun server.js &
NEXT_PID=$!
./bun mini-services/realtime/index.ts &
REALTIME_PID=$!

echo "ChildCheck is starting on http://localhost:${PORT}"
echo "Press Ctrl+C to stop."

# Forward signals to children.
trap 'kill ${NEXT_PID} ${REALTIME_PID} 2>/dev/null; exit' SIGINT SIGTERM

wait
SHEOF
    chmod +x "${OUT_DIR}/childcheck"
  fi

  # Also provide a "run as service" helper script.
  cat > "${OUT_DIR}/run-service.sh" <<'SHEOF'
#!/bin/bash
# ChildCheck — run as a systemd service (Linux/macOS)
# Usage: sudo bash run-service.sh
cd "$(dirname "$0")"
export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"

# Start realtime (background).
./bun mini-services/realtime/index.ts &
REALTIME_PID=$!

# Start Next.js (foreground — this process IS the service).
exec ./bun server.js
SHEOF
  chmod +x "${OUT_DIR}/run-service.sh"

  # Drop a README in the output dir.
  cat > "${OUT_DIR}/README.txt" <<EOF
ChildCheck ${TARGET}
======================

This directory contains a self-contained ChildCheck deployment.

Files:
  bun / bun.exe              The Bun runtime (v${BUN_VERSION}).
  childcheck / childcheck.bat  Launcher script (starts server + realtime).
  run-service.sh           Run as a systemd service (foreground).
  server.js                Next.js standalone server.
  .next/static/            Static JS/CSS chunks.
  public/                  Manifest, icons, service worker.
  prisma/schema.prisma     Database schema.
  node_modules/prisma/     Prisma CLI (used by db:push).
  mini-services/realtime/  Socket.io mini-service.
  .env                     Optional env file (see .env.example).
  data/                    Runtime photos / branding / backups.
  db/                      SQLite database file (created on first run).
  config/                  Persisted runtime secrets (auto-generated).

Quick start:
  1. cp .env.example .env  (and edit it — set NEXTAUTH_URL + NEXTAUTH_SECRET)
  2. ./childcheck          (or childcheck.bat on Windows)
  3. Open http://localhost:3000/setup and complete the first-run wizard.

For a systemd service:
  sudo bash run-service.sh
EOF

  # Tarball the output for easy distribution.
  echo "[build:${TARGET}] creating tarball..."
  ARCHIVE="${DIST_DIR}/childcheck-${TARGET}.tar.gz"
  tar -czf "${ARCHIVE}" -C "${DIST_DIR}" "childcheck-${TARGET}"
  echo "[build:${TARGET}] → ${ARCHIVE}"

  # Print final size.
  SIZE=$(du -sh "${OUT_DIR}" | cut -f1)
  echo "[build:${TARGET}] done. dir=${OUT_DIR} size=${SIZE}"
done

echo ""
echo "============================================================"
echo " All targets built."
echo "============================================================"
ls -lh "${DIST_DIR}"
