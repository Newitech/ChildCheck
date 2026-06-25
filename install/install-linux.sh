#!/usr/bin/env bash
# =============================================================================
# ChildCheck — Linux installer (systemd)
#
# What it does:
#   1. Creates a `childcheck` system user + group (no shell, no home).
#   2. Installs the pre-built binary to /opt/childcheck/ (or uses an existing
#      install if present, asking before overwriting).
#   3. Creates /var/lib/childcheck/{data,db,config} with correct perms.
#   4. Writes a default .env (prompting for NEXTAUTH_SECRET if not set).
#   5. Writes /etc/systemd/system/childcheck.service.
#   6. Enables + starts the service.
#   7. Prints the URL + first-run setup instructions.
#
# Idempotent: re-running updates the binary + service file in place; data is
# NEVER touched.
#
# Usage:
#   sudo bash install/install-linux.sh                       # download latest release
#   sudo bash install/install-linux.sh /path/to/tarball      # use local tarball
#   sudo bash install/install-linux.sh /path/to/dir          # use unpacked dir
#
# Environment variables (optional):
#   CHILDCHECK_VERSION     Version to download (default: latest)
#   CHILDCHECK_URL         Direct download URL (overrides version)
#   CHILDCHECK_URL_BASE    Base URL for downloads (default: https://github.com/childcheck/childcheck/releases/download)
# =============================================================================
set -euo pipefail

# Must be root.
if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: run this script as root (use sudo)."
  exit 1
fi

# Detect arch.
ARCH="$(uname -m)"
case "${ARCH}" in
  x86_64|amd64)  TARGET="linux-x64" ;;
  aarch64|arm64) TARGET="linux-arm64" ;;
  *)
    echo "ERROR: unsupported architecture ${ARCH}"
    echo "Supported: x86_64 (linux-x64), aarch64 (linux-arm64)."
    exit 1
    ;;
esac

INSTALL_DIR="/opt/childcheck"
DATA_DIR="/var/lib/childcheck"
SERVICE_USER="childcheck"
SERVICE_GROUP="childcheck"
SERVICE_FILE="/etc/systemd/system/childcheck.service"
BINARY_NAME="childcheck"

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
    # Tarball or single binary.
    info "using local file: ${SOURCE_PATH}"
    case "${SOURCE_PATH}" in
      *.tar.gz|*.tgz)
        tar -xzf "${SOURCE_PATH}" -C "${WORK_DIR}"
        # Find the unpacked childcheck-* dir.
        SRC_DIR="$(find "${WORK_DIR}" -maxdepth 1 -type d -name 'childcheck*' | head -n1)"
        ;;
      *)
        # Assume a single binary file. Set up a minimal dir.
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
  # Download.
  VERSION="${CHILDCHECK_VERSION:-latest}"
  URL_BASE="${CHILDCHECK_URL_BASE:-https://github.com/childcheck/childcheck/releases/download}"
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
    err "neither curl nor wget is installed — install one and retry."
    exit 1
  fi
  tar -xzf "${WORK_DIR}/childcheck.tar.gz" -C "${WORK_DIR}"
  SRC_DIR="$(find "${WORK_DIR}" -maxdepth 1 -type d -name 'childcheck*' | head -n1)"
  if [ -z "${SRC_DIR}" ]; then
    err "could not find unpacked childcheck-* directory."
    exit 1
  fi
fi

if [ ! -f "${SRC_DIR}/${BINARY_NAME}" ]; then
  err "expected binary not found at ${SRC_DIR}/${BINARY_NAME}"
  err "contents of source dir:"
  ls -la "${SRC_DIR}" >&2
  exit 1
fi

# ----------------------------------------------------------------------------
# 1. Create service user + group
# ----------------------------------------------------------------------------
step "Creating service user '${SERVICE_USER}'"
if id "${SERVICE_USER}" >/dev/null 2>&1; then
  info "user '${SERVICE_USER}' already exists — leaving as-is."
