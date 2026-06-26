#!/usr/bin/env bash
# =============================================================================
# ChildCheck — Linux uninstaller (systemd)
#
# What it does:
#   1. Stops + disables the childcheck systemd service.
#   2. Asks for explicit confirmation (default: NO — requires "yes" / "I-understand").
#   3. Offers to back up the data dir to ~/childcheck-data-backup-<date>.tar.gz
#      (default: yes — the backup happens BEFORE any removal).
#   4. Removes the install dir (/opt/childcheck) + service file
#      (/etc/systemd/system/childcheck.service).
#   5. Removes the data dir (/var/lib/childcheck) ONLY if the user explicitly
#      confirms a SECOND time (default: keep data — just remove binary + service).
#   6. Optionally removes the childcheck system user.
#   7. Prints post-uninstall instructions (where the backup is, how to re-install).
#
# Usage:
#   sudo bash install/uninstall-linux.sh
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
  echo "ERROR: run this script as root (use sudo)."
  exit 1
fi

INSTALL_DIR="/opt/childcheck"
DATA_DIR="/var/lib/childcheck"
SERVICE_USER="childcheck"
SERVICE_FILE="/etc/systemd/system/childcheck.service"

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
echo " ChildCheck uninstaller (Linux / systemd)"
echo "============================================================"
echo ""
echo " This will:"
echo "   - Stop + disable the '${SERVICE_USER}' systemd service."
echo "   - Remove the install dir:    ${INSTALL_DIR}"
echo "   - Remove the service unit:   ${SERVICE_FILE}"
echo "   - (Optionally) back up data: ~/childcheck-data-backup-<date>.tar.gz"
echo "   - (Optionally) remove data:  ${DATA_DIR}"
echo "   - (Optionally) remove user:  ${SERVICE_USER}"
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
# 1. Stop + disable the service
# ----------------------------------------------------------------------------
step "Stopping + disabling service"
if systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE_USER}\.service"; then
  systemctl stop "${SERVICE_USER}" 2>/dev/null || true
  systemctl disable "${SERVICE_USER}" 2>/dev/null || true
  info "service stopped + disabled."
else
  info "no '${SERVICE_USER}' systemd unit found — skipping."
fi

# Kill any stray process just in case (e.g. if launched outside systemd).
pkill -f "${INSTALL_DIR}/${SERVICE_USER}" 2>/dev/null || true

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
      BACKUP_PATH="${HOME}/childcheck-data-backup-${STAMP}.tar.gz"
      # Run as the calling user (SUDO_USER) if available, so the backup is
      # owned by the operator, not root.
      info "creating tarball: ${BACKUP_PATH}"
      # shellcheck disable=SC2086
      if ! tar -czf "${BACKUP_PATH}" -C "$(dirname "${DATA_DIR}")" "$(basename "${DATA_DIR}")" 2>/dev/null; then
        err "backup failed — aborting so data is NOT lost."
        exit 1
      fi
      # Fix ownership if we're root + SUDO_USER is set.
      if [ -n "${SUDO_USER:-}" ]; then
        chown "${SUDO_USER}:${SUDO_USER}" "${BACKUP_PATH}" 2>/dev/null || true
      fi
      info "backup complete: ${BACKUP_PATH}"
      # Make the backup readable + list its size.
      ls -lh "${BACKUP_PATH}"
      ;;
  esac
elif [ "${SKIP_BACKUP}" -eq 1 ]; then
  warn "--no-backup given — skipping backup."
fi

# ----------------------------------------------------------------------------
# 3. Remove install dir + service file
# ----------------------------------------------------------------------------
step "Removing install dir + service file"
if [ -d "${INSTALL_DIR}" ]; then
  rm -rf "${INSTALL_DIR}"
  info "removed ${INSTALL_DIR}."
else
  info "${INSTALL_DIR} not found — skipping."
fi

if [ -f "${SERVICE_FILE}" ]; then
  rm -f "${SERVICE_FILE}"
  info "removed ${SERVICE_FILE}."
else
  info "${SERVICE_FILE} not found — skipping."
fi

systemctl daemon-reload 2>/dev/null || true

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
  info "to remove it later:  sudo rm -rf ${DATA_DIR}"
fi

# ----------------------------------------------------------------------------
# 5. Optionally remove the service user
# ----------------------------------------------------------------------------
if id "${SERVICE_USER}" >/dev/null 2>&1; then
  step "Remove service user '${SERVICE_USER}'?"
  read -r -p "Remove the '${SERVICE_USER}' system user? [y/N] " RM_USER </dev/tty
  case "${RM_USER}" in
    [Yy]*)
      userdel "${SERVICE_USER}" 2>/dev/null || true
      # Also remove the group of the same name if it has no members.
      groupdel "${SERVICE_USER}" 2>/dev/null || true
      info "removed user '${SERVICE_USER}'."
      ;;
    *)
      info "kept user '${SERVICE_USER}'."
      ;;
  esac
fi

# ----------------------------------------------------------------------------
# 6. Post-uninstall summary
# ----------------------------------------------------------------------------
echo ""
echo "============================================================"
echo " ChildCheck uninstalled."
echo "============================================================"
echo ""
echo " Removed:"
echo "   - install dir:    ${INSTALL_DIR}"
echo "   - service unit:   ${SERVICE_FILE}"
[ "${REMOVE_DATA}" -eq 1 ] && echo "   - data dir:       ${DATA_DIR}"
echo ""
if [ -n "${BACKUP_PATH}" ]; then
  echo " Data backup:"
  echo "   ${BACKUP_PATH}"
  echo ""
  echo " To restore on a fresh install:"
  echo "   1. Re-run install/install-linux.sh"
  echo "   2. Stop the service:  sudo systemctl stop ${SERVICE_USER}"
  echo "   3. Extract the backup over the new data dir:"
  echo "        sudo tar -xzf ${BACKUP_PATH} -C $(dirname "${DATA_DIR}")"
  echo "   4. Copy the CHILDCHECK_DATA_KEY from the old .env (inside the backup's"
  echo "      config/.env) into the new ${DATA_DIR}/config/.env — without it,"
  echo "      encrypted photos + backups cannot be decrypted."
  echo "   5. Restart:  sudo systemctl start ${SERVICE_USER}"
elif [ "${REMOVE_DATA}" -eq 1 ]; then
  echo " No backup was created. Data has been permanently deleted."
else
  echo " Data dir left intact at:  ${DATA_DIR}"
  echo " To remove it manually:    sudo rm -rf ${DATA_DIR}"
fi
echo ""
echo " To reinstall later:"
echo "   sudo bash install/install-linux.sh"
echo "============================================================"
