# ChildCheck — Secure Child Check-In / Check-Out System

**A self-hosted, cross-platform, web-based child check-in / check-out system for churches (Seventh-Day Adventist focused), clubs, schools, and childcare organisations.**

Inspired by the check-in/out components of Rock RMS and Elvanto, but re-imagined as a standalone, self-hosted, privacy-first system focused exclusively on the check-in / check-out workflow.

---

## 1. Vision & Goals

### 1.1 What we are building
A single deployable application that lets an organisation (church, club, school, childcare centre, playgroup, Scouts troop, etc.) securely check children **in** to and **out** of programs, classes, and one-off events — while keeping **all personal and child data on the organisation's own infrastructure** (no cloud provider, no third-party data hosting).

### 1.2 Primary target audience
- **Primary:** Seventh-Day Adventist churches running **Sabbath School**, **Pathfinders**, **Adventurers**, community childcare, and custom programs.
- **Secondary (via branding/config):** Any church (e.g. one that prefers the term "Sunday School"), Scouts, childcare centres, playgroups, schools, clubs.

### 1.3 Core principles
1. **Self-hosted & local-first** — all data stays on the organisation's hardware/network. No mandatory cloud dependency.
2. **Cross-platform** — runs on Linux, Windows, macOS, NAS devices, and Docker.
3. **Web-accessible + installable** — a responsive web app that can be "installed" to the home screen / desktop (PWA) on Android, iOS, Windows, macOS, Linux.
4. **Secure by default** — personal + child data is encrypted at rest, access is role-based, all sensitive actions are audit-logged.
5. **Configurable, not custom-coded** — branding, terminology, and feature toggles live in an Admin Dashboard so the same binary serves an SDA church, a Scouts troop, or a childcare centre.
6. **Offline-resilient kiosk** — the kiosk keeps working during network blips and resyncs when connectivity returns.

### 1.4 Non-goals (explicitly out of scope for this build)
- A full church management system (we are not rebuilding Rock/Elvanto — only the check-in/out slice).
- Cloud hosting / SaaS multi-tenancy. (Single organisation per install; multi-site is a *future* item.)
- Replacing the organisation's existing CRM/CHM. (Future import/export integrations are planned.)

---

## 2. Key Use Cases

| # | Actor | Use case |
|---|-------|----------|
| UC-1 | Guardian (Primary Carer) | Self-register family + children, set PIN/password, manage own data. |
| UC-2 | Guardian | Add/remove **Authorised Guardians** (grandparents, aunts/uncles) who may sign children in/out but not edit family data. |
| UC-3 | Guardian | Add an entry to the **Blacklist** (person explicitly NOT permitted to collect a child). |
| UC-4 | Guardian | At a kiosk, search own family, tick multiple children, sign them all in with one action, receive a daily 3-digit code. |
| UC-5 | Guardian | Return later, enter the 3-digit code (or PIN) for quick sign-out of some/all children. |
| UC-6 | Visitor / First-timer | At a kiosk, quickly add themselves + child(ren) for the day, with an option to **add / not add** to the regular database. |
| UC-7 | Kiosk (open mode) | Walk-up user searches families by name / surname / phone / email. |
| UC-8 | Kiosk (locked mode) | A Kiosk Account PIN is required before the search screen is shown. |
| UC-9 | Admin / Teacher | Override checkout after confirming with an authorised guardian — must tick a confirmation box + write a note. |
| UC-10 | Teacher / Volunteer | Open the Volunteer Dashboard, see live room roster, take headcounts, process manual check-outs, view/print/email reports. |
| UC-11 | Admin | Configure branding, terminology, feature toggles, printers, programs, classes, events. |
| UC-12 | Admin | Import families/people from CSV; export data; backup & restore. |
| UC-13 | Admin | Promote a Person to Admin / Teacher / Volunteer / Kiosk — credentials flow from the Person record. |
| UC-14 | Guardian | Authorise an **older sibling** to collect a younger sibling. |

---

## 3. Technology Stack & Architecture

