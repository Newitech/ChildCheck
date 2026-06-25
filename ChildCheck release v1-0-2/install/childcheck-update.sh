#!/usr/bin/env bash
# =============================================================================
# ChildCheck — Update script (native installs)
#
# Stops the service, backs up the current install, downloads the latest
# release from GitHub, extracts it (preserving data/db/config), runs db:push,
# restarts the service, and health-checks.
#
# Usage:
#   sudo bash install/childcheck-update.sh                      # latest release
#   sudo bash install/childcheck-update.sh --version v1.1.0     # specific version
#   sudo bash install/childcheck-update.sh --repo owner/repo    # specific repo
#   sudo bash install/childcheck-update.sh --dir /opt/childcheck # specific install dir
#
# Requires: curl/wget, tar, root (for service management).
# =============================================================================
set -euo pipefail

# Defaults
REPO="${CHILDCHETECK_UPDATE_REPO:-childcheck/childcheck}"
VERSION="latest"
INSTALL_DIR=""

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --repo)    REPO="$2"; shift 2 ;;
    --dir)     INSTALL_DIR="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 [--version vX.Y.Z] [--repo owner/repo] [--dir /path/to/install]"
      exit 0 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# Must be root
if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: run this script as root (use sudo)."
  exit 1
fi

# Detect install dir if not specified
if [ -z "${INSTALL_DIR}" ]; then
  if [ -d "/opt/childcheck" ] && [ -f "/opt/childcheck/package.json" ]; then
    INSTALL_DIR="/opt/childcheck"
  elif [ -d "/Applications/ChildCheck" ]; then
    INSTALL_DIR="/Applications/ChildCheck"
  else
    echo "ERROR: could not auto-detect install directory."
    echo "Specify with: --dir /path/to/childcheck"
    exit 1
  fi
fi

echo "[update] Install dir: ${INSTALL_DIR}"
echo "[update] Repo: ${REPO}"
echo "[update] Version: ${VERSION}"

# Detect service manager
SERVICE_NAME="childcheck"
USE_SYSTEMD=false
USE_LAUNCHD=false
if command -v systemctl >/dev/null 2>&1 && systemctl is-enabled "${SERVICE_NAME}" >/dev/null 2>&1; then
  USE_SYSTEMD=true
elif [ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]; then
  USE_SYSTEMD=true
elif [ -f "$HOME/Library/LaunchAgents/org.childcheck.plist" ]; then
  USE_LAUNCHD=true
fi

# --- 1. Stop the service ---
echo "[update] Stopping service..."
if ${USE_SYSTEMD}; then
  systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
elif ${USE_LAUNCHD}; then
  launchctl unload "$HOME/Library/LaunchAgents/org.childcheck.plist" 2>/dev/null || true
fi

# --- 2. Backup ---
BACKUP_DIR="${INSTALL_DIR}.bak.$(date +%Y%m%d%H%M%S)"
echo "[update] Backing up current install to ${BACKUP_DIR}..."
cp -R "${INSTALL_DIR}" "${BACKUP_DIR}"

# --- 3. Download the release ---
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

if [ "${VERSION}" = "latest" ]; then
  DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/childcheck-linux-x64.tar.gz"
else
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/childcheck-linux-x64.tar.gz"
fi
echo "[update] Downloading ${DOWNLOAD_URL}..."
if command -v curl >/dev/null 2>&1; then
  curl -fL "${DOWNLOAD_URL}" -o "${WORK_DIR}/childcheck.tar.gz"
else
  wget -O "${WORK_DIR}/childcheck.tar.gz" "${DOWNLOAD_URL}"
fi

# --- 4. Extract (preserving data/db/config) ---
echo "[update] Extracting..."
# Remove old source files (but preserve data/db/config symlinks + .env)
cd "${INSTALL_DIR}"
# Save what we need to preserve
PRESERVE_LIST=""
for item in data db config .env package-lock.json bun.lock; do
  if [ -e "${item}" ]; then
    PRESERVE_LIST="${PRESERVE_LIST} ${item}"
  fi
done
# Remove everything except preserved items
find . -maxdepth 1 -mindepth 1 ! -name "data" ! -name "db" ! -name "config" ! -name ".env" ! -name "package-lock.json" ! -name "bun.lock" -exec rm -rf {} +
# Extract new files
tar -xzf "${WORK_DIR}/childcheck.tar.gz" -C "${INSTALL_DIR}" --strip-components=1

# --- 5. Run db:push (schema migration) ---
echo "[update] Running db:push..."
cd "${INSTALL_DIR}"
if [ -f "childcheck" ]; then
  # Bun standalone binary
  ./childcheck db-push
elif command -v bun >/dev/null 2>&1; then
  bun run db:push
elif command -v npx >/dev/null 2>&1; then
  npx prisma db push --skip-generate
fi

# --- 6. Restart ---
echo "[update] Restarting service..."
if ${USE_SYSTEMD}; then
  systemctl restart "${SERVICE_NAME}"
elif ${USE_LAUNCHD}; then
  launchctl load "$HOME/Library/LaunchAgents/org.childcheck.plist"
fi

# --- 7. Health check ---
echo "[update] Waiting for service to come up..."
OK=0
for i in $(seq 1 30); do
  if curl -fsS "http://localhost:3000/api/config" >/dev/null 2>&1; then
    OK=1
    break
  fi
  sleep 1
done

if [ "${OK}" -ne 1 ]; then
  echo ""
  echo "[update] WARNING: service did not respond within 30s."
  echo "         Check logs: journalctl -u ${SERVICE_NAME} -f"
  echo ""
  echo "         To ROLL BACK:"
  echo "           1. Stop: systemctl stop ${SERVICE_NAME}"
  echo "           2. Restore: rm -rf ${INSTALL_DIR} && mv ${BACKUP_DIR} ${INSTALL_DIR}"
  echo "           3. Restart: systemctl restart ${SERVICE_NAME}"
  exit 1
fi

echo ""
echo "[update] ✓ Update complete. Service is running."
echo "[update] Backup saved at: ${BACKUP_DIR}"
echo "[update] To roll back: stop service, swap dirs, restart."
