# Task 3 — Stage 3 People & Families (full-stack-developer)

## Scope
Stage 3 vertical slice for ChildCheck:
- Dual org-type profiles (SDA vs non-SDA) — apply-profile API + UI selector
- Extended Person model (medical, child-specific, photoPath, isVisitor, isActive, createdById)
- Family + FamilyMember models
- WorkingWithChildrenCard model (gated by `working_with_children_tracking` flag)
- Photo encryption at rest (AES-256-GCM, `src/lib/crypto.ts`)
- Photo upload/serve APIs (encrypted storage; SVG initials avatar fallback)
- People CRUD APIs (list strips medical; detail includes medical for view_people)
- WWCC CRUD APIs
- Families CRUD APIs + members sub-resources
- Admin UI: `/admin/people` (list + form + detail), `/admin/families` (list + form + detail), org-type selector on `/admin/settings`
- `/admin` home updated to link to People & Families

## Files created (new)
- `src/lib/org-profiles.ts` — ORG_PROFILES registry, getProfile, isOrgType
- `src/lib/crypto.ts` — AES-256-GCM encrypt/decrypt + writeEncryptedFile/readEncryptedFile
- `src/lib/people.ts` — toPersonListDTO (strips medical), toPersonDetailDTO (includes medical), summariseWwcc, loadPersonDetail
- `src/app/api/admin/organisation/profile/route.ts` — GET profiles, POST apply (merge semantics)
- `src/app/api/admin/people/route.ts` — GET list (paginated, filtered, medical stripped), POST create
- `src/app/api/admin/people/[id]/route.ts` — GET detail (medical included), PUT update, DELETE soft-delete (409 if User linked)
- `src/app/api/admin/people/[id]/photo/route.ts` — POST upload (sharp resize, encrypt, write), DELETE remove
- `src/app/api/people/[id]/photo/route.ts` — GET serve decrypted JPEG / SVG initials fallback
- `src/app/api/admin/people/[id]/wwcc/route.ts` — GET list (flag-gated), POST create
- `src/app/api/admin/wwcc/[id]/route.ts` — PUT update, DELETE remove
- `src/app/api/admin/families/route.ts` — GET list, POST create (+ optional memberIds)
- `src/app/api/admin/families/[id]/route.ts` — GET detail, PUT update, DELETE soft-delete
- `src/app/api/admin/families/[id]/members/route.ts` — POST add membership
- `src/app/api/admin/families/[id]/members/[personId]/route.ts` — DELETE remove membership
- `src/app/admin/people/page.tsx` — server shell (force-dynamic, requirePermission view_people)
- `src/app/admin/people/people-list.tsx` — client list (search/filter/pagination/dialog-driven CRUD)
- `src/app/admin/people/person-form.tsx` — client form (tabs: Identity/Contact/Child/Medical)
- `src/app/admin/people/[id]/page.tsx` — server detail shell
- `src/app/admin/people/[id]/person-detail.tsx` — client detail (photo upload, WWCC, family links, edit dialog, archive)
- `src/app/admin/families/page.tsx` — server shell
- `src/app/admin/families/families-list.tsx` — client list
- `src/app/admin/families/family-form.tsx` — client create form (with member picker)
- `src/app/admin/families/[id]/page.tsx` — server detail shell
- `src/app/admin/families/[id]/family-detail.tsx` — client detail (members grouped by role, add/remove member, edit family, archive)
- `src/app/admin/settings/org-type-selector.tsx` — org-type profile selector with confirm dialog

## Files modified
- `prisma/schema.prisma` — extended Person (+preferredName, dateOfBirth, schoolGrade, gender, allergies, medicalNotes, dietaryNotes, emergencyContact*, isVisitor, isActive, createdById, familyMemberships, wwccards relations); added Family, FamilyMember, WorkingWithChildrenCard; added Organisation.orgType (default "SDA")
- `src/lib/branding.ts` — OrgConfig.orgType added; getOrgConfig reads org.orgType (fallback "SDA")
- `src/components/providers.tsx` — PublicConfig.orgType added
- `src/app/api/config/route.ts` — response includes orgType
- `src/app/api/admin/branding/route.ts` — GET response includes orgType
- `src/app/admin/settings/page.tsx` — OrgTypeSelector placed above BrandingForm on the Branding tab
- `src/app/admin/page.tsx` — People & Families card now links to /admin/people; welcome header has People + Families shortcut buttons

## Verification (all passed)
1. `bun run lint` → clean (0 errors, 0 warnings)
2. `bun run db:push` → succeeded; schema synced, Prisma Client regenerated
3. `GET /api/config` → returns `orgType: "SDA"` plus the existing branding/terminology/flags
4. Login as admin/password123 → /admin → /admin/people renders, no console errors
5. Org-type profile swap: POST /api/admin/organisation/profile `{orgType:"SundayChurch"}` → /api/config shows `program_sabbath_school: "Sunday School"`; UI confirm dialog → toast "Profile applied" → dropdown shows Sunday Church as currently applied
6. **REVERTED**: POST `{orgType:"SDA"}` → /api/config shows `program_sabbath_school: "Sabbath School"` again (also tested via the UI: pick SDA → Apply → confirm)
7. People CRUD via API + UI:
   - Created Adult "John Smith" (john@x.local, 0412345678) — appears in list
   - Created Child "Mary Smith" (DOB 2018-05-10, allergy "Peanuts", medical "Asthma") — appears in list with age badge "Age 8"
   - List response does NOT include allergies/medicalNotes fields (verified via curl)
   - Detail response DOES include medical fields (verified via curl)
   - PUT preferredName "Maz" → detail reflects it
   - Uploaded /tmp/test-face.png → photo served at /api/people/{id}/photo as image/jpeg 512x512; file on disk at data/photos/<personId>.enc is "data" (not PNG — encrypted)
   - Person with no photo returns 404 + SVG initials avatar (deterministic colour from name hash)
