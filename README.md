# ChildCheck

**Self-hosted, secure child check-in / check-out for churches, clubs, schools & childcare.**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Built with Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org)
[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun-f9f1e1)](https://bun.sh)
[![Database: SQLite](https://img.shields.io/badge/Database-SQLite-003B57)](https://www.sqlite.org)

---

## What is ChildCheck?

ChildCheck is a **self-hosted web application** for securely checking children in and out of programs — built with **Seventh-day Adventist** organisations in mind (Sabbath School, Pathfinders, Adventurers), but rebrandable for any church, club, school, or childcare centre.

**All data stays on your hardware.** No cloud provider, no third-party data hosting. Photos and backups are encrypted at rest (AES-256-GCM). The system is a Progressive Web App (PWA) — installable on phones, tablets, and desktops like a native app.

### Key features
- **Kiosk mode** — touch-friendly, fullscreen, open or PIN-locked
- **Multi-child check-in** — tick all children at once, one daily code per family
- **Check-out** — by daily code, guardian PIN, or staff override (with mandatory note)
- **Authorised guardians** — grandparents/aunts/uncles who can sign in/out but not edit family data
- **Blacklist** — blocked collectors with a hard stop at checkout
- **Allergy & medical alerts** — surfaced prominently at check-in, role-scoped visibility
- **Photo verification** — optional visual match at checkout
- **Programs & classes** — Sabbath School / Pathfinders / Adventurers / custom, with rooms + schedules
- **Volunteer dashboard** — live room rosters (realtime), headcounts, manual check-in/out
- **Reports** — attendance, headcount trends, volunteer hours, visitor follow-up, WWCC expiry
- **Printing** — name labels + signout-code slips (browser / QZ Tray / thermal)
- **Import/Export** — CSV for people/families, Elvanto connector
- **Backup/Restore** — encrypted `.cbak` bundles
- **Audit log** — tamper-evident, SHA-256 hash-chained
- **SDA-correct calendar** — Sunday = 1st day, Saturday = 7th-day Sabbath (configurable)
- **Cross-platform** — Docker, Linux, macOS, Windows, NAS
- **Offline-resilient** — kiosk queues check-ins during network outages

---

## Quick start (Docker)

```bash
# 1. Get the project
git clone https://github.com/Newitech/ChildCheck.git
cd childcheck

# 2. Configure
cp .env.example .env
# Edit .env: set NEXTAUTH_SECRET, CHILDCHECK_DATA_KEY, NEXTAUTH_URL
# Generate secrets with: openssl rand -hex 32

# 3. Build + start
docker compose up -d --build

# 4. Open the setup wizard
# Browse to http://localhost:3000/setup
```

The first-run wizard creates your organisation + first admin account + seeds the default SDA programs (Sabbath School, Pathfinders, Adventurers, Community Childcare).

### 🔒 HTTPS (recommended)

For any deployment beyond localhost, serve ChildCheck over HTTPS via Caddy (bundled opt-in):

```bash
# Docker — auto Let's Encrypt for a real domain:
DOMAIN=checkin.mychurch.org docker compose --profile tls up -d

# Docker — self-signed for LAN-only (no domain needed):
cp docker/Caddyfile.lan docker/Caddyfile
docker compose --profile tls up -d

# Native install (Linux/macOS/Windows) — adds Caddy automatically:
sudo bash install/install-linux.sh --tls
```

See [Security & TLS guide](docs/deployment/security.md) for the full walkthrough, including Caddy's internal root CA import for LAN-only setups.

---

## Installation

| Platform | Guide |
|----------|-------|
| Docker (recommended) | [docs/deployment/docker.md](docs/deployment/docker.md) |
| Linux (systemd) | [docs/deployment/linux.md](docs/deployment/linux.md) |
| macOS (launchd) | [docs/deployment/macos.md](docs/deployment/macos.md) |
| Windows (service) | [docs/deployment/windows.md](docs/deployment/windows.md) |
| Synology NAS | [docs/deployment/nas-synology.md](docs/deployment/nas-synology.md) |

---

## Configuration

After setup, sign in at `/admin` → **Settings** (4 tabs):
- **Branding & Terminology** — org name, colours, logo, terminology overrides, org-type profile
- **Calendar & Codes** — week starts on (Sunday for SDA), daily code length + charset
- **Feature Toggles** — 14 flags (kiosk lock, guardian PIN, photo verification, override checkout, etc.)
- **Email** — SMTP config with presets (Gmail, Office 365, Outlook, Yahoo, Zoho)

Full config reference: [docs/deployment/configuration.md](docs/deployment/configuration.md)

---

## Security

- **Self-hosted** — all data on your hardware, no outbound calls except optional SMTP
- **Encrypted at rest** — photos + backups + SMTP passwords (AES-256-GCM)
- **Tamper-evident audit log** — SHA-256 hash-chained, verification built in
- **Role-based access** — 6 roles (Admin, Security, Teacher, Volunteer, Kiosk, PeopleManager), 14 permissions
- **Rate limiting** — login, search, admin writes
- **No data leakage** — kiosk search returns no medical/photo/contact data

Security guide: [docs/deployment/security.md](docs/deployment/security.md)

---

## Updating

Updates are discovered in-app (admin console → Updates card) and applied externally:

- **Docker:** `docker compose pull && docker compose up -d`
- **Native:** `sudo bash install/childcheck-update.sh`

Updating guide: [docs/deployment/updating.md](docs/deployment/updating.md)

---

## License

ChildCheck is licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0-or-later).

This means:
- ✅ You can use, modify, and distribute ChildCheck freely
- ✅ You can self-host it for your organisation
- ⚠️ If you modify ChildCheck and make it available to others over a network (e.g. host it as a service), you **must** make the source code of your modified version available to those users
- ⚠️ All derivative works must also be licensed under AGPL-3.0

See [LICENSE](LICENSE) for the full text, or [docs/LICENSES-COMPARISON.md](docs/LICENSES-COMPARISON.md) for the rationale behind this choice.

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md).

**Security disclosures:** Do NOT open public issues for security vulnerabilities. Email the maintainer directly.

---

## Acknowledgements

- Built with [Next.js](https://nextjs.org), [Prisma](https://prisma.io), [shadcn/ui](https://ui.shadcn.com), [Bun](https://bun.sh), [Tailwind CSS](https://tailwindcss.com)
- Realtime updates via [Socket.io](https://socket.io)
- Charts via [Recharts](https://recharts.org)
