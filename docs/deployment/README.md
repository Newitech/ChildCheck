# ChildCheck — Deployment Guide

Welcome! This guide walks you through deploying ChildCheck in production.
Pick the method that best matches your environment.

## Pick your method

| Method | Best for | Pros | Cons |
|---|---|---|---|
| **[Docker](./docker.md)** ✅ recommended | Servers, VPS, NAS with Container Manager | One command, easy updates, isolated | Needs Docker installed |
| **[Linux native](./linux.md)** | Dedicated Linux server, no Docker | Low overhead, systemd integration | Manual binary download |
| **[macOS native](./macos.md)** | Mac mini / studio home server | launchd integration, native performance | Apple Silicon only (prebuilt) |
| **[Windows native](./windows.md)** | Windows Server / desktop | Windows Service integration | Needs PowerShell as admin |
| **[Synology NAS](./nas-synology.md)** | Synology DiskStation | Runs alongside your files | DSM 7+ on x86_64/arm64 NAS |

## Quick reference

- **Default ports**: 3000 (web UI + REST API), 3003 (realtime / Socket.io)
- **Database**: SQLite, stored in a single file (`db/custom.db`)
- **Data**: photos, branding logo, encrypted backups in `data/`
- **Required env**: `NEXTAUTH_SECRET`, `NEXTAUTH_URL`
- **Strongly recommended**: `CHILDCHECK_DATA_KEY` (encrypts photos + backups)

## First-run setup

After installing with **any** method, complete the first-run setup wizard:

1. Browse to `http://<your-host>:3000/setup`.
2. Fill in your organisation name, the first admin's first/last name, username, and password.
3. Click **Create admin & finish setup**. The default SDA programs (Sabbath School, Pathfinders, Adventurers, Community Childcare) are seeded automatically.
4. You're redirected to `/admin`. Sign in with the admin account.
5. Visit **/admin/settings** to configure branding (org name, colours, terminology, logo), feature toggles, calendar week-start, and the daily code format.

> ⚠️ The setup wizard is only available before any user exists. Once the first admin is created, `/setup` redirects to `/`.

## Common topics

- **[Configuration (all env vars, data dirs)](./configuration.md)**
- **[Updating to a new version](./updating.md)**
- **[Backup & restore](./backup-restore.md)**
- **[Uninstalling (per-platform, with backup)](./uninstall.md)**

## Architecture (one-page overview)

```
                          ┌────────────────────────────────┐
                          │       Reverse proxy (TLS)      │
                          │   Caddy / Nginx / Traefik      │
                          └───────────────┬────────────────┘
                                          │ 443 (HTTPS)
                          ┌───────────────▼────────────────┐
                          │       Next.js (port 3000)      │
                          │  - Web UI (kiosk / admin /     │
                          │    volunteer / guardian)       │
                          │  - REST API (/api/...)         │
                          │  - NextAuth (cookie sessions)  │
                          └──┬──────────────────────┬──────┘
                             │                      │
                  ┌──────────▼─────┐    ┌───────────▼────────────┐
                  │  SQLite DB     │    │  Realtime mini-service  │
                  │  db/custom.db  │    │  (port 3003, Socket.io) │
                  └────────────────┘    └─────────────────────────┘

                  ┌──────────────────────────────────────┐
                  │       data/                          │
                  │  photos/   encrypted-at-rest photos  │
                  │  branding/ uploaded org logo         │
                  │  backups/  encrypted .cbak bundles   │
                  └──────────────────────────────────────┘
```

## Getting help

- File issues at <https://github.com/childcheck/childcheck/issues>.
- Before contacting support, gather:
  - The output of `childcheck version` (or `docker logs childcheck` first lines).
  - Your install method + OS.
  - The relevant log snippet (see [Updating](./updating.md) for where logs live per install method).