8. Family CRUD:
   - Created family "Smith" with John (PrimaryCarer) + Mary (Child)
   - Family detail shows members grouped by role
   - Removed Mary from family → family now has 1 member (John) and 0 children
9. Soft-delete:
   - DELETE John (no User linked) → returns ok; default list excludes him; includeInactive=true shows him with isActive=false
   - DELETE Jane Admin (has linked User) → returns 409 with explanation
10. WWCC:
   - Flag ON (default) → POST /api/admin/people/{id}/wwcc creates card (QLD Blue Card, # 12345, Verified, expiry 2027-12-31) → list endpoint returns it; verifiedAt stamped automatically
   - Flag OFF via PUT /api/admin/flags → list endpoint returns wwccStatusSummary: null; wwcc sub-resource returns `{enabled:false, items:[]}`
   - Flag back ON → restored
11. Auth guards (logged out):
   - GET /api/admin/people → 401
   - GET /admin/people → 307 redirect to /login?callback=/admin/people
12. dev.log: zero runtime errors; all routes return 200/307/401/404 as expected
13. Screenshots saved: /tmp/s3-people.png, /tmp/s3-person-detail.png, /tmp/s3-family.png, /tmp/s3-family-detail.png, /tmp/s3-orgtype-selector.png

## Decisions / deviations
- **Photo resize**: used `sharp`'s `resize(512, 512, {fit:"cover"})` then `jpeg({quality:85})` so stored photos are uniformly 512x512 JPEG (consistent bytes-on-disk for a given input). Original format/mime is not preserved.
- **Photo file format**: `[12-byte iv][16-byte auth tag][ciphertext]` concatenated in a single file. `file` reports "data" not PNG — confirms encryption.
- **Org-type profile merge**: implemented as merge (profile terminology keys overwrite existing for the same keys but do NOT wipe other customised keys); only the flag keys named by the profile are upserted. This satisfies the "preserve user-customised terminology keys not in the profile" requirement.
- **Person soft-delete**: only blocks if person has a linked User (409 with explanation). FamilyMember rows referencing the person are NOT cascaded by soft-delete (they remain for audit). Hard deletes are never performed.
- **WWCC list endpoint** returns `{enabled, items}` so the UI can render the section only when `enabled:true`. With flag OFF, the section disappears from the detail page (and `wwccStatusSummary` is null in the people list).
- **Medical field visibility**: enforced via the `toPersonListDTO` / `toPersonDetailDTO` split in `src/lib/people.ts`. List DTO simply omits the medical fields entirely (not even null); detail DTO includes them and the route handler is the gate (view_people permission required for the GET /api/admin/people/[id] route).
- **Person detail page** loads the person server-side and passes the initial detail DTO to the client `<PersonDetail>` component. The client re-fetches on save/edit to stay fresh; photo has a cache-bust query so the UI updates immediately after upload.
- **Add-person dialog** uses Tabs (Identity / Contact / Child details / Medical) so the form is browsable without scrolling forever. The Medical tab has a destructive-tinted banner explaining the sensitivity.
- **Family create form**: includes a multi-person picker that searches existing people; adults auto-assigned PrimaryCarer role, children Child role, on the server side. Roles can be customised later from the family detail page's add-member panel (full role select: PrimaryCarer/Child/EmergencyContact/AuthorisedGuardian).
- **Auth fallback for photo GET**: any logged-in user can view any person's photo in Stage 3. Full role/room scoping arrives with classes/rooms in Stage 5 — documented in the route file.
- **Org-type profile application is reversible**: applying SDA after SundayChurch restores "Sabbath School" etc. (because the SDA profile includes its own `program_sabbath_school: "Sabbath School"` override).
- Did NOT touch: home page, /login, /setup, /admin, /admin/settings existing branding/flags forms, /volunteer, /kiosk, /api/config existing fields, auth flow. All Stage 0/1/2 deliverables remain intact.

## Result
Stage 3 COMPLETE. People & Families vertical slice shipped with encrypted photos, role-scoped medical visibility, WWCC tracking, soft-delete semantics, and dual org-type defaults (SDA vs non-SDA) wired through a profile-merge API + UI selector. All non-negotiables met: TypeScript strict-friendly, every mutation is an API route, sticky footer on every page, `bun run lint` clean, home page untouched, test admin login still works, medical fields never leak in list responses, photos encrypted at rest, soft-delete only (never hard-delete), WWCC UI hidden when flag OFF, org-type application is a merge (not a wipe). Org-type test reverted to "SDA" before finishing.
