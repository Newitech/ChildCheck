# =============================================================================
# ChildCheck — Windows uninstaller (WinSW service)
#
# What it does:
#   1. Stops + removes the ChildCheck Windows service (via WinSW).
#   2. Asks for explicit confirmation (default: NO — requires "yes" / "I-understand").
#   3. Offers to back up the data dir to a .zip on the current user's desktop
#      (default: yes — the backup happens BEFORE any removal).
#   4. Removes the install dir (C:\Program Files\ChildCheck).
#   5. Removes the data dir (C:\ProgramData\ChildCheck) ONLY if the user
#      explicitly confirms a SECOND time (default: keep data — just remove
#      binary + service).
#   6. Prints post-uninstall instructions (where the backup is, how to re-install).
#
# Usage (run as Administrator in PowerShell):
#   .\install\uninstall-windows.ps1
#
# Flags:
#   -NoBackup      Skip the data backup step (only meaningful with -RemoveData).
#   -RemoveData    Remove the data dir too (still asks for confirmation).
#   -Yes           Skip the initial confirmation prompt (still asks for data
#                  removal confirmation unless -RemoveData is also given).
# =============================================================================
[CmdletBinding()]
param(
    [switch]$NoBackup,
    [switch]$RemoveData,
    [switch]$Yes
)

$ErrorActionPreference = "Stop"

# --- Admin check -------------------------------------------------------------
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "ERROR: run this script as Administrator." -ForegroundColor Red
    exit 1
}

# --- Constants ---------------------------------------------------------------
$installDir   = "C:\Program Files\ChildCheck"
$dataDir      = "C:\ProgramData\ChildCheck"
$serviceName  = "ChildCheck"
$binaryName   = "childcheck.exe"
$winswExeName = "childcheck-service.exe"

function Write-Info($msg) { Write-Host "[info]  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[warn]  $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "[error] $msg" -ForegroundColor Red }
function Write-Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }

# ----------------------------------------------------------------------------
# 0. Confirmation
# ----------------------------------------------------------------------------
Write-Host ""
Write-Host "============================================================"
Write-Host " ChildCheck uninstaller (Windows / WinSW service)"
Write-Host "============================================================"
Write-Host ""
Write-Host " This will:"
Write-Host "   - Stop + remove the '$serviceName' Windows service."
Write-Host "   - Remove the install dir:  $installDir"
Write-Host "   - (Optionally) back up data to a .zip on your desktop."
Write-Host "   - (Optionally) remove data: $dataDir"
Write-Host ""
Write-Host " Data is KEPT by default. Removing it requires explicit confirmation."
Write-Host "============================================================"
Write-Host ""

if (-not $Yes) {
    $confirm = Read-Host "Type 'yes' or 'I-understand' to proceed (anything else aborts)"
    if ($confirm -ne "yes" -and $confirm -ne "I-understand") {
        Write-Host "Aborted - no changes were made."
        exit 0
    }
}

# ----------------------------------------------------------------------------
# 1. Stop + remove the service
# ----------------------------------------------------------------------------
Write-Step "Stopping + removing service"

# Try WinSW first (it manages its own service registration cleanly).
$winswExe = Join-Path $installDir $winswExeName
$serviceExists = $false
try {
    $svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($svc) { $serviceExists = $true }
} catch {}

if ($serviceExists) {
    # Stop the service (idempotent).
    try { Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue } catch {}
    Start-Sleep -Seconds 1

    # Prefer WinSW uninstall (it cleans up the service registration + event log source).
    if (Test-Path $winswExe) {
        try {
            & $winswExe uninstall 2>$null | Out-Null
            Write-Info "service removed via WinSW."
        } catch {
            # Fall back to sc.exe.
            & sc.exe delete $serviceName 2>$null | Out-Null
            Write-Info "service removed via sc.exe (WinSW uninstall failed)."
        }
    } else {
        & sc.exe delete $serviceName 2>$null | Out-Null
        Write-Info "service removed via sc.exe."
    }
} else {
    Write-Info "no '$serviceName' service found - skipping."
}

# Kill any stray process just in case.
Get-Process -Name "childcheck" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# ----------------------------------------------------------------------------
# 2. Backup
# ----------------------------------------------------------------------------
$backupPath = ""
if ((Test-Path $dataDir) -and -not $NoBackup) {
    Write-Step "Backing up data dir"
    $doBackup = Read-Host "Back up $dataDir before removal? [Y/n]"
    if (-not $doBackup) { $doBackup = "Y" }
    if ($doBackup -match "^[Nn]") {
        Write-Warn "skipping backup. If you proceed with -RemoveData, the data will be lost."
    } else {
        $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $desktop = [Environment]::GetFolderPath("Desktop")
        if (-not $desktop) { $desktop = $env:USERPROFILE }
        $backupPath = Join-Path $desktop "childcheck-data-backup-$stamp.zip"
        Write-Info "creating zip: $backupPath"
        try {
            # Compress-Archive requires the source path to exist + not be open.
            # Exclude the running binary's locked files (logs/*.log may be locked
            # by the just-stopped service — skip them on failure).
            Compress-Archive -Path $dataDir -DestinationPath $backupPath -Force -ErrorAction Stop
            Write-Info "backup complete: $backupPath"
            Get-Item $backupPath | Select-Object FullName, @{n="SizeMB";e={[math]::Round($_.Length/1MB,2)}} | Format-List
        } catch {
            Write-Err "backup failed: $($_.Exception.Message)"
            Write-Err "aborting so data is NOT lost."
            exit 1
        }
    }
} elseif ($NoBackup) {
    Write-Warn "-NoBackup given - skipping backup."
}

