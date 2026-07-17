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
#   bash install/install-nas-synology.sh --tls                 # also enable TLS (see below)
#
# Flags:
#   --tls          Opt-in TLS termination. On bare-metal DSM, this prints
#                  step-by-step instructions for the built-in DSM reverse proxy
#                  (Control Panel → Login Portal → Advanced → Reverse Proxy) —
#                  the preferred path on Synology because DSM already ships a
#                  Let's Encrypt integration and there is no native Caddy
#                  package. For Docker-on-NAS deployments, this writes
#                  Caddyfile templates into /volume1/childcheck/docker/ so you
#                  can run `docker compose --profile tls up -d` (see
#                  docker/Caddyfile + docker/Caddyfile.lan).
#                  Without this flag the install stays on plain HTTP (unchanged).
# =============================================================================
set -euo pipefail

# When run via curl|bash, /dev/tty may not be available.
safe_read() {
  read -r "$@" </dev/tty 2>/dev/null || true
}

# Parse `--tls` flag (anywhere in argv). Remaining args become the source-path
# arg handled below.
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
# Port helpers (Synology DSM 7+ — BusyBox-based. netstat is available.)
# ----------------------------------------------------------------------------
port_in_use() {
  local port="$1"
  # DSM ships netstat in BusyBox; ss is rarely present. /proc/net/tcp is
  # always there on Linux. Try ss → /proc → netstat → /dev/tcp.
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
  if command -v netstat >/dev/null 2>&1; then
    if netstat -tln 2>/dev/null | awk '{print $4}' | grep -E "[:.]${port}\$" >/dev/null 2>&1; then
      return 0
    fi
    return 1
  fi
  if (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null; then
    exec 3>&- 3<&-
    return 0
  fi
  return 1
}

# prompt_port(default, label) → echoes the chosen port number.
prompt_port() {
  local default="$1" label="$2"
  local port="${default}"

  if port_in_use "${default}"; then
    warn "port ${default} is already in use (${label})."
    local suggest=$(( default + 1 ))
    while port_in_use "${suggest}"; do
      suggest=$(( suggest + 1 ))
    done
    safe_read -p "Use an alternative port for ${label}? [${suggest}]: " alt
    port="${alt:-${suggest}}"
    while ! [[ "${port}" =~ ^[0-9]+$ ]] || [ "${port}" -lt 1 ] || [ "${port}" -gt 65535 ]; do
      err "'${port}' is not a valid port (must be 1-65535)."
      safe_read -p "${label} port [${suggest}]: " alt
      port="${alt:-${suggest}}"
    done
    while port_in_use "${port}"; do
      err "port ${port} is also in use."
      safe_read -p "${label} port [${suggest}]: " alt
      port="${alt:-${suggest}}"
      while ! [[ "${port}" =~ ^[0-9]+$ ]] || [ "${port}" -lt 1 ] || [ "${port}" -gt 65535 ]; do
        err "'${port}' is not a valid port (must be 1-65535)."
        safe_read -p "${label} port [${suggest}]: " alt
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
  URL_BASE="${CHILDCHECK_URL_BASE:-https://github.com/Newitech/ChildCheck/releases}"
  VERSION="${CHILDCHECK_VERSION:-latest}"
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
  safe_read -p "Overwrite? [y/N] " OVERWRITE
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
  PORT="$(grep -E '^PORT=' "${ENV_FILE}" | cut -d= -f2- || true)"
  PORT="${PORT:-3000}"
  REALTIME_PORT="$(grep -E '^REALTIME_PORT=' "${ENV_FILE}" | cut -d= -f2- || true)"
  REALTIME_PORT="${REALTIME_PORT:-3003}"
else
  step "Choosing ports (default: web 3000, realtime 3003)"
  PORT="$(prompt_port 3000 "web server")"
  REALTIME_PORT="$(prompt_port 3003 "realtime (Socket.io)")"

  # Synology: try the box's primary IP.
  DEFAULT_URL="http://localhost:${PORT}"
  IP="$(ip -4 addr show 2>/dev/null | grep -oP 'inet \K[0-9.]+' | grep -v '^127\.' | head -n1 || true)"
  if [ -n "${IP}" ]; then
    DEFAULT_URL="http://${IP}:${PORT}"
  fi

  safe_read -p "Public URL [${DEFAULT_URL}]: " NEXTAUTH_URL
  NEXTAUTH_URL="${NEXTAUTH_URL:-${DEFAULT_URL}}"

  safe_read -p "NEXTAUTH_SECRET (blank = auto-generate): " NEXTAUTH_SECRET
  if [ -z "${NEXTAUTH_SECRET}" ]; then
    if command -v openssl >/dev/null 2>&1; then
      NEXTAUTH_SECRET="$(openssl rand -hex 32)"
    else
      NEXTAUTH_SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    fi
    info "generated NEXTAUTH_SECRET."
  fi

  safe_read -p "CHILDCHECK_DATA_KEY for photo/backup encryption (blank = auto-generate): " CHILDCHECK_DATA_KEY
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
REALTIME_PORT=${REALTIME_PORT}
PORT=${PORT}
HOSTNAME=0.0.0.0
EOF
  chmod 600 "${ENV_FILE}"
  info ".env written to ${ENV_FILE} (chmod 600)."
  info "  PORT=${PORT}  REALTIME_PORT=${REALTIME_PORT}"
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
  read -r -p "Press ENTER once you've created the task... " </dev/tty || true
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
  if curl -fsS "http://localhost:${PORT}/api/config" >/dev/null 2>&1; then
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
# 6a. Opt-in TLS via Caddy (--tls flag)
# ----------------------------------------------------------------------------
# On bare-metal Synology DSM there is no native Caddy package — DSM already
# ships a built-in reverse proxy + Let's Encrypt integration, which is the
# preferred TLS path. For Docker-on-NAS deployments, the bundled
# docker/Caddyfile + docker/Caddyfile.lan templates handle Caddy for you
# (activated via `docker compose --profile tls up -d`).
TLS_SUMMARY_LINES=()
if [ "${TLS_ENABLED}" -eq 1 ]; then
  step "Configuring TLS (--tls)"

  # Prompt for the domain name (blank = LAN-only self-signed).
  echo ""
  echo "  Domain name (blank for LAN-only self-signed):"
  echo "    - For a real domain (e.g. checkin.mychurch.org): the DSM reverse"
  echo "      proxy auto-provisions + auto-renews a Let's Encrypt cert. Ports"
  echo "      80 + 443 must be open."
  echo "    - Blank: use the DSM reverse proxy with a self-signed cert (or use"
  echo "      Caddy's internal CA via the Docker-on-NAS path below)."
  safe_read -p "  Domain [blank for LAN-only]: " TLS_DOMAIN
  TLS_DOMAIN="${TLS_DOMAIN:-}"

  # Locate the Caddyfile templates shipped alongside this script. Even on
  # bare-metal DSM we copy them into the data dir so an operator who later
  # switches to Docker-on-NAS has them ready to use.
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  DOMAIN_TEMPLATE="${SCRIPT_DIR}/Caddyfile.domain"
  LAN_TEMPLATE="${SCRIPT_DIR}/Caddyfile.lan"
  DOCKER_DIR="${DATA_DIR}/docker"
  mkdir -p "${DOCKER_DIR}"
  if [ -f "${DOMAIN_TEMPLATE}" ]; then
    cp "${DOMAIN_TEMPLATE}" "${DOCKER_DIR}/Caddyfile.domain"
  fi
  if [ -f "${LAN_TEMPLATE}" ]; then
    cp "${LAN_TEMPLATE}" "${DOCKER_DIR}/Caddyfile.lan"
  fi

  # Detect the box's primary IP for display purposes.
  TLS_PUBLIC_HOST="$(TLS_DOMAIN:-)"
  if [ -z "${TLS_PUBLIC_HOST}" ]; then
    TLS_PUBLIC_HOST="$(ip -4 addr show 2>/dev/null | grep -oP 'inet \K[0-9.]+' | grep -v '^127\.' | head -n1 || true)"
    TLS_PUBLIC_HOST="${TLS_PUBLIC_HOST:-localhost}"
  fi

  echo ""
  echo "  ----------------------------------------------------------"
  echo "  TLS path 1 — DSM built-in reverse proxy (RECOMMENDED)"
  echo "  ----------------------------------------------------------"
  echo "  DSM ships a reverse proxy + Let's Encrypt integration, so this is"
  echo "  the simplest TLS path on bare-metal Synology:"
  echo ""
  echo "    1. DSM → Control Panel → Login Portal → Advanced → Reverse Proxy."
  echo "    2. Create → Source: HTTPS, hostname ${TLS_PUBLIC_HOST}, port 443."
  echo "       (If you have a real domain, also create a DDNS hostname in"
  echo "        Control Panel → External Access → DDNS first.)"
  echo "    3. Destination: HTTP, localhost, port ${PORT}."
  echo "    4. Under Settings → HSTS, enable HSTS for added browser safety."
  echo "    5. Under Settings → Certificate, pick the Let's Encrypt cert DSM"
  echo "       auto-provisioned for your DDNS hostname (or import your own)."
  echo "    6. DSM → Control Panel → Security → Firewall: allow 80/tcp + 443/tcp."
  echo ""
  echo "  After the proxy is up, edit ${ENV_FILE} and set:"
  echo "    NEXTAUTH_URL=https://${TLS_PUBLIC_HOST}"
  echo "  then restart the service:"
  echo "    pkill -f '${INSTALL_DIR}/${BINARY_NAME}'; ${START_SCRIPT}"
  echo ""
  echo "  ----------------------------------------------------------"
  echo "  TLS path 2 — Docker-on-NAS with Caddy (compose profile)"
  echo "  ----------------------------------------------------------"
  echo "  If you run ChildCheck in Docker on the NAS (Container Manager), the"
  echo "  bundled Caddyfile templates handle TLS for you:"
  echo ""
  echo "    Caddyfile templates copied to: ${DOCKER_DIR}/"
  echo "      - Caddyfile.domain   (auto-Let's-Encrypt for a real domain)"
  echo "      - Caddyfile.lan      (self-signed via Caddy's internal CA)"
  echo ""
  echo "  Then from the ChildCheck source dir on the NAS:"
  if [ -n "${TLS_DOMAIN}" ]; then
    echo "    DOMAIN=${TLS_DOMAIN} docker compose --profile tls up -d"
  else
    echo "    # LAN-only (no domain) — swap in the LAN template first:"
    echo "    cp docker/Caddyfile.lan docker/Caddyfile"
    echo "    docker compose --profile tls up -d"
    echo "    # Then import Caddy's root CA into each client's trust store"
    echo "    # (see Caddyfile.lan for per-OS instructions)."
  fi
  echo ""
  echo "  See docs/deployment/docker.md → 'TLS termination with Caddy (opt-in)'."
  echo ""

  # Build the TLS summary lines for the final summary block.
  TLS_SUMMARY_LINES+=(" TLS:          opt-in via --tls flag")
  TLS_SUMMARY_LINES+=("               Bare-metal DSM: use the built-in reverse proxy")
  TLS_SUMMARY_LINES+=("                 (Control Panel → Login Portal → Advanced → Reverse Proxy).")
  TLS_SUMMARY_LINES+=("               Docker-on-NAS: docker compose --profile tls up -d")
  TLS_SUMMARY_LINES+=("                 Caddyfile templates copied to: ${DOCKER_DIR}/")
  if [ -n "${TLS_DOMAIN}" ]; then
    TLS_SUMMARY_LINES+=("               Cert:       Let's Encrypt for ${TLS_DOMAIN}")
  else
    TLS_SUMMARY_LINES+=("               Cert:       self-signed (LAN-only) — set DOMAIN for auto-Let's-Encrypt.")
  fi
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
if [ "${TLS_ENABLED}" -eq 1 ] && [ "${#TLS_SUMMARY_LINES[@]}" -gt 0 ]; then
  for line in "${TLS_SUMMARY_LINES[@]}"; do
    echo "${line}"
  done
  echo ""
fi
echo " Next step:"
echo "   1. Open the Setup URL above in a browser."
echo "   2. Fill in your organisation name + first admin user."
echo "   3. Default SDA programs are seeded automatically on submit."
echo "   4. Sign in → /admin → Settings to configure branding + toggles."
echo ""
echo " IMPORTANT: back up the CHILDCHECK_DATA_KEY in ${ENV_FILE}."
echo "============================================================"
