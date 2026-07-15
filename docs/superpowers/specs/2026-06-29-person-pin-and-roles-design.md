# Design: Move PIN to Person, reframe User as permissions/login

**Date:** 2026-06-29
**Status:** Approved (brainstorm)
**Owner:** Newitech

## Problem

The guardian/identity PIN currently lives on `User.pinHash`. A guardian is a
`Person`, and most guardians have **no** `User` login account — so they can't
have a PIN at all unless promoted to a full login. This blocks the core
requirement that "the same PIN works for kiosk check-out, guardian sign-in, and
the guardian self-service portal" for any adult carer.

Concurrently, the `User` table bundles three unrelated concerns: login
credentials (username + password), the PIN, and permission roles (`UserRole`).
Roles are only assignable by "promoting" a Person into a full login account,
which is the wrong model: a Person should be granted a role (e.g. Volunteer)
without needing to be given a username/password.

## Goals

1. **PIN belongs to a Person.** Any adult Person can have a guardian/identity
   PIN regardless of whether they have a login account. The same PIN is used
   everywhere a PIN is needed (kiosk checkout, guardian sign-in, guardian
   portal PIN change).
2. **Permissions (roles) belong to a Person.** Roles are granted per Person,
   independent of login. They can be ticked from within the Person editor and
   viewed/added from within the Users area ("permission group" view).
3. **`User` becomes login-only.** Username + password + status + lastLoginAt.
   Created only when someone needs to sign in to the staff app.
4. **Enforcement:** `Admin` and `PeopleManager` roles **require** a login
   account. PIN is **recommended** (not mandatory) for those roles.

## Decisions (from brainstorm)

| Question | Decision |
|---|---|
| Role model | **Roles on Person, login optional** — new `PersonRole` table; `User` keeps credentials only. |
| Login credentials | **Keep `User` for login only** (1:1 with Person). NextAuth, password reset, sessions unaffected. |
| Migration | **Single atomic migration** — schema + data copy in one Prisma migration. |
| Group view | **Role filter on the Users page** — chip row to view People per role, with inline assign. |
| Admin/PM login | **Mandatory** (reject role without a `User`). |
| Admin/PM PIN | **Recommended** (UI warning), not blocked. |

## Data model

### Schema changes

**`Person`** gains:

```prisma
pinHash   String?   // Guardian/kiosk PIN — a property of the human.
```

**New table `PersonRole`:**

```prisma
model PersonRole {
  id        String   @id @default(cuid())
  personId  String
  role      String                    // Admin | Security | Teacher | Volunteer | Kiosk | PeopleManager
  scope     String?
  createdAt DateTime @default(now())
  person    Person   @relation(fields: [personId], references: [id], onDelete: Cascade)

  @@unique([personId, role])
}
```

**`User`** becomes login-only. **Remove** `pinHash` and the `roles` relation.
Keeps: `id, personId, username, passwordHash, status, lastLoginAt, timestamps,
person, resetTokens`.

**`UserRole`** table is removed entirely (data migrates to `PersonRole`).

### Migration (single atomic)

One Prisma migration whose SQL, in order:

