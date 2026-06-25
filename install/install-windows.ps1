# =============================================================================
# ChildCheck — Windows installer (PowerShell + WinSW service wrapper)
#
# What it does:
#   1. Installs the pre-built binary to C:\Program Files\ChildCheck\.
#   2. Creates C:\ProgramData\ChildCheck\{data,db,config,logs}.
#   3. Writes a default .env (prompting for NEXTAUTH_SECRET if not set).
#   4. Downloads WinSW (Windows Service Wrapper) into the install dir.
#   5. Writes a childcheck.xml config + childcheck.exe wrapper.
#   6. Registers + starts the Windows service.
#   7. Prints the URL + first-run setup instructions.
#
# Usage (run as Administrator in PowerShell):
#   .\install\install-windows.ps1                              # download latest
#   .\install\install-windows.ps1 -Source .\childcheck-win-x64.tar.gz
#   .\install\install-windows.ps1 -Source .\childcheck-win-x64
#
# Parameters:
#   -Source       Path to a local tarball or unpacked directory.
#   -Version      Release version to download (default: latest).
#   -InstallDir   Override the install directory (default: C:\Program Files\ChildCheck).
# =============================================================================
[CmdletBinding()]
param(
    [string]$Source = "",
    [string]$Version = "latest",
    [string]$InstallDir = "C:\Program Files\ChildCheck",
    [string]$UrlBase = "https://github.com/childcheck/childcheck/releases/download"
)

$ErrorActionPreference = "Stop"

# --- Admin check -------------------------------------------------------------
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "ERROR: run this script as Administrator." -ForegroundColor Red
    exit 1
}

# --- Constants ---------------------------------------------------------------
$target = "windows-x64"
$binaryName = "childcheck.exe"
$dataDir = "C:\ProgramData\ChildCheck"
$serviceName = "ChildCheck"
$serviceDisplayName = "ChildCheck — secure child check-in / check-out"
$serviceDescription = "Runs the ChildCheck web app + realtime mini-service."
$winswVersion = "2.12.0"
$winswUrl = "https://github.com/winsw/winsw/releases/download/v${winswVersion}/WinSW-x64.exe"

function Write-Info($msg)  { Write-Host "[info]  $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "[warn]  $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "[error] $msg" -ForegroundColor Red }
function Write-Step($msg)  { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }

# --- 0. Locate the binary ----------------------------------------------------
$workDir = Join-Path $env:TEMP "childcheck-install-$(Get-Random)"
New-Item -ItemType Directory -Path $workDir -Force | Out-Null

