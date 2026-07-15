#!/usr/bin/env bash
# =============================================================================
# ChildCheck — macOS installer (launchd, user-level LaunchAgent)
#
# What it does:
#   1. Installs the pre-built binary to /Applications/ChildCheck/.
#   2. Creates ~/Library/Application Support/ChildCheck/{data,db,config}.
#   3. Writes a default .env (prompting for NEXTAUTH_SECRET if not set).
#   4. Writes ~/Library/LaunchAgents/org.childcheck.plist.
#   5. Loads the agent (starts the service for the current user).
#   6. Prints the URL + first-run setup instructions.
#
# Runs as the current user (NOT root). sudo is not required and not recommended.
#
# Usage:
#   bash install/install-macos.sh                       # download latest release
#   bash install/install-macos.sh /path/to/tarball      # use local tarball
#   bash install/install-macos.sh /path/to/dir          # use unpacked dir
#   bash install/install-macos.sh --tls                 # also install + configure Caddy for HTTPS
#
# Flags:
#   --tls          Opt-in TLS termination via Caddy. `brew install caddy`,
#                  generates a Caddyfile into
#                  /opt/homebrew/etc/caddy/Caddyfile (Apple Silicon) or
#                  /usr/local/etc/caddy/Caddyfile (Intel), and starts Caddy
#                  via a second launchd plist (org.childcheck.caddy.plist)
#                  alongside ChildCheck. Prompts for a domain name (blank for
#                  LAN-only self-signed via Caddy's internal CA).
# =============================================================================
set -euo pipefail

# Parse `--tls` flag (anywhere in argv).
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

# Refuse to run as root — launchd user agents don't work for root well.
if [ "$(id -u)" -eq 0 ]; then
  echo "ERROR: do NOT run this script as root. Run it as the user who will own the service."
  exit 1
fi

ARCH="$(uname -m)"
case "${ARCH}" in
  arm64)  TARGET="macos-arm64" ;;
  x86_64) TARGET="macos-x64"   # NOTE: we don't ship a prebuilt macos-x64 binary;
                               # the launcher builds for macos-arm64 only. On
                               # Intel Macs, Rosetta 2 will run the arm64 binary
                               # at native speed... actually no, Rosetta only
                               # works the other way (x86 on arm). For Intel
                               # Macs, use the Docker image or build from source.
                               echo "ERROR: Intel Mac (x86_64) not directly supported by prebuilt binaries."
                               echo "Use the Docker image (docs/deployment/docker.md) or build from source with:"
                               echo "  bun build scripts/launcher.ts --compile --target=bun-darwin-x64 --outfile=childcheck"
                               exit 1
                               ;;
  *)
    echo "ERROR: unsupported architecture ${ARCH}"
    exit 1
    ;;
esac

INSTALL_DIR="/Applications/ChildCheck"
DATA_DIR="${HOME}/Library/Application Support/ChildCheck"
PLIST_PATH="${HOME}/Library/LaunchAgents/org.childcheck.plist"
BINARY_NAME="childcheck"
LABEL="org.childcheck"

# Colors.
RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; NC=$'\033[0m'
info()  { echo "${GREEN}[info]${NC}  $*"; }
warn()  { echo "${YELLOW}[warn]${NC}  $*"; }
err()   { echo "${RED}[error]${NC} $*" >&2; }
step()  { echo ""; echo "${CYAN}==>${NC} $*"; }

