#!/usr/bin/env bash
# =============================================================================
# ChildCheck — native update script.
#
# Updates a native (non-Docker) ChildCheck install in place. Safe + idempotent:
#   1. Detects the install (Linux: /opt/childcheck, macOS: /Applications/ChildCheck,
#      Synology: /volume1/@appstore/ChildCheck) or accepts --dir.
#   2. Stops the service (systemctl / launchctl / pkill).
#   3. Backs up the current binary + DB to <install>.bak.<timestamp>.
#      NEVER touches data/ or config/ (those are symlinked into the install dir).
#   4. Downloads the latest (or --version vX.Y.Z) release tarball from GitHub.
#   5. Extracts the tarball into the install dir, preserving the data/db/config
#      symlinks.
#   6. Runs `childcheck db-push` to apply any schema migrations.
#   7. Restarts the service.
#   8. Waits for the health endpoint (/api/config) to come back.
#   9. Prints the result + rollback instructions if it failed.
#
# Usage:
#   sudo bash install/childcheck-update.sh                          # latest release
#   sudo bash install/childcheck-update.sh --version v1.2.0         # specific version
#   sudo bash install/childcheck-update.sh --repo childcheck/childcheck
#   sudo bash install/childcheck-update.sh --dir /opt/childcheck
#   sudo bash install/childcheck-update.sh --health-url http://localhost:3000/api/config
#
# For Docker installs, do NOT use this script. Instead:
#   docker compose pull && docker compose up -d
#
# Env vars:
#   CHILDCHECK_UPDATE_REPO   GitHub repo slug (default: childcheck/childcheck)
#   CHILDCHECK_VERSION         Pin a version (same as --version)
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults + arg parsing
# ---------------------------------------------------------------------------
REPO="${CHILDCHECK_UPDATE_REPO:-childcheck/childcheck}"
VERSION="${CHILDCHECK_VERSION:-}"
INSTALL_DIR=""
HEALTH_URL=""
SERVICE_NAME="childcheck"
PLATFORM=""
ARCH=""
BINARY_NAME="childcheck"
NO_RESTART=0
SKIP_DB_PUSH=0
HEALTH_TIMEOUT=120   # seconds to wait for the service to come back

usage() {
  sed -n '2,40p' "$0"
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --version)      VERSION="$2"; shift 2 ;;
    --repo)         REPO="$2"; shift 2 ;;
    --dir)          INSTALL_DIR="$2"; shift 2 ;;
    --health-url)   HEALTH_URL="$2"; shift 2 ;;
    --service-name) SERVICE_NAME="$2"; shift 2 ;;
    --no-restart)   NO_RESTART=1; shift ;;
    --skip-db-push) SKIP_DB_PUSH=1; shift ;;
    --help|-h)      usage ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; NC=$'\033[0m'
info()  { echo "${GREEN}[info]${NC}  $*"; }
warn()  { echo "${YELLOW}[warn]${NC}  $*"; }
err()   { echo "${RED}[error]${NC} $*" >&2; }
step()  { echo ""; echo "${CYAN}==>${NC} $*"; }

print_rollback() {
  local backup_dir="$1"
  cat <<EOF

${YELLOW}=== Rollback instructions ===${NC}
If the new version doesn't come up cleanly, roll back:

  sudo ${SERVICE_CTL_STOP}
  sudo mv ${INSTALL_DIR} ${INSTALL_DIR}.failed-update
  sudo mv ${backup_dir} ${INSTALL_DIR}
  sudo ${SERVICE_CTL_START}

If the schema was migrated forward and the rollback fails because the old
binary doesn't understand the new schema, restore the DB backup:

  sudo ${SERVICE_CTL_STOP}
  sudo cp ${backup_dir}/db/custom.db ${DATA_DIR_DB_PATH:-<your-db-path>}/custom.db
  sudo ${SERVICE_CTL_START}

EOF
}

# ---------------------------------------------------------------------------
# Detect platform + arch
# ---------------------------------------------------------------------------
OS_KERNEL="$(uname -s)"
ARCH_RAW="$(uname -m)"
case "${OS_KERNEL}" in
  Linux)
    PLATFORM="linux"
    case "${ARCH_RAW}" in
      x86_64|amd64)  ARCH="x64" ;;
      aarch64|arm64) ARCH="arm64" ;;
      *) err "unsupported Linux arch: ${ARCH_RAW}"; exit 1 ;;
    esac
    ;;
  Darwin)
    PLATFORM="macos"
    case "${ARCH_RAW}" in
      arm64) ARCH="arm64" ;;
      x86_64) ARCH="x64" ;;
      *) err "unsupported macOS arch: ${ARCH_RAW} (only Apple Silicon prebuilt)"; exit 1 ;;
    esac
    ;;
  *) err "unsupported OS: ${OS_KERNEL} (use Docker instead)"; exit 1 ;;
