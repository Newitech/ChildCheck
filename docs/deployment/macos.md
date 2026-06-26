# macOS Native Deployment

Installs ChildCheck as a user-level LaunchAgent on macOS, using the prebuilt
Bun-compiled binary.

## Supported targets

- `macos-arm64` (Apple Silicon: M1, M2, M3, M4)
- Intel Macs (`macos-x64`): not directly supported by the prebuilt binaries.
  Use [Docker](./docker.md) or build from source:
  ```bash
  bun build scripts/launcher.ts --compile --target=bun-darwin-x64 --outfile=childcheck
  ```

## Prerequisites

- macOS 11 (Big Sur) or newer.
- An admin user account (you do NOT need to be root — and shouldn't be).
- ~200 MB free disk.

## Install

### Option A — download + install in one command

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/childcheck/childcheck/main/install/install-macos.sh)"
```

### Option B — clone + run locally

```bash
git clone https://github.com/childcheck/childcheck.git
cd childcheck
bash install/install-macos.sh
```

### Option C — install a specific tarball

```bash
bash install/install-macos.sh /path/to/childcheck-macos-arm64.tar.gz
# or:
bash install/install-macos.sh /path/to/childcheck-macos-arm64/
```

The installer will:

1. Install the binary to `/Applications/ChildCheck/`.
2. Create `~/Library/Application Support/ChildCheck/{data,db,config,logs}`.
3. Strip the `com.apple.quarantine` extended attribute (downloaded files only).
4. Prompt for the public URL + auto-generate `NEXTAUTH_SECRET` + `CHILDCHECK_DATA_KEY`.
5. Write `~/Library/LaunchAgents/org.childcheck.plist`.
6. Load the agent.
7. Wait for `/api/config` to return 200, then print the URL.

> ⚠️ The service runs **as your user**, not as a system-wide daemon. If you want
> it to run regardless of who's logged in, install under a dedicated user
> account and use `/Library/LaunchDaemons/` instead of `~/Library/LaunchAgents/`.

## What goes where

| Path | Contents |
|---|---|
| `/Applications/ChildCheck/` | Binary + standalone server + prisma + mini-services |
| `/Applications/ChildCheck/data` → `~/Library/Application Support/ChildCheck/data` | Symlink |
| `/Applications/ChildCheck/db` → `~/Library/Application Support/ChildCheck/db` | Symlink |
| `/Applications/ChildCheck/config` → `~/Library/Application Support/ChildCheck/config` | Symlink |
| `~/Library/Application Support/ChildCheck/data/photos/` | Encrypted-at-rest photos |
| `~/Library/Application Support/ChildCheck/data/branding/` | Uploaded org logo |
| `~/Library/Application Support/ChildCheck/data/backups/` | Encrypted `.cbak` bundles |
| `~/Library/Application Support/ChildCheck/db/custom.db` | SQLite database |
| `~/Library/Application Support/ChildCheck/config/.env` | Environment file (chmod 600) |
| `~/Library/Application Support/ChildCheck/logs/` | stdout + stderr logs |
| `~/Library/LaunchAgents/org.childcheck.plist` | launchd plist |

## Service management

```bash
launchctl list | grep childcheck                       # status (PID + last exit)
launchctl unload ~/Library/LaunchAgents/org.childcheck.plist   # stop + disable
launchctl load   ~/Library/LaunchAgents/org.childcheck.plist   # start + enable
launchctl kickstart -k gui/$(id -u)/org.childcheck     # restart

# Tail logs:
tail -f ~/Library/Application\ Support/ChildCheck/logs/childcheck.stdout.log
tail -f ~/Library/Application\ Support/ChildCheck/logs/childcheck.stderr.log
```

## First-run setup

After install, the script prints:

```
Public URL:   http://mini.local:3000
Setup wizard: http://mini.local:3000/setup
```

Browse to the Setup URL and complete the wizard (organisation name + first
admin user). Default SDA programs are seeded automatically.

## Auto-start on boot

`~/Library/LaunchAgents/` agents only start when **you** log in. To run
ChildCheck as a system-wide daemon (starts on boot, runs as root or a
dedicated user), move the plist to `/Library/LaunchDaemons/` and adjust
ownership:

```bash
sudo chown root:wheel ~/Library/LaunchAgents/org.childcheck.plist
sudo mv ~/Library/LaunchAgents/org.childcheck.plist /Library/LaunchDaemons/org.childcheck.plist
sudo launchctl load /Library/LaunchDaemons/org.childcheck.plist
```

> ⚠️ If you switch to a LaunchDaemon, the data dir should move out of
> `~/Library/Application Support/` to a system-wide path like
> `/var/db/ChildCheck/` or `/Library/Application Support/ChildCheck/`. Update
> the symlinks in `/Applications/ChildCheck/` accordingly.

## Updating to a new version

See [Updating](./updating.md#macos-native).

## Backup

See [Backup & restore](./backup-restore.md).

## Uninstall

```bash
launchctl unload ~/Library/LaunchAgents/org.childcheck.plist
rm ~/Library/LaunchAgents/org.childcheck.plist
sudo rm -rf /Applications/ChildCheck
# Optional: keep data for later, or remove everything:
# rm -rf ~/Library/Application\ Support/ChildCheck
```

## Troubleshooting

### "childcheck cannot be opened because the developer cannot be verified"
macOS Gatekeeper blocks the downloaded binary. Either:
- Right-click → Open (one-time bypass), or
- Run `xattr -dr com.apple.quarantine /Applications/ChildCheck/childcheck`
  (the installer does this automatically).

### Service won't start: "exit code 1"
Check the stderr log:

```bash
tail -50 ~/Library/Application\ Support/ChildCheck/logs/childcheck.stderr.log
```

### Port 3000 already in use
Edit `~/Library/Application Support/ChildCheck/config/.env`, change `PORT=3000`
to e.g. `PORT=8080`, then:

```bash
launchctl unload ~/Library/LaunchAgents/org.childcheck.plist
launchctl load ~/Library/LaunchAgents/org.childcheck.plist
```

Don't forget to update `NEXTAUTH_URL` to match.

### I forgot the `CHILDCHECK_DATA_KEY`
The key is in `~/Library/Application Support/ChildCheck/config/.env`. Without
it, **existing photos and encrypted backups cannot be decrypted**. Keep this
file safe (Time Machine, encrypted note in 1Password, etc.).