# ----------------------------------------------------------------------------
# Port helpers (macOS — uses lsof which is always present on macOS)
# ----------------------------------------------------------------------------
port_in_use() {
  local port="$1"
  # macOS ships lsof by default — it's the most reliable here.
  if lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
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
    read -r -p "Use an alternative port for ${label}? [${suggest}]: " alt </dev/tty
    port="${alt:-${suggest}}"
    while ! [[ "${port}" =~ ^[0-9]+$ ]] || [ "${port}" -lt 1 ] || [ "${port}" -gt 65535 ]; do
      err "'${port}' is not a valid port (must be 1-65535)."
      read -r -p "${label} port [${suggest}]: " alt </dev/tty
      port="${alt:-${suggest}}"
    done
    while port_in_use "${port}"; do
      err "port ${port} is also in use."
      read -r -p "${label} port [${suggest}]: " alt </dev/tty
      port="${alt:-${suggest}}"
      while ! [[ "${port}" =~ ^[0-9]+$ ]] || [ "${port}" -lt 1 ] || [ "${port}" -gt 65535 ]; do
        err "'${port}' is not a valid port (must be 1-65535)."
        read -r -p "${label} port [${suggest}]: " alt </dev/tty
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
  URL_BASE="${CHILDCHECK_URL_BASE:-https://github.com/Newitech/ChildCheck/releases/download}"
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
  else
    err "curl is required. Install with: brew install curl"
    exit 1
  fi
  tar -xzf "${WORK_DIR}/childcheck.tar.gz" -C "${WORK_DIR}"
  SRC_DIR="$(find "${WORK_DIR}" -maxdepth 1 -type d -name 'childcheck*' | head -n1)"
fi

if [ ! -f "${SRC_DIR}/${BINARY_NAME}" ]; then
  err "expected binary not found at ${SRC_DIR}/${BINARY_NAME}"
  exit 1
fi

# Clear the quarantine attribute on the downloaded binary so macOS doesn't
# refuse to run it.
xattr -dr com.apple.quarantine "${SRC_DIR}" 2>/dev/null || true

# ----------------------------------------------------------------------------
# 1. Install to /Applications/ChildCheck
# ----------------------------------------------------------------------------
step "Installing to ${INSTALL_DIR}"
if [ -d "${INSTALL_DIR}" ] && [ -f "${INSTALL_DIR}/${BINARY_NAME}" ]; then
  warn "an existing install is present at ${INSTALL_DIR}."
  read -r -p "Overwrite? [y/N] " OVERWRITE </dev/tty
  if [[ ! "${OVERWRITE}" =~ ^[Yy]$ ]]; then
    info "keeping existing install. Aborting."
    exit 0
  fi
  # Unload the agent before overwriting.
  launchctl unload "${PLIST_PATH}" 2>/dev/null || true
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
# 2. Data dir
# ----------------------------------------------------------------------------
step "Creating data directory ${DATA_DIR}"
mkdir -p "${DATA_DIR}/data/photos" \
         "${DATA_DIR}/data/branding" \
         "${DATA_DIR}/data/backups" \
         "${DATA_DIR}/db" \
         "${DATA_DIR}/config"
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

  DEFAULT_URL="http://localhost:${PORT}"
  # Try to detect the .local hostname (Bonjour).
  if command -v scutil >/dev/null 2>&1; then
    LOCAL_HOST="$(scutil --get LocalHostName 2>/dev/null || true)"
    if [ -n "${LOCAL_HOST}" ]; then
      DEFAULT_URL="http://${LOCAL_HOST}.local:${PORT}"
    fi
  fi

  read -r -p "Public URL [${DEFAULT_URL}]: " NEXTAUTH_URL </dev/tty
  NEXTAUTH_URL="${NEXTAUTH_URL:-${DEFAULT_URL}}"

  read -r -p "NEXTAUTH_SECRET (blank = auto-generate): " NEXTAUTH_SECRET </dev/tty
  if [ -z "${NEXTAUTH_SECRET}" ]; then
    NEXTAUTH_SECRET="$(openssl rand -hex 32)"
    info "generated NEXTAUTH_SECRET."
  fi

  read -r -p "CHILDCHECK_DATA_KEY for photo/backup encryption (blank = auto-generate): " CHILDCHECK_DATA_KEY </dev/tty
  if [ -z "${CHILDCHECK_DATA_KEY}" ]; then
    CHILDCHECK_DATA_KEY="$(openssl rand -hex 32)"
    info "generated CHILDCHECK_DATA_KEY — SAVE THIS."
  fi

  cat > "${ENV_FILE}" <<EOF
# ChildCheck environment — generated by install-macos.sh on $(date)
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
# 4. launchd plist
# ----------------------------------------------------------------------------
step "Writing launchd plist ${PLIST_PATH}"
mkdir -p "$(dirname "${PLIST_PATH}")"

LOG_DIR="${DATA_DIR}/logs"
mkdir -p "${LOG_DIR}"

cat > "${PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${INSTALL_DIR}/${BINARY_NAME}</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${INSTALL_DIR}</string>

  <key>EnvironmentVariables</key>
  <dict>
EOF

# Inject each env var from the .env file as a <key>/<string> pair.
while IFS='=' read -r KEY VAL; do
  # Skip blank lines + comments.
  [ -z "${KEY:-}" ] && continue
  case "${KEY}" in \#*) continue ;; esac
  # Strip any surrounding quotes from VAL.
  VAL="${VAL#\"}"; VAL="${VAL%\"}"
  cat >> "${PLIST_PATH}" <<EOF
    <key>${KEY}</key>
    <string>${VAL}</string>
EOF
done < "${ENV_FILE}"

cat >> "${PLIST_PATH}" <<EOF
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>

  <key>StandardOutPath</key>
  <string>${LOG_DIR}/childcheck.stdout.log</string>

  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/childcheck.stderr.log</string>

  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>
EOF
chmod 644 "${PLIST_PATH}"
info "plist written."

# ----------------------------------------------------------------------------
# 5. Load + start
# ----------------------------------------------------------------------------
step "Loading launchd agent"
launchctl unload "${PLIST_PATH}" 2>/dev/null || true
launchctl load "${PLIST_PATH}"
info "agent loaded."

# Wait for it to come up.
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
  warn "service did not respond within 30s. Logs:"
  warn "  tail -f '${LOG_DIR}/childcheck.stderr.log'"
else
  info "service is up."
fi

# ----------------------------------------------------------------------------
# 5a. Opt-in TLS via Caddy (--tls flag)
# ----------------------------------------------------------------------------
# Install Caddy via Homebrew, generate a Caddyfile, and run Caddy via a
# second launchd plist (org.childcheck.caddy.plist) alongside ChildCheck.
CADDY_PLIST_PATH="${HOME}/Library/LaunchAgents/org.childcheck.caddy.plist"
CADDYFILE_PATH=""
if [ "${TLS_ENABLED}" -eq 1 ]; then
  step "Configuring TLS via Caddy (--tls)"

  # Locate the Caddy config dir (Homebrew path differs by arch).
  if [ -d "/opt/homebrew" ]; then
    CADDYFILE_PATH="/opt/homebrew/etc/caddy/Caddyfile"
    CADDY_BIN="/opt/homebrew/bin/caddy"
    CADDY_DATA_DIR="${HOME}/Library/Application Support/Caddy"
  else
    CADDYFILE_PATH="/usr/local/etc/caddy/Caddyfile"
    CADDY_BIN="/usr/local/bin/caddy"
    CADDY_DATA_DIR="${HOME}/Library/Application Support/Caddy"
  fi

  # Install Caddy via Homebrew.
  if ! command -v caddy >/dev/null 2>&1; then
    if ! command -v brew >/dev/null 2>&1; then
      err "Homebrew is required to install Caddy. Install from https://brew.sh and re-run."
      exit 1
    fi
    info "installing Caddy via Homebrew."
    brew install caddy
  else
    info "Caddy already installed — skipping brew install."
    CADDY_BIN="$(command -v caddy)"
  fi

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

  # Locate the Caddyfile templates shipped alongside this script.
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  DOMAIN_TEMPLATE="${SCRIPT_DIR}/Caddyfile.domain"
  LAN_TEMPLATE="${SCRIPT_DIR}/Caddyfile.lan"

  # Generate the Caddyfile from the appropriate template.
  mkdir -p "$(dirname "${CADDYFILE_PATH}")"
  if [ -n "${TLS_DOMAIN}" ]; then
    info "using DOMAIN mode (auto-Let's-Encrypt for ${TLS_DOMAIN})."
    if [ -f "${DOMAIN_TEMPLATE}" ]; then
      sed "s|{\$DOMAIN}|${TLS_DOMAIN}|g; s|{\$PORT:3000}|${PORT}|g" "${DOMAIN_TEMPLATE}" > "${CADDYFILE_PATH}"
    else
      cat > "${CADDYFILE_PATH}" <<EOF
${TLS_DOMAIN} {
        reverse_proxy localhost:${PORT}
}
EOF
    fi
    TLS_PUBLIC_HOST="${TLS_DOMAIN}"
  else
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
    # Use the .local hostname for NEXTAUTH_URL.
    TLS_PUBLIC_HOST="$(scutil --get LocalHostName 2>/dev/null || echo localhost).local"
  fi
  chmod 644 "${CADDYFILE_PATH}"
  info "Caddyfile written to ${CADDYFILE_PATH}."

  # Run Caddy via a second launchd plist.
  mkdir -p "$(dirname "${CADDY_PLIST_PATH}")"
  mkdir -p "${CADDY_DATA_DIR}/logs"
  cat > "${CADDY_PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>org.childcheck.caddy</string>

  <key>ProgramArguments</key>
  <array>
    <string>${CADDY_BIN}</string>
    <string>run</string>
    <string>--config</string>
    <string>${CADDYFILE_PATH}</string>
  </array>

  <key>WorkingDirectory</key>
  <string>$(dirname "${CADDYFILE_PATH}")</string>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>

  <key>StandardOutPath</key>
  <string>${CADDY_DATA_DIR}/logs/caddy.stdout.log</string>

  <key>StandardErrorPath</key>
  <string>${CADDY_DATA_DIR}/logs/caddy.stderr.log</string>

  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>
EOF
  chmod 644 "${CADDY_PLIST_PATH}"

  # Caddy needs to bind ports 80 + 443, which on macOS requires either:
  #   (a) running Caddy as root via sudo (NOT recommended — we run as user), OR
  #   (b) granting Caddy the privilege to bind privileged ports via:
  #         sudo /usr/sbin/screencapture setcap... (not available on macOS), OR
  #   (c) running Caddy on higher ports (e.g. 8443) — requires a redirect rule.
  # The standard macOS approach is to launch Caddy with sudo. We DON'T do that
  # here (to keep the user-level launchd pattern). Instead we warn the user:
  if [ "${PORT}" = "3000" ]; then
    warn "macOS note: binding ports 80 + 443 requires root. Caddy will fail to start"
    warn "the launchd agent as your user. Either:"
    warn "  (a) Edit ${CADDYFILE_PATH} to listen on :8443 instead of :443, then browse to"
    warn "      https://${TLS_PUBLIC_HOST}:8443 — no root needed."
    warn "  (b) Run Caddy as root: sudo launchctl bootstrap system/${CADDY_PLIST_PATH}"
    warn "      after moving it to /Library/LaunchDaemons/org.childcheck.caddy.plist"
    warn "      (system-level Daemons run as root and can bind 80 + 443)."
  fi

  # Load the Caddy launchd agent (best-effort — may fail on privileged ports).
  launchctl unload "${CADDY_PLIST_PATH}" 2>/dev/null || true
  launchctl load "${CADDY_PLIST_PATH}" 2>/dev/null || warn "Caddy agent failed to load — see the note above."

  # Rewrite NEXTAUTH_URL to HTTPS.
  HTTPS_URL="https://${TLS_PUBLIC_HOST}"
  if [ -f "${ENV_FILE}" ]; then
    sed -i '' "s|^NEXTAUTH_URL=.*|NEXTAUTH_URL=${HTTPS_URL}|" "${ENV_FILE}"
    info "NEXTAUTH_URL updated to ${HTTPS_URL} in ${ENV_FILE}."
    launchctl unload "${PLIST_PATH}" 2>/dev/null || true
    launchctl load "${PLIST_PATH}"
  fi
fi

# ----------------------------------------------------------------------------
# 6. Summary
# ----------------------------------------------------------------------------
PUBLIC_URL="$(grep -E '^NEXTAUTH_URL=' "${ENV_FILE}" | cut -d= -f2-)"

echo ""
echo "============================================================"
echo " ChildCheck installed successfully."
echo "============================================================"
echo ""
echo " Status:       launchctl list | grep ${LABEL}"
echo " Start:        launchctl load ${PLIST_PATH}"
echo " Stop:         launchctl unload ${PLIST_PATH}"
echo " Restart:      launchctl unload ${PLIST_PATH} && launchctl load ${PLIST_PATH}"
echo " Logs:         tail -f '${LOG_DIR}/childcheck.stdout.log'"
echo "               tail -f '${LOG_DIR}/childcheck.stderr.log'"
echo ""
echo " Install dir:  ${INSTALL_DIR}"
echo " Data dir:     ${DATA_DIR}"
echo " Config:       ${ENV_FILE}"
echo " Plist:        ${PLIST_PATH}"
echo ""
echo " Public URL:   ${PUBLIC_URL}"
echo " Setup wizard: ${PUBLIC_URL}/setup"
echo ""
if [ "${TLS_ENABLED}" -eq 1 ] && [ -n "${CADDYFILE_PATH}" ]; then
  echo " TLS:          Caddy reverse proxy (ports 80 + 443)"
  echo "               Caddyfile:  ${CADDYFILE_PATH}"
  echo "               Plist:      ${CADDY_PLIST_PATH}"
  echo "               Logs:       tail -f '${HOME}/Library/Application Support/Caddy/logs/caddy.stderr.log'"
  if [ -n "${TLS_DOMAIN:-}" ]; then
    echo "               Cert:       auto-Let's-Encrypt for ${TLS_DOMAIN}"
  else
    echo "               Cert:       Caddy internal CA (self-signed)."
    echo "                           Import the root cert on each client:"
    echo "                           ~/Library/Application Support/Caddy/pki/authorities/local/root.crt"
  fi
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