else
  useradd --system --no-create-home --shell /usr/sbin/nologin "${SERVICE_USER}"
  info "created system user '${SERVICE_USER}'."
fi

# ----------------------------------------------------------------------------
# 2. Install to /opt/childcheck
# ----------------------------------------------------------------------------
step "Installing to ${INSTALL_DIR}"
if [ -d "${INSTALL_DIR}" ] && [ -f "${INSTALL_DIR}/${BINARY_NAME}" ]; then
  warn "an existing install is present at ${INSTALL_DIR}."
  read -r -p "Overwrite? [y/N] " OVERWRITE </dev/tty
  if [[ ! "${OVERWRITE}" =~ ^[Yy]$ ]]; then
    info "keeping existing install. Aborting."
    exit 0
  fi
  # Stop the service before overwriting.
  systemctl stop "${SERVICE_USER}" 2>/dev/null || true
  # Move the old install aside (don't delete — backup).
  BACKUP_DIR="${INSTALL_DIR}.bak.$(date +%Y%m%d%H%M%S)"
  mv "${INSTALL_DIR}" "${BACKUP_DIR}"
  info "backed up old install to ${BACKUP_DIR}"
fi

mkdir -p "${INSTALL_DIR}"
# Copy everything (binary + server.js + .next + public + prisma + node_modules
# + mini-services). Don't copy data/db/config from source — those will be
# symlinked to /var/lib/childcheck below.
cp -R "${SRC_DIR}/." "${INSTALL_DIR}/"
# Remove the source's empty data/db/config dirs so we can symlink ours.
rm -rf "${INSTALL_DIR}/data" "${INSTALL_DIR}/db" "${INSTALL_DIR}/config"
chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "${INSTALL_DIR}"
info "installed to ${INSTALL_DIR}."

# ----------------------------------------------------------------------------
# 3. Data dir at /var/lib/childcheck
# ----------------------------------------------------------------------------
step "Creating data directory ${DATA_DIR}"
mkdir -p "${DATA_DIR}/data/photos" \
         "${DATA_DIR}/data/branding" \
         "${DATA_DIR}/data/backups" \
         "${DATA_DIR}/db" \
         "${DATA_DIR}/config"
chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "${DATA_DIR}"
chmod 750 "${DATA_DIR}"
# Symlink so the binary finds data/db/config in its own dir.
ln -sfn "${DATA_DIR}/data"   "${INSTALL_DIR}/data"
ln -sfn "${DATA_DIR}/db"     "${INSTALL_DIR}/db"
ln -sfn "${DATA_DIR}/config" "${INSTALL_DIR}/config"
info "data dir ready at ${DATA_DIR}."

# ----------------------------------------------------------------------------
# 4. .env file
# ----------------------------------------------------------------------------
step "Configuring environment"
ENV_FILE="${DATA_DIR}/config/.env"
if [ -f "${ENV_FILE}" ]; then
  info ".env already exists at ${ENV_FILE} — leaving as-is."
