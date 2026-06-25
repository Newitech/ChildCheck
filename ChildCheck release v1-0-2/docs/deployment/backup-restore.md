# Backup & Restore

ChildCheck ships with built-in encrypted backups. This guide explains how to
schedule them, where they live, and how to restore them.

## What's in a backup

Each `.cbak` bundle contains:

- The full SQLite database (`custom.db`).
- All uploaded photos (`data/photos/*.enc`).
- The branding logo (`data/branding/*`).
- The current organisation + feature-flag config (rows from the DB, also
  included in the DB dump — this is redundant but lets you restore the org
  profile even if the DB dump fails to load).

The bundle is encrypted with AES-256-GCM, keyed by `CHILDCHECK_DATA_KEY`.
Without that key, the bundle is unrecoverable.

## Triggering a manual backup

### Via the admin UI
1. Sign in as Admin.
2. **/admin/backup** → click **Backup now**.
3. The bundle is saved to `data/backups/childcheck-backup-YYYYMMDD-HHMMSS.cbak`
   and offered as a download.

### Via the API
```bash
# Auth cookie required (sign in via /login first; or use a session cookie
# captured from a browser).
curl -X POST -b cookie.txt http://localhost:3000/api/admin/backup
# → { "ok": true, "filename": "childcheck-backup-2026-06-23-143930.cbak" }
```

## Scheduling automatic backups

1. Enable the `scheduled_backups` feature flag at **/admin/settings → Feature Toggles**.
2. Set a cron job / scheduled task to hit the backup tick endpoint once per day:

```bash
# Linux cron (add to /etc/cron.d/childcheck):
0 2 * * * root curl -fsS -X POST http://localhost:3000/api/admin/backup/tick >> /var/log/childcheck-backup-tick.log 2>&1

# macOS launchd (~/Library/LaunchAgents/org.childcheck.backup.plist), or use cron:
0 2 * * * /usr/bin/curl -fsS -X POST http://localhost:3000/api/admin/backup/tick

# Windows Task Scheduler: run daily at 2 AM:
#   powershell -Command "Invoke-WebRequest -Uri http://localhost:3000/api/admin/backup/tick -Method POST -UseBasicParsing"

# Synology: Task Scheduler → Create → Scheduled Task → User-defined script:
#   curl -fsS -X POST http://localhost:3000/api/admin/backup/tick
#   Schedule: Daily at 02:00.
```

The tick endpoint:

- Returns 200 `{ ok: true, created: false }` if no backup was due (the last
  one was less than 24h ago).
- Returns 200 `{ ok: true, created: true, filename: "..." }` if a new backup
  was created.
- Returns 401 if not signed in (use a long-lived admin session cookie) — or
  in single-tenant kiosk deployments, you can leave the kiosk-unattended
  backup tick unauthenticated by setting an env var (not currently supported;
  always auth).

## Backup retention

Old backups are NOT automatically deleted. Implement retention at the file
level:

```bash
# Keep only the last 30 days of backups (Linux/macOS/Synology):
find /var/lib/childcheck/data/backups -name "*.cbak" -mtime +30 -delete

# Windows PowerShell:
Get-ChildItem "C:\ProgramData\ChildCheck\data\backups\*.cbak" |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
  Remove-Item
```

Add this to your daily cron / Task Scheduler alongside the tick.

## Off-site replication

A backup on the same disk as the original isn't a backup. Sync the
`data/backups/` directory off-site:

```bash
# rsync to a remote server (Linux/macOS/Synology):
rsync -avz --delete /var/lib/childcheck/data/backups/ user@offsite:/backups/childcheck/

# rclone to B2/S3/Google Drive:
rclone sync /var/lib/childcheck/data/backups remote:childcheck-backups/

# Synology Hyper Backup: schedule a backup of /volume1/childcheck/data/backups
# to a remote NAS or cloud provider. Enable encryption + compression.

# Windows: use FreeFileSync, Cobian Reflector, or robocopy to a SMB share.
```

For maximum safety: **two** off-site copies (e.g. one to a remote server +
one to B2). Test restores quarterly.

## Restoring a backup

### Via the admin UI (recommended)
1. Sign in as Admin.
2. **/admin/backup** → "Restore from file".
3. Choose a `.cbak` file → click **Restore**.
4. Confirm the warning that the **current database will be replaced**.
5. The app:
   - Takes an automatic pre-restore backup (`*-pre-restore.cbak`).
   - Decrypts + extracts the chosen bundle.
   - Replaces the current `custom.db` + `data/photos/` + `data/branding/`.
   - Writes an `AuditLog` entry: `backup.restore`.
6. Sign out + back in (the session is invalidated because the DB changed).

### Via the API
```bash
curl -X POST -b cookie.txt \
  -F "file=@childcheck-backup-2026-06-23-143930.cbak" \
  http://localhost:3000/api/admin/backup/restore
```

### Disaster recovery (cold restore)

If the entire server is lost and you only have the `.cbak` file + the
`CHILDCHECK_DATA_KEY`:

1. Stand up a fresh ChildCheck install (don't run `/setup` — the restore will
   create the org + admin for you).
2. Stop the service.
3. Move the existing DB aside: `mv /var/lib/childcheck/db/custom.db /var/lib/childcheck/db/custom.db.fresh`
4. Start the service (it will run `db:push` to create an empty schema).
5. Sign in to the admin UI → **/admin/backup → Restore from file** → upload
   your `.cbak`.
6. The service restarts with the restored data.

> ⚠️ You **must** have the `CHILDCHECK_DATA_KEY` from the original install.
> Without it, the bundle cannot be decrypted and the data is gone.

## Verifying a backup

The backup endpoint returns a SHA-256 checksum of the bundle. Verify after
download:

```bash
sha256sum childcheck-backup-2026-06-23-143930.cbak
# Compare to the value shown in the admin UI / API response.
```

For a deeper check, you can use the `verifyBundle()` helper programmatically
(see `src/lib/backup.ts`) — it decrypts + checks the GCM auth tag without
writing files. The admin UI calls this automatically before every restore.

## What's NOT in a backup

- The `config/.env` file (contains `NEXTAUTH_SECRET` + `CHILDCHECK_DATA_KEY`).
  Back this up **separately**, ideally offline (printed in a safe, or stored in
  a password manager). Without the `CHILDCHECK_DATA_KEY`, no backup can be
  decrypted.
- The `node_modules/` directory (re-created by the installer).
- The Next.js build output (re-created by `bun run build`).

## Backup checklist

- [ ] `scheduled_backups` flag is ON.
- [ ] A daily cron / Task Scheduler / launchd job hits `/api/admin/backup/tick`.
- [ ] `data/backups/` is being synced to at least one off-site location.
- [ ] Old backups are pruned (keep 30–90 days).
- [ ] `CHILDCHECK_DATA_KEY` is stored somewhere safe OFF the server.
- [ ] A test restore has been performed at least once (and re-tested quarterly).
