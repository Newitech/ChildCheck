# =============================================================================
# ChildCheck — multi-stage Dockerfile
#
# Stage 1 (builder):
#   - oven/bun base, install deps, build Next.js (produces .next/standalone).
#
# Stage 2 (runtime):
#   - oven/bun (slim), copy standalone server + static + public + prisma +
#     realtime mini-service. Install only the runtime deps needed
#     (prisma CLI for db:push + socket.io for the realtime service).
#   - Runs as non-root `childcheck` user.
#   - Entrypoint: db:push → realtime mini-service (bg) → next start.
#
# Build:
#   docker build -t childcheck:latest .
#
# Run (quick smoke):
#   docker run --rm -p 3000:3000 -p 3003:3003 \
#     -v $(pwd)/data:/app/data \
#     -v $(pwd)/db:/app/db \
#     -e NEXTAUTH_URL=http://localhost:3000 \
#     -e NEXTAUTH_SECRET=$(openssl rand -hex 32) \
#     childcheck:latest
#
# Production: see docker-compose.yml + docs/deployment/docker.md.
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1 — builder
# ---------------------------------------------------------------------------
FROM oven/bun:1.3-debian AS builder

WORKDIR /app

# Install deps first (cached layer). Copy manifests only (no lockfile — it's
# not tracked in the repo to avoid version-mismatch crashes in CI).
COPY package.json ./
COPY mini-services/realtime/package.json ./mini-services/realtime/

# Install root deps (including devDeps needed for the build: next, prisma, eslint).
RUN bun install

# Copy the rest of the source.
COPY . .

# Delete any lockfile that bun install may have created, so bun run doesn't
# crash with "lockfile is frozen" in CI environments.
RUN rm -f bun.lock

# Generate the Prisma client (the build needs @prisma/client).
RUN bun run --no-install db:generate

# Build Next.js. package.json "build" script also copies .next/static + public
# into .next/standalone/ (see package.json).
RUN bun run --no-install build

# Install the realtime mini-service deps (so we can copy node_modules into the
# runtime image without re-installing there).
RUN cd mini-services/realtime && bun install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 2 — runtime
# ---------------------------------------------------------------------------
FROM oven/bun:1.3-debian AS runtime

# Install only what the runtime image needs: tini (PID 1 / signal handling),
# wget (healthcheck probe), openssl (entrypoint mints a default NEXTAUTH_SECRET),
# gosu (privilege drop — the entrypoint runs as root to fix bind-mount perms,
# then drops to the childcheck user before starting the app).
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini wget openssl ca-certificates gosu \
 && rm -rf /var/lib/apt/lists/*

# Non-root user.
RUN groupadd --system --gid 1001 childcheck \
 && useradd  --system --uid 1001 --gid childcheck \
             --home-dir /app --shell /usr/sbin/nologin childcheck

WORKDIR /app

# --- Copy the Next.js standalone bundle (includes server.js, traced node_modules,
#     .next/static, public/).
COPY --from=builder --chown=childcheck:childcheck /app/.next/standalone ./
# The build script in package.json already copied .next/static + public/ into
# .next/standalone, but copy them again explicitly to be safe across future
# changes to that script.
COPY --from=builder --chown=childcheck:childcheck /app/.next/static ./.next/static
COPY --from=builder --chown=childcheck:childcheck /app/public ./public

# --- Copy the Prisma schema + package manifests so the entrypoint can run
#     `prisma db push --skip-generate` to apply the schema to SQLite on boot.
COPY --from=builder --chown=childcheck:childcheck /app/prisma ./prisma
COPY --from=builder --chown=childcheck:childcheck /app/package.json ./package.json
COPY --from=builder --chown=childcheck:childcheck /app/bun.lock ./bun.lock
# Copy the ENTIRE node_modules from the builder stage. This includes:
#   - prisma CLI (needed for db:push at boot)
#   - @prisma/client + the generated client (.prisma) — needed by the app
#   - all runtime deps the standalone server traces
# We do NOT run a second `bun install --production` here — that was slow +
# hit integrity-check failures. Copying from the builder is faster + reliable.
COPY --from=builder --chown=childcheck:childcheck /app/node_modules ./node_modules

# --- Copy the realtime mini-service (Node + socket.io).
COPY --from=builder --chown=childcheck:childcheck /app/mini-services/realtime ./mini-services/realtime

# --- Entrypoint script.
COPY --chown=childcheck:childcheck docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Data directories. The entrypoint will ensure subdirs exist on first boot.
# These are the bind-mount points docker-compose maps to ./data, ./db, ./config.
RUN mkdir -p /app/data /app/db /app/config \
 && chown -R childcheck:childcheck /app/data /app/db /app/config

# Default env (override via docker-compose / -e flags).
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    REALTIME_PORT=3003 \
    DATABASE_URL=file:/app/db/custom.db \
    CHILDCHECK_DATA_DIR=/app/data \
    NEXTAUTH_URL=http://localhost:3000

EXPOSE 3000 3003

# Health check: the /api/config route is public + DB-backed, so a 200 means
# the Next.js server is up AND the Prisma client can read the (just-pushed)
# SQLite schema. Uses $PORT so it works regardless of the port override.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- --tries=1 --timeout=3 http://localhost:${PORT:-3000}/api/config >/dev/null 2>&1 || exit 1

# NOTE: we intentionally do NOT set USER childcheck here. The entrypoint runs
# as root so it can chown the bind-mounted data/db/config directories (which
# may be owned by the host user, e.g. UID 1000) to the childcheck user. It
# then drops privileges via gosu before starting the app. This is the standard
# pattern used by the official Postgres / MySQL images.

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