else
  # Determine the public URL. Default to the box's primary IP.
  DEFAULT_URL="http://localhost:3000"
  if command -v hostname >/dev/null 2>&1; then
    IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
    if [ -n "${IP}" ]; then
      DEFAULT_URL="http://${IP}:3000"
    fi
  fi

  read -r -p "Public URL [${DEFAULT_URL}]: " NEXTAUTH_URL </dev/tty
  NEXTAUTH_URL="${NEXTAUTH_URL:-${DEFAULT_URL}}"

  # NEXTAUTH_SECRET: prompt or generate.
  read -r -p "NEXTAUTH_SECRET (blank = auto-generate): " NEXTAUTH_SECRET </dev/tty
  if [ -z "${NEXTAUTH_SECRET}" ]; then
    if command -v openssl >/dev/null 2>&1; then
      NEXTAUTH_SECRET="$(openssl rand -hex 32)"
    else
      NEXTAUTH_SECRET="$(head -c 32 /dev/urandom | xxd -p | tr -d '\n')"
    fi
    info "generated NEXTAUTH_SECRET."
  fi

  # CHILDCHECK_DATA_KEY: prompt or generate.
  read -r -p "CHILDCHECK_DATA_KEY for photo/backup encryption (blank = auto-generate): " CHILDCHECK_DATA_KEY </dev/tty
  if [ -z "${CHILDCHECK_DATA_KEY}" ]; then
    if command -v openssl >/dev/null 2>&1; then
      CHILDCHECK_DATA_KEY="$(openssl rand -hex 32)"
    else
      CHILDCHECK_DATA_KEY="$(head -c 32 /dev/urandom | xxd -p | tr -d '\n')"
    fi
    info "generated CHILDCHECK_DATA_KEY (SAVE THIS — losing it loses access to existing photos/backups)."
  fi

  cat > "${ENV_FILE}" <<EOF
# ChildCheck environment — generated by install-linux.sh on $(date)
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
  chown "${SERVICE_USER}:${SERVICE_GROUP}" "${ENV_FILE}"
  info ".env written to ${ENV_FILE} (chmod 600)."
fi

# ----------------------------------------------------------------------------
# 5. systemd unit
# ----------------------------------------------------------------------------
step "Writing systemd unit ${SERVICE_FILE}"
cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=ChildCheck — secure child check-in / check-out
Documentation=https://github.com/childcheck/childcheck
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${INSTALL_DIR}/${BINARY_NAME}
Restart=on-failure
RestartSec=5s
TimeoutStopSec=15s
KillSignal=SIGTERM
# Hardening
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=${DATA_DIR} ${INSTALL_DIR}
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=yes
LockPersonality=yes
MemoryDenyWriteExecute=no
# Next.js + Bun need JIT/mmap; don't restrict memory writes.

[Install]
WantedBy=multi-user.target
EOF
chmod 644 "${SERVICE_FILE}"
info "service file written."

# ----------------------------------------------------------------------------
# 6. Enable + start
# ----------------------------------------------------------------------------
step "Enabling + starting service"
systemctl daemon-reload
systemctl enable "${SERVICE_USER}"
systemctl restart "${SERVICE_USER}"
info "service enabled + started."

# Wait for it to come up (poll /api/config).
step "Waiting for service to come up"
OK=0
for i in $(seq 1 30); do
  if curl -fsS "http://localhost:3000/api/config" >/dev/null 2>&1; then
    OK=1
    break
  fi
  sleep 1
done
if [ "${OK}" -ne 1 ]; then
  warn "service did not respond on http://localhost:3000/api/config within 30s."
  warn "check logs with:  journalctl -u ${SERVICE_USER} -f"
else
  info "service is up."
fi

# ----------------------------------------------------------------------------
# 7. Print summary
# ----------------------------------------------------------------------------
PUBLIC_URL="$(grep -E '^NEXTAUTH_URL=' "${ENV_FILE}" | cut -d= -f2-)"

echo ""
echo "============================================================"
echo " ChildCheck installed successfully."
echo "============================================================"
echo ""
echo " Service:      systemctl status ${SERVICE_USER}"
echo " Logs:         journalctl -u ${SERVICE_USER} -f"
echo " Restart:      systemctl restart ${SERVICE_USER}"
echo " Stop:         systemctl stop ${SERVICE_USER}"
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
echo "   3. On submit, the default SDA programs are seeded automatically."
echo "   4. Sign in with the admin account → /admin → Settings to configure"
echo "      branding, terminology, and feature toggles."
echo ""
echo " IMPORTANT: back up the CHILDCHECK_DATA_KEY in ${ENV_FILE}."
echo " Losing it means existing photos + encrypted backups cannot be read."
echo "============================================================"
