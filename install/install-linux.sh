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
#   sudo bash install/install-linux.sh --tls                 # also install + configure Caddy for HTTPS
#
# Flags:
#   --tls          Opt-in TLS termination via Caddy. Installs Caddy from the
#                  official apt repo, generates /etc/caddy/Caddyfile from
#                  install/Caddyfile.domain (if you provide a domain) or
#                  install/Caddyfile.lan (if blank — self-signed internal CA),
#                  enables + starts the `caddy` systemd service, and rewrites
#                  NEXTAUTH_URL to https://<domain-or-host>/. Without this
#                  flag the install stays on plain HTTP (unchanged).
#
# Environment variables (optional):
#   CHILDCHECK_VERSION     Version to download (default: latest)
#   CHILDCHECK_URL         Direct download URL (overrides version)
#   CHILDCHECK_URL_BASE    Base URL for downloads (default: https://github.com/Newitech/ChildCheck/releases/download)
# =============================================================================
set -euo pipefail

# Parse `--tls` flag (anywhere in argv). Remaining args (after shift) become
# the source-path / version args handled below.
TLS_ENABLED=0
NEW_ARGS=()
for arg in "$@"; do
  case "${arg}" in
    --tls) TLS_ENABLED=1 ;;
    --help|-h)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *) NEW_ARGS+=("${arg}") ;;
  esac
done
set -- "${NEW_ARGS[@]+"${NEW_ARGS[@]}"}"

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
# Port helpers
# ----------------------------------------------------------------------------
# port_in_use(port) → 0 if something is listening on it, 1 if free.
# Tries ss first (iproute2), then /proc/net/tcp, then a /dev/tcp probe.
port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    if ss -tlnH 2>/dev/null | awk '{print $4}' | grep -E "[:.]${port}\$" >/dev/null 2>&1; then
      return 0
    fi
    return 1
  fi
  if [ -r /proc/net/tcp ]; then
    local port_hex port_dec addr
    while IFS= read -r line; do
      case "${line}" in *"local_address"*) continue ;; esac
      addr="$(awk '{print $2}' <<<"${line}")"
      [ -z "${addr}" ] && continue
      port_hex="${addr##*:}"
      [ -z "${port_hex}" ] && continue
      port_dec="$(( 16#${port_hex} ))"
      if [ "${port_dec}" -eq "${port}" ]; then
        return 0
      fi
    done < /proc/net/tcp
    if [ -r /proc/net/tcp6 ]; then
      while IFS= read -r line; do
        case "${line}" in *"local_address"*) continue ;; esac
        addr="$(awk '{print $2}' <<<"${line}")"
        [ -z "${addr}" ] && continue
        port_hex="${addr##*:}"
        [ -z "${port_hex}" ] && continue
        port_dec="$(( 16#${port_hex} ))"
        if [ "${port_dec}" -eq "${port}" ]; then
          return 0
        fi
      done < /proc/net/tcp6
    fi
    return 1
  fi
  # Last-ditch /dev/tcp probe.
  if (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null; then
    exec 3>&- 3<&-
    return 0
  fi
  return 1
}

# prompt_port(default, label) → echoes the chosen port number.
# If the default port is already in use, prompts the user for an alternative
# and validates the new value (numeric + free). Loops until a free port is
# provided (or the user explicitly accepts the default — which then fails
# later when the service tries to bind).
prompt_port() {
  local default="$1" label="$2"
  local port="${default}"

  if port_in_use "${default}"; then
    warn "port ${default} is already in use (${label})."
    # Suggest the next port up as a default alternative.
    local suggest=$(( default + 1 ))
    while port_in_use "${suggest}"; do
      suggest=$(( suggest + 1 ))
    done
    read -r -p "Use an alternative port for ${label}? [${suggest}]: " alt </dev/tty || true
    port="${alt:-${suggest}}"
    # Validate: numeric + in range.
    while ! [[ "${port}" =~ ^[0-9]+$ ]] || [ "${port}" -lt 1 ] || [ "${port}" -gt 65535 ]; do
      err "'${port}' is not a valid port (must be 1-65535)."
      read -r -p "${label} port [${suggest}]: " alt </dev/tty || true
      port="${alt:-${suggest}}"
    done
    # Validate: free.
    while port_in_use "${port}"; do
      err "port ${port} is also in use."
      read -r -p "${label} port [${suggest}]: " alt </dev/tty || true
      port="${alt:-${suggest}}"
      while ! [[ "${port}" =~ ^[0-9]+$ ]] || [ "${port}" -lt 1 ] || [ "${port}" -gt 65535 ]; do
        err "'${port}' is not a valid port (must be 1-65535)."
        read -r -p "${label} port [${suggest}]: " alt </dev/tty || true
        port="${alt:-${suggest}}"
      done
    done
    if [ "${port}" != "${default}" ]; then
      info "using ${label} port ${port} (default ${default} was in use)."
    fi
  fi
  echo "${port}"
}

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
  URL_BASE="${CHILDCHECK_URL_BASE:-https://github.com/Newitech/ChildCheck/releases}"
  if [ -n "${CHILDCHECK_URL:-}" ]; then
    URL="${CHILDCHECK_URL}"
  elif [ "${VERSION}" = "latest" ]; then
    URL="${URL_BASE}/latest/download/childcheck-${TARGET}.tar.gz"
  else
    URL="${URL_BASE}/download/v${VERSION}/childcheck-${TARGET}.tar.gz"
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
  # Pull existing PORT/REALTIME_PORT so the health-check + summary use the
  # same values the service is actually configured for.
  PORT="$(grep -E '^PORT=' "${ENV_FILE}" | cut -d= -f2- || true)"
  PORT="${PORT:-3000}"
  REALTIME_PORT="$(grep -E '^REALTIME_PORT=' "${ENV_FILE}" | cut -d= -f2- || true)"
  REALTIME_PORT="${REALTIME_PORT:-3003}"
