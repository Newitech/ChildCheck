# Windows Native Deployment

Installs ChildCheck as a Windows Service on Windows 10/11 or Windows Server
2019+, using the prebuilt Bun-compiled binary and [WinSW](https://github.com/winsw/winsw)
as the service wrapper.

## Supported targets

- `windows-x64` (Intel/AMD 64-bit)

> ARM64 Windows isn't currently supported by the prebuilt binaries. Use
> [Docker](./docker.md) (with Docker Desktop's ARM64 emulation) or build
> from source.

## Prerequisites

- Windows 10 / 11 / Server 2019 or newer.
- PowerShell 5.1+ (Windows 10+ ships with it).
- Administrator account.
- ~300 MB free disk.

## Install

### Option A — clone + run locally

```powershell
git clone https://github.com/childcheck/childcheck.git
cd childcheck
.\install\install-windows.ps1
```

### Option B — install a specific tarball

```powershell
.\install\install-windows.ps1 -Source .\childcheck-windows-x64.tar.gz
# or:
.\install\install-windows.ps1 -Source .\childcheck-windows-x64\
```

### Option C — install a specific version

```powershell
.\install\install-windows.ps1 -Version 1.2.3
```

> ⚠️ If PowerShell Execution Policy blocks the script, run:
> ```powershell
> Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
> ```
> Or bypass once with:
> ```powershell
> powershell -ExecutionPolicy Bypass -File .\install\install-windows.ps1
> ```

The installer will:

1. Install the binary to `C:\Program Files\ChildCheck\`.
2. Create `C:\ProgramData\ChildCheck\{data,db,config,logs}`.
3. Create junctions (`data`, `db`, `config`) from the install dir to ProgramData.
4. Download WinSW v2.12.0 (`childcheck-service.exe`) into the install dir.
5. Prompt for the public URL + auto-generate `NEXTAUTH_SECRET` + `CHILDCHECK_DATA_KEY`.
6. Write `childcheck-service.xml` (WinSW config).
7. Register + start the `ChildCheck` service.
8. Wait for `/api/config` to return 200, then print the URL.

## What goes where

| Path | Contents |
|---|---|
| `C:\Program Files\ChildCheck\` | Binary + standalone server + prisma + mini-services + WinSW |
| `C:\Program Files\ChildCheck\data` → `C:\ProgramData\ChildCheck\data` | Junction |
| `C:\Program Files\ChildCheck\db` → `C:\ProgramData\ChildCheck\db` | Junction |
| `C:\Program Files\ChildCheck\config` → `C:\ProgramData\ChildCheck\config` | Junction |
| `C:\ProgramData\ChildCheck\data\photos\` | Encrypted-at-rest photos |
| `C:\ProgramData\ChildCheck\data\branding\` | Uploaded org logo |
| `C:\ProgramData\ChildCheck\data\backups\` | Encrypted `.cbak` bundles |
| `C:\ProgramData\ChildCheck\db\custom.db` | SQLite database |
| `C:\ProgramData\ChildCheck\config\.env` | Environment file |
| `C:\ProgramData\ChildCheck\logs\*.log` | Rotated WinSW logs |
| `C:\Program Files\ChildCheck\childcheck-service.xml` | WinSW config |

## Service management

```powershell
Get-Service ChildCheck                        # status
Start-Service ChildCheck                      # start
Stop-Service ChildCheck                       # stop
Restart-Service ChildCheck                    # restart

# View recent Windows Event Log entries:
Get-EventLog -LogName Application -Source "ChildCheck" -Newest 50

# Tail the WinSW log files:
Get-Content "C:\ProgramData\ChildCheck\logs\*.log" -Wait -Tail 50
```

You can also manage the service from the standard `services.msc` MMC snap-in
(services list).

## First-run setup

After install, the script prints:

```
Public URL:   http://192.168.1.50:3000
Setup wizard: http://192.168.1.50:3000/setup
```

Browse to the Setup URL and complete the wizard (organisation name + first
admin user). Default SDA programs are seeded automatically.

## Firewall

By default, Windows blocks inbound connections to the Next.js port. To allow
other devices on your LAN to reach the kiosk:

```powershell
New-NetFirewallRule -DisplayName "ChildCheck (HTTP 3000)" `
    -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Domain,Private
```

(Leave out `-Profile Domain,Private` if you want it accessible on Public
networks too — usually not recommended.)

## Updating to a new version

See [Updating](./updating.md#windows-native).

## Backup

See [Backup & restore](./backup-restore.md).

## Uninstall

```powershell
Stop-Service ChildCheck
& "C:\Program Files\ChildCheck\childcheck-service.exe" uninstall
Remove-Item -Recurse -Force "C:\Program Files\ChildCheck"
# Optional: keep data for later, or remove everything:
# Remove-Item -Recurse -Force "C:\ProgramData\ChildCheck"
```

## Troubleshooting

### Service stays in "Starting" state
WinSW couldn't start the wrapper binary. Check the WinSW log:

```powershell
Get-Content "C:\ProgramData\ChildCheck\logs\*.log" -Tail 50
```

### "Windows protected your PC" SmartScreen warning
On first run, Windows SmartScreen may block the binary. Click **More info** →
**Run anyway**. To suppress this for all future launches, right-click
`childcheck.exe` → Properties → check **Unblock**.

### Port 3000 already in use
Edit `C:\ProgramData\ChildCheck\config\.env`, change `PORT=3000` to e.g.
`PORT=8080`. Also update the `PORT` env var inside
`C:\Program Files\ChildCheck\childcheck-service.xml`. Then:

```powershell
Restart-Service ChildCheck
```

Don't forget to update `NEXTAUTH_URL` to match.

### I forgot the `CHILDCHECK_DATA_KEY`
The key is in `C:\ProgramData\ChildCheck\config\.env`. Without it, **existing
photos and encrypted backups cannot be decrypted**. Back this file up to a
safe location (encrypted password manager, USB drive in a locked drawer, etc.).