### 3.1 Stack (locked)
| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | **Next.js 16 (App Router) + TypeScript 5** | Already initialised; SSR + API routes in one binary; PWA-capable. |
| UI | **Tailwind CSS 4 + shadcn/ui (New York) + Lucide** | Consistent, accessible, already present. |
| State | **Zustand** (client) + **TanStack Query** (server) | Already available. |
| Auth | **NextAuth.js v4** (credentials provider, PIN/password, optional email recovery) | Already available; works fully offline. |
| ORM | **Prisma** | Already available. |
| DB (default) | **SQLite** (file-based, zero-config, perfect for self-hosting on a NAS) | Portable, ships inside the install. |
| DB (optional) | **PostgreSQL** (documented swap path in `.env`) | For larger orgs / multi-device write load. |
| Realtime | **Socket.io** mini-service (separate port, gateway-routed) | Live roster updates to teacher dashboard & kiosks. |
| Printing | **QZ Tray** or **node-thermal-printer** / browser print to configured queues | Cross-platform label printing. |
| Packaging | **Docker** (primary) + **Bun standalone binary** + **systemd/launchd/Winsw** service wrappers | Cross-platform deployment. |

### 3.2 High-level architecture
```
┌──────────────────────────────────────────────────────────────┐
│  Client (any modern browser / installed PWA)                  │
│  ├─ Kiosk UI        ├─ Guardian Self-Service UI               │
│  └─ Admin / Volunteer Dashboard UI                            │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTPS (Caddy gateway, port 3000)
┌───────────────────────────▼──────────────────────────────────┐
│  Next.js 16 App (API routes + Server Components)              │
│  ├─ NextAuth (PIN/password, session, RBAC)                    │
│  ├─ Domain APIs (people, families, check-in/out, reports)     │
│  └─ Audit log, backup/restore, import/export                  │
└──────────┬──────────────────────────────┬────────────────────┘
           │                              │
   ┌───────▼───────┐              ┌───────▼────────┐
   │ Prisma Client │              │ Socket.io svc  │
   │ SQLite/PG     │              │ (port 3003)    │
   └───────────────┘              └────────────────┘
           │
   ┌───────▼───────┐
   │ File storage  │  (photos, backups, label templates)
   │ ./data/       │  encrypted at rest via app-layer AES
   └───────────────┘
```

### 3.3 Cross-platform packaging strategy
- **Docker** — primary, recommended for NAS / Linux servers. Single `docker-compose.yml` with volumes for `./data` and `./db`.
- **Bun standalone binary** — `bun build --compile` produces a single executable for Linux/macOS/Windows. Bundles the Next.js standalone output.
- **Service wrappers** — systemd unit (Linux), launchd plist (macOS), winsw/nssm (Windows), Synology DSM task (NAS).
- **Install scripts** — one-shot bash (Linux/Mac) and PowerShell (Windows) scripts in `/install/`.

### 3.4 PWA / "install like an app"
- Web manifest with `display: standalone`, maskable icons, theme colour pulled from branding config.
- Service worker for offline shell + cached kiosk assets.
- On iOS/Android/Chrome/Edge, "Add to Home Screen" / "Install" produces an app-like icon with no browser chrome.
- Same binary serves kiosk tablets, guardian phones, admin desktops.

---

## 4. Core Domain Model (high level)

> Full Prisma schema is defined stage-by-stage. This is the conceptual map.

### 4.1 Organisation & Configuration
- **Organisation** (singleton) — name, branding (logo, colours, terminology overrides: e.g. "Sabbath School" vs "Sunday School" vs "Unit").
- **FeatureFlags** — every enable/disable toggle in the Admin Dashboard (see §6).
- **Printer** — name, driver type, assigned area/classroom.
- **Area / Room** — physical locations where check-in/out happens.

### 4.2 Programs, Classes, Events
- **Program** — recurring program (Sabbath School, Pathfinders, Adventurers, Community Childcare, Custom…).
- **Group / Class** — a class within a program (e.g. "Beginner", "Kindergarten", "Primary", "Juniors"). Assigned to a Room and a Schedule.
- **Schedule** — when a class meets (day-of-week + time, or ad-hoc).
- **Event** — a one-off / occasional event not under a regular program (e.g. "Community Fun Day 2025"). Can reuse classes or define ad-hoc rooms.