esac
TARGET="${PLATFORM}-${ARCH}"
[ "${PLATFORM}" = "windows" ] && BINARY_NAME="childcheck.exe"

info "platform=${PLATFORM} arch=${ARCH} target=${TARGET}"

# ---------------------------------------------------------------------------
# Detect install dir + service manager
# ---------------------------------------------------------------------------
if [ -z "${INSTALL_DIR}" ]; then
  case "${PLATFORM}" in
    linux)
      # Synology uses /volume1/@appstore/ChildCheck; systemd installs use /opt/childcheck.
      if [ -d "/volume1/@appstore/ChildCheck" ] && [ -f "/volume1/@appstore/ChildCheck/childcheck" ]; then
        INSTALL_DIR="/volume1/@appstore/ChildCheck"
      elif [ -d "/opt/childcheck" ] && [ -f "/opt/childcheck/childcheck" ]; then
        INSTALL_DIR="/opt/childcheck"
      fi
      ;;
    macos)
      if [ -d "/Applications/ChildCheck" ] && [ -f "/Applications/ChildCheck/childcheck" ]; then
        INSTALL_DIR="/Applications/ChildCheck"
      fi
      ;;
  esac
fi

if [ -z "${INSTALL_DIR}" ] || [ ! -d "${INSTALL_DIR}" ]; then
  err "could not auto-detect the ChildCheck install dir."
  echo "Pass --dir /path/to/install explicitly." >&2
  exit 1
fi

if [ ! -f "${INSTALL_DIR}/${BINARY_NAME}" ]; then
  err "binary ${BINARY_NAME} not found in ${INSTALL_DIR}."
  echo "Is this actually a ChildCheck install dir?" >&2
  exit 1
fi

info "install dir: ${INSTALL_DIR}"

# Detect service manager + the start/stop commands.
SERVICE_CTL_STOP=":"
SERVICE_CTL_START=":"
if [ "${PLATFORM}" = "linux" ]; then
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE_NAME}.service"; then
    SERVICE_CTL_STOP="systemctl stop ${SERVICE_NAME}"
    SERVICE_CTL_START="systemctl start ${SERVICE_NAME}"
    info "service manager: systemd (${SERVICE_NAME}.service)"
  elif [ -f "/etc/synology_release" ] || uname -a | grep -qi synology; then
    SERVICE_CTL_STOP="pkill -f ${INSTALL_DIR}/${BINARY_NAME}"
    SERVICE_CTL_START="${INSTALL_DIR}/${BINARY_NAME} &"
    info "service manager: pkill (Synology — manual restart)"
  else
    warn "no systemd unit '${SERVICE_NAME}.service' found — assuming manual process control."
    SERVICE_CTL_STOP="pkill -f ${INSTALL_DIR}/${BINARY_NAME} || true"
    SERVICE_CTL_START="${INSTALL_DIR}/${BINARY_NAME}"
  fi
elif [ "${PLATFORM}" = "macos" ]; then
  PLIST_LABEL="org.childcheck"
  PLIST_PATH="${HOME}/Library/LaunchAgents/${PLIST_LABEL}.plist"
  if [ -f "${PLIST_PATH}" ]; then
    SERVICE_CTL_STOP="launchctl unload ${PLIST_PATH}"
    SERVICE_CTL_START="launchctl load ${PLIST_PATH}"
    info "service manager: launchd (${PLIST_LABEL})"
  else
    warn "no launchd plist at ${PLIST_PATH} — assuming manual process control."
    SERVICE_CTL_STOP="pkill -f ${INSTALL_DIR}/${BINARY_NAME} || true"
    SERVICE_CTL_START="${INSTALL_DIR}/${BINARY_NAME}"
  fi
fi

# Health URL fallback: derive from NEXTAUTH_URL or assume localhost:3000.
if [ -z "${HEALTH_URL}" ]; then
  if [ -n "${NEXTAUTH_URL:-}" ]; then
    HEALTH_URL="${NEXTAUTH_URL}/api/config"
  else
    HEALTH_URL="http://localhost:3000/api/config"
  fi
fi
info "health url: ${HEALTH_URL}"

