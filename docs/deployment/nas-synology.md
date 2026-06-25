# Synology NAS Deployment

Installs ChildCheck on a Synology DiskStation (DSM 7+) using the prebuilt
Bun-compiled binary, registered as a boot-time scheduled task.

## Supported targets

- `linux-x64` (Intel/AMD x64 NAS — most DS418play, DS220+, DS920+, etc.)
- `linux-arm64` (ARMv8 64-bit NAS — DS220+, DS1522+, etc.)

> ARMv7 (armhf) NAS devices (older DS218, DS218play) are NOT supported by the
> prebuilt binaries. If your NAS supports Container Manager (Docker), use the
> [Docker](./docker.md) method instead.

## Prerequisites

- A Synology NAS running **DSM 7.0 or newer**.
- **SSH access** enabled:
  - DSM → Control Panel → Terminal & SNMP → Enable SSH service.
- Root access via SSH (`ssh youradmin@nas-ip`, then `sudo -i`).
- ~256 MB free RAM (the service is light).
- ~300 MB free disk on `volume1`.
- `curl` or `wget` (DSM ships with both).

## Install

### Step 1 — SSH in + become root

```bash
ssh youradmin@nas-ip
sudo -i
```

### Step 2 — run the installer

#### Option A — one-liner
```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/childcheck/childcheck/main/install/install-nas-synology.sh)"
```

#### Option B — download + run
```bash
cd /tmp
curl -fLO https://raw.githubusercontent.com/childcheck/childcheck/main/install/install-nas-synology.sh
bash install-nas-synology.sh
```

#### Option C — install a specific tarball you've uploaded
```bash
bash install-nas-synology.sh /volume1/downloads/childcheck-linux-x64.tar.gz
```

The installer will:

1. Detect the NAS architecture (x86_64 → `linux-x64`, arm64 → `linux-arm64`).
2. Install the binary to `/volume1/@appstore/ChildCheck/`.
3. Create `/volume1/childcheck/{data,db,config,logs}`.
4. Prompt for the public URL + auto-generate `NEXTAUTH_SECRET` + `CHILDCHECK_DATA_KEY`.
5. Write `/usr/local/bin/childcheck-start.sh`.
6. Try to register a boot task via the `synotask` CLI; if unavailable, print
   manual instructions for the DSM web UI.
7. Start the service in the background.
8. Wait for `/api/config` to return 200, then print the URL.

## What goes where

| Path | Contents |
|---|---|
| `/volume1/@appstore/ChildCheck/` | Binary + standalone server + prisma + mini-services |
| `/volume1/@appstore/ChildCheck/data` → `/volume1/childcheck/data` | Symlink |
| `/volume1/@appstore/ChildCheck/db` → `/volume1/childcheck/db` | Symlink |
| `/volume1/@appstore/ChildCheck/config` → `/volume1/childcheck/config` | Symlink |
| `/volume1/childcheck/data/photos/` | Encrypted-at-rest photos |
| `/volume1/childcheck/data/branding/` | Uploaded org logo |
| `/volume1/childcheck/data/backups/` | Encrypted `.cbak` bundles |
| `/volume1/childcheck/db/custom.db` | SQLite database |
| `/volume1/childcheck/config/.env` | Environment file (chmod 600) |
| `/volume1/childcheck/logs/` | stdout + stderr logs |
| `/usr/local/bin/childcheck-start.sh` | Start script (called by the scheduled task) |

## Registering the boot task manually (if the CLI failed)

If the installer couldn't auto-register a scheduled task, do it via the DSM
web UI:

1. Open **DSM → Control Panel → Task Scheduler**.
2. Click **Create → Triggered Task → User-defined script**.
3. **General** tab:
   - **Task**: `ChildCheck`
   - **User**: `root`
   - **Event**: `Boot-up`
   - **Enabled**: yes
4. **Task Settings** tab:
   - **Run command**: `/usr/local/bin/childcheck-start.sh`
5. Click **OK**.
6. To test it: right-click the task → **Run**.

## Service management

There's no systemd on DSM. To start/stop manually:

```bash
# Start (foreground, blocks):
/usr/local/bin/childcheck-start.sh

# Start in background (like the scheduled task does):
nohup /usr/local/bin/childcheck-start.sh \
  >/volume1/childcheck/logs/childcheck.stdout.log \
  2>/volume1/childcheck/logs/childcheck.stderr.log &

# Stop:
pkill -f "/volume1/@appstore/ChildCheck/childcheck"

# Restart:
pkill -f "/volume1/@appstore/ChildCheck/childcheck"; sleep 1
nohup /usr/local/bin/childcheck-start.sh \
  >/volume1/childcheck/logs/childcheck.stdout.log \
  2>/volume1/childcheck/logs/childcheck.stderr.log &

# Tail logs:
tail -f /volume1/childcheck/logs/childcheck.stdout.log
tail -f /volume1/childcheck/logs/childcheck.stderr.log
```

## DSM Firewall

By default, DSM blocks inbound connections to non-standard ports. To allow
LAN devices to reach the kiosk on port 3000:

1. DSM → Control Panel → Security → Firewall.
2. Edit the active profile → Create → Allow.
3. **Port**: Custom → TCP → `3000` (and `3003` if exposing realtime).
4. **Source IP**: Any (or restrict to your LAN subnet).
5. Click OK.

## Reverse proxy via DSM (optional, TLS)

DSM has a built-in reverse proxy feature that handles TLS for you:

1. DSM → Control Panel → Login Portal → Advanced → Reverse Proxy.
2. Create:
   - **Source**: HTTPS, hostname `checkin.mychurch.org`, port 443.
   - **Destination**: HTTP, `localhost`, port 3000.
3. Under **Settings → HSTS**, enable HSTS for added browser safety.
4. DSM will auto-provision a Let's Encrypt cert if you've configured DDNS.

> ⚠️ If you use a reverse proxy, update `NEXTAUTH_URL` in
> `/volume1/childcheck/config/.env` to `https://checkin.mychurch.org` and
> restart the service.

## First-run setup

After install, the script prints:

```
Public URL:   http://192.168.1.50:3000
Setup wizard: http://192.168.1.50:3000/setup
```

Browse to the Setup URL and complete the wizard (organisation name + first
admin user). Default SDA programs are seeded automatically.

## Updating to a new version

See [Updating](./updating.md#synology-nas).

## Backup

See [Backup & restore](./backup-restore.md).

The advantage of running on a NAS: you can use Synology's built-in tools to
back up `/volume1/childcheck/`:

- **Hyper Backup**: schedule a backup to a remote NAS, B2, S3, Google Drive.
  Encrypt + compress on the way out.
- **Snapshot Replication**: if your volume is BTRFS, take hourly snapshots —
  instant rollback of the DB + photos if something goes wrong.

## Uninstall

```bash
pkill -f "/volume1/@appstore/ChildCheck/childcheck"
# Remove the scheduled task via DSM UI (Task Scheduler → right-click → Delete).
rm /usr/local/bin/childcheck-start.sh
rm -rf /volume1/@appstore/ChildCheck
# Optional: keep data for later, or remove everything:
# rm -rf /volume1/childcheck
```

## Troubleshooting

### Service won't start: "Permission denied"
The binary needs the executable bit. The installer sets it, but if you copied
the files manually:

```bash
chmod +x /volume1/@appstore/ChildCheck/childcheck
```

### Boot task runs but the service doesn't come up
Check the logs:

```bash
cat /volume1/childcheck/logs/childcheck.stderr.log
```

Common causes:
- `.env` not loaded (the start script sources it — check it exists).
- Database dir not writable: `chown -R root:root /volume1/childcheck/`.

### Port 3000 already in use
DSM's own web UI uses ports 5000/5001; Photo Station uses 80/443. Port 3000
is usually free, but if you've installed another app, change `PORT=3000` in
`/volume1/childcheck/config/.env` to e.g. `PORT=8080`, then restart the
service. Don't forget to update `NEXTAUTH_URL` to match.

### I forgot the `CHILDCHECK_DATA_KEY`
The key is in `/volume1/childcheck/config/.env`. Without it, **existing photos
and encrypted backups cannot be decrypted**. Back this file up to a safe
location.
