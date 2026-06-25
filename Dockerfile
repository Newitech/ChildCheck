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

# Install deps first (cached layer). Copy lockfile + manifests only.
COPY package.json bun.lock ./
COPY mini-services/realtime/package.json mini-services/realtime/bun.lock ./mini-services/realtime/

# Install root deps (including devDeps needed for the build: next, prisma, eslint).
RUN bun install --frozen-lockfile

# Copy the rest of the source.
COPY . .

# Generate the Prisma client (the build needs @prisma/client).
RUN bun run db:generate

# Build Next.js. package.json "build" script also copies .next/static + public
# into .next/standalone/ (see package.json).
RUN bun run build

# Install the realtime mini-service deps (so we can copy node_modules into the
# runtime image without re-installing there).
RUN cd mini-services/realtime && bun install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 2 — runtime
# ---------------------------------------------------------------------------
FROM oven/bun:1.3-debian AS runtime

# Install only what the runtime image needs: tini (PID 1 / signal handling),
# wget (healthcheck probe), openssl (used by entrypoint to mint a default
# NEXTAUTH_SECRET if none is provided).
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini wget openssl ca-certificates \
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

# --- Copy the Prisma schema + a minimal prisma CLI install so the entrypoint
#     can run `bun run db:push` to create/migrate the SQLite DB on first boot.
COPY --from=builder --chown=childcheck:childcheck /app/prisma ./prisma
COPY --from=builder --chown=childcheck:childcheck /app/package.json ./package.json
COPY --from=builder --chown=childcheck:childcheck /app/bun.lock ./bun.lock
# Install only prisma as a runtime dep (devDeps excluded). --frozen-lockfile
# would fail because we're not installing everything, so we use --production.
RUN bun install --production \
 && bun add prisma@^6.11.1 --production

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
# SQLite schema.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- --tries=1 --timeout=3 http://localhost:3000/api/config >/dev/null 2>&1 || exit 1

USER childcheck

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
