# Security hardening guide

ChildCheck is designed to handle sensitive information about children and
their families — names, dates of birth, medical notes, photos, family
relationships, and check-in/check-out history. This guide walks through every
hardening control you should apply before going live, and how to verify each
one is in place.

> **Threat model.** The primary threats are: (a) an attacker on the network
> intercepting or tampering with traffic, (b) an attacker with physical
> access to a kiosk device enumerating families or brute-forcing PINs,
> (c) an insider with database access exfiltrating or tampering with audit
> logs, and (d) loss of a backup medium. The controls below address each.

---

## 1. Firewall — bind to the LAN only

ChildCheck is designed for a single-site deployment (a church / school /
club). The simplest and strongest network control is to **never expose the
app to the public internet** unless you've put a TLS-terminating reverse
proxy with authentication in front of it.

### LAN-only mode

Set `HOSTNAME` to the LAN interface address (or `127.0.0.1` for localhost
only) and don't publish the port to the public internet:

**Docker compose:**

```yaml
services:
  childcheck:
    # Bind ONLY to the LAN IP (or 127.0.0.1 for localhost-only).
    ports:
      - "192.168.1.50:3000:3000"   # LAN IP — only reachable from inside the LAN
      # - "127.0.0.1:3000:3000"    # even stricter: localhost only (with reverse proxy)
    environment:
      - HOSTNAME=0.0.0.0            # inside the container; the port binding above restricts it
      - NEXTAUTH_URL=http://192.168.1.50:3000
```

**Native install (systemd):**

The launcher listens on `HOSTNAME` (default `0.0.0.0`). To restrict to
localhost only (recommended when fronting with Caddy on the same host), set:

```bash
# /var/lib/childcheck/config/.env
HOSTNAME=127.0.0.1
NEXTAUTH_URL=https://checkin.mychurch.org
```

And use the host firewall (UFW / iptables / Windows Firewall) to deny
inbound 3000 from anywhere except the reverse proxy:

```bash
# UFW example (Linux): allow from the LAN only
sudo ufw deny 3000
sudo ufw allow from 192.168.1.0/24 to any port 3000 proto tcp
```

### Internet-exposed mode (NOT recommended)

If you must expose the app to the internet (e.g. so admins can configure it
from home), you **must**:

1. Put a TLS-terminating reverse proxy in front (Caddy / Nginx — see §2).
2. Set `NEXTAUTH_URL` to the HTTPS URL.
3. Add an authentication layer at the proxy (HTTP Basic Auth, mTLS, or
   Cloudflare Access) so the only unauthenticated endpoint exposed is
   `/api/auth/*` (login).
4. Lock down the kiosk endpoints (`/api/kiosk/*`) — they're already
   rate-limited + minimal in their response, but a public-facing kiosk
   endpoint is a higher-risk surface.

---

## 2. TLS — terminate HTTPS with Caddy or Nginx

NextAuth session cookies are marked `Secure` only when `NEXTAUTH_URL` is
HTTPS. Without TLS, cookies travel in cleartext and can be sniffed or
stolen. **Always run behind a TLS-terminating reverse proxy in production.**

### Caddy (recommended — automatic Let's Encrypt)

```caddyfile
# /etc/caddy/Caddyfile
checkin.mychurch.org {
    # Reverse-proxy to the ChildCheck container / process.
    reverse_proxy 127.0.0.1:3000

    # Security headers
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "geolocation=(), microphone=(), camera=()"
    }

    # Rate-limit at the proxy too (defence in depth).
    # See https://caddyserver.com/docs/json/apps/http/servers/routes/handle/rate_limit/
}
```

Reload: `sudo systemctl reload caddy`.

### Nginx + certbot

```nginx
# /etc/nginx/sites-available/checkin.mychurch.org
server {
    listen 443 ssl http2;
    server_name checkin.mychurch.org;

    ssl_certificate     /etc/letsencrypt/live/checkin.mychurch.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/checkin.mychurch.org/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    client_max_body_size 8M;   # allow photo + logo uploads

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";   # for Socket.io
    }
}

server {
    listen 80;
    server_name checkin.mychurch.org;
    return 301 https://$host$request_uri;
}
```

