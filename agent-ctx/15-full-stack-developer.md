# Task 15 — full-stack-developer — Stage 15: Deployment & installation

## Goal
Build Dockerfile + docker-compose.yml, Bun standalone binary build script, install scripts (Linux/macOS/Windows/Synology NAS), and `docs/deployment/` guides.

## Context (from prior worklog stages 0–14)
- Stack: Next.js 16 App Router + TS 5 + Tailwind 4 + shadcn/ui + Prisma (SQLite at `db/custom.db`).
- `output: "standalone"` in `next.config.ts`. Build script copies `.next/static` + `public/` into `.next/standalone/`.
- Mini-service at `mini-services/realtime/` (Socket.io on port 3003, started via `bun --hot index.ts`).
- Data dirs from `src/lib/paths.ts`: `DATA_DIR` = `process.env.CHILDCHECK_DATA_DIR || "/home/z/my-project/data"`, subdirs `photos/`, `branding/`, `backups/` (created on demand).
- Env: `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, optional `CHILDCHECK_DATA_KEY` (photo/backup encryption — defaults to all-zeros dev key).
- `/api/config` is public (health-check target). `/api/setup` is the first-run wizard POST endpoint (creates org + admin + seeds SDA programs).
- DB filename in `DATABASE_URL` is `file:/home/z/my-project/db/custom.db`. Prisma `db:push` script exists.

## Plan
1. Create `Dockerfile` (multi-stage: build with `oven/bun`, runtime slim) + `.dockerignore` + `docker/entrypoint.sh`.
2. Create `docker-compose.yml` (service `childcheck`, ports, volumes for data + db + config, env, healthcheck).
3. Create `scripts/build-binaries.sh` — Bun `--compile` for linux-x64, linux-arm64, macos-arm64, windows-x64; bundles a small launcher TS that runs db:push + realtime + next start.
4. Create install scripts under `install/`:
   - `install-linux.sh` (systemd, `/opt/childcheck`, `/var/lib/childcheck/{data,db}`).
   - `install-macos.sh` (launchd plist in `~/Library/LaunchAgents/`).
   - `install-windows.ps1` (WinSW wrapper).
   - `install-nas-synology.sh` (DSM scheduled task).
5. Create `docs/deployment/` with 9 markdown guides.
6. Verify: `bun run lint` clean; `bash -n` on install scripts; dev server still runs; dev.log no new errors.

## Status
- in progress
