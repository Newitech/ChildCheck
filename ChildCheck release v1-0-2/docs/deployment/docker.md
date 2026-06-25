# Docker Deployment

The fastest way to run ChildCheck in production. The provided `docker-compose.yml`
brings up the Next.js app + realtime mini-service in a single container, with
persistent volumes for the database, uploaded photos, branding, and backups.

## Prerequisites

- Docker 20+ and Docker Compose v2.
- ~512 MB free RAM (the container is light; SQLite is the DB).
- A reverse proxy for TLS (recommended — see [TLS reverse proxy](#tls-reverse-proxy)).

## 1. Get the source

```bash
git clone https://github.com/Newitech/ChildCheck.git
cd childcheck
```

You only need the `Dockerfile`, `docker-compose.yml`, `.env.example`, and the
`prisma/`, `mini-services/`, `public/`, `src/` directories — but cloning the
whole repo is simplest.

## 2. Configure environment

```bash
cp .env.example .env
$EDITOR .env   # set NEXTAUTH_URL + NEXTAUTH_SECRET + (optional) CHILDCHECK_DATA_KEY
```

At minimum, set:

| Var | Value |
|---|---|
| `NEXTAUTH_URL` | The public URL users browse to (e.g. `https://checkin.mychurch.org`) |
| `NEXTAUTH_SECRET` | 32-byte hex string — generate with `openssl rand -hex 32` |
| `CHILDCHECK_DATA_KEY` | 32-byte hex string for photo/backup encryption (strongly recommended) |

## 3. Build + start

```bash
docker compose up -d --build
```

The first build takes ~3–5 minutes (Bun install + Next.js build). Subsequent
rebuilds are fast due to layer caching.

Check the logs:

```bash
docker compose logs -f childcheck
```

You should see:

```
[entrypoint] ChildCheck starting up...
[entrypoint] running prisma db:push...
[entrypoint] db:push complete
[entrypoint] starting realtime mini-service on port 3003...
[entrypoint] realtime is running
[entrypoint] starting Next.js standalone server on 0.0.0.0:3000...
```

## 4. Verify

```bash
curl http://localhost:3000/api/config
# → {"branding": {...}, "flags": {...}, ...}
```

Then browse to <http://localhost:3000/setup> to complete the first-run wizard.

## Volumes

`docker-compose.yml` mounts three host directories into the container:

| Host path | Container path | Contents |
|---|---|---|
| `./db` | `/app/db` | SQLite database file (`custom.db`) |
| `./data` | `/app/data` | Uploaded photos, branding logo, encrypted backup bundles |
| `./config` | `/app/config` | Auto-generated NEXTAUTH_SECRET (if not provided) |

Back these up regularly — see [Backup & restore](./backup-restore.md).

## Environment variables

All variables the container reads (with defaults):

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `production` | Next.js runtime mode |
| `PORT` | `3000` | Next.js HTTP port |
| `REALTIME_PORT` | `3003` | Socket.io port |
| `HOSTNAME` | `0.0.0.0` | Bind address |
| `DATABASE_URL` | `file:/app/db/custom.db` | Prisma SQLite connection string |
| `NEXTAUTH_URL` | (required) | Public URL |
| `NEXTAUTH_SECRET` | (auto-generated if missing) | JWT signing secret |
| `CHILDCHECK_DATA_DIR` | `/app/data` | Photos / branding / backups root |
| `CHILDCHECK_CONFIG_DIR` | `/app/config` | Persisted runtime secrets |
| `CHILDCHECK_DATA_KEY` | (dev all-zeros key) | 32-byte hex AES key for photos + backups |
| `REALTIME_INTERNAL_KEY` | `childcheck-internal-dev` | Shared secret for the realtime `/broadcast` endpoint |

## Health check

The container's `HEALTHCHECK` polls <http://localhost:3000/api/config> every 30 s.
This endpoint:

- is public (no auth needed)
- reads from the DB (so a 200 means SQLite is mounted + schema is pushed)

Inspect health:

```bash
docker inspect --format='{{.State.Health.Status}}' childcheck
# → healthy
```

## TLS reverse proxy

For browser-facing deployments, put Caddy or Nginx in front and let it handle
TLS. The simplest option is Caddy (automatic Let's Encrypt certs).

### Caddy (recommended)

Create `Caddyfile` next to your `docker-compose.yml`:

```caddy
checkin.mychurch.org {
    reverse_proxy childcheck:3000
}
```

Uncomment the `caddy` service in `docker-compose.yml` (or copy from the
commented block at the bottom). Make sure your DNS A/AAAA record for
`checkin.mychurch.org` points at the host running Docker.

The realtime service (Socket.io) is served through the same port 3000 via the
Next.js app's `/socket.io/` path. Caddy forwards it transparently — no special
handling needed. (If you'd rather expose port 3003 directly, see the
`XTransformPort` pattern in the README.)

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name checkin.mychurch.org;

    ssl_certificate     /etc/letsencrypt/live/checkin.mychurch.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/checkin.mychurch.org/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Socket.io: upgrade to WebSocket.
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 600s;
    }
}
```

> ⚠️ Set `NEXTAUTH_URL=https://checkin.mychurch.org` (HTTPS) in `.env` once TLS
> is in place, otherwise NextAuth cookies won't be marked `Secure`.

## Stopping / restarting

```bash
docker compose stop            # stop the container (preserves data)
docker compose start           # start it back up
docker compose restart         # full restart
docker compose down            # stop + remove container (preserves volumes)
docker compose up -d --build   # rebuild after a code update
```

## Updating to a new version

See [Updating](./updating.md#docker).

## Troubleshooting

### `NEXTAUTH_SECRET is required` error
You didn't set `NEXTAUTH_SECRET` in `.env`. Either set it explicitly, or remove
the `:?` requirement in `docker-compose.yml` and let the entrypoint auto-generate
one (it will be persisted to `./config/.nextauth-secret`).

### Health check fails but the container is running
Give it 30 seconds — the entrypoint runs `db:push` first. Check the logs:

```bash
docker compose logs childcheck
```

### Photos or backups directory is empty after a restart
You probably didn't bind-mount `./data`. Stop the container, add the volume,
and restart — your photos are still inside the old container's writable layer
(`docker cp` to extract them if needed).

### Port 3000 already in use on the host
Edit the `ports:` section in `docker-compose.yml`:

```yaml
ports:
  - "8080:3000"   # host:container
```

Then update `NEXTAUTH_URL` to include the new port (e.g. `http://localhost:8080`).