else
  # Prompt for ports if the defaults are in use.
  step "Choosing ports (default: web 3000, realtime 3003)"
  PORT="$(prompt_port 3000 "web server")"
  REALTIME_PORT="$(prompt_port 3003 "realtime (Socket.io)")"

  # Determine the public URL. Default to the box's primary IP + chosen PORT.
  DEFAULT_URL="http://localhost:${PORT}"
  if command -v hostname >/dev/null 2>&1; then
    IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
    if [ -n "${IP}" ]; then
      DEFAULT_URL="http://${IP}:${PORT}"
    fi
  fi

  read -r -p "Public URL [${DEFAULT_URL}]: " NEXTAUTH_URL </dev/tty || true
  NEXTAUTH_URL="${NEXTAUTH_URL:-${DEFAULT_URL}}"

  # NEXTAUTH_SECRET: prompt or generate.
  read -r -p "NEXTAUTH_SECRET (blank = auto-generate): " NEXTAUTH_SECRET </dev/tty || true
  if [ -z "${NEXTAUTH_SECRET}" ]; then
    if command -v openssl >/dev/null 2>&1; then
      NEXTAUTH_SECRET="$(openssl rand -hex 32)"
    else
      NEXTAUTH_SECRET="$(head -c 32 /dev/urandom | xxd -p | tr -d '\n')"
    fi
    info "generated NEXTAUTH_SECRET."
  fi

  # CHILDCHECK_DATA_KEY: prompt or generate.
  read -r -p "CHILDCHECK_DATA_KEY for photo/backup encryption (blank = auto-generate): " CHILDCHECK_DATA_KEY </dev/tty || true
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
REALTIME_PORT=${REALTIME_PORT}
PORT=${PORT}
HOSTNAME=0.0.0.0
EOF
  chmod 600 "${ENV_FILE}"
  chown "${SERVICE_USER}:${SERVICE_GROUP}" "${ENV_FILE}"
  info ".env written to ${ENV_FILE} (chmod 600)."
  info "  PORT=${PORT}  REALTIME_PORT=${REALTIME_PORT}"
fi

# ----------------------------------------------------------------------------
# 5. systemd unit
# ----------------------------------------------------------------------------
step "Writing systemd unit ${SERVICE_FILE}"
cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=ChildCheck — secure child check-in / check-out
Documentation=https://github.com/Newitech/ChildCheck
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
  if curl -fsS "http://localhost:${PORT}/api/config" >/dev/null 2>&1; then
    OK=1
    break
  fi
  sleep 1
done
if [ "${OK}" -ne 1 ]; then
  warn "service did not respond on http://localhost:${PORT}/api/config within 30s."
  warn "check logs with:  journalctl -u ${SERVICE_USER} -f"
else
  info "service is up."
fi

