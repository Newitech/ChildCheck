# Linux Native Deployment

Installs ChildCheck as a systemd service on any modern Linux distribution
(Debian/Ubuntu, RHEL/CentOS/Fedora, Arch, etc.) using the prebuilt Bun-compiled
binary.

## Supported targets

- `linux-x64` (Intel/AMD 64-bit)
- `linux-arm64` (Raspberry Pi 4/5 64-bit, AWS Graviton, Apple Silicon Linux VMs)

## Prerequisites

- A Linux server with:
  - systemd (any distro from the last ~10 years)
  - curl or wget
  - openssl (for secret generation)
  - ~256 MB free RAM
  - ~200 MB free disk for the install
- Root access (sudo)

## Install

### Option A — download + install in one command

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/childcheck/childcheck/main/install/install-linux.sh)"
```

### Option B — clone + run locally

```bash
git clone https://github.com/childcheck/childcheck.git
cd childcheck
sudo bash install/install-linux.sh
```

### Option C — install a specific tarball you've already downloaded

```bash
sudo bash install/install-linux.sh /path/to/childcheck-linux-x64.tar.gz
# or, for an unpacked directory:
sudo bash install/install-linux.sh /path/to/childcheck-linux-x64/
```

The installer will:

1. Create a `childcheck` system user (no shell, no home).
2. Install the binary to `/opt/childcheck/`.
3. Create `/var/lib/childcheck/{data,db,config}` with `chmod 750`.
4. Prompt for the public URL + auto-generate `NEXTAUTH_SECRET` + `CHILDCHECK_DATA_KEY`.
5. Write `/etc/systemd/system/childcheck.service`.
6. Enable + start the service.
7. Wait for `/api/config` to return 200, then print the URL.

## What goes where

| Path | Contents |
|---|---|
| `/opt/childcheck/` | Binary + standalone server + prisma + mini-services |
| `/opt/childcheck/data` → `/var/lib/childcheck/data` | Symlink to data dir |
| `/opt/childcheck/db` → `/var/lib/childcheck/db` | Symlink to SQLite dir |
| `/opt/childcheck/config` → `/var/lib/childcheck/config` | Symlink to env dir |
| `/var/lib/childcheck/data/photos/` | Encrypted-at-rest child photos |
| `/var/lib/childcheck/data/branding/` | Uploaded org logo |
| `/var/lib/childcheck/data/backups/` | Encrypted `.cbak` bundles |
| `/var/lib/childcheck/db/custom.db` | SQLite database |
| `/var/lib/childcheck/config/.env` | Environment file (chmod 600) |
| `/etc/systemd/system/childcheck.service` | systemd unit |

## Service management

```bash
systemctl status childcheck              # current status + last 10 log lines
systemctl restart childcheck             # restart
systemctl stop childcheck                # stop
systemctl start childcheck               # start
systemctl disable childcheck             # stop auto-starting on boot
systemctl enable childcheck              # re-enable auto-start
journalctl -u childcheck -f              # follow logs (live)
journalctl -u childcheck --since "1h ago"   # logs from last hour
journalctl -u childcheck --since today  # today's logs
```

## First-run setup

After install, the script prints:

```
Public URL:   http://192.168.1.50:3000
Setup wizard: http://192.168.1.50:3000/setup
```

Browse to the Setup URL and complete the wizard (organisation name + first
admin user). Default SDA programs are seeded automatically.

## systemd unit hardening

The generated unit file includes these hardening directives:

```ini
NoNewPrivileges=yes          # No setuid binaries
ProtectSystem=strict         # / is read-only except WritePaths
ProtectHome=yes              # /home, /root, /run/user are invisible
ReadWritePaths=/var/lib/childcheck /opt/childcheck
PrivateTmp=yes               # Private /tmp
PrivateDevices=yes           # No /dev access except minimum
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=yes
LockPersonality=yes
```

If you need to relax any of these (e.g. for a network printer), edit
`/etc/systemd/system/childcheck.service`, run `systemctl daemon-reload`, and
`systemctl restart childcheck`.

## Updating to a new version

See [Updating](./updating.md#linux-native).

## Backup

See [Backup & restore](./backup-restore.md). The short version:

```bash
# Trigger an immediate backup via the admin UI (Admin → Backup → "Backup now"),
# or call the API directly:
curl -X POST -b cookie.txt http://localhost:3000/api/admin/backup

# Then rsync the bundle offsite:
rsync -avz /var/lib/childcheck/data/backups/ user@offsite:/backups/childcheck/
```

## Uninstall

```bash
sudo systemctl stop childcheck
sudo systemctl disable childcheck
sudo rm /etc/systemd/system/childcheck.service
sudo systemctl daemon-reload
sudo rm -rf /opt/childcheck
# Optional: keep data for later, or remove everything:
# sudo rm -rf /var/lib/childcheck
sudo userdel childcheck
```

## Troubleshooting

### `Failed to start childcheck.service: Unit ... is not loaded properly`
Syntax error in the unit file. Inspect:

```bash
systemctl status childcheck
journalctl -u childcheck -n 50
```

### Service starts but `/api/config` returns 500
Most likely the SQLite DB is locked or corrupt. Stop the service, inspect:

```bash
sudo systemctl stop childcheck
sudo -u childcheck sqlite3 /var/lib/childcheck/db/custom.db ".schema"
```

### Port 3000 already in use
Edit `/var/lib/childcheck/config/.env`, change `PORT=3000` to e.g. `PORT=8080`,
then `sudo systemctl restart childcheck`. Don't forget to update `NEXTAUTH_URL`
to match.

### I forgot the `CHILDCHECK_DATA_KEY`
The key is in `/var/lib/childcheck/config/.env`. Without it, **existing photos
and encrypted backups cannot be decrypted**. Keep this file safe!