# ---------------------------------------------------------------------------
# Must be root for linux systemd / opt writes
# ---------------------------------------------------------------------------
if [ "${PLATFORM}" = "linux" ] && [ "$(id -u)" -ne 0 ]; then
  err "run as root (use sudo)."
  exit 1
fi

# ---------------------------------------------------------------------------
# Resolve version + download URL
# ---------------------------------------------------------------------------
if [ -z "${VERSION}" ]; then
  step "resolving latest release for ${REPO}…"
  API_URL="https://api.github.com/repos/${REPO}/releases/latest"
  API_RES="$(curl -fsSL -H "Accept: application/vnd.github+json" \
                  -H "User-Agent: ChildCheck-update-script" \
                  "${API_URL}")" || {
    err "failed to fetch latest release from ${API_URL}"
    exit 1
  }
  TAG="$(printf '%s' "${API_RES}" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name":[[:space:]]*"([^"]+)".*/\1/')"
  if [ -z "${TAG}" ]; then
    err "could not parse tag_name from GitHub response."
    exit 1
  fi
  VERSION="${TAG}"
fi

# Normalise: strip a leading 'v' for the URL path, keep it for display.
TAG_FOR_URL="${VERSION#v}"
TARBALL_NAME="childcheck-${TARGET}.tar.gz"
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/v${TAG_FOR_URL}/${TARBALL_NAME}"

step "update plan"
echo "  repo:         ${REPO}"
echo "  version:      ${VERSION}"
echo "  target:       ${TARGET}"
echo "  tarball:      ${TARBALL_NAME}"
echo "  download url: ${DOWNLOAD_URL}"
echo "  install dir:  ${INSTALL_DIR}"
echo "  health url:   ${HEALTH_URL}"
echo ""
read -r -p "Proceed? [y/N] " yn
case "${yn}" in
  y|Y|yes|YES) ;;
  *) echo "aborted."; exit 0 ;;
esac

# ---------------------------------------------------------------------------
# 1. Stop the service
# ---------------------------------------------------------------------------
step "stopping service"
if [ "${NO_RESTART}" -eq 1 ]; then
  info "skipping (--no-restart)"
else
  # shellcheck disable=SC2086
  ${SERVICE_CTL_STOP} || warn "stop command returned non-zero (may already be stopped)"
  info "service stopped."
fi

# ---------------------------------------------------------------------------
# 2. Backup the binary + DB + schema (NOT data/ or config/).
# ---------------------------------------------------------------------------
TIMESTAMP="$(date +%Y%m%d%H%M%S)"
BACKUP_DIR="${INSTALL_DIR}.bak.${TIMESTAMP}"
step "backing up to ${BACKUP_DIR}"
mkdir -p "${BACKUP_DIR}"

# Copy the binary itself.
cp -a "${INSTALL_DIR}/${BINARY_NAME}" "${BACKUP_DIR}/${BINARY_NAME}"

# Copy server.js + .next + public + prisma (the code bundle).
for item in server.js .next public prisma mini-services; do
  if [ -e "${INSTALL_DIR}/${item}" ]; then
    cp -a "${INSTALL_DIR}/${item}" "${BACKUP_DIR}/${item}"
  fi
done

# Copy the DB file if it lives in the install dir (it might be a symlink to a
# data dir; follow it so we have a real backup).
DB_FILE=""
for candidate in "${INSTALL_DIR}/db/custom.db" "${INSTALL_DIR}/db/database.db"; do
  if [ -e "${candidate}" ]; then
    DB_FILE="${candidate}"
    break
  fi
done
if [ -n "${DB_FILE}" ]; then
  mkdir -p "${BACKUP_DIR}/db"
  cp -aL "${DB_FILE}" "${BACKUP_DIR}/db/custom.db"
  info "backed up DB: ${DB_FILE} → ${BACKUP_DIR}/db/custom.db"
  export DATA_DIR_DB_PATH="$(dirname "$(readlink -f "${DB_FILE}")")"
fi

info "backup complete: ${BACKUP_DIR}"

# ---------------------------------------------------------------------------
# 3. Download the release tarball
# ---------------------------------------------------------------------------
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT
step "downloading ${DOWNLOAD_URL}"
curl -fSL -o "${WORK_DIR}/${TARBALL_NAME}" "${DOWNLOAD_URL}" || {
  err "download failed."
  print_rollback "${BACKUP_DIR}"
  exit 1
}
info "downloaded $(du -h "${WORK_DIR}/${TARBALL_NAME}" | cut -f1)"

