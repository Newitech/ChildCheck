#!/usr/bin/env bash
# =============================================================================
# ChildCheck — Synology DSM installer
#
# Synology NAS devices run DSM (a BusyBox-based Linux). They don't use systemd
# or launchd; instead, "scheduled tasks" launched at boot are the standard way
# to run a long-lived service. This script:
#
#   1. Installs the pre-built binary to /volume1/@appstore/ChildCheck/.
#   2. Creates /volume1/childcheck/{data,db,config,logs}.
#   3. Writes a default .env (prompting for NEXTAUTH_SECRET if not set).
#   4. Creates a synoservice-style start script.
#   5. Registers a "User-defined script" scheduled task via the synoservicectl
#      / synotask CLI (or, if unavailable, prints instructions for the user
#      to add the task manually via the DSM web UI).
#   6. Starts the service.
#   7. Prints the URL + first-run setup instructions.
#
# Requires:
#   - SSH access to the Synology NAS (Control Panel → Terminal & SNMP → Enable SSH).
#   - Run as root (sudo -i).
#   - DSM 7+ (the @appstore path + synoservicectl are DSM 7+ conventions).
#
# Usage (run on the NAS over SSH, as root):
#   bash install/install-nas-synology.sh                       # download latest
#   bash install/install-nas-synology.sh /path/to/tarball      # use local tarball
# =============================================================================
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: run this script as root (sudo -i)."
  exit 1
fi

# Detect arch.
ARCH="$(uname -m)"
case "${ARCH}" in
  x86_64|amd64)  TARGET="linux-x64" ;;
  aarch64|arm64) TARGET="linux-arm64" ;;
  *)
    echo "ERROR: unsupported architecture ${ARCH}."
    echo "Synology ARMv7 (armhf) devices are NOT supported by the prebuilt binaries."
    echo "Use Docker (if your NAS supports Container Manager) or build from source."
    exit 1
    ;;
esac

INSTALL_DIR="/volume1/@appstore/ChildCheck"
DATA_DIR="/volume1/childcheck"
LOG_DIR="${DATA_DIR}/logs"
BINARY_NAME="childcheck"
SERVICE_NAME="childcheck"
START_SCRIPT="/usr/local/bin/childcheck-start.sh"

# Colors.
RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; NC=$'\033[0m'
info()  { echo "${GREEN}[info]${NC}  $*"; }
warn()  { echo "${YELLOW}[warn]${NC}  $*"; }
err()   { echo "${RED}[error]${NC} $*" >&2; }
step()  { echo ""; echo "${CYAN}==>${NC} $*"; }

# ----------------------------------------------------------------------------
# 0. Parse args / locate the binary
# ----------------------------------------------------------------------------
SOURCE_PATH="${1:-}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

if [ -n "${SOURCE_PATH}" ]; then
  if [ -f "${SOURCE_PATH}" ]; then
    info "using local file: ${SOURCE_PATH}"
    case "${SOURCE_PATH}" in
      *.tar.gz|*.tgz)
        tar -xzf "${SOURCE_PATH}" -C "${WORK_DIR}"
        SRC_DIR="$(find "${WORK_DIR}" -maxdepth 1 -type d -name 'childcheck*' | head -n1)"
        ;;
      *)
        mkdir -p "${WORK_DIR}/childcheck"
        cp "${SOURCE_PATH}" "${WORK_DIR}/childcheck/${BINARY_NAME}"
        chmod +x "${WORK_DIR}/childcheck/${BINARY_NAME}"
        SRC_DIR="${WORK_DIR}/childcheck"
        ;;
    esac
  elif [ -d "${SOURCE_PATH}" ]; then
    info "using local directory: ${SOURCE_PATH}"
    SRC_DIR="${SOURCE_PATH}"
  else
    err "source path does not exist: ${SOURCE_PATH}"
    exit 1
  fi
else
  URL_BASE="${CHILDCHECK_URL_BASE:-https://github.com/childcheck/childcheck/releases/download}"
  VERSION="${CHILDCHECK_VERSION:-latest}"
  if [ -n "${CHILDCHECK_URL:-}" ]; then
    URL="${CHILDCHECK_URL}"
  elif [ "${VERSION}" = "latest" ]; then
    URL="${URL_BASE}/latest/childcheck-${TARGET}.tar.gz"
  else
    URL="${URL_BASE}/v${VERSION}/childcheck-${TARGET}.tar.gz"
  fi
  step "Downloading ${URL}"
  if command -v curl >/dev/null 2>&1; then
    curl -fL "${URL}" -o "${WORK_DIR}/childcheck.tar.gz"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "${WORK_DIR}/childcheck.tar.gz" "${URL}"
  else
    err "neither curl nor wget is available. Install one and retry."
    exit 1
  fi
  tar -xzf "${WORK_DIR}/childcheck.tar.gz" -C "${WORK_DIR}"
  SRC_DIR="$(find "${WORK_DIR}" -maxdepth 1 -type d -name 'childcheck*' | head -n1)"
fi

