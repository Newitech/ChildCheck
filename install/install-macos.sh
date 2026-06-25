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
# =============================================================================
set -euo pipefail

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
else
  DEFAULT_URL="http://localhost:3000"
  # Try to detect the .local hostname (Bonjour).
  if command -v scutil >/dev/null 2>&1; then
    LOCAL_HOST="$(scutil --get LocalHostName 2>/dev/null || true)"
    if [ -n "${LOCAL_HOST}" ]; then
      DEFAULT_URL="http://${LOCAL_HOST}.local:3000"
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
REALTIME_PORT=3003
PORT=3000
HOSTNAME=0.0.0.0
EOF
  chmod 600 "${ENV_FILE}"
  info ".env written to ${ENV_FILE} (chmod 600)."
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
  if curl -fsS "http://localhost:3000/api/config" >/dev/null 2>&1; then
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
echo " Next step:"
echo "   1. Open the Setup URL above in a browser."
echo "   2. Fill in your organisation name + first admin user."
echo "   3. Default SDA programs are seeded automatically on submit."
echo "   4. Sign in → /admin → Settings to configure branding + toggles."
echo ""
echo " IMPORTANT: back up the CHILDCHECK_DATA_KEY in ${ENV_FILE}."
echo "============================================================"