# ----------------------------------------------------------------------------
# 6a. Opt-in TLS via Caddy (--tls flag)
# ----------------------------------------------------------------------------
# Install + configure Caddy so the app is served over HTTPS. The user provides
# a domain name (auto-Let's-Encrypt) OR leaves it blank for LAN-only with
# Caddy's built-in self-signed internal CA.
CADDYFILE_PATH="/etc/caddy/Caddyfile"
if [ "${TLS_ENABLED}" -eq 1 ]; then
  step "Configuring TLS via Caddy (--tls)"

  # Prompt for the domain name (blank = LAN-only self-signed).
  echo ""
  echo "  Domain name (blank for LAN-only self-signed):"
  echo "    - For a real domain (e.g. checkin.mychurch.org): Caddy auto-provisions"
  echo "      + auto-renews a Let's Encrypt cert. Ports 80 + 443 must be open."
  echo "    - Blank: Caddy uses its built-in internal CA (self-signed). Import"
  echo "      Caddy's root cert into each client's trust store — see"
  echo "      install/Caddyfile.lan for the per-OS commands."
  read -r -p "  Domain [blank for LAN-only]: " TLS_DOMAIN </dev/tty
  TLS_DOMAIN="${TLS_DOMAIN:-}"

  # Install Caddy from the official apt repo.
  # https://caddyserver.com/docs/install#debian-ubuntu-fedora-arch
  if ! command -v caddy >/dev/null 2>&1; then
    info "installing Caddy from the official apt repo."
    apt-get update -qq
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl
    # The keyring add may fail if it's already present — ignore.
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null || true
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    apt-get update -qq
    apt-get install -y -qq caddy
  else
    info "Caddy already installed — skipping apt install."
  fi

  # Locate the Caddyfile templates shipped alongside this script.
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  DOMAIN_TEMPLATE="${SCRIPT_DIR}/Caddyfile.domain"
  LAN_TEMPLATE="${SCRIPT_DIR}/Caddyfile.lan"

  # Generate /etc/caddy/Caddyfile from the appropriate template.
  mkdir -p "$(dirname "${CADDYFILE_PATH}")"
  if [ -n "${TLS_DOMAIN}" ]; then
    # Domain mode — auto-Let's-Encrypt.
    info "using DOMAIN mode (auto-Let's-Encrypt for ${TLS_DOMAIN})."
    if [ -f "${DOMAIN_TEMPLATE}" ]; then
      sed "s|{\$DOMAIN}|${TLS_DOMAIN}|g" "${DOMAIN_TEMPLATE}" > "${CADDYFILE_PATH}"
    else
      cat > "${CADDYFILE_PATH}" <<EOF
${TLS_DOMAIN} {
        reverse_proxy localhost:${PORT}
        header {
                Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
                X-Content-Type-Options "nosniff"
                X-Frame-Options "DENY"
                Referrer-Policy "strict-origin-when-cross-origin"
                Permissions-Policy "geolocation=(), microphone=(), camera=()"
        }
}
EOF
    fi
    TLS_PUBLIC_HOST="${TLS_DOMAIN}"
  else
    # LAN-only mode — tls internal (self-signed internal CA).
    info "using LAN-only mode (Caddy internal CA — self-signed)."
    if [ -f "${LAN_TEMPLATE}" ]; then
      sed "s|{\$PORT:3000}|${PORT}|g" "${LAN_TEMPLATE}" > "${CADDYFILE_PATH}"
    else
      cat > "${CADDYFILE_PATH}" <<EOF
:443 {
        tls internal
        reverse_proxy localhost:${PORT}
}
EOF
    fi
    # Use the box's primary IP / hostname for NEXTAUTH_URL.
    TLS_PUBLIC_HOST="$(hostname -I 2>/dev/null | awk '{print $1}')"
    if [ -z "${TLS_PUBLIC_HOST}" ]; then
      TLS_PUBLIC_HOST="localhost"
    fi
  fi
  chmod 644 "${CADDYFILE_PATH}"
  info "Caddyfile written to ${CADDYFILE_PATH}."

  # Open ports 80 + 443 via UFW if available (best-effort).
  if command -v ufw >/dev/null 2>&1; then
    ufw allow 80/tcp 2>/dev/null || true
    ufw allow 443/tcp 2>/dev/null || true
    info "UFW: allowed 80/tcp + 443/tcp (if UFW is active)."
  fi

  # Enable + start the caddy service.
  systemctl daemon-reload
  systemctl enable caddy 2>/dev/null || true
  systemctl restart caddy || systemctl reload caddy 2>/dev/null || true
  info "caddy service enabled + started."

  # Rewrite NEXTAUTH_URL to the HTTPS URL so NextAuth marks cookies Secure.
  HTTPS_URL="https://${TLS_PUBLIC_HOST}"
  if [ -f "${ENV_FILE}" ]; then
    sed -i "s|^NEXTAUTH_URL=.*|NEXTAUTH_URL=${HTTPS_URL}|" "${ENV_FILE}"
    info "NEXTAUTH_URL updated to ${HTTPS_URL} in ${ENV_FILE}."
    # Restart ChildCheck so it picks up the new NEXTAUTH_URL.
    systemctl restart "${SERVICE_USER}"
  fi
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
if [ "${TLS_ENABLED}" -eq 1 ]; then
  echo " TLS:          Caddy reverse proxy on ports 80 + 443"
  echo "               Caddyfile:  ${CADDYFILE_PATH}"
  echo "               Service:    systemctl status caddy"
  echo "               Logs:       journalctl -u caddy -f"
  echo ""
  if [ -n "${TLS_DOMAIN:-}" ]; then
    echo "               Cert:       auto-Let's-Encrypt for ${TLS_DOMAIN}"
  else
    echo "               Cert:       Caddy internal CA (self-signed)."
    echo "                           Import the root cert on each client:"
    echo "                           /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt"
  fi
  echo ""
fi
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
