#!/usr/bin/env bash
# =============================================================================
# ChildCheck — Bun standalone binary build script.
#
# Produces self-contained executables for four targets:
#   - linux-x64
#   - linux-arm64
#   - macos-arm64
#   - windows-x64
#
# Each output is a single compiled `childcheck` (or `childcheck.exe`) binary
# that embeds the Bun runtime. The binary uses `scripts/launcher.ts` as its
# entry point. Alongside each binary we copy:
#   - .next/standalone/server.js             (Next.js standalone server)
#   - .next/standalone/.next/static/         (static chunks)
#   - .next/standalone/public/               (manifest, icons, sw.js)
#   - prisma/schema.prisma                   (DB schema)
#   - node_modules/prisma/                   (Prisma CLI, for db:push)
#   - mini-services/realtime/                (Socket.io source + deps)
#
# Output: dist/childcheck-<platform>-<arch>/
#
# Prerequisites:
#   - bun ≥ 1.3 installed locally
#   - Run from the project root (after `bun install`)
#
# Usage:
#   bash scripts/build-binaries.sh            # build all 4 targets
#   bash scripts/build-binaries.sh linux-x64  # build one target
#   TARGETS="linux-x64,macos-arm64" bash scripts/build-binaries.sh
# =============================================================================
set -euo pipefail

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

# Mapping: <target> -> <bun target flag> <binary name> <subdir>
declare -A BUN_TARGET=(
  ["linux-x64"]="bun-linux-x64"
  ["linux-arm64"]="bun-linux-arm64"
  ["macos-arm64"]="bun-darwin-arm64"
  ["windows-x64"]="bun-windows-x64"
)
declare -A BINARY_NAME=(
  ["linux-x64"]="childcheck"
  ["linux-arm64"]="childcheck"
  ["macos-arm64"]="childcheck"
  ["windows-x64"]="childcheck.exe"
)

echo "============================================================"
echo " ChildCheck binary builder"
echo " Targets: ${TARGETS_CSV}"
echo " Project: ${PROJECT_ROOT}"
echo " Output:  ${DIST_DIR}"
echo "============================================================"

# --- 0. Sanity checks -------------------------------------------------------
if ! command -v bun >/dev/null 2>&1; then
  echo "ERROR: bun is not installed (or not on PATH). Install from https://bun.sh"
  exit 1
fi

if [ ! -f "package.json" ]; then
  echo "ERROR: package.json not found in ${PROJECT_ROOT}"
  echo "Run this script from the ChildCheck project root."
  exit 1
fi

if [ ! -f "scripts/launcher.ts" ]; then
  echo "ERROR: scripts/launcher.ts not found."
  exit 1
fi

# --- 1. Install root deps if needed ----------------------------------------
if [ ! -d "node_modules" ]; then
  echo "[build] installing root deps..."
  bun install --no-verify
fi

# --- 2. Generate Prisma client + build Next.js ------------------------------
echo "[build] generating Prisma client..."
bun run db:generate

echo "[build] building Next.js (standalone)..."
bun run build

if [ ! -d ".next/standalone" ]; then
  echo "ERROR: .next/standalone not produced by the build."
  echo "Check next.config.ts has output: 'standalone'."
  exit 1
fi

if [ ! -d "mini-services/realtime/node_modules" ]; then
  echo "[build] installing realtime mini-service deps..."
  ( cd mini-services/realtime && bun install )
fi

# --- 3. Build per-target ----------------------------------------------------
for TARGET in "${TARGETS[@]}"; do
  BUN_FLAG="${BUN_TARGET[$TARGET]:-}"
  BIN_NAME="${BINARY_NAME[$TARGET]:-}"
  if [ -z "${BUN_FLAG}" ] || [ -z "${BIN_NAME}" ]; then
    echo "ERROR: unknown target '${TARGET}'"
    echo "Supported: linux-x64, linux-arm64, macos-arm64, windows-x64"
    exit 1
  fi

  OUT_DIR="${DIST_DIR}/childcheck-${TARGET}"
  echo ""
  echo "[build:${TARGET}] ----------------------------------------"
  echo "[build:${TARGET}] target=${BUN_FLAG} out=${OUT_DIR}"

  # Clean + recreate the output dir.
  rm -rf "${OUT_DIR}"
  mkdir -p "${OUT_DIR}"

  # Compile the launcher.
  echo "[build:${TARGET}] compiling launcher binary..."
  bun build "${PROJECT_ROOT}/scripts/launcher.ts" \
    --compile \
    --target="${BUN_FLAG}" \
    --outfile="${OUT_DIR}/${BIN_NAME}"

  if [ ! -f "${OUT_DIR}/${BIN_NAME}" ]; then
    echo "ERROR: compiled binary not produced at ${OUT_DIR}/${BIN_NAME}"
    exit 1
  fi

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
  # CLI (so the launcher can run `prisma db push`). We use `bun install` with
  # a stripped package.json to avoid pulling the whole tree.
  echo "[build:${TARGET}] copying prisma CLI..."
  mkdir -p "${OUT_DIR}/prisma"
  cp "prisma/schema.prisma" "${OUT_DIR}/prisma/schema.prisma"

  # Install just `prisma` into the output dir.
  ( cd "${OUT_DIR}" && bun init --no-install 2>/dev/null || true
    # Write a minimal package.json so bun install works.
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
    bun install --production
  )

  # Copy the realtime mini-service (source + node_modules).
  echo "[build:${TARGET}] copying realtime mini-service..."
  mkdir -p "${OUT_DIR}/mini-services"
  cp -R "mini-services/realtime" "${OUT_DIR}/mini-services/realtime"

  # Create empty data/db/config dirs (the launcher will populate them).
  mkdir -p "${OUT_DIR}/data" "${OUT_DIR}/db" "${OUT_DIR}/config"

  # Drop a README in the output dir so users know what they have.
  cat > "${OUT_DIR}/README.txt" <<EOF
ChildCheck ${TARGET}
======================

This directory contains a self-contained ChildCheck deployment.

Files:
  ${BIN_NAME}                The launcher binary (run this).
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
  2. ./${BIN_NAME}
  3. Open http://localhost:3000/setup and complete the first-run wizard.

Run \`${BIN_NAME} help\` for all commands.
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