1. `ALTER TABLE Person ADD COLUMN pinHash TEXT;`
2. Create `PersonRole` table (mirrors `UserRole` columns + FK to Person).
3. Copy data: for every `UserRole`, insert a `PersonRole` row joining
   `User.personId`. Insert with `INSERT OR IGNORE` so the `@@unique([personId,
   role])` constraint is respected if two login accounts ever shared a Person
   (they can't today — `User.personId` is `@unique` — but the guard is cheap).
4. Copy data: for every non-null `User.pinHash`, write it to the linked
   `Person.pinHash`. (`User.personId` is `@unique`, so each Person maps to at
   most one PIN source — no conflict resolution needed.)
5. Drop `UserRole` table; `ALTER TABLE User DROP COLUMN pinHash`.

`scripts/seed-demo.ts` is updated: Teacher Person gets `pinHash` + a
`PersonRole { role: "Teacher" }`; admin Person gets `PersonRole { role: "Admin" }`.
No `pinHash`/`roles` on `User`.

## Auth & permissions layer (`src/lib/auth.ts`, new `src/lib/person-roles.ts`)

- Permission derivation moves from `User.roles` to the Person's `PersonRole`
  rows. `ROLE_PERMISSIONS` matrix, `requirePermission`, `requireRole`,
  `getCurrentUser` keep their public shapes; `roles[]` in the returned user
  object now comes from `PersonRole`. Callers are unaffected.
- **NextAuth `authorize`** still looks up by `username` → `User` (login-only).
  Password-or-PIN field: if input looks like a 4–6 digit PIN → verify against
  **`Person.pinHash`**; otherwise verify `User.passwordHash`. User-facing flow
  unchanged.
- **New `src/lib/person-roles.ts`** thin helpers: `getPersonRoles`,
  `setPersonRoles` (full replace), `ensurePersonRole`, `removePersonRole`.
  Shared by the Person editor and the Users-page role-group UI.
- **Defense-in-depth:** `getCurrentUser` ignores (and logs as a data error) any
  `Admin`/`PeopleManager` `PersonRole` whose Person has no `User`, so a stray
  DB edit can't grant staff powers to a login-less Person.
- **Audit logging** re-points actions at the `Person` entity where they now
  belong: `person.pin_set`, `person.pin_cleared`, `person.role_added`,
  `person.role_removed` (was `user.pin_set`, etc.). `logAudit` already supports
  `actorPersonId` and `actorUserId`.
- Feature flag `guardian_pin_signin` — unchanged.

## API changes

### PIN APIs

- **`POST /api/guardian/signin`** and **`POST /api/kiosk/guardian-signin`**:
  load family → `person.pinHash` directly (no `user` join). Drop the
  `user.status === "Active"` gate (a PIN-bearing Person with no login is
  valid). Request/response shapes unchanged.
- **`POST /api/guardian/pin`** (guardian self-service): writes `Person.pinHash`.
  No longer requires a `User`; a login-less guardian can now change their PIN.
  Still requires `currentPin` when a PIN exists.
- **`POST /api/admin/users/[id]/set-pin`** → **relocated to
  `POST /api/admin/people/[id]/pin`**: 4–6 digit PIN, empty = clear. Audit
  `person.pin_set` / `person.pin_cleared`. Permission `manage_people`
  (PeopleManager + Admin), not Admin-only. Old route deleted.
- **`POST /api/admin/users`** (promote): body loses `pin` and `roles` fields.
  Accepts `personId, username, password, status?`. Optionally accepts `roles[]`
  — if present, written as `PersonRole` rows in the same transaction (the
  promote dialog uses this so a single create can also grant Admin/PM). If
  absent, no roles are assigned. The same Admin/PeopleManager-requires-login
  guard applies (trivially satisfied here, since a `User` is being created).
- **`POST /api/kiosk/checkout`** with `method: "pin"`: the "collector has no
  PIN" check reads `membership.person.pinHash` instead of
  `membership.person.user?.pinHash`. No `user.status` check.

### Role APIs (new)

- **`GET /api/admin/people/[id]/roles`** → `{ roles: string[] }`
- **`PUT /api/admin/people/[id]/roles`** → `{ roles: string[] }` full replace
  (Person editor checkboxes). Rejects if `Admin`/`PeopleManager` included and
  Person has no `User`.
- **`GET /api/admin/roles/people?role=Volunteer`** → `{ items: PersonSummary[] }`
  (Users-page role-group view).
- **`POST /api/admin/roles/assign`** `{ personId, role }` and
  **`DELETE /api/admin/roles/assign`** `{ personId, role }` (inline
  add/remove). Same Admin/PeopleManager login guard.
- Permission: `manage_people` (PeopleManager + Admin). Role-group read uses
  `view_people`.

### People APIs (adjusted)

- `GET /api/admin/people/[id]`: gains **`hasPin`** and **`roles[]`** in the
  response (keeps `hasUser`).
- `GET /api/admin/people`: optional **`?role=Volunteer`** filter to power the
  role-group view.
- `POST /api/admin/people`: optionally accepts `pin` and `roles[]` for one-shot
  creation.

### Users APIs (login-only now)

- `GET/POST /api/admin/users` and `/api/admin/users/[id]`: drop `hasPin`/`pin`
  and `roles` from responses/bodies. Users list no longer shows PIN column or
  role badges. Admin-only. Still handles password reset, enable/disable,
  username.

**Backwards compat:** pre-launch, no old clients. Moved paths are deleted, not
deprecated.

## UI changes

### Person detail page (`/admin/people/[id]`)

The "Login account" card (`user-account-section.tsx`) becomes a **"Permissions
& Access"** card with three parts:

1. **Roles** — checkboxes (Admin, Security, Teacher, Volunteer, Kiosk,
   PeopleManager). Toggling calls `PUT /api/admin/people/[id]/roles`. Works for
   any Adult Person. `Admin`/`PeopleManager` are disabled (with hint + link to
   promote) when the Person has no login.
2. **Guardian PIN** — "PIN set" / "No PIN" badge + "Set / change PIN" button →
   dialog repointed to `POST /api/admin/people/[id]/pin`. Closes the gap:
   admins can set the initial guardian PIN for any adult carer.
3. **Login account** — existing promote/status/last-login block, reframed as
   *"optional staff sign-in."* Promote dialog keeps `username` + `password`,
   drops PIN + role fields.

### Person create/edit form (`person-form.tsx`)

On create: optionally set an initial `pin` and tick initial `roles[]`, so a new
carer can be created with a guardian PIN + (e.g.) Volunteer role in one step.

### Users & Roles page (`/admin/users`, `users-list.tsx`)

- **Role filter chip row** at top: `[All] [Admin] [PeopleManager] [Teacher]
  [Volunteer] [Kiosk] [Security]`. Selecting a role shows the People who have
  it (via `GET /api/admin/people?role=…`), with inline add/remove.
- **Add person to role** inside a group: a person picker (search by name) →
  `POST /api/admin/roles/assign`. For `Admin`/`PeopleManager`, only People with
  a login are offered.
- **Removed from this page:** the PIN column and Set PIN action; role badges
  and edit-roles on a login row. Login row keeps: name, username, status, last
  login, reset-password, enable/disable.
- "Promote to user" stays; its dialog no longer asks for PIN or roles.

### Sign-in forms

- Volunteer/Admin login form — no change.
- Guardian sign-in form (`guardian-signin-form.tsx`) — no change.
- Guardian portal "change PIN" (`family-dashboard.tsx`) — no UI change; hits
  the unchanged `/api/guardian/pin`, which now writes `Person.pinHash`.

## Enforcement rules

- **`Admin` / `PeopleManager` require a `User` login.** Enforced at role-assign
  APIs (400), in the UI (disabled checkbox + hint), and defense-in-depth in
  `getCurrentUser` (ignore/log).
- **`Teacher`, `Volunteer`, `Kiosk`, `Security`** — login optional.
- **PIN** — recommended for Admin/PeopleManager (UI warning), mandatory
  nowhere.

## Guardian portal permission model (already correct, restated)

| Capability | Primary Carer | Authorised Guardian |
|---|---|---|
| View own family (names, children, medical) | ✅ | ✅ |
| Update ALL family details/data | ✅ | ❌ (403 PrimaryCarer only) |
| View daily code for authorised families | ✅ | ✅ |
| Check out a child using personal PIN | ✅ (own family) | ✅ (authorised families) |
| Update own PIN | ✅ | ✅ |

Verified across `/api/guardian/family` PUT, `/api/guardian/family/members`
POST/DELETE, `/api/guardian/people/[personId]` PUT (all `403` for non-PrimaryCarer),
and `family-dashboard.tsx` (`canEdit = family.me.role === "PrimaryCarer"`).

## Bidirectional person ↔ family creation

People and families are currently siloed: a Person is created with no family
link, and a Family is created by searching for *existing* people only. This
forces a two-step workflow (create person → go to families → find & add).

### Person form → add to family

**When creating or editing a Person** in `/admin/people`, the form gains an
optional "Family" section:

- A family picker (search existing families by name, same pattern as the
  existing people search in the family form).
- A role dropdown: `PrimaryCarer` | `AuthorisedGuardian` | `Child`.
- On create: the person is created *and* a `FamilyMember` row is inserted in
  the same API call.
- On edit: a "join family" or "change family/role" action calls
  `POST /api/admin/families/[familyId]/members` (create membership) or
  `PATCH /api/admin/families/[familyId]/members/[personId]` (update role).
- A "Leave family" action removes the membership.
- The family picker also shows the person's current family (if any) when editing.

### Family form → create new people inline

**When creating a Family** in `/admin/families`, the "Add members" section gains
a second mode alongside the existing-people search:

- A **"Create new member"** inline form (name, person type Adult/Child, optional
  phone/email). Expands within the dialog as a collapsible section or a "+" button.
- New people are created as `Person` rows *and* linked as `FamilyMember` rows
  in the same `POST /api/admin/families` call.
- The API accepts a new `newMembers` array alongside the existing `memberIds`:

  ```json
  {
    "familyName": "Smith",
    "memberIds": ["existing-person-id"],
    "newMembers": [
      { "firstName": "Jane", "lastName": "Smith", "personType": "Adult", "phone": "..." },
      { "firstName": "Timmy", "lastName": "Smith", "personType": "Child" }
    ]
  }
  ```

- The API creates each new `Person`, then inserts `FamilyMember` rows for both
  `memberIds` and the newly created people, in a transaction. Role is derived
  from `personType` as today (Adult → PrimaryCarer, Child → Child).
- The UI shows both lists ("Existing people to add" + "New members") in the
  members section of the create-family dialog.

### API changes for bidirectional flow

- **`POST /api/admin/people`** (create person): body gains optional
  `familyId` + `familyRole` fields. If present, a `FamilyMember` is created in
  the same transaction.
- **`POST /api/admin/families`** (create family): body gains optional
  `newMembers[]` (inline person creation). Existing `memberIds` unchanged.

## Out of scope

- No change to the kiosk operator/override flows beyond the PIN read.
- No change to NextAuth session/cookie mechanics.
- No backward-compatible shims for moved APIs (pre-launch).