if [ ! -f "${SRC_DIR}/${BINARY_NAME}" ]; then
  err "expected binary not found at ${SRC_DIR}/${BINARY_NAME}"
  exit 1
fi

# ----------------------------------------------------------------------------
# 1. Install to /volume1/@appstore/ChildCheck
# ----------------------------------------------------------------------------
step "Installing to ${INSTALL_DIR}"
mkdir -p "$(dirname "${INSTALL_DIR}")"
if [ -d "${INSTALL_DIR}" ] && [ -f "${INSTALL_DIR}/${BINARY_NAME}" ]; then
  warn "an existing install is present at ${INSTALL_DIR}."
  read -r -p "Overwrite? [y/N] " OVERWRITE </dev/tty
  if [[ ! "${OVERWRITE}" =~ ^[Yy]$ ]]; then
    info "keeping existing install. Aborting."
    exit 0
  fi
  # Try to stop the service before overwriting.
  if command -v synoservicectl >/dev/null 2>&1; then
    synoservicectl --stop "${SERVICE_NAME}" 2>/dev/null || true
  fi
  pkill -f "${INSTALL_DIR}/${BINARY_NAME}" 2>/dev/null || true
  BACKUP_DIR="${INSTALL_DIR}.bak.$(date +%Y%m%d%H%M%S)"
  mv "${INSTALL_DIR}" "${BACKUP_DIR}"
  info "backed up old install to ${BACKUP_DIR}"
fi

mkdir -p "${INSTALL_DIR}"
cp -R "${SRC_DIR}/." "${INSTALL_DIR}/"
rm -rf "${INSTALL_DIR}/data" "${INSTALL_DIR}/db" "${INSTALL_DIR}/config"
chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
info "installed to ${INSTALL_DIR}."

# ----------------------------------------------------------------------------
# 2. Data dir at /volume1/childcheck
# ----------------------------------------------------------------------------
step "Creating data directory ${DATA_DIR}"
mkdir -p "${DATA_DIR}/data/photos" \
         "${DATA_DIR}/data/branding" \
         "${DATA_DIR}/data/backups" \
         "${DATA_DIR}/db" \
         "${DATA_DIR}/config" \
         "${LOG_DIR}"
# Set ownership: most Synology boxes have an 'admin' group; the root user owns
# the install. Use 750 for the data dir.
chmod 750 "${DATA_DIR}"
# Symlink so the binary finds data/db/config in its own dir.
ln -sfn "${DATA_DIR}/data"   "${INSTALL_DIR}/data"
ln -sfn "${DATA_DIR}/db"     "${INSTALL_DIR}/db"
ln -sfn "${DATA_DIR}/config" "${INSTALL_DIR}/config"
info "data dir ready at ${DATA_DIR}."

# ----------------------------------------------------------------------------
# 3. .env file
# ----------------------------------------------------------------------------
step "Configuring environment"
ENV_FILE="${DATA_DIR}/config/.env"
if [ -f "${ENV_FILE}" ]; then
  info ".env already exists at ${ENV_FILE} — leaving as-is."
else
  # Synology: try the box's primary IP.
  DEFAULT_URL="http://localhost:3000"
  IP="$(ip -4 addr show 2>/dev/null | grep -oP 'inet \K[0-9.]+' | grep -v '^127\.' | head -n1 || true)"
  if [ -n "${IP}" ]; then
    DEFAULT_URL="http://${IP}:3000"
  fi

  read -r -p "Public URL [${DEFAULT_URL}]: " NEXTAUTH_URL </dev/tty
  NEXTAUTH_URL="${NEXTAUTH_URL:-${DEFAULT_URL}}"

  read -r -p "NEXTAUTH_SECRET (blank = auto-generate): " NEXTAUTH_SECRET </dev/tty
  if [ -z "${NEXTAUTH_SECRET}" ]; then
    if command -v openssl >/dev/null 2>&1; then
      NEXTAUTH_SECRET="$(openssl rand -hex 32)"
    else
      NEXTAUTH_SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    fi
    info "generated NEXTAUTH_SECRET."
  fi

  read -r -p "CHILDCHECK_DATA_KEY for photo/backup encryption (blank = auto-generate): " CHILDCHECK_DATA_KEY </dev/tty
  if [ -z "${CHILDCHECK_DATA_KEY}" ]; then
    if command -v openssl >/dev/null 2>&1; then
      CHILDCHECK_DATA_KEY="$(openssl rand -hex 32)"
    else
      CHILDCHECK_DATA_KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    fi
    info "generated CHILDCHECK_DATA_KEY — SAVE THIS."
  fi

  cat > "${ENV_FILE}" <<EOF
# ChildCheck environment — generated by install-nas-synology.sh on $(date)
NEXTAUTH_URL=${NEXTAUTH_URL}
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
CHILDCHECK_DATA_KEY=${CHILDCHECK_DATA_KEY}
DATABASE_URL=file:${DATA_DIR}/db/custom.db
CHILDCHECK_DATA_DIR=${DATA_DIR}/data
CHILDCHECK_CONFIG_DIR=${DATA_DIR}/config
REALTIME_PORT=3003
PORT=3000
HOSTNAME=0.0.0.0
EOF
  chmod 600 "${ENV_FILE}"
  info ".env written to ${ENV_FILE} (chmod 600)."
