# Task 13 — Stage 13 Backup/Restore

Agent: full-stack-developer
Task: Stage 13 — Backup/Restore (encrypted .cbak bundle, backup now, scheduled flag, restore with automatic pre-restore backup)

## Files created / modified

- `src/lib/backup.ts` — backup engine: createBackup, restoreBackup, verifyBundle, listBackups, deleteBackup, readBackupFile, scheduledBackupIfDue, getDbFilePath
- `src/app/api/admin/backup/route.ts` — GET (list backups), POST (backup now → downloads .cbak, also saved to disk)
- `src/app/api/admin/backup/restore/route.ts` — POST multipart .cbak (with ?dryRun=1 verify-only mode)
- `src/app/api/admin/backup/[filename]/route.ts` — GET (download existing .cbak), DELETE (delete a backup)
- `src/app/api/admin/backup/tick/route.ts` — POST scheduled-backup-if-due check (per scheduled_backups flag, 24h interval, 1min cooldown)
- `src/app/admin/backup/page.tsx` — admin page (server gate requirePermission("manage_people"))
- `src/app/admin/backup/backup-console.tsx` — client UI: Backup now button + Existing backups table + Restore (verify → confirm dialog → restore)
- `src/app/admin/page.tsx` — added Backup card href + quick-action button

## Bundle format

The `.cbak` file is an ENCRYPTED JSON document:
1. The in-memory bundle (db bytes + photos dict + branding logo + config) is JSON-serialized with binary fields base64-encoded.
2. The whole JSON string is UTF-8 encoded and AES-256-GCM encrypted via `writeEncryptedFile` (same primitive as photos). On-disk format: `[iv (12)][tag (16)][ciphertext (rest)]` — identical to every other encrypted file in `data/`.
3. `file` reports "data" — no SQLite header visible, no plaintext strings.

Restore workflow: verifyBundle (decrypt + parse) → createBackup("pre-restore") → db.$disconnect() → overwrite DB file → write photos back → write logo back → db.$connect() → upsert Organisation + FeatureFlags (best-effort, wrapped in try/catch) → logAudit("backup.restore").

## Verification (all passed)

1. ✅ `bun run lint` clean
2. ✅ /admin/backup renders with Backup now + Existing backups table + Restore upload
3. ✅ Click "Backup now" → .cbak file downloads (also saved to data/backups/)
4. ✅ Backup appears in list with size + date
5. ✅ .cbak file is encrypted — `file` reports "data", `strings` finds no SQLite header, `grep -c SQLite` = 0
6. ✅ Restore: upload .cbak → verify bundle succeeds → confirm dialog opens → "Restore complete. Restart the server for changes to take full effect."
7. ✅ Pre-restore backup automatically created (filename has "-pre-restore" suffix, marked with badge in UI)
8. ✅ Delete a backup → confirm dialog → removed from list + filesystem
9. ✅ /admin/backup logged-out → 307 redirect to /login?callback=/admin
10. ✅ All 5 API endpoints return 401 when logged out
11. ✅ Invalid bundle (random bytes) → 400 "Bundle verification failed: Unsupported state or unable to authenticate data"
12. ✅ Short bundle (< 28 bytes) → 400 "Bundle too short"
13. ✅ Valid dry-run → 200 "Bundle is valid. No changes were made."
14. ✅ Scheduled tick: flag OFF → `{created:false,reason:"flag_off"}`; flag ON + no backups → creates backup; flag ON + recent backup → cooldown
15. ✅ AuditLog entries: `backup.create`, `backup.restore` (with preRestoreBackup filename), `backup.delete` (all visible in /api/admin/export?type=audit)
16. ✅ dev.log no errors
17. ✅ Screenshots: `/tmp/s13-backup.png`, `/tmp/s13-restore.png`

## Decisions / notes

- **DB overwrite while Prisma open**: We `db.$disconnect()` before the file overwrite and `db.$connect()` after the photos/logo are written. In dev with hot-reload, Prisma's cached global singleton may hold onto the old DB — the API returns "please restart the server" message. Documented that production restores should use a maintenance mode / CLI script.
- **Audit log of pre-restore backup is overwritten**: When the pre-restore backup is created, its `backup.create` audit entry is written to the OLD DB. The subsequent restore overwrites the DB file with the backup's bytes (which don't contain that audit entry). The `backup.restore` entry (written AFTER the overwrite) records the pre-restore filename so the operator can still see one was made. The pre-restore `backup.create` entry itself is preserved inside the backup file (its DB bytes include it). This is documented in code comments.
- **Photos stored as-is**: The bundle stores photo bytes already-encrypted (iv+tag+ciphertext) — they're written verbatim on restore. Double-encryption (bundle JSON is encrypted, photos within it are already encrypted) is intentional defense-in-depth.
- **Scheduled backups**: Per the spec, we didn't build a full scheduler — `scheduledBackupIfDue()` checks the flag + last backup age (24h) + cooldown (1min process-wide). The tick endpoint is idempotent. Production: a real cron / systemd timer should hit the endpoint at the desired interval. Documented in code + UI.
- **Filename sanitization**: deleteBackup / readBackupFile enforce a strict regex (`^childcheck-backup-\d{4}-\d{2}-\d{2}-\d{6}(-pre-restore)?\.cbak$`) and resolve-against-BACKUPS_DIR check to prevent path traversal.
- **Config re-apply is best-effort**: After the DB file is overwritten, the upsert of Organisation + FeatureFlags from the bundle's config JSON is wrapped in try/catch — a schema drift on those rows shouldn't fail an otherwise-successful DB restore.
- **Pre-restore backups are excluded from the "is a scheduled backup due?" check** so they don't satisfy the 24h coverage requirement.

Test data: all backups created during verification were cleaned up. The DB was restored to itself (a no-op) during the round-trip test — no production data was lost.
