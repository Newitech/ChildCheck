# Task 12 — full-stack-developer — Stage 12 Import / Export

## Work Log

- Read `/home/z/my-project/worklog.md` (Stages 0–11). Key context absorbed:
  - Next.js 16 App Router + TS 5 strict, Tailwind 4, shadcn/ui, Lucide, Prisma + SQLite via `@/lib/db`.
  - Dev server on port 3000 (running). `bun run lint` must be clean. NEVER `bun run build`.
  - Test admin: `admin` / `password123`.
  - Admin UIs already exist at /admin/people, /admin/families, /admin/programs, /admin/rooms, /admin/events, /admin/blacklist, /admin/settings, /admin/reports, /admin/printers.
  - Sticky footer pattern via `min-h-screen flex flex-col` + `mt-auto` on the footer.
  - Every mutation is an API route — NO server actions. shadcn/ui primitives. TS strict-friendly, no `any`.
- Studied existing patterns: `src/lib/csv.ts` (writer), `src/lib/auth.ts` (requirePermission), `src/lib/reports-shared.ts` (requireReportsUser), `src/app/admin/printers/` (UI tab structure), `src/app/api/admin/reports/attendance/route.ts` (CSV response pattern).

## Files created / modified

### New library files
- `src/lib/csv-parse.ts` — RFC-4180 CSV parser (hand-written state machine; handles quoted fields, escaped `""`, CRLF + LF, trailing-newline, blank-line skipping, header-row extraction). Also `rowMapper` (case-insensitive column lookup) + `pick` helper.
- `src/lib/import-export.ts` — Shared import/export column definitions + validators + DB writers. Exports:
  - `PERSON_COLUMNS`, `FAMILY_COLUMNS` (canonical header lists).
  - `parsePersonRow`, `parsePeopleCsv` (header validation + per-row validation).
  - `parseFamilyRow`, `parseFamiliesCsv` (parses the `Name|role|DOB;Name|role|DOB` members cell).
  - `insertPeopleBatch`, `insertFamiliesBatch` (Prisma `$transaction` atomic writers).

### New API routes
- `src/app/api/admin/export/route.ts` — `GET /api/admin/export?type=(people|families|attendance|audit)&format=csv[&dateFrom=&dateTo=]`. Returns RFC-4180 CSV attachment. Audits each export. Gated to Admin / PeopleManager / Security.
- `src/app/api/admin/import/route.ts` — `POST /api/admin/import?dryRun=(true|false)` (multipart form: `file`, `type`). dryRun returns `{ totalRows, valid, errors, preview, parseWarnings }`. Real import is atomic (transaction); any error rolls the whole batch back. Gated to Admin / PeopleManager.
- `src/app/api/admin/import/template/route.ts` — `GET /api/admin/import/template?type=(people|families)`. Returns a sample CSV with headers + 2 example rows.

### New admin pages
- `src/app/admin/data/page.tsx` — server gate (`requirePermission("manage_people")`) + header with back-link.
- `src/app/admin/data/data-console.tsx` — client component with 2 tabs (Export / Import).
- `src/app/admin/data/export-tab.tsx` — 4 export cards (People, Families, Attendance, Audit). Attendance + Audit have date-range pickers. Browser-side blob download with Content-Disposition filename.
- `src/app/admin/data/import-tab.tsx` — 3-step UI: (1) type selector + template download + collapsible column reference, (2) drag-drop or click-to-browse file picker + dry-run/import/reset buttons, (3) preview card showing row count + valid/invalid badges + errors table + first-10-rows preview + parse warnings, plus an import-result card showing imported/membersCreated/skipped counts and any post-import errors.

### Modified files
- `src/app/admin/page.tsx` — Added `href: "/admin/data"` to the Import/Export card (now "Open" instead of "Coming soon") + a quick-action "Data" button at the top.

## Verification

### Lint
- `bun run lint` → clean (0 errors, 0 warnings).

### Dev log
- All HTTP responses correct: 200 for successful exports/imports, 400 for validation failures, 500 for the atomic-rollback test (intentional), 401 for unauthorized requests, 307 for the /admin/data logged-out redirect. No errors or warnings.

