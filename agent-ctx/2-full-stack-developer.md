# Task ID: 2 — Stage 2 — Organisation branding & feature toggles

**Agent:** full-stack-developer
**Status:** COMPLETE
**Date:** 2026-06-23

## What was built

A full vertical slice making ChildCheck rebrandable from the dashboard:
- Admin can change colours / tagline / app name / logo
- Admin can rename ANY terminology term (e.g. "Sabbath School" → "Unit")
- Admin can flip any of the 14 feature toggles from PLAN.md §6
- Changes apply live across the running app (theme + labels + flags)

## Files created
- `prisma/schema.prisma` (+ `FeatureFlag` model — modified in place)
- `src/lib/paths.ts` — DATA_DIR / BRAND_DIR / PHOTOS_DIR / BACKUPS_DIR constants (env-overridable)
- `src/lib/feature-flags.ts` — FEATURE_FLAGS registry (14 flags, 6 categories), cached helpers (getFeatureFlags/getFeatureFlag/isFeatureEnabled/setFeatureFlag/seedDefaultFlags/invalidateFlagCache)
- `src/app/api/config/route.ts` — public merged config endpoint (branding + terminology + flags), 5s cache
- `src/app/api/admin/branding/route.ts` — Admin GET/PUT branding+terminology (zod-validated, audited)
- `src/app/api/admin/branding/logo/route.ts` — Admin POST/DELETE multipart logo upload (2MB cap, png/jpg/svg/webp)
- `src/app/api/branding/logo/route.ts` — public logo serve with 1h immutable cache + 404 SVG placeholder
- `src/app/api/admin/flags/route.ts` — Admin GET/PUT flags (per-flag audit)
- `src/app/admin/settings/page.tsx` — server shell, requireRole("Admin"), two-tab Tabs
- `src/app/admin/settings/branding-form.tsx` — client form (name, appName, tagline, primary/accent colour pickers, logo upload/remove, 21-key terminology grid with default hints, reset-to-defaults AlertDialog, sticky Save bar)
- `src/app/admin/settings/flags-form.tsx` — client form (grouped by category, anchors, Switch per flag, dirty-state Save)
- `src/hooks/use-config.ts`, `use-terminology.ts`, `use-flags.ts`
- `src/components/domain/runtime-theme.tsx` — applies primary/accent to CSS vars + luminance-based foreground

## Files modified
- `src/components/providers.tsx` — added ConfigProvider, exported ConfigContext + PublicConfig type
- `src/app/layout.tsx` — added `<RuntimeTheme />` inside `<Providers>`
- `src/app/admin/page.tsx` — Branding & Toggles card now links to `/admin/settings` with "Open" CTA; other 6 cards keep "Coming soon" + stage badges; added Settings shortcut in welcome header + a "System status" card

## Verification (all passed)
1. `bun run lint` — 0 errors / 0 warnings
2. `bun run db:push` — FeatureFlag table created
3. Logged in as admin/password123 → /admin
4. /admin/settings renders, two tabs, no console errors
5. Saved branding: primary #7c3aed, tagline "Test Tagline", "Sabbath School"→"Sunday School" → toast "Branding saved"; admin header turned purple; home page showed "Sunday School" in copy; title showed "Test Tagline"
6. Saved flags: kiosk_requires_login ON, photo_verification OFF → toast "Toggles saved"; /api/config confirmed both
7. Reverted all back to SDA defaults (primary #0f9d8a, tagline "Secure Child Check-In & Check-Out", "Sabbath School", both flags default) — verified via /api/config
8. Logo upload: 290-byte SVG → preview showed, /api/branding/logo served 200 image/svg+xml; removed → 404 placeholder, UI showed "No logo"
9. Logged-out /admin/settings → 307 redirect to /login?callback=/admin
10. curl PUT /api/admin/flags + /api/admin/branding (no cookie) → 401 for both
11. dev.log: zero runtime errors post-restart
12. Screenshots: /tmp/s2-settings.png, /tmp/s2-rebranded.png (purple + Sunday School), /tmp/s2-flags.png, /tmp/s2-admin-home.png, /tmp/s2-admin-home-final.png

## Known follow-ups / handoffs to next stage
- File-storage pattern established: logos in `/home/z/my-project/data/branding/`. Stage 3 photos go to `data/photos/`, Stage 13 backups to `data/backups/` (constants already defined in `src/lib/paths.ts`).
- ConfigProvider fetches /api/config on mount + window focus; useConfig/useTerminology/useFlags hooks ready for client components in Stages 3+.
- RuntimeTheme auto-contrasts foreground (WCAG luminance) — works for any colour.
- Forced a dev-server restart via `touch next.config.ts` once after schema push (Turbopack cached the pre-FeatureFlag Prisma Client). If next agent edits the schema, they may need to do the same.

## DB state at handoff
- Organisation "default": appName "Test SDA Church", tagline "Secure Child Check-In & Check-Out", primaryColor #0f9d8a, accentColor #e8a33d, logoUrl null, terminology all-defaults
- FeatureFlag table: empty (defaults used) — kiosk_requires_login=false, photo_verification=true, etc.
- Test admin (admin/password123) intact, login still works.