# ---------------------------------------------------------------------------
# 4. Extract over the install dir, preserving data/db/config symlinks
# ---------------------------------------------------------------------------
step "extracting"
EXTRACT_DIR="${WORK_DIR}/extracted"
mkdir -p "${EXTRACT_DIR}"
tar -xzf "${WORK_DIR}/${TARBALL_NAME}" -C "${EXTRACT_DIR}"

# The tarball contains a single top-level childcheck-${TARGET}/ dir.
SRC_DIR="$(find "${EXTRACT_DIR}" -maxdepth 1 -mindepth 1 -type d | head -1)"
if [ -z "${SRC_DIR}" ]; then
  err "tarball did not contain a top-level directory."
  print_rollback "${BACKUP_DIR}"
  exit 1
fi

# Remove the runtime symlinks/data dirs from the install (we'll preserve them).
# These are created by the install scripts as symlinks into /var/lib/childcheck
# (Linux) or ~/Library/Application Support/ChildCheck (macOS). NEVER overwrite
# the data they point to.
for runtime_dir in data db config; do
  if [ -e "${INSTALL_DIR}/${runtime_dir}" ] || [ -L "${INSTALL_DIR}/${runtime_dir}" ]; then
    # Save the symlink target (or the dir itself).
    mv "${INSTALL_DIR}/${runtime_dir}" "${WORK_DIR}/preserved-${runtime_dir}"
  fi
done

# Copy the new code over the install dir (clobbers old binary + server.js + .next + public + prisma).
cp -Rf "${SRC_DIR}/." "${INSTALL_DIR}/"

# Restore the preserved data/db/config symlinks (or dirs).
for runtime_dir in data db config; do
  if [ -e "${WORK_DIR}/preserved-${runtime_dir}" ]; then
    # Remove whatever the tarball dropped in (shouldn't be there, but be safe).
    rm -rf "${INSTALL_DIR}/${runtime_dir}"
    mv "${WORK_DIR}/preserved-${runtime_dir}" "${INSTALL_DIR}/${runtime_dir}"
  fi
done

# Make sure the binary is executable.
chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
info "extracted to ${INSTALL_DIR}"

# ---------------------------------------------------------------------------
# 5. Run db:push to apply any schema migrations
# ---------------------------------------------------------------------------
if [ "${SKIP_DB_PUSH}" -eq 1 ]; then
  step "skipping db:push (--skip-db-push)"
else
  step "running db:push (schema migration)"
  ( cd "${INSTALL_DIR}" && "./${BINARY_NAME}" db-push ) || {
    err "db:push failed."
    print_rollback "${BACKUP_DIR}"
    exit 1
  }
  info "db:push complete."
fi

# ---------------------------------------------------------------------------
# 6. Restart the service
# ---------------------------------------------------------------------------
if [ "${NO_RESTART}" -eq 1 ]; then
  step "skipping restart (--no-restart)"
else
  step "restarting service"
  # shellcheck disable=SC2086
  ${SERVICE_CTL_START} || {
    err "start command returned non-zero."
    print_rollback "${BACKUP_DIR}"
    exit 1
  }
  info "service started."
fi

# ---------------------------------------------------------------------------
# 7. Health check
# ---------------------------------------------------------------------------
if [ "${NO_RESTART}" -eq 1 ]; then
  step "skipping health check (--no-restart)"
else
  step "waiting for health endpoint (${HEALTH_TIMEOUT}s timeout)"
  HEALTH_OK=0
  for i in $(seq 1 "${HEALTH_TIMEOUT}"); do
    if curl -fsS --max-time 3 "${HEALTH_URL}" >/dev/null 2>&1; then
      HEALTH_OK=1
      info "healthy after ${i}s."
      break
    fi
    sleep 1
  done
  if [ "${HEALTH_OK}" -ne 1 ]; then
    err "service did not become healthy within ${HEALTH_TIMEOUT}s."
    print_rollback "${BACKUP_DIR}"
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# 8. Done
# ---------------------------------------------------------------------------
step "update complete"
echo "  ${GREEN}version:${NC}  ${VERSION}"
echo "  ${GREEN}install:${NC}  ${INSTALL_DIR}"
echo "  ${GREEN}backup:${NC}   ${BACKUP_DIR}"
echo ""
info "verify the install:"
echo "    ${BINARY_NAME} version    # in ${INSTALL_DIR}"
echo "    curl -s ${HEALTH_URL} | jq .orgType"
echo ""
warn "if anything looks wrong, roll back using the instructions above."