### Self-verification checklist
1. ✅ `bun run lint` clean.
2. ✅ /admin/data renders with Export + Import tabs.
3. ✅ Download People CSV template → valid CSV with 17 headers + 2 example rows.
4. ✅ Export People → CSV downloads with Jane Admin, Robert Grandparent, Baby One, John Smith, Mary Smith, Tom Smith, etc.
5. ✅ Export Families → CSV with Smith family (primaryCarer: John Smith, children: Mary Smith; Tom Smith, guardian: Robert Grandparent, 4 members).
6. ✅ Import dry-run with exported People CSV → `totalRows: 10, valid: 10, errors: []`.
7. ✅ Import dry-run with broken CSV (missing firstName + invalid personType "BadType") → preview shows the error row + 2 errors with row numbers + parse warnings.
8. ✅ Import for real (clean 3-row CSV) → `imported: 3, skipped: 0, errors: []`.
9. ✅ /admin/data logged out → 307 redirect to /login?callback=/admin. All three API routes return 401 JSON when called without a session.
10. ✅ dev.log no errors.
11. ✅ Screenshots: `/tmp/s12-export.png` (Export tab), `/tmp/s12-import-preview.png` (Import tab with dry-run preview showing errors + table).

### Atomic rollback verified
- Imported a 2-row families CSV where row 3 referenced a `primaryCarerEmail` that doesn't exist → response was `500 { error: "Import failed — entire batch rolled back.", detail: "Row 3: no Person found with email ..." }`.
- Verified via subsequent Families export that the first row (GoodFam) was NOT created — atomicity confirmed.

### Round-trip verified
- The exported People CSV (10 rows) was fed straight back into the import dry-run with `valid: 10, errors: []`. The columns exported by `export` exactly match the columns expected by `import`.

## Decisions / deviations

- **Families CSV `members` column format**: chose `Name|role|DOB;Name|role|DOB` (single cell, semicolon-separated descriptors) over a "wide" layout (`child1Name`, `child1DOB`, ...). The wide layout doesn't scale to arbitrary family sizes; the semicolon-separated cell does. The role is a full PascalCase enum value (PrimaryCarer / Child / AuthorisedGuardian / EmergencyContact), parsed case-insensitively. The DOB is optional (children primarily). Documented inline in the UI via a collapsible `<details>` column reference.
- **`primaryCarerEmail` is a "match by email to existing Person"** shortcut. If provided, the import looks up an existing Person with that email and attaches them as a PrimaryCarer FamilyMember (instead of creating a new Person). If no match, the WHOLE batch is rolled back with a friendly error — atomicity is preserved.
- **Real-import button disabled until dry-run passes with 0 errors and >0 valid rows.** The dry-run is the mandatory preview; the real import never runs against an un-previewed file.
- **CSV escaping**: RFC-4180 compliant via `src/lib/csv.ts` (existing writer) + a hand-written parser in `src/lib/csv-parse.ts`. Quoted fields may contain commas, newlines, and doubled-double-quotes (`""` → `"`).
- **People import columns**: 17 columns total. Required: `firstName`, `lastName`, `personType`. All others optional. `personType` accepts case-insensitive "adult"/"child"; `gender` accepts case-insensitive "male"/"female"/"other"; `isVisitor`/`isActive` accept "true"/"false"/"yes"/"no"/"1"/"0" (case-insensitive); `dateOfBirth` accepts ISO YYYY-MM-DD or full ISO datetime.
- **5 MB file size cap** on the import to avoid pathological memory use. The parser is a hand-written state machine (not a regex on the whole text) so multi-MB files won't blow the stack.
- **Audit**: every export and every successful import writes an `AuditLog` entry (action `export.people` / `export.families` / `export.attendance` / `export.audit` / `import.people` / `import.families`) with the row count.
- **Auth gate**: Admin + PeopleManager can use both import and export. Security can export (admin-side triad) but cannot import (no `manage_people` permission). `/admin/data` itself requires `manage_people` (so only Admin + PeopleManager can even see the UI).

## Test data added during verification
- People: Alice Wonder, Bob Build, Charlie Brown (people import test).
- Families: TestFamily (Alice Test + Bob Test) and Johnson (Mary Johnson + Tim Johnson + Sara Johnson).
- These are test artifacts left in the DB from the verification run; can be cleaned up manually or via a future stage's data-reset tool.
