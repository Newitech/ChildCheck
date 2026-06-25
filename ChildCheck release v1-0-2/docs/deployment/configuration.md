# Configuration

Complete reference for all ChildCheck environment variables, data directories,
and post-install steps.

## Environment variables

All variables can be set in the `.env` file (next to the binary, or in the
`config/` directory for service installs). Docker users set them in
`docker-compose.yml` or `.env` at the compose project root.

### Required

| Variable | Example | Purpose |
|---|---|---|
| `NEXTAUTH_URL` | `https://checkin.mychurch.org` | The public URL users browse to. Must include the scheme + host (no trailing slash). Used by NextAuth to set cookie scope + by the app to know its own origin. |
| `NEXTAUTH_SECRET` | `a1b2c3...` (64 hex chars) | 32-byte hex secret used to sign session JWTs. Generate with `openssl rand -hex 32`. If unset, the runtime auto-generates one and persists it to `config/.nextauth-secret`. |

### Strongly recommended

| Variable | Example | Purpose |
|---|---|---|
| `CHILDCHECK_DATA_KEY` | `d4e5f6...` (64 hex chars) | 32-byte hex AES-256-GCM key used to encrypt photos at rest + to seal backup bundles. Generate with `openssl rand -hex 32`. If unset, falls back to an all-zeros dev key (DO NOT leave unset in production). **Losing this key means existing photos + encrypted backups cannot be decrypted.** |

### Optional (with defaults)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Next.js HTTP port. |
| `REALTIME_PORT` | `3003` | Socket.io port for the realtime mini-service. |
| `HOSTNAME` | `0.0.0.0` | Bind address for the Next.js server. Use `127.0.0.1` to restrict to localhost (e.g. behind a reverse proxy). |
| `DATABASE_URL` | `file:./db/custom.db` | Prisma SQLite connection string. The `file:` prefix is required. |
| `CHILDCHECK_DATA_DIR` | `./data` | Root dir for `photos/`, `branding/`, `backups/`. Override to mount a separate volume. |
| `CHILDCHECK_CONFIG_DIR` | `./config` | Where the runtime persists auto-generated secrets. |
| `CHILDCHECK_DB_DIR` | `./db` | Where the SQLite database file lives (only used by the native binary launcher). |
| `REALTIME_INTERNAL_KEY` | `childcheck-internal-dev` | Shared secret for the internal `/broadcast` endpoint on the realtime mini-service. The Next.js app uses it to fan out check-in/out + headcount updates to connected clients. Set to a strong random value in production. |
| `NODE_ENV` | `production` | Next.js runtime mode. Leave as `production`. |

## Data directories

```
data/
├── photos/      # Encrypted-at-rest child + guardian photos (AES-256-GCM,
│                # keyed by CHILDCHECK_DATA_KEY). Filename = <personId>.enc.
├── branding/    # Uploaded org logo. Served via /api/branding/logo.
└── backups/     # Encrypted .cbak bundles (DB + photos + branding + config).
                 # Created by /api/admin/backup and the scheduled-backup tick.

db/
└── custom.db    # The SQLite database. Single file, easy to back up.

config/
├── .env                 # Environment file (chmod 600).
└── .nextauth-secret     # Auto-generated NEXTAUTH_SECRET (if not provided).
```

The launcher's `ensureDirs()` creates these on first boot if missing.

## Database

ChildCheck uses SQLite via Prisma. The DB is a single file at the path in
`DATABASE_URL`. To inspect it directly:

```bash
sqlite3 /path/to/db/custom.db
sqlite> .tables
sqlite> SELECT COUNT(*) FROM User;
sqlite> SELECT key, value FROM FeatureFlag;
```

To apply schema changes after an update:

```bash
# Native install:
cd /opt/childcheck && ./childcheck db-push

# Docker:
docker compose exec childcheck bun run db:push

# Or simply restart the service (the launcher runs db:push on every boot).
```

## First-run setup wizard

