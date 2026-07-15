# Updating ChildCheck

How to update to a new version of ChildCheck without losing data.

> ⚠️ **Always take a fresh backup before updating.** See
> [Backup & restore](./backup-restore.md).

> ⚠️ Read the release notes for any breaking changes (schema migrations,
> config format changes, required env vars) before updating.

## Hybrid update system (overview)

ChildCheck ships with **two complementary update mechanisms**:

1. **In-app update checker** (read-only). On `/admin` an "Updates" card shows
   the installed version + the latest GitHub release + whether an update is
   available. It does **not** apply the update — it only checks.
2. **External update mechanism** (operator-initiated). One of:
   - **Native installs** → run `install/childcheck-update.sh` (Linux / macOS /
     Synology). Stops the service, backs up, downloads the latest release,
     extracts, runs `db:push`, restarts, health-checks.
   - **Docker installs** → `docker compose pull && docker compose up -d`. One
     command; the entrypoint runs `db:push` on boot.

The split is intentional: the in-app checker is always safe (it only fetches
the public GitHub releases API), while applying an update is always an
explicit, operator-initiated action that can be rolled back.

### Enabling the in-app update checker

The checker is **enabled by default** and points at the public
`Newitech/ChildCheck` GitHub repo. Override it with the
`CHILDCHECK_UPDATE_REPO` env var (e.g. to point at a fork, or to disable
checking for an air-gapped install):

```bash
# .env (native) or docker-compose.yml environment (Docker)
CHILDCHECK_UPDATE_REPO=Newitech/ChildCheck
```

The checker is enabled by default (pointing at the public `Newitech/ChildCheck`
repo). To disable it — e.g. for an air-gapped install — set it to `off`,
`disabled`, `none`, or `0` (the Updates card will then show "Update checking
has been turned off"). Set it to any `owner/repo` slug to check a fork.

The checker fetches `https://api.github.com/repos/<repo>/releases/latest` with
no authentication (public repos only). Results are cached in-memory for 1 hour
so repeated admin page loads don't hit the GitHub API rate limit (60 req/hour
per IP for unauthenticated requests). The "Check now" button on the Updates
card bypasses the cache.

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
docker compose pull            # pull the latest image
docker compose up -d           # recreate the container with the new image
```

If you built from source instead of pulling a prebuilt image:

```bash
git pull                       # get the latest Dockerfile + docker-compose.yml
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

## Native (Linux / macOS / Synology) — the update script

The fastest path: run the bundled update script. It detects the install,
stops the service, backs up the current binary + DB, downloads the latest
release tarball from GitHub, extracts it over the install dir (preserving
your `data/` / `db/` / `config/` symlinks), runs `db:push`, restarts the
service, and waits for the health endpoint.

```bash
# Latest release:
sudo bash /opt/childcheck/install/childcheck-update.sh

# Or download + run from anywhere:
curl -fsSL https://github.com/Newitech/ChildCheck/raw/main/install/childcheck-update.sh \
  | sudo bash

# Pin a specific version:
sudo bash install/childcheck-update.sh --version v1.2.0

# Override the repo (if you fork):
sudo bash install/childcheck-update.sh --repo yourorg/childcheck

# Override the install dir (if non-standard):
sudo bash install/childcheck-update.sh --dir /opt/childcheck
```

The script:

1. Detects platform + arch (`linux-x64`, `linux-arm64`, `macos-arm64`).
2. Auto-detects the install dir: `/volume1/@appstore/ChildCheck` (Synology),
   `/opt/childcheck` (Linux systemd), or `/Applications/ChildCheck` (macOS).
3. Detects the service manager (systemd, launchd, or pkill for Synology).
4. **Stops the service** (`systemctl stop`, `launchctl unload`, or `pkill`).
5. **Backs up** the current binary + server.js + `.next` + `public` + `prisma`
   + the SQLite DB to `<install>.bak.<timestamp>`. **Never touches `data/` or
   `config/`.**
6. Downloads the latest (or `--version`) release tarball from GitHub.
7. Extracts it over the install dir, preserving the `data/` / `db/` / `config/`
   symlinks.