try {
    if ($Source -ne "") {
        if (Test-Path $Source -PathType Leaf) {
            Write-Info "using local file: $Source"
            tar -xzf $Source -C $workDir
            $srcDir = Get-ChildItem -Path $workDir -Directory | Where-Object { $_.Name -like "childcheck*" } | Select-Object -First 1
            if (-not $srcDir) { $srcDir = Get-Item $workDir }
            $srcDir = $srcDir.FullName
        } elseif (Test-Path $Source -PathType Container) {
            Write-Info "using local directory: $Source"
            $srcDir = $Source
        } else {
            Write-Err "source path does not exist: $Source"
            exit 1
        }
    } else {
        if ($Version -eq "latest") {
            $url = "$UrlBase/latest/childcheck-$target.tar.gz"
        } else {
            $url = "$UrlBase/v$Version/childcheck-$target.tar.gz"
        }
        Write-Step "Downloading $url"
        $tarball = Join-Path $workDir "childcheck.tar.gz"
        Invoke-WebRequest -Uri $url -OutFile $tarball -UseBasicParsing
        tar -xzf $tarball -C $workDir
        $srcDir = (Get-ChildItem -Path $workDir -Directory | Where-Object { $_.Name -like "childcheck*" } | Select-Object -First 1).FullName
        if (-not $srcDir) {
            Write-Err "could not find unpacked childcheck-* directory."
            exit 1
        }
    }

    $srcBinary = Join-Path $srcDir $binaryName
    if (-not (Test-Path $srcBinary)) {
        Write-Err "expected binary not found at $srcBinary"
        exit 1
    }

    # --- 1. Install dir ------------------------------------------------------
    Write-Step "Installing to $InstallDir"
    if ((Test-Path $InstallDir) -and (Test-Path (Join-Path $InstallDir $binaryName))) {
        Write-Warn "an existing install is present at $InstallDir."
        $overwrite = Read-Host "Overwrite? [y/N]"
        if ($overwrite -notmatch "^[Yy]$") {
            Write-Info "keeping existing install. Aborting."
            exit 0
        }
        # Stop the service before overwriting.
        try { Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue } catch {}
        $backupDir = "$InstallDir.bak.$(Get-Date -Format 'yyyyMMddHHmmss')"
        Move-Item $InstallDir $backupDir
        Write-Info "backed up old install to $backupDir"
    }

    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Copy-Item -Path (Join-Path $srcDir "*") -Destination $InstallDir -Recurse -Force
    # Remove the source's empty data/db/config dirs so we can symlink ours.
    Remove-Item -Path (Join-Path $InstallDir "data") -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -Path (Join-Path $InstallDir "db") -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -Path (Join-Path $InstallDir "config") -Recurse -Force -ErrorAction SilentlyContinue
    Write-Info "installed to $InstallDir."

    # --- 2. Data dir ---------------------------------------------------------
    Write-Step "Creating data directory $dataDir"
    $dirs = @(
        "$dataDir\data\photos",
        "$dataDir\data\branding",
        "$dataDir\data\backups",
        "$dataDir\db",
        "$dataDir\config",
        "$dataDir\logs"
    )
    foreach ($d in $dirs) { New-Item -ItemType Directory -Path $d -Force | Out-Null }

    # Create junctions so the binary finds data/db/config in its own dir.
    cmd /c mklink /J "$InstallDir\data" "$dataDir\data" | Out-Null
    cmd /c mklink /J "$InstallDir\db" "$dataDir\db" | Out-Null
    cmd /c mklink /J "$InstallDir\config" "$dataDir\config" | Out-Null
    Write-Info "data dir ready at $dataDir."

    # --- 3. .env file --------------------------------------------------------
    Write-Step "Configuring environment"
    $envFile = "$dataDir\config\.env"
    if (Test-Path $envFile) {
        Write-Info ".env already exists at $envFile — leaving as-is."
    } else {
        $defaultUrl = "http://localhost:3000"
        # Try to detect the machine's LAN IP.
        try {
            $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                   Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
                   Select-Object -First 1).IPAddress
            if ($ip) { $defaultUrl = "http://$ip`:3000" }
        } catch {}

        $nextauthUrl = Read-Host "Public URL [$defaultUrl]"
        if (-not $nextauthUrl) { $nextauthUrl = $defaultUrl }

        $nextauthSecret = Read-Host "NEXTAUTH_SECRET (blank = auto-generate)"
        if (-not $nextauthSecret) {
            $bytes = New-Object byte[] 32
            (New-Object Security.Cryptography.RandomNumberGenerator).GetBytes($bytes)
            $nextauthSecret = -join ($bytes | ForEach-Object { $_.ToString("x2") })
            Write-Info "generated NEXTAUTH_SECRET."
        }

        $dataKey = Read-Host "CHILDCHECK_DATA_KEY for photo/backup encryption (blank = auto-generate)"
        if (-not $dataKey) {
            $bytes = New-Object byte[] 32
            (New-Object Security.Cryptography.RandomNumberGenerator).GetBytes($bytes)
            $dataKey = -join ($bytes | ForEach-Object { $_.ToString("x2") })
            Write-Info "generated CHILDCHECK_DATA_KEY — SAVE THIS."
        }

        $envContent = @"
# ChildCheck environment — generated by install-windows.ps1 on $(Get-Date)
NEXTAUTH_URL=$nextauthUrl
NEXTAUTH_SECRET=$nextauthSecret
CHILDCHECK_DATA_KEY=$dataKey
DATABASE_URL=file:$dataDir\db\custom.db
CHILDCHECK_DATA_DIR=$dataDir\data
CHILDCHECK_CONFIG_DIR=$dataDir\config
REALTIME_PORT=3003
PORT=3000
HOSTNAME=0.0.0.0
"@
        # Use forward slashes in DATABASE_URL so Prisma's SQLite parser is happy.
        $envContent = $envContent -replace "\\", "/"
        Set-Content -Path $envFile -Value $envContent -Encoding ASCII
        Write-Info ".env written to $envFile."
    }

    # --- 4. Download WinSW ---------------------------------------------------
    Write-Step "Downloading WinSW v$winswVersion"
    $winswExe = Join-Path $InstallDir "childcheck-service.exe"
    Invoke-WebRequest -Uri $winswUrl -OutFile $winswExe -UseBasicParsing

    # --- 5. Write the WinSW XML config --------------------------------------
    Write-Step "Writing WinSW config"
    $xmlPath = Join-Path $InstallDir "childcheck-service.xml"

    # Read env vars from the .env file to inject into the XML.
    $envVars = @()
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) { return }
        $idx = $line.IndexOf("=")
        if ($idx -lt 0) { return }
        $k = $line.Substring(0, $idx).Trim()
        $v = $line.Substring($idx + 1).Trim()
        $envVars += "<env name=`"$k`" value=`"$v`" />"
    }
    $envVarsXml = $envVars -join "`n    "

    $xmlContent = @"