The setup wizard is at `/setup` and is only available **before any user exists**.
Once the first admin is created, `/setup` redirects to `/`.

### What the wizard does

1. Validates organisation name + admin details (zod schema).
2. Upserts the singleton `Organisation` row with the org name.
3. Creates a `Person` for the admin (Adult type).
4. Creates a `User` with the bcrypt-hashed password.
5. Assigns the `Admin` role.
6. Writes an `AuditLog` entry: `setup.complete`.
7. Seeds the default SDA programs (Sabbath School, Pathfinders, Adventurers,
   Community Childcare) — each with its standard classes.

### After the wizard

- **Sign in** with the admin account at `/login` (you'll be redirected to `/admin`).
- **Configure branding**: `/admin/settings` → "Branding & Terminology" tab.
  - Organisation name, app name, tagline.
  - Primary + accent colours (live preview).
  - Logo upload (PNG/JPG/SVG/WebP, ≤2 MB).
  - Terminology overrides (21 keys — rename "Sabbath School" → "Sunday School",
    "Pathfinders" → "Scouts", etc.).
- **Pick an org type profile**: `/admin/settings` → "Organisation type" section.
  Switches the default terminology + programme set for SDA / SundayChurch /
  Scouts / Childcare / School / Club / Other.
- **Toggle features**: `/admin/settings` → "Feature Toggles" tab. 14 flags:
  kiosk_requires_login, guardian_pin_signin, guardian_self_registration,
  older_sibling_collect, override_checkout, photo_verification,
  print_name_labels, print_signout_code, visitors_add_to_db,
  working_with_children_tracking, email_as_contact, email_recovery,
  audit_log_detailed, scheduled_backups.
- **Calendar**: `/admin/settings` → "Calendar & Codes" tab. Week-starts-on
  (Sun/Mon/Sat) + daily code format (length + charset).

## Adding more users

Once you're signed in as admin:

1. **/admin/people** → "New person" → fill name + email.
2. On the person's detail page → "Create user account" → username + password.
3. Assign roles (Admin / PeopleManager / Security / Teacher / Volunteer / Kiosk).

## Backup strategy

See [Backup & restore](./backup-restore.md). The short version:

1. Enable the `scheduled_backups` flag in `/admin/settings`.
2. Set up an off-site sync of `data/backups/` (rsync, rclone, Synology Hyper
   Backup, etc.).
3. Test a restore at least once a quarter.

## Reverse proxy

For TLS termination, put Caddy/Nginx in front. See the per-platform docs:

- Docker: [docker.md → TLS reverse proxy](./docker.md#tls-reverse-proxy)
- Linux: use Caddy/Nginx with `proxy_pass http://localhost:3000`.
- macOS: use Caddy (via `brew install caddy`) or Nginx.
- Windows: use [Caddy for Windows](https://caddyserver.com/docs/install) or IIS ARR.
- Synology: use DSM's built-in reverse proxy (no extra software needed).

> ⚠️ Make sure to set `NEXTAUTH_URL` to the HTTPS URL once TLS is in place,
> otherwise session cookies won't be marked `Secure`.

## Security checklist (production)

- [ ] `NEXTAUTH_SECRET` is set to a strong random value (not the auto-generated
      default — though the auto-generated one is fine if you've backed it up).
- [ ] `CHILDCHECK_DATA_KEY` is set to a strong random value.
- [ ] `REALTIME_INTERNAL_KEY` is set to a strong random value.
- [ ] `NEXTAUTH_URL` is HTTPS (behind a TLS reverse proxy).
- [ ] The `config/.env` file is `chmod 600` and backed up off-site.
- [ ] The `data/backups/` directory is being synced off-site on a schedule.
- [ ] The default admin password has been changed from the wizard password.
- [ ] All kiosk devices have Guided Access / Screen Pinning enabled.
- [ ] The firewall allows inbound 3000 only from the LAN, not the public internet
      (unless you have a reverse proxy + auth in front).
