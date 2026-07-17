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
#   .\install\install-windows.ps1 -Tls                         # also install + configure Caddy for HTTPS
#
# Parameters:
#   -Source       Path to a local tarball or unpacked directory.
#   -Version      Release version to download (default: latest).
#   -InstallDir   Override the install directory (default: C:\Program Files\ChildCheck).
#   -Tls          Opt-in TLS termination via Caddy. Downloads Caddy for Windows
#                 into the install dir, generates a Caddyfile, and registers a
#                 second WinSW service (ChildCheck-Caddy). Prompts for a domain
#                 name (blank for LAN-only self-signed via Caddy's internal CA).
# =============================================================================
[CmdletBinding()]
param(
    [string]$Source = "",
    [string]$Version = "latest",
    [string]$InstallDir = "C:\Program Files\ChildCheck",
    [string]$UrlBase = "https://github.com/Newitech/ChildCheck/releases",
    [switch]$Tls
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

# --- Port helpers ------------------------------------------------------------
# Test-PortFree(port) → $true if nothing is listening on the port.
function Test-PortFree([int]$Port) {
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start()
        $listener.Stop()
        return $true
    } catch {
        return $false
    }
}

# Read-Port($Default, $Label) → the chosen port number.
# If $Default is in use, prompts for an alternative + validates (numeric + free).
function Read-Port([int]$Default, [string]$Label) {
    $port = $Default
    if (-not (Test-PortFree $Default)) {
        Write-Warn "port $Default is already in use ($Label)."
        # Suggest next port up.
        $suggest = $Default + 1
        while (-not (Test-PortFree $suggest)) { $suggest++ }
        $alt = Read-Host "Use an alternative port for $Label? [$suggest]"
        if (-not $alt) { $port = $suggest } else { $port = [int]$alt }
        while ($port -lt 1 -or $port -gt 65535) {
            Write-Err "'$port' is not a valid port (must be 1-65535)."
            $alt = Read-Host "$Label port [$suggest]"
            if (-not $alt) { $port = $suggest } else { $port = [int]$alt }
        }
        while (-not (Test-PortFree $port)) {
            Write-Err "port $port is also in use."
            $alt = Read-Host "$Label port [$suggest]"
            if (-not $alt) { $port = $suggest } else { $port = [int]$alt }
            while ($port -lt 1 -or $port -gt 65535) {
                Write-Err "'$port' is not a valid port (must be 1-65535)."
                $alt = Read-Host "$Label port [$suggest]"
                if (-not $alt) { $port = $suggest } else { $port = [int]$alt }
            }
        }
        if ($port -ne $Default) {
            Write-Info "using $Label port $port (default $Default was in use)."
        }
    }
    return $port
}

