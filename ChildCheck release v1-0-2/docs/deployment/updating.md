# Updating ChildCheck

How to update to a new version of ChildCheck without losing data.

> ⚠️ **Always take a fresh backup before updating.** See
> [Backup & restore](./backup-restore.md).

> ⚠️ Read the release notes for any breaking changes (schema migrations,
> config format changes, required env vars) before updating.

## General update flow

Every update does the same three things:

1. **Stop the service.**
2. **Replace the binary / image.** (Don't touch the data/db/config directories!)
3. **Start the service.** The launcher auto-runs `prisma db:push` on boot,
   which applies any new schema changes non-destructively.

If the new version requires a manual migration that `db:push` can't handle,
the release notes will say so explicitly.

## Docker

```bash
cd /path/to/childcheck
git pull                       # get the latest Dockerfile + docker-compose.yml
docker compose pull            # if using a prebuilt image; otherwise:
docker compose up -d --build   # rebuild with the new code
```

The container's entrypoint runs `bun run db:push` on every boot, so schema
changes are applied automatically.

Verify:

```bash
docker compose logs -f childcheck | head -20
# look for "[entrypoint] db:push complete"
curl http://localhost:3000/api/config | jq .
```

## Linux native

```bash
# 1. Back up (always).
sudo systemctl stop childcheck
sudo cp -a /var/lib/childcheck /var/lib/childcheck.pre-update.$(date +%Y%m%d%H%M%S)

# 2. Download the new tarball + run the installer over the existing install.
#    The installer detects the existing install, prompts to overwrite, and
#    backs up the old install dir automatically.
sudo bash install/install-linux.sh /path/to/childcheck-linux-x64.tar.gz

# 3. The installer restarts the service automatically. Verify:
systemctl status childcheck
journalctl -u childcheck -f
```

If you only want to swap the binary without re-running the installer:

```bash
sudo systemctl stop childcheck
sudo cp /path/to/new/childcheck /opt/childcheck/childcheck
sudo chmod +x /opt/childcheck/childcheck
sudo cp -R /path/to/new/.next/standalone/. /opt/childcheck/
sudo cp -R /path/to/new/prisma /opt/childcheck/
sudo cp -R /path/to/new/mini-services /opt/childcheck/
sudo systemctl start childcheck
journalctl -u childcheck -f | head -20
```

## macOS native

```bash
# 1. Back up.
launchctl unload ~/Library/LaunchAgents/org.childcheck.plist
cp -a ~/Library/Application\ Support/ChildCheck ~/Library/Application\ Support/ChildCheck.pre-update.$(date +%Y%m%d%H%M%S)

# 2. Run the installer over the existing install.
bash install/install-macos.sh /path/to/childcheck-macos-arm64.tar.gz

# 3. Verify.
launchctl list | grep childcheck
tail -f ~/Library/Application\ Support/ChildCheck/logs/childcheck.stdout.log
```

## Windows native

```powershell
# 1. Back up.
Stop-Service ChildCheck
Copy-Item -Recurse "C:\ProgramData\ChildCheck" "C:\ProgramData\ChildCheck.pre-update.$(Get-Date -Format 'yyyyMMddHHmmss')"

# 2. Run the installer over the existing install.
.\install\install-windows.ps1 -Source .\childcheck-windows-x64.tar.gz

# 3. Verify.
Get-Service ChildCheck
Get-Content "C:\ProgramData\ChildCheck\logs\*.log" -Tail 50
```

## Synology NAS

```bash
# 1. Back up.
pkill -f "/volume1/@appstore/ChildCheck/childcheck"
cp -a /volume1/childcheck /volume1/childcheck.pre-update.$(date +%Y%m%d%H%M%S)

# 2. Run the installer over the existing install.
bash install/install-nas-synology.sh /path/to/childcheck-linux-x64.tar.gz

# 3. Verify.
tail -f /volume1/childcheck/logs/childcheck.stdout.log
```

## Rolling back

If the new version doesn't come up cleanly, roll back:

### Docker
```bash
docker compose down
# Restore the previous image (if you tagged it) or revert the git checkout.
git checkout <previous-commit>
docker compose up -d --build
```

### Native (Linux/macOS/Windows/Synology)
```bash
# Stop the service.
# Move the new install aside + restore the backup the installer created:
sudo mv /opt/childcheck /opt/childcheck.failed-update
sudo mv /opt/childcheck.bak.<timestamp> /opt/childcheck
# Restart.
sudo systemctl start childcheck
```

If the schema was migrated forward and the rollback fails because the old
binary doesn't understand the new schema, restore the DB from the pre-update
backup:

```bash
sudo systemctl stop childcheck
sudo cp /var/lib/childcheck.pre-update.<timestamp>/db/custom.db /var/lib/childcheck/db/custom.db
sudo systemctl start childcheck
```

## Verifying the update

1. **Check the version** (native installs): `childcheck version`
2. **Check `/api/config`**: `curl -s http://localhost:3000/api/config | jq .orgType`
3. **Sign in as admin** → browse `/admin` → look at the bottom of the page for
   the version footer (if present in that release).
4. **Test the kiosk**: do a test check-in + check-out to confirm the
   end-to-end flow still works.
5. **Check the logs** for any errors during the first 5 minutes of post-update
   traffic.

## Schema migrations

ChildCheck uses `prisma db push` (not `prisma migrate`). This means:

- Schema changes are applied **non-destructively**: columns are added, never
  dropped without explicit SQL.
- There are no migration files to worry about.
- Rollback requires restoring the DB backup — `db:push` is one-way.

If a release ships with a destructive schema change (rare), the release notes
will call it out + provide a manual SQL script to run before/after the update.
