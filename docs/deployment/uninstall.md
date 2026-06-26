# Uninstalling ChildCheck

Each install method has a dedicated uninstaller. They all share the same
safety-first design:

- **Stop the service first** (so no files are locked / in use).
- **Require explicit confirmation** — the default is **NO** (you must type
  `yes` or `I-understand`).
- **Offer a data backup** (default **yes**) *before* removing anything.
- **Keep data by default** — removing the data dir requires a *second*,
  even more explicit confirmation (type `DELETE-FOREVER`).
- **Print post-uninstall instructions** including the backup path + how to
  re-install / restore.

> ⚠️ **Always back up the `CHILDCHECK_DATA_KEY`** from your `.env` file before
> uninstalling with `--remove-data` / `-RemoveData`. Without it, encrypted
> photos + backup bundles in any tarball/zip you made **cannot be decrypted**.

## Quick reference

| Platform | Uninstaller | Run as | Data dir |
|---|---|---|---|
| **Linux (systemd)** | `install/uninstall-linux.sh` | `root` (sudo) | `/var/lib/childcheck` |
| **macOS (launchd)** | `install/uninstall-macos.sh` | the owning user (NOT root) | `~/Library/Application Support/ChildCheck` |
| **Windows (WinSW)** | `install\uninstall-windows.ps1` | Administrator (PowerShell) | `C:\ProgramData\ChildCheck` |
| **Synology DSM** | `install/uninstall-nas-synology.sh` | `root` (sudo -i) | `/volume1/childcheck` |
| **Docker** | `docker compose down -v` (see below) | your user | the bind-mounted `./data` + `./db` + `./config` |

## Common flags

All four native uninstallers accept the same three flags (PowerShell uses
`-Flag` style):

| Bash flag | PowerShell flag | Effect |
|---|---|---|
| `--no-backup` | `-NoBackup` | Skip the data backup step. Only meaningful with `--remove-data`. |
| `--remove-data` | `-RemoveData` | Also remove the data dir. Still asks for a second confirmation. |
| `--yes` / `-y` | `-Yes` | Skip the initial confirmation prompt. (Still asks for the data-removal confirmation unless `--remove-data` is also given.) |

## Linux (systemd)

```bash
# Standard uninstall — keeps data, offers a backup.
sudo bash install/uninstall-linux.sh

# Fully remove everything (binary, service, AND data) — asks twice.
sudo bash install/uninstall-linux.sh --remove-data

# Non-interactive full purge (for scripts / CI):
sudo bash install/uninstall-linux.sh --yes --remove-data --no-backup
```

**What it removes:**

- Stops + disables the `childcheck` systemd service.
- `/opt/childcheck/` (install dir).
- `/etc/systemd/system/childcheck.service` (unit file).
- Optionally `/var/lib/childcheck/` (data dir — only with `--remove-data`).
- Optionally the `childcheck` system user (asks interactively).

**Backup:** tarball at `~/childcheck-data-backup-<timestamp>.tar.gz` (owned by
`SUDO_USER` if you ran via sudo).

## macOS (launchd)

```bash
# Standard uninstall — keeps data, offers a backup.
bash install/uninstall-macos.sh

# Fully remove everything — asks twice.
bash install/uninstall-macos.sh --remove-data
```

> Do **not** run this with `sudo` — launchd user agents belong to a specific
> user, so root can't manage them cleanly.

**What it removes:**

- Unloads (`launchctl unload`) + removes the launchd agent.
- `~/Library/LaunchAgents/org.childcheck.plist`.
- `/Applications/ChildCheck/` (install dir).
- Optionally `~/Library/Application Support/ChildCheck/` (data dir — only with
  `--remove-data`).

**Backup:** tarball at `~/childcheck-data-backup-<timestamp>.tar.gz`.

## Windows (WinSW service)

```powershell
# Standard uninstall — keeps data, offers a backup.
.\install\uninstall-windows.ps1

# Fully remove everything — asks twice.
.\install\uninstall-windows.ps1 -RemoveData

# Non-interactive full purge:
.\install\uninstall-windows.ps1 -Yes -RemoveData -NoBackup
```

Run as **Administrator** in PowerShell.

**What it removes:**

- Stops + removes the `ChildCheck` Windows service (via WinSW `uninstall`, with
  a `sc.exe delete` fallback).
- `C:\Program Files\ChildCheck\` (install dir).
- Optionally `C:\ProgramData\ChildCheck\` (data dir — only with `-RemoveData`).

**Backup:** zip at `~/Desktop/childcheck-data-backup-<timestamp>.zip`.

## Synology DSM

```bash
# Standard uninstall — keeps data, offers a backup.
bash install/uninstall-nas-synology.sh

# Fully remove everything — asks twice.
bash install/uninstall-nas-synology.sh --remove-data
```

Run over SSH as **root** (`sudo -i`).

**What it removes:**

- Stops the running ChildCheck process (`pkill` + `synoservicectl --stop`).
- Removes the DSM scheduled task via the `synotask` CLI (if available).
- `/volume1/@appstore/ChildCheck/` (install dir).
- `/usr/local/bin/childcheck-start.sh` (start script).
- Optionally `/volume1/childcheck/` (data dir — only with `--remove-data`).

**Manual task removal (if `synotask` CLI unavailable):** the uninstaller
prints instructions; in summary — open DSM → Control Panel → Task Scheduler →
select the "ChildCheck" task → Delete.

**Backup:** tarball at `/root/childcheck-data-backup-<timestamp>.tar.gz`
(or `SUDO_USER`'s home if invoked via sudo).

## Docker

There's no dedicated uninstaller for Docker — `docker compose` is the tool.

```bash
# Stop + remove the container (preserves bind-mounted data):
docker compose down

# Stop + remove the container AND the bind-mounted host directories:
docker compose down
rm -rf ./db ./data ./config
```

The bind-mounted `./db`, `./data`, `./config` host directories are **your**
data — back them up (e.g. `tar -czf childcheck-backup.tar.gz db data config`)
before deleting. See [Backup & restore](./backup-restore.md).

To also remove the Docker image:

```bash
docker rmi childcheck-childcheck   # or whatever the image is named
```

## Restoring from a backup

Every uninstaller's post-uninstall summary prints platform-specific restore
steps. The general procedure:

1. Re-run the matching **installer** (`install/install-<platform>.sh` or `.ps1`)
   to get a fresh, empty install.
2. **Stop** the freshly-started service (so the DB + files aren't locked).
3. **Extract** the tarball / zip **over** the new data dir, replacing its
   contents:
   - Linux:   `sudo tar -xzf ~/childcheck-data-backup-*.tar.gz -C /var/lib`
   - macOS:   `tar -xzf ~/childcheck-data-backup-*.tar.gz -C ~/Library/"Application Support"`
   - Windows: `Expand-Archive -Path "$env:USERPROFILE\Desktop\childcheck-data-backup-*.zip" -DestinationPath "C:\ProgramData" -Force`
   - Synology: `tar -xzf /root/childcheck-data-backup-*.tar.gz -C /volume1`
4. **Copy the `CHILDCHECK_DATA_KEY`** from the old `.env` (inside the backup's
   `config/.env`) into the new `.env`. Without it, encrypted photos + backup
   bundles **cannot be decrypted**.
5. **Restart** the service.

## Related docs

- [Configuration](./configuration.md) — all env vars including `PORT` +
  `REALTIME_PORT` (port-availability checks + alternative-port prompts).
- [Backup & restore](./backup-restore.md) — the in-app backup system.
- [Updating](./updating.md) — prefer updating over uninstalling when possible.