<service>
  <id>$serviceName</id>
  <name>$serviceDisplayName</name>
  <description>$serviceDescription</description>
  <executable>$InstallDir\$binaryName</executable>
  <workingdirectory>$InstallDir</workingdirectory>
  <logpath>$dataDir\logs</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
  <startmode>Automatic</startmode>
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="20 sec" />
  <onfailure action="restart" delay="30 sec" />
    $envVarsXml
</service>
"@
    Set-Content -Path $xmlPath -Value $xmlContent -Encoding ASCII
    Write-Info "WinSW config written to $xmlPath."

    # --- 6. Register + start the service ------------------------------------
    Write-Step "Registering + starting service"
    # Uninstall any previous version (ignore errors).
    & $winswExe uninstall 2>$null | Out-Null
    & $winswExe install
    & $winswExe start
    Write-Info "service installed + started."

    # Wait for it to come up.
    Write-Step "Waiting for service to come up"
    $ok = $false
    for ($i = 1; $i -le 30; $i++) {
        try {
            $resp = Invoke-WebRequest -Uri "http://localhost:3000/api/config" -UseBasicParsing -TimeoutSec 3
            if ($resp.StatusCode -eq 200) { $ok = $true; break }
        } catch {}
        Start-Sleep -Seconds 1
    }
    if (-not $ok) {
        Write-Warn "service did not respond within 30s."
        Write-Warn "check logs at: $dataDir\logs"
    } else {
        Write-Info "service is up."
    }

    # --- 7. Summary ----------------------------------------------------------
    $publicUrl = (Get-Content $envFile | Where-Object { $_ -match "^NEXTAUTH_URL=" }) -replace "NEXTAUTH_URL=", ""
    Write-Host ""
    Write-Host "============================================================"
    Write-Host " ChildCheck installed successfully."
    Write-Host "============================================================"
    Write-Host ""
    Write-Host " Service:      Get-Service $serviceName"
    Write-Host " Start:        Start-Service $serviceName"
    Write-Host " Stop:         Stop-Service $serviceName"
    Write-Host " Restart:      Restart-Service $serviceName"
    Write-Host " Logs:         Get-EventLog -LogName Application -Source `"$serviceName`" -Newest 50"
    Write-Host "               (also see $dataDir\logs\*.log)"
    Write-Host ""
    Write-Host " Install dir:  $InstallDir"
    Write-Host " Data dir:     $dataDir"
    Write-Host " Config:       $envFile"
    Write-Host ""
    Write-Host " Public URL:   $publicUrl"
    Write-Host " Setup wizard: $publicUrl/setup"
    Write-Host ""
    Write-Host " Next step:"
    Write-Host "   1. Open the Setup URL above in a browser."
    Write-Host "   2. Fill in your organisation name + first admin user."
    Write-Host "   3. Default SDA programs are seeded automatically on submit."
    Write-Host "   4. Sign in -> /admin -> Settings to configure branding + toggles."
    Write-Host ""
    Write-Host " IMPORTANT: back up the CHILDCHECK_DATA_KEY in $envFile."
    Write-Host "============================================================"
} finally {
    Remove-Item -Path $workDir -Recurse -Force -ErrorAction SilentlyContinue
}