8. Runs `childcheck db-push` to apply schema migrations.
9. **Restarts the service**.
10. **Waits for `/api/config`** (or `--health-url`) to return 200 — up to 120s.
11. Prints the result + rollback instructions if anything failed.

Flags:

| Flag | Purpose |
|---|---|
| `--version vX.Y.Z` | Pin a specific version (default: latest release). |
| `--repo Newitech/ChildCheck` | Override the GitHub repo slug. |
| `--dir /opt/childcheck` | Override the install dir (skip auto-detect). |
| `--health-url URL` | Override the health endpoint (default: `http://localhost:3000/api/config`). |
| `--service-name NAME` | Override the systemd unit name (default: `childcheck`). |
| `--no-restart` | Don't stop/start the service (you'll restart manually). |
| `--skip-db-push` | Don't run `db:push` after extracting (rare). |

### Manual native update (without the script)

If you prefer to swap the binary by hand:

```bash
# Linux:
sudo systemctl stop childcheck
sudo cp /path/to/new/childcheck /opt/childcheck/childcheck
sudo chmod +x /opt/childcheck/childcheck
sudo cp -R /path/to/new/.next/standalone/. /opt/childcheck/
sudo cp -R /path/to/new/prisma /opt/childcheck/
sudo cp -R /path/to/new/mini-services /opt/childcheck/
sudo systemctl start childcheck
journalctl -u childcheck -f | head -20
```

```bash
# macOS:
launchctl unload ~/Library/LaunchAgents/org.childcheck.plist
sudo cp /path/to/new/childcheck /Applications/ChildCheck/childcheck
sudo cp -R /path/to/new/.next/standalone/. /Applications/ChildCheck/
launchctl load ~/Library/LaunchAgents/org.childcheck.plist
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

## Rolling back

If the new version doesn't come up cleanly, roll back:

### Docker
```bash
docker compose down
# Restore the previous image (if you tagged it) or revert the git checkout.
git checkout <previous-commit>
docker compose up -d --build
```

### Native (Linux/macOS/Synology)
```bash
# Stop the service.
# Move the new install aside + restore the backup the update script created:
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
sudo cp /opt/childcheck.bak.<timestamp>/db/custom.db /var/lib/childcheck/db/custom.db
sudo systemctl start childcheck
```

The update script prints the exact rollback commands (with the right
timestamp) at the end of every run, including on failure.

## Verifying the update

1. **Check the version** (native installs): `childcheck version`
2. **Check `/api/config`**: `curl -s http://localhost:3000/api/config | jq .orgType`
3. **Sign in as admin** → browse `/admin` → look at the "Updates" card at the
   top — it shows the installed version + whether an update is available.
4. **Test the kiosk**: do a test check-in + check-out to confirm the
   end-to-end flow still works.
5. **Check the logs** for any errors during the first 5 minutes of post-update
   traffic.

## When to update

Recommend updating during **low-traffic times** — e.g. Monday morning, not
Sabbath morning right before services start. The update itself takes <1 minute
(native) or a few seconds (Docker), but the health check + first-request
warm-up can add 30–60s. Plan for a 5-minute window.

## Version pinning

To stay on a specific version instead of always tracking `latest`:

- **Docker**: pin the image tag in `docker-compose.yml`:
  ```yaml
  image: ghcr.io/newitech/childcheck:v1.2.0
  ```
  Then `docker compose up -d` (no `pull`).
- **Native**: pass `--version v1.2.0` to `install/childcheck-update.sh`, or
  download the specific release tarball from GitHub:
  ```
  https://github.com/Newitech/ChildCheck/releases/tag/v1.2.0
  ```

## Schema migrations

ChildCheck uses `prisma db push` (not `prisma migrate`). This means:

- Schema changes are applied **non-destructively**: columns are added, never
  dropped without explicit SQL.
- There are no migration files to worry about.
- Rollback requires restoring the DB backup — `db:push` is one-way.

If a release ships with a destructive schema change (rare), the release notes
will call it out + provide a manual SQL script to run before/after the update.