# --- 0. Locate the binary ----------------------------------------------------
# Use the system temp dir (C:\Windows\Temp) instead of the user's AppData\Local\Temp
# to avoid permission issues when running as Administrator via a different user session.
$workDir = Join-Path "$env:SystemRoot\Temp" "childcheck-install-$(Get-Random)"
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
            $url = "$UrlBase/latest/download/childcheck-$target.tar.gz"
        } else {
            $url = "$UrlBase/download/v$Version/childcheck-$target.tar.gz"
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
        # Pull existing PORT/REALTIME_PORT for the health-check + summary.
        $existingPort = (Get-Content $envFile | Where-Object { $_ -match "^PORT=" }) -replace "PORT=", ""
        $existingRt   = (Get-Content $envFile | Where-Object { $_ -match "^REALTIME_PORT=" }) -replace "REALTIME_PORT=", ""
        $port        = if ($existingPort) { [int]$existingPort.Trim() } else { 3000 }
        $realtimePort = if ($existingRt)   { [int]$existingRt.Trim() }   else { 3003 }
    } else {
        # Prompt for ports if defaults are in use.
        Write-Step "Choosing ports (default: web 3000, realtime 3003)"
        $port = Read-Port 3000 "web server"
        $realtimePort = Read-Port 3003 "realtime (Socket.io)"

        $defaultUrl = "http://localhost:$port"
        # Try to detect the machine's LAN IP.
        try {
            $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                   Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
                   Select-Object -First 1).IPAddress
            if ($ip) { $defaultUrl = "http://$ip`:$port" }
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
REALTIME_PORT=$realtimePort
PORT=$port
HOSTNAME=0.0.0.0
"@
        # Use forward slashes in DATABASE_URL so Prisma's SQLite parser is happy.
        $envContent = $envContent -replace "\\", "/"
        Set-Content -Path $envFile -Value $envContent -Encoding ASCII
        Write-Info ".env written to $envFile."
        Write-Info "  PORT=$port  REALTIME_PORT=$realtimePort"
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
            $resp = Invoke-WebRequest -Uri "http://localhost:$port/api/config" -UseBasicParsing -TimeoutSec 3
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

    # --- 6a. Opt-in TLS via Caddy (-Tls switch) ------------------------------
    $caddyServiceName = "ChildCheck-Caddy"
    $caddyExe = Join-Path $InstallDir "caddy.exe"
    $caddyfile = Join-Path $dataDir "config\Caddyfile"
    $caddyWinswExe = Join-Path $InstallDir "caddy-service.exe"
    $caddyWinswXml = Join-Path $InstallDir "caddy-service.xml"
    if ($Tls) {
        Write-Step "Configuring TLS via Caddy (-Tls)"

        # Download Caddy for Windows (single static binary).
        if (-not (Test-Path $caddyExe)) {
            Write-Info "downloading Caddy for Windows..."
            # The official Caddy releases publish caddy_<ver>_windows_amd64.zip.
            # We download from the GitHub releases — the latest stable tag.
            $caddyLatestUrl = "https://caddyserver.com/api/download?os=windows&arch=amd64"
            $caddyZip = Join-Path $workDir "caddy.zip"
            try {
                Invoke-WebRequest -Uri $caddyLatestUrl -OutFile $caddyZip -UseBasicParsing
                Expand-Archive -Path $caddyZip -DestinationPath $InstallDir -Force
                # The zip extracts `caddy.exe` directly into the destination.
                if (-not (Test-Path $caddyExe)) {
                    # Look one level deeper in case it landed in a subfolder.
                    $found = Get-ChildItem -Path $InstallDir -Recurse -Filter "caddy.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
                    if ($found) { Move-Item $found.FullName $caddyExe -Force }
                }
            } catch {
                Write-Err "failed to download Caddy: $($_.Exception.Message)"
                Write-Err "download manually from https://caddyserver.com/download and place caddy.exe at $caddyExe"
            }
        } else {
            Write-Info "Caddy already present at $caddyExe."
        }

        if (Test-Path $caddyExe) {
            # Prompt for the domain (blank = LAN-only self-signed).
            Write-Host ""
            Write-Host "  Domain name (blank for LAN-only self-signed):"
            Write-Host "    - For a real domain (e.g. checkin.mychurch.org): Caddy auto-provisions"
            Write-Host "      + auto-renews a Let's Encrypt cert. Ports 80 + 443 must be open."
            Write-Host "    - Blank: Caddy uses its built-in internal CA (self-signed). Import"
            Write-Host "      Caddy's root cert into each client's trust store — see"
            Write-Host "      install/Caddyfile.lan for the per-OS commands."
            $tlsDomain = Read-Host "  Domain [blank for LAN-only]"
            $tlsDomain = $tlsDomain.Trim()

            # Locate the Caddyfile templates shipped alongside this script.
            $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
            if (-not $scriptDir) { $scriptDir = (Get-Location).Path }
            $domainTemplate = Join-Path $scriptDir "Caddyfile.domain"
            $lanTemplate = Join-Path $scriptDir "Caddyfile.lan"

            # Generate the Caddyfile.
            $caddyConfigDir = Split-Path -Parent $caddyfile
            New-Item -ItemType Directory -Path $caddyConfigDir -Force | Out-Null

            if ($tlsDomain) {
                Write-Info "using DOMAIN mode (auto-Let's-Encrypt for $tlsDomain)."
                if (Test-Path $domainTemplate) {
                    $content = Get-Content $domainTemplate -Raw
                    $content = $content -replace '\{\$DOMAIN\}', $tlsDomain
                    $content = $content -replace '\{\$PORT:3000\}', $port
                    Set-Content -Path $caddyfile -Value $content -Encoding ASCII
                } else {
                    $caddyContent = @"
$tlsDomain {
    reverse_proxy localhost:$port
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "geolocation=(), microphone=(), camera=()"
    }
}
"@
                    Set-Content -Path $caddyfile -Value $caddyContent -Encoding ASCII
                }
                $tlsPublicHost = $tlsDomain
            } else {
                Write-Info "using LAN-only mode (Caddy internal CA — self-signed)."
                if (Test-Path $lanTemplate) {
                    $content = Get-Content $lanTemplate -Raw
                    $content = $content -replace '\{\$PORT:3000\}', $port
                    Set-Content -Path $caddyfile -Value $content -Encoding ASCII
                } else {
                    $caddyContent = @"
:443 {
    tls internal
    reverse_proxy localhost:$port
}
"@
                    Set-Content -Path $caddyfile -Value $caddyContent -Encoding ASCII
                }
                # Use the LAN IP for NEXTAUTH_URL.
                try {
                    $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                           Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
                           Select-Object -First 1).IPAddress
                    if ($ip) { $tlsPublicHost = $ip } else { $tlsPublicHost = "localhost" }
                } catch { $tlsPublicHost = "localhost" }
            }
            Write-Info "Caddyfile written to $caddyfile."

            # Open ports 80 + 443 in Windows Firewall (best-effort).
            try {
                New-NetFirewallRule -DisplayName "ChildCheck Caddy HTTP (80)" -Direction Inbound -LocalPort 80 -Protocol TCP -Action Allow -ErrorAction SilentlyContinue | Out-Null
                New-NetFirewallRule -DisplayName "ChildCheck Caddy HTTPS (443)" -Direction Inbound -LocalPort 443 -Protocol TCP -Action Allow -ErrorAction SilentlyContinue | Out-Null
                Write-Info "Windows Firewall: allowed 80/tcp + 443/tcp."
            } catch {
                Write-Warn "could not open firewall ports (continue manually if needed)."
            }

            # Copy the WinSW binary under a different name for the Caddy service.
            if (Test-Path $winswExe) {
                Copy-Item $winswExe $caddyWinswExe -Force
            } else {
                Invoke-WebRequest -Uri $winswUrl -OutFile $caddyWinswExe -UseBasicParsing
            }

            # Write the Caddy WinSW XML config.
            $caddyXmlContent = @"
<service>
  <id>$caddyServiceName</id>
  <name>ChildCheck Caddy — TLS reverse proxy</name>
  <description>Runs Caddy to terminate HTTPS in front of ChildCheck.</description>
  <executable>$caddyExe</executable>
  <arguments>run --config $caddyfile</arguments>
  <workingdirectory>$dataDir\config</workingdirectory>
  <logpath>$dataDir\logs</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
  <startmode>Automatic</startmode>
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="20 sec" />
  <onfailure action="restart" delay="30 sec" />
</service>
"@
            Set-Content -Path $caddyWinswXml -Value $caddyXmlContent -Encoding ASCII
            Write-Info "Caddy WinSW config written to $caddyWinswXml."

            # Register + start the Caddy service.
            & $caddyWinswExe uninstall 2>$null | Out-Null
            & $caddyWinswExe install
            & $caddyWinswExe start
            Write-Info "Caddy service installed + started."

            # Rewrite NEXTAUTH_URL to HTTPS so cookies are marked Secure.
            $httpsUrl = "https://$tlsPublicHost"
            if (Test-Path $envFile) {
                $envContent = Get-Content $envFile
                $envContent = $envContent | ForEach-Object {
                    if ($_ -match "^NEXTAUTH_URL=") { "NEXTAUTH_URL=$httpsUrl" } else { $_ }
                }
                Set-Content -Path $envFile -Value $envContent -Encoding ASCII
                Write-Info "NEXTAUTH_URL updated to $httpsUrl in $envFile."
                # Restart the ChildCheck service so it picks up the new URL.
                Restart-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
            }
        } else {
            Write-Warn "Caddy binary not found at $caddyExe — skipping Caddy setup."
            Write-Warn "Download manually from https://caddyserver.com/download and re-run with -Tls."
        }
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
    if ($Tls -and (Test-Path $caddyfile)) {
        Write-Host " TLS:          Caddy reverse proxy (ports 80 + 443)"
        Write-Host "               Caddyfile:  $caddyfile"
        Write-Host "               Service:    Get-Service $caddyServiceName"
        Write-Host "               Logs:       $dataDir\logs\*.log"
        if ($tlsDomain) {
            Write-Host "               Cert:       auto-Let's-Encrypt for $tlsDomain"
        } else {
            Write-Host "               Cert:       Caddy internal CA (self-signed)."
            Write-Host "                           Import the root cert on each client:"
            Write-Host "                           C:\ProgramData\Caddy\pki\authorities\local\root.crt"
        }
        Write-Host ""
    }
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
