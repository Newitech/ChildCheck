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
| `CHILDCHECK_DATA_KEY` | `d4e5f6...` (64 hex chars) | 32-byte hex AES-256-GCM key used to encrypt photos at rest + to seal backup bundles + to encrypt the SMTP password stored in the database. Generate with `openssl rand -hex 32`. If unset, falls back to an all-zeros dev key (DO NOT leave unset in production). **Losing this key means existing photos + encrypted backups + the stored SMTP password cannot be decrypted.** |

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

### SMTP (outbound email — env-var path)

The admin UI is the runtime-editable path for SMTP config (`/admin/settings` →
"Email" tab). When the environment variables below are set, they take
**precedence over the database row** — useful for shipping a deploy with SMTP
baked in via env (no admin UI interaction needed). When env vars are present,
the Email tab in `/admin/settings` shows an "SMTP environment variables are
set" banner so the admin knows why their saved changes appear to be ignored.

| Variable | Example | Purpose |
|---|---|---|
| `SMTP_HOST` | `smtp.gmail.com` | SMTP server hostname. When set, env overrides DB. |
| `SMTP_PORT` | `587` | SMTP port (587 = StartTLS, 465 = SSL, 25 = none). Defaults to 587 if unset. |
| `SMTP_USER` | `you@gmail.com` | SMTP auth username (usually the full email address). |
| `SMTP_PASS` | `abcd efgh ijkl mnop` | SMTP password. For Gmail this MUST be an **App Password**, not the account password (see below). |
| `SMTP_FROM` | `ChildCheck <you@gmail.com>` | From address. Either `"Name <addr>"` or just `addr`. |
| `SMTP_SECURITY` | `starttls` | One of `starttls` / `ssl` / `none`. If unset, derived from `SMTP_PORT` (465 → ssl, 25 → none, else starttls). |

> 💡 When env vars are set, the SMTP password is NOT stored in the database
> (it lives in the env file only). When the admin configures SMTP via the UI
> instead, the password IS stored in the database — AES-256-GCM encrypted
> with `CHILDCHECK_DATA_KEY`.

#### Gmail App Password requirement

Gmail does not accept the account password for SMTP. You must:

1. Enable **2-Step Verification** on the Google account
   ([myaccount.google.com/security](https://myaccount.google.com/security)).
2. Create an **App Password** at
   [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
   — select "Mail" + the device, then copy the 16-character password.
3. Paste it into `SMTP_PASS` (env) or the "Password" field in
   `/admin/settings` → "Email" tab.

Other hosted providers (Outlook, Yahoo, etc.) follow the same pattern —
check their docs for the equivalent "App Password" / "SMTP auth password"
flow. Self-hosted SMTP servers (Postfix, Exim, etc.) use the regular mailbox
password.

#### What email features use SMTP

- **Report emailing** — the "Email" button on `/admin/reports` sends a CSV
  attachment. Returns a `smtp_not_configured` error (HTTP 409) if SMTP is
  off; the UI shows "Configure SMTP in Settings → Email first".
- **Password recovery** — gated behind the `email_recovery` feature flag
  (default OFF). When ON + SMTP configured, `/api/auth/forgot-password`
  will email a reset link (currently a stub — see code comments).
- **Email as contact method** — the `email_as_contact` flag (default ON)
  controls whether email is stored on Person records. Independent of SMTP
  sending.

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
- **SMTP / email**: `/admin/settings` → "Email" tab. Configure outbound SMTP
  (host, port, security, username, password, from-address). Password is
  stored AES-256-GCM encrypted at rest. "Send test email" validates the
  config. Alternatively set `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` /
  `SMTP_PASS` / `SMTP_FROM` env vars (overrides the DB row). Gmail requires
  an App Password (see [Gmail App Password requirement](#gmail-app-password-requirement)).

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

For TLS termination, put Caddy/Nginx in front. **TLS is opt-in** — both the
native install scripts and the bundled `docker-compose.yml` default to plain
HTTP (useful for trusted-LAN deployments or when you already have a reverse
proxy in front).

### Native install scripts (`--tls` / `-Tls` flag)

| Platform | Flag |
|---|---|
| Linux | `sudo bash install/install-linux.sh --tls` |
| macOS | `bash install/install-macos.sh --tls` |
| Windows | `.\install\install-windows.ps1 -Tls` |
| Synology NAS | `bash install/install-nas-synology.sh --tls` (prints DSM reverse-proxy instructions + copies Caddyfile templates for Docker-on-NAS) |

Each script prompts for a domain name (blank = LAN-only self-signed via
Caddy's internal CA). On `--tls`/`-Tls` it installs + configures Caddy,
opens firewall ports 80/443, rewrites `NEXTAUTH_URL` to `https://`, and
enables the `caddy` service alongside ChildCheck.

### Docker (`--profile tls`)

```bash
# Default — plain HTTP (no Caddy container starts):
docker compose up -d

# Opt-in HTTPS — auto-Let's-Encrypt for a real domain:
DOMAIN=childcheck.myorg.org docker compose --profile tls up -d

# Opt-in HTTPS — LAN-only (no domain — self-signed via Caddy's internal CA):
cp docker/Caddyfile.lan docker/Caddyfile     # one-time swap
docker compose --profile tls up -d
```

See:
- Docker: [docker.md → TLS termination with Caddy (opt-in)](./docker.md#tls-termination-with-caddy-opt-in)
- Linux: use the `--tls` flag of `install/install-linux.sh` (or set up Caddy/Nginx manually with `proxy_pass http://localhost:3000`).
- macOS: use the `--tls` flag of `install/install-macos.sh` (or `brew install caddy` + manual config).
- Windows: use the `-Tls` switch of `install/install-windows.ps1` (or install [Caddy for Windows](https://caddyserver.com/docs/install) manually).
- Synology: use the `--tls` flag of `install/install-nas-synology.sh` (it walks you through DSM's built-in reverse proxy, which is the preferred path on bare-metal DSM), or use Docker-on-NAS with `docker compose --profile tls up -d`.

> ⚠️ Make sure to set `NEXTAUTH_URL` to the HTTPS URL once TLS is in place,
> otherwise session cookies won't be marked `Secure`. Note: `Secure` cookies
> only travel over HTTPS — if you browse to `http://...`, the cookie's
> `Secure` flag is silently dropped.

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
