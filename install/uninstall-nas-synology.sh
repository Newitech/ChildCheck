#!/usr/bin/env bash
# =============================================================================
# ChildCheck — Synology DSM uninstaller
#
# What it does:
#   1. Stops the running ChildCheck process + removes the DSM scheduled task
#      (if it was registered via the synotask CLI).
#   2. Asks for explicit confirmation (default: NO — requires "yes" / "I-understand").
#   3. Offers to back up the data dir to /root/childcheck-data-backup-<date>.tar.gz
#      (default: yes — the backup happens BEFORE any removal).
#   4. Removes the install dir (/volume1/@appstore/ChildCheck) + start script.
#   5. Removes the data dir (/volume1/childcheck) ONLY if the user explicitly
#      confirms a SECOND time (default: keep data — just remove binary + task).
#   6. Prints post-uninstall instructions (where the backup is, how to re-install,
#      and how to remove the manual DSM task if the CLI couldn't).
#
# Usage (run on the NAS over SSH, as root):
#   bash install/uninstall-nas-synology.sh
#
# Data is NEVER silently destroyed — the script defaults to KEEPING data, and
# when removing data it makes a tarball backup first unless you explicitly
# decline with --no-backup.
#
# Flags:
#   --no-backup       Skip the data backup step (only meaningful with --remove-data).
#   --remove-data     Remove the data dir too (still asks for confirmation).
#   --yes             Skip the initial confirmation prompt (still asks for data
#                     removal confirmation unless --remove-data is also given).
# =============================================================================
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: run this script as root (sudo -i)."
  exit 1
fi

INSTALL_DIR="/volume1/@appstore/ChildCheck"
DATA_DIR="/volume1/childcheck"
LOG_DIR="${DATA_DIR}/logs"
START_SCRIPT="/usr/local/bin/childcheck-start.sh"
BINARY_NAME="childcheck"
SERVICE_NAME="childcheck"

# Args.
SKIP_BACKUP=0
REMOVE_DATA=0
ASSUME_YES=0
for arg in "$@"; do
  case "${arg}" in
    --no-backup)    SKIP_BACKUP=1 ;;
    --remove-data)  REMOVE_DATA=1 ;;
    --yes|-y)       ASSUME_YES=1 ;;
    *)
      echo "ERROR: unknown flag: ${arg}"
      echo "Usage: $0 [--no-backup] [--remove-data] [--yes]"
      exit 1
      ;;
  esac
done

# Colors.
RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; NC=$'\033[0m'
info()  { echo "${GREEN}[info]${NC}  $*"; }
warn()  { echo "${YELLOW}[warn]${NC}  $*"; }
err()   { echo "${RED}[error]${NC} $*" >&2; }
step()  { echo ""; echo "${CYAN}==>${NC} $*"; }

# ----------------------------------------------------------------------------
# 0. Confirmation
# ----------------------------------------------------------------------------
echo ""
echo "============================================================"
echo " ChildCheck uninstaller (Synology DSM)"
echo "============================================================"
echo ""
echo " This will:"
echo "   - Stop the running ChildCheck process."
echo "   - Remove the DSM scheduled task (if registered via synotask CLI)."
echo "   - Remove the install dir:    ${INSTALL_DIR}"
echo "   - Remove the start script:   ${START_SCRIPT}"
echo "   - (Optionally) back up data: /root/childcheck-data-backup-<date>.tar.gz"
echo "   - (Optionally) remove data:  ${DATA_DIR}"
echo ""
echo " Data is KEPT by default. Removing it requires explicit confirmation."
echo "============================================================"
echo ""

if [ "${ASSUME_YES}" -ne 1 ]; then
  read -r -p "Type 'yes' or 'I-understand' to proceed (anything else aborts): " CONFIRM </dev/tty
  case "${CONFIRM}" in
    yes|I-understand) ;;
    *)
      echo "Aborted — no changes were made."
      exit 0
      ;;
  esac
fi

# ----------------------------------------------------------------------------
# 1. Stop the process + remove the scheduled task
# ----------------------------------------------------------------------------
step "Stopping ChildCheck process"
# Stop the service via synoservicectl (DSM 7+) if it's registered that way.
if command -v synoservicectl >/dev/null 2>&1; then
  synoservicectl --stop "${SERVICE_NAME}" 2>/dev/null || true
fi
# Kill any running instance.
pkill -f "${INSTALL_DIR}/${BINARY_NAME}" 2>/dev/null || true
info "stopped."

step "Removing DSM scheduled task"
TASK_REMOVED=0
if command -v synotask >/dev/null 2>&1; then
  if synotask --delete --name "${SERVICE_NAME}" 2>/dev/null; then
    info "scheduled task removed via synotask CLI."
    TASK_REMOVED=1
  fi
fi
if [ "${TASK_REMOVED}" -ne 1 ]; then
  warn "Could not auto-remove the DSM scheduled task (synotask CLI not available"
  warn "or task was registered manually via the web UI)."
  warn "If you created the task manually, remove it now:"
  echo ""
  echo "  1. Open DSM → Control Panel → Task Scheduler."
  echo "  2. Select the 'ChildCheck' task → Delete."
  echo ""
fi