Issue the cert: `sudo certbot --nginx -d checkin.mychurch.org`.

### After TLS is in place

Update `NEXTAUTH_URL` to the HTTPS URL so NextAuth marks its cookies
`Secure` + `SameSite=Strict`:

```bash
# .env
NEXTAUTH_URL=https://checkin.mychurch.org
```

---

## 3. Service user — run as a non-root dedicated user

The native install scripts (`install/install-linux.sh`,
`install/install-macos.sh`, etc.) all create a dedicated `childcheck` system
user with no shell + no home dir, and run the service as that user. The
Docker image's runtime stage also drops to a non-root `childcheck` user
(UID 1001).

**Verify:**

```bash
# Linux systemd
ps -o user= -p $(systemctl show -p MainPID --value childcheck)
# → childcheck

# Docker
docker compose exec childcheck id
# → uid=1001(childcheck) gid=0(root) groups=0(root)
```

Never run ChildCheck as `root` — a vulnerability in the app would give an
attacker root on the host.

---

## 4. File permissions

```bash
# .env contains NEXTAUTH_SECRET + CHILDCHECK_DATA_KEY — protect it.
chmod 600 /var/lib/childcheck/config/.env
chown childcheck:childcheck /var/lib/childcheck/config/.env

# Data dir: photos (encrypted), branding, backups.
chmod 700 /var/lib/childcheck/data
chown -R childcheck:childcheck /var/lib/childcheck/data

# DB dir: SQLite database.
chmod 700 /var/lib/childcheck/db
chown -R childcheck:childcheck /var/lib/childcheck/db

# Config dir: auto-generated secrets.
chmod 700 /var/lib/childcheck/config
chown -R childcheck:childcheck /var/lib/childcheck/config
```

The systemd unit (written by `install-linux.sh`) adds `ProtectSystem=strict`
+ `ProtectHome` + `PrivateTmp` + `PrivateDevices` so the service can only
write to its declared `ReadWritePaths` — even a privilege-escalation bug in
Node/Bun can't escape to the rest of the filesystem. See
[linux.md → systemd hardening reference](./linux.md).

---

## 5. Encryption-at-rest — `CHILDCHECK_DATA_KEY`

ChildCheck encrypts every sensitive file at rest with AES-256-GCM, keyed by
`CHILDCHECK_DATA_KEY` (32 bytes / 64 hex chars):

| Asset | Path | Encrypted? |
|---|---|---|
| Person photos (children + adults) | `data/photos/<personId>.enc` | ✅ AES-256-GCM |
| Backup bundles | `data/backups/*.cbak` | ✅ AES-256-GCM (whole bundle) |
| Branding logo | `data/branding/logo.<ext>` | ⚠️ Plain file (public asset — served via `/api/branding/logo`) |
| SQLite database | `db/custom.db` | ❌ Plain SQLite (use full-disk encryption on the host if required) |

On-disk encrypted file format: `[iv (12 bytes)][auth tag (16 bytes)][ciphertext (rest)]`.
The auth tag means any tampering with the file (bit-flip, truncation,
substitution) is detected on decrypt — the read throws and the API returns
a 404/500 rather than serving corrupt data.

### Generate a strong key

```bash
openssl rand -hex 32
# → d4e5f6a7b8c9... (64 hex chars)
```

Store it in `.env` (chmod 600) or in a secret manager (Docker secret,
systemd `LoadCredential`, Kubernetes secret, etc.). **Never commit it to
git.**

> ⚠️ **Losing this key means existing photos + encrypted backups cannot be
> decrypted.** Back up the key somewhere safe (password manager, printed in
> a sealed envelope, etc.) — separately from the database backups.

### Master-key rotation

To rotate the key (e.g. after a suspected leak, or as an annual hygiene
practice), use `scripts/rotate-key.ts`:

