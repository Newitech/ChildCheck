# Task ID 4 — Agent: full-stack-developer

## Task
Stage 4 — Authorised Guardians, Blacklist & Older-sibling collection (ChildCheck).

## Outcome
COMPLETE. All Stage 4 deliverables (Prisma schema additions, guardian permission-check
helper, Authorised-Guardian / Blacklist / Older-sibling APIs, family/person/blacklist
UIs) are in place, lint-clean, and verified end-to-end. One UI bug
(BlacklistTable `<SelectItem value="">` triggering a Radix runtime error)
was found and fixed during verification.

## Key facts for downstream agents
- `older_sibling_collect` flag is OFF in the DB (final state — required).
- DB rows for older-sibling authorisations are preserved even when flag is OFF
  (UI hides the section, helper ignores the rows, but data is not deleted).
- Test data additions (already in DB): Robert Grandparent (Adult, AuthorisedGuardian
  of Smith), Creep Person (Adult, blacklist-targeted at Mary Smith — child-specific),
  free-text blacklist entry "Unknown male ~40s" (family-level for Smith), Tom Smith
  (Child, older sibling authorised to collect Mary — conditions "Only after 12pm").
- `canCollectChild()` decision order is FINAL: blacklist FIRST (blocked → false,
  flag → false with `reason:"flagged"`), then PrimaryCarer → AuthorisedGuardian
  → OlderSibling (only when flag ON) → not_authorised.
- `canEditFamily()` returns true ONLY for PrimaryCarer. AuthorisedGuardians have
  sign-in/out rights but NO edit rights (server-enforced at the API layer too —
  the existing family mutation routes require `manage_people`, but Stage 8 will
  call `canEditFamily()` directly for guardian self-service gates).
- Audit-log actions introduced this stage: `family.guardian.add`,
  `family.guardian.remove`, `blacklist.add`, `blacklist.update`, `blacklist.remove`,
  `older_sibling.add`, `older_sibling.remove`.

## Files (new)
- `src/lib/guardians.ts` — core helper (`canCollectChild`, `listAuthorisedCollectors`,
  `listBlacklistForChild`, `canEditFamily`).
- `src/app/api/admin/families/[id]/guardians/route.ts` — GET guardians.
- `src/app/api/admin/people/[id]/guardian-families/route.ts` — GET families where adult is guardian.
- `src/app/api/admin/people/[id]/collection-permissions/route.ts` — GET consolidated child collection view.
- `src/app/api/admin/blacklist/route.ts` — GET (filter by childId/familyId/personId/severity) + POST.
- `src/app/api/admin/blacklist/[id]/route.ts` — PUT + DELETE.
- `src/app/api/admin/older-sibling/route.ts` — GET + POST (flag-gated, 404 if off).
- `src/app/api/admin/older-sibling/[id]/route.ts` — DELETE (flag-gated).
- `src/app/admin/families/[id]/authorised-guardians-section.tsx`
- `src/app/admin/families/[id]/blacklist-section.tsx`
- `src/app/admin/families/[id]/older-sibling-section.tsx`
- `src/app/admin/people/[id]/guardian-families-section.tsx`
- `src/app/admin/people/[id]/collection-permissions-section.tsx`
- `src/app/admin/blacklist/page.tsx` + `blacklist-table.tsx`

## Files (modified)
- `prisma/schema.prisma` — added `BlacklistEntry`, `OlderSiblingAuthorisation`
  models + back-relations on `Person` and `Family`.
- `src/app/api/admin/families/[id]/members/route.ts` — AuthorisedGuardian
  role now requires Adult; emits `family.guardian.add` audit action.
- `src/app/api/admin/families/[id]/members/[personId]/route.ts` — emits
  `family.guardian.remove` audit action when removing an AuthorisedGuardian.
- `src/app/admin/families/[id]/family-detail.tsx` — renders the three new
  sections (older-sibling only when `older_sibling_collect` flag on).
- `src/app/admin/people/[id]/person-detail.tsx` — renders the Adult
  "Guardian for families" section + Child "Collection permissions" section.
- `src/app/admin/page.tsx` — admin home now has a Blacklist shortcut button.
- `src/app/admin/blacklist/blacklist-table.tsx` — FIXED Radix SelectItem
  empty-value runtime error by introducing `__all__` sentinel.

## Verification (all passed)
1. `bun run lint` → 0 errors, 0 warnings.
2. `bun run db:push` → schema in sync, Prisma Client regenerated.
3. Auth guards (logged-out): all five new endpoints return 401.
4. Login admin/password123 → /admin → all sections render.
5. canCollectChild() verified by direct call:
   - John (PrimaryCarer) → allowed: true, reason: "primary_carer"
   - Robert (AuthorisedGuardian) → allowed: true, reason: "authorised_guardian"
   - Creep (Blacklisted, child-level) → allowed: false, reason: "blacklisted"
   - Tom (OlderSibling, flag OFF) → allowed: false, reason: "not_authorised"
   - Tom (OlderSibling, flag ON) → allowed: true, reason: "older_sibling", conditions: "Only after 12pm"
6. canEditFamily(): John (PrimaryCarer) = true; Robert (Guardian) = false.
7. Family detail page shows all 3 sections (guardian with "no edit rights" badge,
   blacklist with 2 entries, older-sibling section hidden when flag OFF).
8. Mary Smith (Child) detail "Collection permissions" section shows John + Robert
   as authorised; 2 blacklist entries shown as "Blocked".
9. Robert Grandparent (Adult) detail "Guardian for families" section lists Smith.
10. Consolidated /admin/blacklist page renders with filters working.
11. Older-sibling section appears when flag ON, hides when OFF (DB row preserved).
12. `older_sibling_collect` flag left OFF (confirmed via direct DB query).
13. Screenshots saved:
    - /tmp/s4-family-guardians.png
    - /tmp/s4-child-permissions.png
    - /tmp/s4-blacklist.png
    - /tmp/s4-older-sibling.png