# ----------------------------------------------------------------------------
# 2. Backup
# ----------------------------------------------------------------------------
BACKUP_PATH=""
if [ -d "${DATA_DIR}" ] && [ "${SKIP_BACKUP}" -ne 1 ]; then
  step "Backing up data dir"
  read -r -p "Back up ${DATA_DIR} before removal? [Y/n] " DO_BACKUP </dev/tty
  DO_BACKUP="${DO_BACKUP:-Y}"
  case "${DO_BACKUP}" in
    [Nn]*)
      warn "skipping backup. If you proceed with --remove-data, the data will be lost."
      ;;
    *)
      STAMP="$(date +%Y%m%d-%H%M%S)"
      # Put the backup in /root so it survives the install dir removal. Use the
      # SUDO_USER's home if invoked via sudo (less common on Synology but safe).
      BACKUP_HOME="${SUDO_USER:+$(getent passwd "${SUDO_USER}" | cut -d: -f6)}"
      BACKUP_HOME="${BACKUP_HOME:-${HOME:-/root}}"
      BACKUP_PATH="${BACKUP_HOME}/childcheck-data-backup-${STAMP}.tar.gz"
      info "creating tarball: ${BACKUP_PATH}"
      if ! tar -czf "${BACKUP_PATH}" -C "$(dirname "${DATA_DIR}")" "$(basename "${DATA_DIR}")" 2>/dev/null; then
        err "backup failed — aborting so data is NOT lost."
        exit 1
      fi
      if [ -n "${SUDO_USER:-}" ]; then
        chown "${SUDO_USER}:${SUDO_USER}" "${BACKUP_PATH}" 2>/dev/null || true
      fi
      info "backup complete: ${BACKUP_PATH}"
      ls -lh "${BACKUP_PATH}"
      ;;
  esac
elif [ "${SKIP_BACKUP}" -eq 1 ]; then
  warn "--no-backup given — skipping backup."
fi

# ----------------------------------------------------------------------------
# 3. Remove install dir + start script
# ----------------------------------------------------------------------------
step "Removing install dir + start script"
if [ -d "${INSTALL_DIR}" ]; then
  rm -rf "${INSTALL_DIR}"
  info "removed ${INSTALL_DIR}."
else
  info "${INSTALL_DIR} not found — skipping."
fi

if [ -f "${START_SCRIPT}" ]; then
  rm -f "${START_SCRIPT}"
  info "removed ${START_SCRIPT}."
else
  info "${START_SCRIPT} not found — skipping."
fi

# ----------------------------------------------------------------------------
# 4. Remove data dir (only with explicit confirmation)
# ----------------------------------------------------------------------------
if [ "${REMOVE_DATA}" -eq 1 ] && [ -d "${DATA_DIR}" ]; then
  step "Removing data dir ${DATA_DIR}"
  echo ""
  echo "  *** You passed --remove-data. ***"
  echo "  This will PERMANENTLY DELETE:"
  echo "    - The SQLite database (children, families, programs, attendance...)"
  echo "    - All encrypted-at-rest photos"
  echo "    - All branding assets"
  echo "    - All encrypted backup bundles (.cbak files)"
  echo ""
  if [ -n "${BACKUP_PATH}" ]; then
    echo "  A backup was created at: ${BACKUP_PATH}"
    echo "  RESTORE PREREQUISITE: keep the CHILDCHECK_DATA_KEY from"
    echo "  ${DATA_DIR}/config/.env — without it, the backup cannot be decrypted."
    echo ""
  else
    echo "  NO BACKUP was created. This deletion is irreversible."
    echo ""
  fi
  read -r -p "Type 'DELETE-FOREVER' to permanently remove ${DATA_DIR}: " DEL_CONFIRM </dev/tty
  if [ "${DEL_CONFIRM}" = "DELETE-FOREVER" ]; then
    rm -rf "${DATA_DIR}"
    info "removed ${DATA_DIR}."
  else
    warn "kept data dir ${DATA_DIR} (confirmation didn't match 'DELETE-FOREVER')."
  fi
elif [ -d "${DATA_DIR}" ]; then
  step "Keeping data dir"
  info "data dir left intact at ${DATA_DIR}."
  info "to remove it later:  rm -rf ${DATA_DIR}"
fi

# ----------------------------------------------------------------------------
# 5. Post-uninstall summary
# ----------------------------------------------------------------------------
echo ""
echo "============================================================"
echo " ChildCheck uninstalled."
echo "============================================================"
echo ""
echo " Removed:"
echo "   - install dir:    ${INSTALL_DIR}"
echo "   - start script:   ${START_SCRIPT}"
echo "   - scheduled task: (via synotask CLI — see warning above if manual)"
[ "${REMOVE_DATA}" -eq 1 ] && echo "   - data dir:       ${DATA_DIR}"
echo ""
if [ -n "${BACKUP_PATH}" ]; then
  echo " Data backup:"
  echo "   ${BACKUP_PATH}"
  echo ""
  echo " To restore on a fresh install:"
  echo "   1. Re-run install/install-nas-synology.sh"
  echo "   2. Stop the service:  pkill -f ${INSTALL_DIR}/${BINARY_NAME}"
  echo "   3. Extract the backup over the new data dir:"
  echo "        tar -xzf ${BACKUP_PATH} -C $(dirname "${DATA_DIR}")"
  echo "   4. Copy the CHILDCHECK_DATA_KEY from the old .env (inside the backup's"
  echo "      config/.env) into the new ${DATA_DIR}/config/.env — without it,"
  echo "      encrypted photos + backups cannot be decrypted."
  echo "   5. Restart:  ${START_SCRIPT}  (or reboot the NAS)"
elif [ "${REMOVE_DATA}" -eq 1 ]; then
  echo " No backup was created. Data has been permanently deleted."
else
  echo " Data dir left intact at:  ${DATA_DIR}"
  echo " To remove it manually:    rm -rf ${DATA_DIR}"
fi
echo ""
echo " To reinstall later:"
echo "   bash install/install-nas-synology.sh"
echo "============================================================"