```bash
# 1. STOP the ChildCheck service.
sudo systemctl stop childcheck

# 2. Generate the new key.
NEW_KEY=$(openssl rand -hex 32)
echo "New key: $NEW_KEY"

# 3. Run the rotation: decrypt every photo (and the branding logo, if
#    encrypted) with the OLD key, re-encrypt with the NEW key.
cd /opt/childcheck
CHILDCHECK_DATA_KEY_OLD=$(grep ^CHILDCHECK_DATA_KEY /var/lib/childcheck/config/.env | cut -d= -f2) \
CHILDCHECK_DATA_KEY=$NEW_KEY \
  ./childcheck scripts/rotate-key.ts
# (or with bun: bun run scripts/rotate-key.ts)

# 4. Update .env with the new key.
sudo sed -i "s|^CHILDCHECK_DATA_KEY=.*|CHILDCHECK_DATA_KEY=$NEW_KEY|" /var/lib/childcheck/config/.env

# 5. Restart the service.
sudo systemctl start childcheck

# 6. Verify: open a person detail page → photo loads.
```

The rotation script writes an `AuditLog` entry (`action: key.rotation`) so
there's a tamper-evident record of the rotation. The chain remains intact.

**Backups are NOT rotated** — old `.cbak` bundles stay encrypted with
whatever key they were made with. Keep `CHILDCHECK_DATA_KEY_OLD` available
(in a sealed envelope / password manager) for as long as you might need to
restore old backups. Once old backups are no longer needed (or have been
re-made under the new key), the old key can be destroyed.

---

## 6. Session security — NextAuth cookies

NextAuth v4 manages session cookies with these defaults:

| Attribute | Value | Why |
|---|---|---|
| `httpOnly` | `true` | JavaScript can't read the cookie → XSS can't steal the session. |
| `Secure` | `true` (when `NEXTAUTH_URL` is HTTPS) | Cookie only sent over TLS → can't be sniffed. |
| `SameSite` | `Lax` (default) | Cookie not sent on cross-site POST → CSRF protection. For ChildCheck we recommend `Strict` (below). |
| `Path` | `/` | Cookie scoped to the whole app. |

To tighten `SameSite` to `Strict` (so the cookie isn't sent even on
top-level navigations from external sites), edit `src/lib/auth.ts`:

```ts
export const authOptions: NextAuthOptions = {
  // ...
  cookies: {
    sessionToken: {
      name: `next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: "strict",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
};
```

> Note: `SameSite=Strict` will break the "open in new tab from an email
> link" flow (the user will need to sign in again). For a child-safety app,
> this is an acceptable trade-off — recommend `Strict` for production.

### Session timeout

The admin layout mounts `<IdleTimeout />` which auto-signs-out admin users
after 15 minutes of inactivity. The kiosk layout mounts `<KioskIdleReset />`
which returns to the search screen after 90 seconds of inactivity. Both are
client-side; the JWT itself expires after 30 days (NextAuth default) — for
stricter expiry, set `session: { strategy: "jwt", maxAge: 8 * 3600 }` in
`authOptions` (8 hours).

---

## 7. Rate limiting

ChildCheck applies three layers of rate limiting:

| Surface | Limit | Bucket key | Where |
|---|---|---|---|
| Login attempts | 10 / min | `username + IP` | `src/middleware.ts` (intercepts `POST /api/auth/callback/credentials`) |
| Admin API writes | 60 / min | `session token + IP` | `src/middleware.ts` (intercepts `POST/PUT/PATCH/DELETE /api/admin/*`) |
| Kiosk search | 30 / min | `IP` | `/api/kiosk/search` (in-route) |
| Guardian PIN verify | 5 / min | `familyId` | `/api/kiosk/guardian-signin` (in-route) |

The login limiter blocks brute-force password guessing (the 11th attempt
within a minute gets a 429 before NextAuth even hashes the password). The
admin-write limiter blocks a compromised admin session from hammering the
API. The kiosk + PIN limiters prevent family enumeration + PIN brute-force.

### Implementation note — single-process

The limiter is in-memory (`src/lib/rate-limit.ts`): a `Map<key, timestamps>`
with lazy TTL cleanup. This is fine for the single-process kiosk/admin
deployment ChildCheck is designed for.

For **multi-instance** deployments (e.g. behind a load balancer with 2+
ChildCheck containers), the in-memory limiter doesn't share state across
instances — an attacker could rotate between instances to bypass the limit.
**Swap in a Redis-backed limiter** for multi-instance:

- Use [`@upstash/ratelimit`](https://github.com/upstash/ratelimit) with the
  `@upstash/redis` client (works on Edge + Node).
- Or run a custom Lua script on Redis `INCR` + `EXPIRE`.
- Or use Caddy's built-in [`rate_limit` directive](https://caddyserver.com/docs/json/apps/http/servers/routes/handle/rate_limit/)
  to rate-limit at the proxy (per-IP, before traffic even reaches the app).

The `rateLimit(key, max, windowMs)` + `withRateLimit(handler, opts)` API in
`src/lib/rate-limit.ts` is the single integration point — swap the
implementation there and every caller (middleware + kiosk routes) gets the
distributed limiter automatically.

---

## 8. Audit log — tamper-evident hash chain

Every sensitive action writes an `AuditLog` row (action, entity, entityId,
details JSON, IP, actor, timestamp). Stage 16 adds a SHA-256 hash chain:

- `prevHash` = the `hash` of the immediately preceding row.
- `hash`     = `sha256( id | action | entity | entityId | details | ip | createdAt(ISO) | prevHash )`.

Verification (`/admin/audit` → "Verify chain integrity" button, or
`GET /api/admin/audit/verify`) walks the chain oldest→newest and flags the
first row that fails:

- **Hash mismatch** → the row was edited in-place (someone changed the
  `details` JSON or the `action` field directly in the DB).
- **prevHash mismatch** → a row was inserted or deleted in the middle of
  the chain (the prevHash of row N no longer matches the hash of row N-1).

Rows written before the Stage 16 migration have null `hash` and are skipped
by the verifier (with a `skippedUnhashed` count in the result). The chain
effectively starts at the first row that has a hash.

### Operational practice

- **Verify weekly** (or after any admin change) — open `/admin/audit` →
  click "Verify chain integrity".
- **Investigate any "Tampering detected" result immediately** — it means
  someone with DB access bypassed the app and edited the audit log
  directly. Page the security officer.
- **Back up the audit log** — it's part of the SQLite DB, so it's included
  in every `.cbak` backup bundle. See [backup-restore.md](./backup-restore.md).

### What gets audited

| Action | When |
|---|---|
| `user.login` / `user.signout` | NextAuth credentials flow + signout event. |
| `setup.complete` | First-run wizard completes. |
| `flag.update` | Admin changes a feature flag. |
| `person.photo.upload` / `person.photo.remove` | Admin uploads/removes a Person photo. |
| `blacklist.add` / `blacklist.remove` | Admin adds/removes a BlacklistEntry. |
| `branding.logo` | Admin uploads/removes the org logo. |
| `backup.create` / `backup.restore` | Admin triggers a backup or restore. |
| `key.rotation` | `scripts/rotate-key.ts` runs. |
| `kiosk.search` *(if `audit_log_detailed`)* | Each kiosk family search (with query + result count). |
| `guardian.pin_verify_ok` / `guardian.pin_verify_failed` / `guardian.pin_rate_limited` | Guardian PIN attempts at the kiosk. |

---

## 9. Backup security

- **Encrypted at rest** — every `.cbak` bundle is AES-256-GCM sealed with
  `CHILDCHECK_DATA_KEY`. A stolen backup medium is unreadable without the key.
- **Off-site copy** — sync `data/backups/` to off-site storage (rsync to a
  remote NAS, rclone to S3, Synology Hyper Backup to B2). See
  [backup-restore.md → off-site replication](./backup-restore.md).
- **Test restores** — at least once a quarter, restore a backup on a
  throwaway VM and verify the data. An untested backup is not a backup.
- **The key is NOT in the backup** — `.env` (containing
  `CHILDCHECK_DATA_KEY`) is explicitly excluded from `.cbak` bundles. Back
  up the key separately (sealed envelope, password manager, etc.).
- **Retention** — keep at least 30 days of daily backups + 12 monthly
  snapshots. Adjust to your regulatory environment.

---

## 10. Child data minimization

ChildCheck only collects what it needs to safely check children in and out.
Tighten further with these controls:

- **Visitor records are purgeable** — visitors added via the kiosk quick-add
  flow can be bulk-purged via `/admin/data` → Export/Import tab →
  "Purge visitors". Use this after every event to remove transient records.
- **Photos are optional** — disable the `photo_verification` flag in
  `/admin/settings` and no photos will be captured or displayed. Existing
  photos can be bulk-deleted via `/admin/data`.
- **Medical data is role-scoped** — `allergies`, `medicalNotes`,
  `dietaryNotes` fields are only returned by the API to callers with the
  `view_people` permission (Admin / PeopleManager / Security). The kiosk
  search response deliberately omits these fields — it returns only a
  boolean `hasAlerts` so the kiosk can show a badge without leaking the
  underlying data.
- **Email + phone are contact-only** — never used for authentication
  (unless `email_recovery` is enabled, which is OFF by default).
- **WWCC numbers are partially redacted** in list views — only the last 4
  digits are shown; the full number requires the detail view.

---

## 11. Optional LAN-only mode

ChildCheck makes NO outbound network calls in normal operation (no
telemetry, no analytics, no font/CDN fetches — everything is self-hosted).
The only outbound call is **optional** SMTP for email-based password
recovery, which is gated OFF by default (the `email_recovery` flag).

To run a fully air-gapped install:

1. Set `NEXTAUTH_URL=http://<lan-ip>:3000` (HTTP is fine inside a trusted
   LAN; the cookies will be marked `Secure=false`).
2. Bind the dev server / Docker port to the LAN interface only (§1).
3. Keep `email_recovery` OFF (default).
4. (Optional) Block outbound traffic at the firewall for the ChildCheck
   host — nothing breaks.

This is the simplest deployment for a single-site church / school / club
that doesn't need remote admin access.

---

## Security checklist (production)

Print this off and tick each box before going live.

### Network

- [ ] ChildCheck is bound to the LAN interface only (or `127.0.0.1` behind
      a reverse proxy) — not `0.0.0.0` exposed to the internet.
- [ ] The host firewall denies inbound 3000 from outside the LAN.
- [ ] (If internet-exposed) A TLS-terminating reverse proxy (Caddy/Nginx)
      is in front; `NEXTAUTH_URL` is HTTPS.
- [ ] HSTS header is set by the reverse proxy.
- [ ] `NEXTAUTH_URL` matches the URL users actually browse to.

### Secrets

- [ ] `NEXTAUTH_SECRET` is a strong 64-hex-char value (not the auto-generated
      default — or, if auto-generated, `config/.nextauth-secret` is backed up).
- [ ] `CHILDCHECK_DATA_KEY` is a strong 64-hex-char value, generated with
      `openssl rand -hex 32`.
- [ ] `REALTIME_INTERNAL_KEY` is a strong random value.
- [ ] `.env` is `chmod 600`, owned by the `childcheck` user, and backed up
      off-site (separately from the DB backups).
- [ ] The `CHILDCHECK_DATA_KEY` is also stored in a sealed envelope / password
      manager / etc. — losing it means photos + backups can't be decrypted.

### Service + filesystem

- [ ] The service runs as a non-root dedicated user (`childcheck`).
- [ ] `data/`, `db/`, `config/` directories are `chmod 700`, owned by
      `childcheck`.
- [ ] (Linux) The systemd unit has `ProtectSystem=strict`, `ProtectHome`,
      `PrivateTmp`, `PrivateDevices`, `NoNewPrivileges` (written by
      `install-linux.sh`).
- [ ] The host OS is kept up to date (unattended-upgrades / equivalent).

### Authentication + sessions

- [ ] The default admin password has been changed from the wizard password.
- [ ] All admin / security / people-manager accounts use strong passwords.
- [ ] Kiosk accounts have PINs (not full passwords) and `Kiosk` role only.
- [ ] `NEXTAUTH_URL` is HTTPS so session cookies are `Secure`.
- [ ] (Recommended) `SameSite=Strict` is set on session cookies.
- [ ] Idle timeout (admin: 15 min, kiosk: 90s) is enforced via the layout
      components.

### Rate limiting

- [ ] Login rate limiter (10/min/username+IP) is in effect — test by
      attempting 11 rapid wrong-password logins; the 11th should return 429.
- [ ] Admin write limiter (60/min/session) is in effect.
- [ ] Kiosk search limiter (30/min/IP) is in effect.
- [ ] Guardian PIN limiter (5/min/family) is in effect.
- [ ] (Multi-instance only) Limiter is backed by Redis, not in-memory.

### Audit log

- [ ] New audit rows have non-null `hash` (verify in `/admin/audit` —
      badges should show "OK", not "unhashed", for post-Stage-16 rows).
- [ ] "Verify chain integrity" returns `{ ok: true }` after a fresh install.
- [ ] A weekly verify is scheduled (calendar reminder / cron job hitting
      `GET /api/admin/audit/verify` + alerting on `ok: false`).
- [ ] The audit log is included in every `.cbak` backup (it's part of the
      SQLite DB).

### Backups

- [ ] `scheduled_backups` flag is ON (or a cron job hits
      `POST /api/admin/backup/tick` daily).
- [ ] `data/backups/` is synced off-site (rsync / rclone / Hyper Backup).
- [ ] At least one restore has been tested on a throwaway VM.
- [ ] Retention is configured (30 daily + 12 monthly, or per policy).

### Kiosk devices

- [ ] Each kiosk device has Guided Access (iOS) / Screen Pinning (Android)
      enabled so users can't switch out of the kiosk browser.
- [ ] Kiosk devices are on the same LAN as the server (or via a VPN — never
      over the public internet without TLS).
- [ ] The kiosk browser's saved passwords are cleared (it shouldn't offer
      to save the kiosk account PIN).

### Data minimization

- [ ] Visitor records are purged after each event (`/admin/data`).
- [ ] `photo_verification` is OFF if photos aren't required.
- [ ] `email_recovery` is OFF for air-gapped / LAN-only installs.
- [ ] Medical / WWCC fields are only visible to roles with `view_people`.

### Key rotation (annual hygiene)

- [ ] `CHILDCHECK_DATA_KEY` has been rotated within the last 12 months (or
      after any suspected leak).
- [ ] Old backups made under the previous key have either been re-made
      under the new key, or `CHILDCHECK_DATA_KEY_OLD` is preserved for
      restore.
- [ ] The rotation is recorded in the audit log (`key.rotation` action).

---

## Incident response

If you suspect a breach:

1. **Stop the service.** `sudo systemctl stop childcheck` (or `docker compose stop`).
2. **Snapshot the data dir.** `tar czf /tmp/cc-snapshot-$(date +%s).tgz /var/lib/childcheck/{data,db,config}` — this preserves evidence (including the audit log + any tampering).
3. **Verify the audit chain.** `bun run scripts/verify-audit.ts` (or open
   `/admin/audit` → "Verify chain integrity") — if it returns `ok: false`,
   note the `brokenAt` row ID and the reason; that's your first lead.
4. **Rotate the master key.** See §5 — this renders any exfiltrated photos
   + future backups unreadable (assuming the new key isn't also compromised).
5. **Rotate all admin passwords.** Especially the admin account.
6. **Notify the relevant authority** per your local child-safety / privacy
   regulations (e.g. OAIC in Australia, ICO in the UK, etc.).
7. **Restore from a known-good backup** if the live data has been tampered
   with. Pick the most recent backup whose chain verifies intact.