### 4.3 People & Families
- **Person** — a human. Has a `personType`: `Adult` | `Child`. Common fields + type-specific fields.
  - Adult-only fields: email, phone, PIN, password hash, self-manage flag.
  - Child-only fields: DOB, school grade, allergies, medical notes, photo-verification flag.
- **Family** — a household. Has 1+ **PrimaryCarer** (Adult Person) and 0+ Child Persons.
- **FamilyMembership** — join table Person↔Family with role (`PrimaryCarer`, `Child`, `AuthorisedGuardian`, `EmergencyContact`).
- **AuthorisedGuardian** — an Adult Person (may belong to their *own* Family) who can sign in/out a given Family's children but cannot edit that family's data.
- **BlacklistEntry** — Person (or free-text name+description) explicitly **not** permitted to collect a specified child/family.
- **OlderSiblingAuthorisation** — flag + details allowing an older sibling Person to collect a younger sibling.
- **WorkingWithChildrenCard** — card type (e.g. "QLD Blue Card", "NSW WWCC", international equivalent), number, status, expiry, verified-by.

### 4.4 Users & Security Roles
- **User** — a login account. **Linked 1:1 to a Person** (Admin, Teacher, Volunteer, Kiosk all link from PEOPLE records and share the Person's credentials).
- **Role** — `Admin`, `Security`, `Teacher`, `Volunteer`, `Kiosk`, `PeopleManager`.
- **RoleAssignment** — User↔Role with optional scope (e.g. Teacher scoped to a Class).
- **Permission** — granular actions (`check_in`, `check_out`, `override_checkout`, `view_roster`, `manage_people`, `manage_programs`, `manage_system`, `run_reports`, `backup_restore`).

### 4.5 Check-In / Check-Out
- **Session** — a check-in "day" for a Program/Class/Event (e.g. "Sabbath School — 2025-01-18").
- **CheckInRecord** — Child Person, Session, Class/Room, checked-in-by (User/Guardian), timestamp, generated **DailyCode** (3-digit), label-printed flag.
- **CheckOutRecord** — Child Person, Session, checked-out-by, timestamp, method (`Code` | `PIN` | `Override`), override note (if any), photo-verified flag.
- **DailyCode** — a random 3-digit code generated per **family per day** (visible to all carers/guardians of that family who sign in with PIN). Used for quick sign-out.
- **HeadcountLog** — Teacher-entered headcount snapshots per Room/Session.
- **OverrideCheckoutLog** — mandatory confirmation checkbox + free-text note + authorising User, for every override.

### 4.6 Audit
- **AuditLog** — actor, action, entity, before/after, timestamp, IP. Append-only, tamper-evident (chained hash).

---

## 5. Security Model

| Concern | Approach |
|---------|----------|
| Data residency | 100% on the organisation's hardware. No outbound data calls except optional SMTP for email recovery/notifications. |
| Encryption at rest | Photos + backups encrypted with AES-256-GCM (key derived from a master secret in env/config, rotatable). DB file permissions locked to the service user. |
| Passwords | bcrypt-hashed. Optional PIN (4–6 digits) for kiosk/guardian quick login. |
| Sessions | HTTP-only, Secure, SameSite=Strict cookies; configurable session TTL; idle timeout on kiosk. |
| RBAC | Role → Permission matrix enforced in API route handlers (server-side, never trust client). |
| Audit | Every check-in/out, override, data change, config change, login written to append-only audit log. |
| Rate limiting | Login + kiosk search rate-limited to prevent enumeration. |
| Backup | Encrypted, downloadable, restorable. Scheduled option. |
| Network | Caddy terminates TLS; recommend LAN-only exposure by default. Documented hardening guide. |
| Child data minimisation | Photos optional + toggleable; medical/allergy fields shown only to authorised roles; visitor records purgeable. |

---

## 6. Feature Toggles (Admin Dashboard)

Every toggle below is an **enable/disable** switch in the Admin Dashboard, stored in `FeatureFlags`.

| Toggle | Default | Effect when ON |
|--------|---------|----------------|
| `kiosk_requires_login` | OFF | Kiosk requires a Kiosk-Account PIN before showing search. |
| `guardian_pin_signin` | ON | Guardians/Authorised Guardians can sign in with PIN/password at kiosk to sign children in/out. |
| `guardian_self_registration` | OFF | Guardians can self-register & self-manage family data + PIN/password. |
| `email_recovery` | OFF | Allow email-based password recovery (requires internet/SMTP). |
| `email_as_contact` | ON | Email stored as a contact/communication method (not used for auth). |
| `photo_verification` | ON | Photos required/used for child + adult verification at checkout. |
| `print_name_labels` | ON | Print a child name label at check-in. |
| `print_signout_code` | ON | Print the daily 3-digit code + details for the guardian at check-in. |
| `override_checkout` | OFF | Admins/Teachers may override checkout (with confirmation + note). |
| `older_sibling_collect` | OFF | Allow authorising an older sibling to collect a younger sibling. |
| `visitors_add_to_db` | ON (prompt) | Visitor flow offers "add to regular database" checkbox. |
| `working_with_children_tracking` | ON | Track WWCC / Blue Card status for volunteers. |
| `audit_log_detailed` | ON | Verbose audit logging. |
| `scheduled_backups` | OFF | Automated encrypted backups on a schedule. |

---

## 7. Staged Delivery Plan

Each stage is independently shippable and demoable. Stages are grouped into **Phases**.

> **Naming:** "Sabbath School" is the default program-term in code/constants, overridable to "Sunday School" / "Unit" / etc. via branding config. We never hardcode "Sunday School" as the label.

---

### PHASE A — Foundation

#### Stage 0 — Project scaffold & architecture
- Folder structure: `src/app/(kiosk)`, `src/app/(admin)`, `src/app/(volunteer)`, `src/app/(guardian)`, `src/app/api`, `src/lib`, `src/components/domain/*`.
- Prisma baseline + `db` client.
- Tailwind theme tokens (branding-driven CSS variables).
- PWA manifest + service worker shell.
- Caddy gateway confirmation; dev server running.
- **Deliverable:** blank themed shell with working nav, installable as PWA.

#### Stage 1 — Auth, Users, RBAC
- NextAuth credentials provider (email/username + password; PIN login for kiosk/guardian).
- User ↔ Person link model (a User is always backed by a Person).
- Role + Permission matrix + server-side guard helpers (`requirePermission`).
- First-run setup wizard: create Organisation + first Admin (linked to a Person).
- Login, logout, session, idle timeout.
- **Deliverable:** can log in as Admin; can promote a Person to Teacher/Volunteer/Kiosk/Security.

#### Stage 2 — Organisation, branding & feature toggles
- Organisation singleton (name, logo, colours, terminology overrides).
- FeatureFlags table + Admin UI for every toggle in §6.
- Branding flows into theme + manifest + printed labels.
- Terminology resolver (e.g. `t('program.sabbath_school')` → "Sabbath School" or "Sunday School").
- **Deliverable:** a second organisation (e.g. a Scouts troop) could install, rebrand, and rename "Sabbath School" → "Unit" entirely from the dashboard.

---

### PHASE B — The World (people, programs, places)

#### Stage 3 — People & Families
- Person CRUD (Adult/Child), type-specific fields.
- Family CRUD, PrimaryCarer + Child memberships.
- Photos (upload, encrypted storage, optional per toggle).
- Medical/allergy fields (visibility scoped by role).
- WorkingWithChildrenCard tracking.
- Visitors / first-time flag on Person.
- Search + list (paginated) for People Managers.
- **Deliverable:** Admin/PeopleManager can build the whole people/family graph.

#### Stage 4 — Authorised Guardians, Blacklist, Older-sibling
- AuthorisedGuardian: link an Adult Person (possibly from another Family) to a Family with sign-in/out rights but **no edit rights** on that family's data.
- BlacklistEntry: Person/free-text blocked from collecting a child; surfaced as a hard stop at checkout.
- OlderSiblingAuthorisation (gated by toggle): mark an older sibling Person as allowed to collect a younger sibling.
- **Deliverable:** a grandparent who is themselves a primary carer of their own family can be added as an Authorised Guardian to their child's family.

#### Stage 5 — Programs, Classes, Events, Rooms
- Program CRUD (Sabbath School, Pathfinders, Adventurers, Community Childcare, Custom).
- Group/Class CRUD within a Program; assign to Room + Schedule.
- Event CRUD (one-off / occasional); can borrow rooms/classes or define ad-hoc.
- Schedule model (recurring day-of-week + time, or ad-hoc date/time).
- **Deliverable:** Admin can model "Sabbath School with Beginner/Kindergarten/Primary/Juniors classes, meeting Saturdays 9:30am, in Rooms 1–4" and "Pathfinders Club meeting Wed 7pm in the Hall".

---

### PHASE C — The Kiosk & Check-In/Out (the heart of the system)

#### Stage 6 — Kiosk shell & search
- Kiosk route group `(kiosk)` with fullscreen, touch-friendly UI.
- Open mode vs locked mode (per `kiosk_requires_login`).
- Universal search across name, surname, phone, email (rate-limited, no partial-data leakage).
- Family selection → family summary card (carers, children, alerts).
- Idle reset back to search after configurable timeout.
- **Deliverable:** a tablet can be set up as a kiosk and a guardian can find their family.

#### Stage 7 — Check-In flow
- Select Program/Class/Event + Session (today's session auto-suggested).
- Multi-child selection with checkboxes/sliders (no dropdown-per-child).
- Allergy/medical alerts surfaced prominently per child.
- Authorised-guardian flow: guardian signs in with PIN/password (if `guardian_pin_signin` ON) → can act for the family.
- Generate **DailyCode** (3-digit, per family per day) — shown on screen, visible to all carers/guardians of that family who sign in.
- Optional label printing (`print_name_labels`) + optional signout-code slip printing (`print_signout_code`).
- Visitor quick-add flow with "add to regular DB" checkbox (per `visitors_add_to_db`).
- Write CheckInRecord + AuditLog.
- **Deliverable:** a guardian can check in 3 children across 2 rooms in under 20 seconds and walk away with a code + labels.

#### Stage 8 — Check-Out flow
- Three checkout methods:
  1. **Code** — enter the family's daily 3-digit code → quick sign-out of some/all children (checkboxes).
  2. **PIN** — guardian PIN/password → sign-out.
  3. **Override** — Admin/Teacher only (per `override_checkout`): mandatory confirmation checkbox + free-text note → OverrideCheckoutLog.
- Photo verification display (per `photo_verification`): show child photo + collector photo for visual match.
- Blacklist hard-stop: if the collector matches a BlacklistEntry, block + alert Security.
- Older-sibling collection (per `older_sibling_collect`): allow if authorised.
- Write CheckOutRecord + AuditLog.
- **Deliverable:** the daily code works for fast checkout; override is audited; blacklist blocks.

---

### PHASE D — Operations

#### Stage 9 — Volunteer / Teacher Dashboard
- Route group `(volunteer)` for Teachers/Volunteers/Security.
- Live room roster (Socket.io realtime) — who's checked in to my room right now.
- Headcount log — enter a count, system compares to check-in count, flags discrepancies.
- Manual check-in/out (with reason).
- Override checkout UI (same rules as kiosk override).
- Reports: attendance for my room/class/session; print or email.
- **Deliverable:** a teacher with a tablet sees their roster update live and can close out the session.

#### Stage 10 — Reporting & Analytics
- Attendance reports (by program/class/date range/person).
- Headcount trend charts.
- Volunteer hours (from check-in/out of volunteer Users).
- First-time/visitor follow-up report.
- WWCC expiry report.
- Export any report to PDF/CSV; email from the dashboard.
- **Deliverable:** Admin can pull "Sabbath School attendance Q1 2025 by class" as a PDF.

#### Stage 11 — Printing subsystem
- Printer CRUD (name, driver, default queue).
- Assign printers to Rooms/Areas/Classes.
- Label template editor (child name, class, room, code, date, allergy icon).
- Signout-code slip template.
- Print via QZ Tray (recommended) or browser print fallback.
- **Deliverable:** check-in at Room 1's kiosk prints on Room 1's label printer.

---

### PHASE E — Data lifecycle

#### Stage 12 — Import / Export
- CSV/Excel import for People + Families (with template downloads + validation preview).
- CSV/Excel export of any list (people, families, attendance, audit).
- Dry-run + rollback on import errors.
- **Deliverable:** migrate an existing Rock/Elvanto export into the system.

#### Stage 13 — Backup / Restore
- Manual "Backup now" → downloads an encrypted `.cbak` bundle (DB + photos + config).
- Scheduled backups (per `scheduled_backups`) → write to `./data/backups/` with retention.
- Restore workflow: upload `.cbak`, verify, confirm, restore (with automatic pre-restore backup).
- **Deliverable:** an org can move the whole system to new hardware via backup → restore.

---

### PHASE F — Deployment & Hardening

#### Stage 14 — PWA polish & offline
- Service worker: precache kiosk shell + branding; runtime cache for family search results.
- Offline queue for check-in/out writes (resync on reconnect).
- "Install app" prompts + install instructions per platform.
- **Deliverable:** kiosk keeps checking children in during a network outage and resyncs after.

#### Stage 15 — Deployment & installation
- `Dockerfile` + `docker-compose.yml` (with volumes, env, healthcheck).
- Bun standalone binary build script (`bun build --compile`) for linux-x64, linux-arm64, macos-arm64, windows-x64.
- Install scripts:
  - `install/install-linux.sh` (systemd unit, creates service user, sets perms).
  - `install/install-macos.sh` (launchd plist).
  - `install/install-windows.ps1` (winsw service).
  - `install/install-nas-synology.sh` (DSM scheduled task).
- `/docs/deployment/` markdown guides per platform.
- First-run setup wizard (Org + Admin) on first launch.
- **Deliverable:** `curl … | bash` on a fresh Linux box, or `docker compose up`, yields a running system.

#### Stage 16 — Security hardening & audit
- Encryption-at-rest for photos + backups (AES-256-GCM, rotatable master key).
- Tamper-evident audit log (chained hashes).
- Login + search rate limiting.
- Security hardening guide (firewall, TLS, service user, file perms).
- Optional LAN-only mode (bind to interface, no external exposure).
- **Deliverable:** passes a basic security checklist; audit log is verifiable.

---

### PHASE G — Future (designed-for, not built-now)

These are explicitly **out of scope for the initial build** but the schema/APIs will be shaped to accept them:

- **F-1** Two-factor authentication (TOTP) for Users.
- **F-2** QR-code check-in/out — per-family unique QR for pre-check; guardian scans at kiosk.
- **F-3** External system integration — Rock RMS / Elvanto / Planning Center import connectors; export to CSV/JSON for comms tools.
- **F-4** Parent/Carer communication — in-app messages + optional email/SMS (SMTP/Twilio gateway configurable).
- **F-5** Multi-site support — several congregations/branches sharing one install with scoped data.
- **F-6** Multi-language UI (i18n already scaffolded via next-intl).

---

## 8. Requirements Traceability

Mapping the user's explicit requirements to stages, so nothing is missed.

| Requirement (paraphrased) | Stage |
|---------------------------|-------|
| Families, Groups, Types for Sabbath School | S3, S5 |
| Security roles for volunteers | S1, S9 |
| Authorised guardians | S4 |
| Security (hardening) | S16 |
| Photo verification | S3 (photos), S8 (verification UI), toggle S2 |
| Kiosk mode | S6 |
| Mobile check-in | S6, S14 (PWA) |
| Allergy/medical alerts | S3 (fields), S7 (surfaced) |
| Multi-room check-in | S5 (rooms), S7 |
| Volunteer workflows | S9 |
| Self-hosted, cross-platform | S15 |
| Web app installable on phone/tablet/desktop | S0 (PWA shell), S14 |
| Secure (child data) | S1, S16 |
| Sabbath School / Pathfinders / Adventurers / community childcare / custom programs | S5 |
| One-off/occasional Events | S5 |
| Visitors/First-timers with add-to-DB option | S7 (toggle S2) |
| Branding/config dashboard for other orgs | S2 |
| Email as recovery option (toggleable) + as contact | S2 (toggle), S3 (contact field) |
| Self-register/self-manage with PIN/password (toggleable) | S2 (toggle), S1 (auth), S3 |
| Adult-only fields vs child-only fields | S3 |
| Add/remove Authorised Guardians (grandparents etc.) | S4 |
| Blacklist | S4 |
| Authorised Guardian may belong to own Family | S4 |
| Toggle: carer/guardian PIN sign-in | S2 (toggle), S7 |
| Easy multi-child sign in/out (checkboxes/sliders) | S7, S8 |
| Random 3-digit daily code, visible to all carers/guardians | S7 |
| Code works even if guardian PIN sign-in is disabled | S7 (code is independent of PIN) |
| Users (Admin/Teacher/Volunteer/Kiosk) linked from PEOPLE, shared credentials | S1 |
| Kiosk: straight-to-use OR require Kiosk Account login (toggle) | S2 (toggle), S6 |
| Override checkout for Admins/Teachers (toggle) with confirmation + note | S2 (toggle), S8, S9 |
| Kiosk SEARCH across name/surname/phone/email | S6 |
| Toggle: print name label | S2 (toggle), S7, S11 |
| Toggle: print signout code + details | S2 (toggle), S7, S11 |
| Printer/queue config assigned to areas/classrooms | S11 |
| Toggle: photo for adult + child, used at checkout verification | S2 (toggle), S3, S8 |
| Older sibling authorised to collect younger (toggle) | S2 (toggle), S4, S8 |
| Teacher/Volunteer dashboard: live rosters, headcounts, manual checkout, reports | S9, S10 |
| Data Import/Export | S12 |
| Backup/Restore | S13 |
| Native install scripts (Linux/Win/Mac/NAS) + Docker | S15 |
| Future: 2FA, external integrations, QR check-in/out, parent comms | F-1…F-4 |
| Working with Children cards (Blue Card etc., national + international) | S3 |

---

## 9. Development Conventions

- **Frontend first per stage:** build the UI so the user can see progress, then wire the API routes + Prisma.
- **API routes** (not server actions) for all data mutations.
- **Prisma schema** evolves stage-by-stage; `bun run db:push` after each schema change.
- **shadcn/ui** for all UI primitives; domain components in `src/components/domain/`.
- **Sticky footer** on every layout (`min-h-screen flex flex-col`, `mt-auto` footer).
- **Responsive + accessible** (ARIA, keyboard, 44px touch targets) from day one.
- **Self-verification:** after each stage, use Agent Browser to confirm the page renders and the golden path works before declaring done.

---

## 10. How We'll Build It

1. This plan is reviewed and approved.
2. We execute **Stage 0 → Stage 16** in order (with parallel sub-stages where safe).
3. After each stage: demo to user → fix → mark complete → proceed.
4. Phase G (future) items are parked; schema/APIs are shaped to accept them later without rework.

---

## 11. Open Questions for the User (to confirm before Stage 0)

1. **Terminology defaults** — confirm default term is "Sabbath School" with override to "Sunday School"/"Unit"/etc. ✔ (assumed yes)
2. **DB engine** — ship SQLite by default (recommended for self-hosted/NAS), with documented Postgres swap? ✔ (assumed yes)
3. **Print tech** — QZ Tray (Java tray app, very reliable for label printers) as primary, browser-print as fallback? ✔ (assumed yes)
4. **Daily code scope** — per **family per day** (shared by all that family's carers/guardians), regenerated each calendar day? ✔ (assumed yes per your description)
5. **Kiosk Account** — a dedicated role `Kiosk` (a User linked to a Person, or a non-Person system account)? Assumed: a **User with role Kiosk**, optionally linked to a Person. ✔
6. **Photo storage** — encrypted files on disk under `./data/photos/` (not in DB blob)? ✔ (assumed yes)
7. **Multi-org** — single organisation per install for now (multi-site is F-5)? ✔ (assumed yes)

If any assumption above is wrong, flag it and we'll adjust the plan before Stage 0.