# ----------------------------------------------------------------------------
# 3. Remove install dir
# ----------------------------------------------------------------------------
Write-Step "Removing install dir"
if (Test-Path $installDir) {
    try {
        Remove-Item -Path $installDir -Recurse -Force -ErrorAction Stop
        Write-Info "removed $installDir."
    } catch {
        # Some files (e.g. logs) may still be locked for a moment after the
        # service stops. Wait + retry once.
        Start-Sleep -Seconds 2
        try {
            Remove-Item -Path $installDir -Recurse -Force -ErrorAction Stop
            Write-Info "removed $installDir (on retry)."
        } catch {
            Write-Warn "could not fully remove ${installDir}: $($_.Exception.Message)"
            Write-Warn "remaining files - close any open editors + delete manually."
        }
    }
} else {
    Write-Info "$installDir not found - skipping."
}

# ----------------------------------------------------------------------------
# 4. Remove data dir (only with explicit confirmation)
# ----------------------------------------------------------------------------
if ($RemoveData -and (Test-Path $dataDir)) {
    Write-Step "Removing data dir $dataDir"
    Write-Host ""
    Write-Host "  *** You passed -RemoveData. ***"
    Write-Host "  This will PERMANENTLY DELETE:"
    Write-Host "    - The SQLite database (children, families, programs, attendance...)"
    Write-Host "    - All encrypted-at-rest photos"
    Write-Host "    - All branding assets"
    Write-Host "    - All encrypted backup bundles (.cbak files)"
    Write-Host ""
    if ($backupPath) {
        Write-Host "  A backup was created at: $backupPath"
        Write-Host "  RESTORE PREREQUISITE: keep the CHILDCHECK_DATA_KEY from"
        Write-Host "  $dataDir\config\.env - without it, the backup cannot be decrypted."
        Write-Host ""
    } else {
        Write-Host "  NO BACKUP was created. This deletion is irreversible."
        Write-Host ""
    }
    $delConfirm = Read-Host "Type 'DELETE-FOREVER' to permanently remove $dataDir"
    if ($delConfirm -eq "DELETE-FOREVER") {
        try {
            Remove-Item -Path $dataDir -Recurse -Force -ErrorAction Stop
            Write-Info "removed $dataDir."
        } catch {
            Start-Sleep -Seconds 2
            try {
                Remove-Item -Path $dataDir -Recurse -Force -ErrorAction Stop
                Write-Info "removed $dataDir (on retry)."
            } catch {
                Write-Warn "could not fully remove $dataDir - delete manually."
            }
        }
    } else {
        Write-Warn "kept data dir $dataDir (confirmation didn't match 'DELETE-FOREVER')."
    }
} elseif (Test-Path $dataDir) {
    Write-Step "Keeping data dir"
    Write-Info "data dir left intact at $dataDir."
    Write-Info "to remove it later:  Remove-Item -Recurse -Force '$dataDir'"
}

# ----------------------------------------------------------------------------
# 5. Post-uninstall summary
# ----------------------------------------------------------------------------
Write-Host ""
Write-Host "============================================================"
Write-Host " ChildCheck uninstalled."
Write-Host "============================================================"
Write-Host ""
Write-Host " Removed:"
Write-Host "   - install dir:  $installDir"
Write-Host "   - service:      $serviceName"
if ($RemoveData) { Write-Host "   - data dir:     $dataDir" }
Write-Host ""
if ($backupPath) {
    Write-Host " Data backup:"
    Write-Host "   $backupPath"
    Write-Host ""
    Write-Host " To restore on a fresh install:"
    Write-Host "   1. Re-run .\install\install-windows.ps1"
    Write-Host "   2. Stop the service:  Stop-Service $serviceName"
    Write-Host "   3. Extract the backup over the new data dir:"
    Write-Host "        Expand-Archive -Path '$backupPath' -DestinationPath 'C:\ProgramData' -Force"
    Write-Host "   4. Copy the CHILDCHECK_DATA_KEY from the old .env (inside the backup's"
    Write-Host "      config\.env) into the new $dataDir\config\.env - without it,"
    Write-Host "      encrypted photos + backups cannot be decrypted."
    Write-Host "   5. Restart:  Start-Service $serviceName"
} elseif ($RemoveData) {
    Write-Host " No backup was created. Data has been permanently deleted."
} else {
    Write-Host " Data dir left intact at:  $dataDir"
    Write-Host " To remove it manually:    Remove-Item -Recurse -Force '$dataDir'"
}
Write-Host ""
Write-Host " To reinstall later:"
Write-Host "   .\install\install-windows.ps1"
Write-Host "============================================================"