fi

# ----------------------------------------------------------------------------
# 4. Start script
# ----------------------------------------------------------------------------
step "Writing start script ${START_SCRIPT}"
cat > "${START_SCRIPT}" <<EOF
#!/bin/sh
# ChildCheck start script — invoked by the DSM scheduled task at boot.
# Runs the launcher in the foreground; the task scheduler handles restarts.
set -e
cd "${INSTALL_DIR}"
# Load env vars from .env.
if [ -f "${ENV_FILE}" ]; then
  set -a
  . "${ENV_FILE}"
  set +a
fi
exec "${INSTALL_DIR}/${BINARY_NAME}"
EOF
chmod +x "${START_SCRIPT}"
info "start script written."

# ----------------------------------------------------------------------------
# 5. Register the boot task
# ----------------------------------------------------------------------------
step "Registering boot task"

# DSM 7+ has a `synotask` CLI we can try to use to register a user-defined
# scheduled task. If that's not available, we'll fall back to printing manual
# instructions for the user.
TASK_REGISTERED=0

if command -v synotask >/dev/null 2>&1; then
  # Try the CLI (syntax varies between DSM versions).
  if synotask --create \
      --name "childcheck" \
      --event boot \
      --user root \
      --script "${START_SCRIPT}" \
      --enable 2>/dev/null; then
    info "scheduled task registered via synotask CLI."
    TASK_REGISTERED=1
  fi
fi

if [ "${TASK_REGISTERED}" -ne 1 ]; then
  warn "Could not auto-register a scheduled task (synotask CLI not available)."
  warn "Register it manually in the DSM web UI:"
  echo ""
  echo "  1. Open DSM → Control Panel → Task Scheduler."
  echo "  2. Create → Triggered Task → User-defined script."
  echo "  3. General tab:"
  echo "       Task:     ChildCheck"
  echo "       User:     root"
  echo "       Event:    Boot-up"
  echo "       Enabled:  yes"
  echo "  4. Task Settings tab:"
  echo "       Run command: ${START_SCRIPT}"
  echo "  5. Click OK."
  echo ""
  read -r -p "Press ENTER once you've created the task... " </dev/tty
fi

# ----------------------------------------------------------------------------
# 6. Start the service now (don't wait for next boot)
# ----------------------------------------------------------------------------
step "Starting ChildCheck"
# Kill any stale instance first.
pkill -f "${INSTALL_DIR}/${BINARY_NAME}" 2>/dev/null || true
sleep 1
nohup "${START_SCRIPT}" >"${LOG_DIR}/childcheck.stdout.log" 2>"${LOG_DIR}/childcheck.stderr.log" &
echo $! > "${DATA_DIR}/childcheck.pid"
info "started (pid $(cat "${DATA_DIR}/childcheck.pid"))."

# Wait for it to come up.
OK=0
for i in $(seq 1 30); do
  if curl -fsS "http://localhost:3000/api/config" >/dev/null 2>&1; then
    OK=1
    break
  fi
  sleep 1
done
if [ "${OK}" -ne 1 ]; then
  warn "service did not respond within 30s. Check logs:"
  warn "  tail -f ${LOG_DIR}/childcheck.stderr.log"
else
  info "service is up."
fi

# ----------------------------------------------------------------------------
# 7. Summary
# ----------------------------------------------------------------------------
PUBLIC_URL="$(grep -E '^NEXTAUTH_URL=' "${ENV_FILE}" | cut -d= -f2-)"

echo ""
echo "============================================================"
echo " ChildCheck installed successfully."
echo "============================================================"
echo ""
echo " Start:        ${START_SCRIPT}  (or restart the NAS)"
echo " Stop:         pkill -f ${INSTALL_DIR}/${BINARY_NAME}"
echo " Restart:      pkill -f ${INSTALL_DIR}/${BINARY_NAME}; ${START_SCRIPT}"
echo " Logs:         tail -f ${LOG_DIR}/childcheck.stdout.log"
echo "               tail -f ${LOG_DIR}/childcheck.stderr.log"
echo ""
echo " Install dir:  ${INSTALL_DIR}"
echo " Data dir:     ${DATA_DIR}"
echo " Config:       ${ENV_FILE}"
echo ""
echo " Public URL:   ${PUBLIC_URL}"
echo " Setup wizard: ${PUBLIC_URL}/setup"
echo ""
echo " Next step:"
echo "   1. Open the Setup URL above in a browser."
echo "   2. Fill in your organisation name + first admin user."
echo "   3. Default SDA programs are seeded automatically on submit."
echo "   4. Sign in → /admin → Settings to configure branding + toggles."
echo ""
echo " IMPORTANT: back up the CHILDCHECK_DATA_KEY in ${ENV_FILE}."
echo "============================================================"
