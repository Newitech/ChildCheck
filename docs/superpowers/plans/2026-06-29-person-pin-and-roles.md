# Person PIN + Roles Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the guardian/identity PIN from `User.pinHash` to `Person.pinHash`, move permission roles from `UserRole` to a new `PersonRole` table (roles belong to a Person, login optional), reframe `User` as login-only, add role-group UI, and enable bidirectional person↔family creation.

**Architecture:** Single atomic Prisma migration copies existing PIN + roles onto `Person`/`PersonRole` and drops the old columns/table. A thin `src/lib/person-roles.ts` layer centralizes role read/write. All PIN-read call sites move from `person.user.pinHash` to `person.pinHash`; all permission derivation moves from `User.roles` to `PersonRole`. UI for PIN/roles relocates from the Users page into the Person detail page; the Users page gains a role-group filter.

**Tech Stack:** Next.js 16 (App Router, Turbopack), Prisma + SQLite, NextAuth, TypeScript, Tailwind, shadcn/ui components, Zod validation. **No test framework is installed** — verification is by `bunx tsc --noEmit`, the dev server, and manual API/UI checks.

**Spec:** `docs/superpowers/specs/2026-06-29-person-pin-and-roles-design.md`

**Verification commands used throughout:**
- Typecheck: `bunx tsc --noEmit 2>&1 | grep -v "node_modules" | head -40` (ignore pre-existing errors unrelated to the task)
- Prisma: `bunx prisma format && bunx prisma generate`
- Dev server: `bun run dev` (port 3001), then check `dev.log`
- Re-seed after schema changes: `bun run db:reset` then `bun run seed:demo`

---

## File Structure

**New files:**
- `prisma/migrations/<ts>_person_pin_roles/migration.sql` — single atomic migration (generated, then hand-edited for data copy)
- `src/lib/person-roles.ts` — role read/write helpers (`getPersonRoles`, `setPersonRoles`, `ensurePersonRole`, `removePersonRole`)
- `src/app/api/admin/people/[id]/pin/route.ts` — admin set/clear person PIN (relocated from users set-pin)
- `src/app/api/admin/people/[id]/roles/route.ts` — GET/PUT person roles
- `src/app/api/admin/roles/people/route.ts` — GET people by role (role-group view)
- `src/app/api/admin/roles/assign/route.ts` — POST/DELETE assign/unassign a person to a role

**Modified files:**
- `prisma/schema.prisma` — add `Person.pinHash`, add `PersonRole` model, remove `User.pinHash` + `User.roles`, remove `UserRole` model
- `src/lib/auth.ts` — permission derivation from `PersonRole`; NextAuth PIN check from `Person.pinHash`; defense-in-depth guard
- `src/lib/people.ts` — `PersonDetailDTO` gains `hasPin` + `roles`; `toPersonDetailDTO` populated; list gains `role` filter
- `src/lib/guardian-session.ts` — (verify) no change needed; PIN read unaffected
- `src/lib/audit.ts` — (verify) already supports `actorPersonId`
- `src/app/api/admin/people/route.ts` — create accepts optional `pin`/`roles`/`familyId`/`familyRole`; GET accepts `?role=`
- `src/app/api/admin/people/[id]/route.ts` — detail returns `hasPin`/`roles`
- `src/app/api/admin/users/route.ts` + `[id]/route.ts` — drop pin/roles from body/response
- `src/app/api/admin/users/[id]/set-pin/route.ts` — DELETE (relocated)
- `src/app/api/guardian/signin/route.ts` — PIN read from `person.pinHash`
- `src/app/api/guardian/pin/route.ts` — write `Person.pinHash`, drop User dependency
- `src/app/api/kiosk/guardian-signin/route.ts` — PIN read from `person.pinHash`
- `src/app/api/kiosk/checkout/route.ts` — PIN read from `person.pinHash`
- `src/app/api/admin/families/route.ts` — create accepts `newMembers[]`
- `src/app/admin/people/person-form.tsx` — optional pin + roles + family picker on create
- `src/app/admin/people/[id]/user-account-section.tsx` — becomes "Permissions & Access" card (roles checkboxes + PIN + login)
- `src/app/admin/users/users-list.tsx` — role-group chip filter; remove PIN column + role badges
- `src/app/admin/families/family-form.tsx` — "create new member" inline section
- `scripts/seed-demo.ts` — Teacher gets `pinHash` + `PersonRole`; admin gets `PersonRole`; no pinHash/roles on User

---

## Phase 1 — Schema & migration

### Task 1.1: Update Prisma schema

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `pinHash` to `Person`**

In the `model Person { ... }` block, add a `pinHash String?` field. Place it logically near the identity fields. Example addition:

```prisma
  pinHash        String?
```

- [ ] **Step 2: Add the `PersonRole` model**

Add after the `Person` model (or grouped with other relation models):

```prisma
model PersonRole {
  id        String   @id @default(cuid())
  personId  String
  role      String
  scope     String?
  createdAt DateTime @default(now())

  person Person @relation(fields: [personId], references: [id], onDelete: Cascade)

  @@unique([personId, role])
  @@index([role])
}
```

Also add the back-relation on `Person`:

```prisma
  roles          PersonRole[]
```

- [ ] **Step 3: Remove `pinHash` and `roles` from `User`**

In `model User { ... }`:
- Delete the `pinHash   String?` field.
- Delete the `roles     UserRole[]` relation field.

- [ ] **Step 4: Delete the `UserRole` model entirely**

Remove the whole `model UserRole { ... }` block.

- [ ] **Step 5: Validate schema syntax**

Run:
```bash
bunx prisma format
bunx prisma validate
```
Expected: "The schema at prisma/schema.prisma is valid 🚀"

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): add Person.pinHash + PersonRole; drop User.pinHash + UserRole"
```

---

### Task 1.2: Write the atomic migration SQL

Because this migration both changes schema AND must copy existing data, we generate the migration shell with `prisma migrate dev` then hand-edit the SQL to add the data-copy statements.

**Files:**
- Create: `prisma/migrations/<ts>_person_pin_roles/migration.sql`

- [ ] **Step 1: Generate the migration shell**

Run (this will create the migration folder + a SQL file based on the schema diff, but it does NOT know about the data copy):
```bash
bunx prisma migrate dev --name person_pin_roles --create-only
```
Expected: a new folder `prisma/migrations/<timestamp>_person_pin_roles/migration.sql`.

- [ ] **Step 2: Hand-edit the generated SQL to insert data-copy statements**

Open `prisma/migrations/<timestamp>_person_pin_roles/migration.sql`. Prisma will have written the `CREATE TABLE "PersonRole"`, `ALTER TABLE "Person" ADD COLUMN "pinHash"`, `ALTER TABLE "User" DROP COLUMN "pinHash"`, and `DROP TABLE "UserRole"` statements. Reorder/insert so the final SQL reads in this order:

1. `ALTER TABLE "Person" ADD COLUMN "pinHash" TEXT;` (move this ABOVE the drop statements)
2. `CREATE TABLE "PersonRole" (...)` — keep Prisma's generated DDL.
3. **Copy roles** (before `DROP TABLE "UserRole"`):
   ```sql
   INSERT OR IGNORE INTO "PersonRole" ("id", "personId", "role", "scope", "createdAt")
   SELECT LOWER(HEX(RANDOMBLOB(12))), "U"."personId", "UR"."role", "UR"."scope", COALESCE("UR"."createdAt", CURRENT_TIMESTAMP)
   FROM "UserRole" "UR"
   JOIN "User" "U" ON "U"."id" = "UR"."userId";
   ```
4. **Copy PINs** (before `ALTER TABLE "User" DROP COLUMN "pinHash"`):
   ```sql
   UPDATE "Person"
   SET "pinHash" = (
     SELECT "U"."pinHash" FROM "User" "U" WHERE "U"."personId" = "Person"."id" AND "U"."pinHash" IS NOT NULL
   )
   WHERE EXISTS (
     SELECT 1 FROM "User" "U" WHERE "U"."personId" = "Person"."id" AND "U"."pinHash" IS NOT NULL
   );
   ```
5. `ALTER TABLE "User" DROP COLUMN "pinHash";`
6. `DROP TABLE "UserRole";`

Add the standard Prisma preamble comment block at the top (it will already be there). Ensure no statement references `UserRole` or `User.pinHash` after the drop steps.

- [ ] **Step 3: Apply the migration to the dev DB**

Run:
```bash
bunx prisma migrate dev
```
Expected: migration applies; Prisma regenerates the client. If it reports "Migration failed", read the error — most likely cause is statement ordering (a drop happening before its data copy). Fix ordering and re-run.

- [ ] **Step 4: Verify the data copy worked**

Run a quick SQLite query via prisma (or a one-off script). Easiest: temporarily inspect counts. Example using the sqlite3 CLI if available, else a tiny bun script:
```bash
cat > /tmp/check.js <<'EOF'
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const peopleWithPin = await p.person.count({ where: { pinHash: { not: null } } });
const roles = await p.personRole.count();
console.log({ peopleWithPin, personRoles: roles, usersWithPinStill: "should be impossible" });
await p.$disconnect();
EOF
bunx tsx /tmp/check.js
```
Expected: `peopleWithPin` and `personRoles` are both > 0 (matching the seed data); no error about `User.pinHash`.

- [ ] **Step 5: Regenerate Prisma client**

```bash
bunx prisma generate
```

- [ ] **Step 6: Commit**

```bash
git add prisma/migrations/
git commit -m "feat(db): atomic migration — copy PIN + roles to Person/PersonRole, drop User fields"
```

---

### Task 1.3: Update seed-demo

**Files:**
- Modify: `scripts/seed-demo.ts`

- [ ] **Step 1: Find the seed sections that set User.pinHash and UserRole**

Run `grep -n "pinHash\|userRole\|UserRole\|role:" scripts/seed-demo.ts` to locate every place. Note line numbers.

- [ ] **Step 2: Move pinHash to the Person, roles to PersonRole**

For each seed person that previously had `pinHash` on its `User`, set `pinHash` on the `Person` create instead. For each `UserRole.create`, replace with `db.personRole.create({ data: { personId, role } })`.

Example transformation (adapt to actual field names found in Step 1):

Before (illustrative):
```ts
await db.user.create({
  data: { id: userId, personId, username: "teacher1", passwordHash, pinHash: hashPin("1234"), roles: { create: [{ role: "Teacher" }] } },
});
```

After:
```ts
await db.person.update({ where: { id: personId }, data: { pinHash: hashPin("1234") } });
await db.user.create({
  data: { id: userId, personId, username: "teacher1", passwordHash },
});
await db.personRole.create({ data: { personId, role: "Teacher" } });
```

Ensure the admin seed person gets `db.personRole.create({ data: { personId: adminPersonId, role: "Admin" } })`.

- [ ] **Step 3: Re-seed and verify**

```bash
bun run db:reset   # wipes DB and re-runs all migrations
bun run seed:demo
```
Then re-run the `/tmp/check.js` count script from Task 1.2 Step 4. Expected: `peopleWithPin` and `personRoles` reflect the new seed (e.g. teacher has a PIN; admin has an Admin role).

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-demo.ts
git commit -m "feat(seed): set PIN on Person, roles on PersonRole"
```

---

## Phase 2 — Lib layer

### Task 2.1: Create `src/lib/person-roles.ts`

**Files:**
- Create: `src/lib/person-roles.ts`

- [ ] **Step 1: Write the helpers**

```ts
// src/lib/person-roles.ts
// Central read/write helpers for PersonRole. Roles belong to a Person (not a
// login account). Used by both the Person editor and the Users role-group UI.

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";

/** Roles that REQUIRE a linked User login account. */
export const LOGIN_REQUIRED_ROLES = new Set(["Admin", "PeopleManager"]);

/** The full set of assignable staff roles. */
export const ALL_STAFF_ROLES = [
  "Admin",
  "PeopleManager",
  "Teacher",
  "Volunteer",
  "Kiosk",
  "Security",
] as const;
export type StaffRole = (typeof ALL_STAFF_ROLES)[number];

/** All role strings assigned to a Person. */
export async function getPersonRoles(personId: string): Promise<string[]> {
  const rows = await db.personRole.findMany({
    where: { personId },
    select: { role: true },
    orderBy: { role: "asc" },
  });
  return rows.map((r) => r.role);
}

/**
 * Does this Person have a User login account?
 * (Admin/PeopleManager roles require this.)
 */
export async function personHasLogin(personId: string): Promise<boolean> {
  const u = await db.user.findUnique({
    where: { personId },
    select: { id: true },
  });
  return !!u;
}

/**
 * Replace a Person's full role set. Adds/removes the diff.
 *
 * Enforces the rule that Admin/PeopleManager require a login: if `roles`
 * includes one of those and the Person has no User, throws.
 */
export async function setPersonRoles(opts: {
  personId: string;
  roles: string[];
  actorUserId?: string;
}): Promise<string[]> {
  const { personId, roles, actorUserId } = opts;
  const desired = new Set(
    roles.filter((r) => (ALL_STAFF_ROLES as readonly string[]).includes(r)),
  );

  // Enforce login-required roles.
  const needsLogin = [...desired].some((r) => LOGIN_REQUIRED_ROLES.has(r));
  if (needsLogin && !(await personHasLogin(personId))) {
    throw new RolesRequireLoginError(
      "Admin and PeopleManager roles require a login account. Create a login first.",
    );
  }

  const current = new Set(await getPersonRoles(personId));
  const toAdd = [...desired].filter((r) => !current.has(r));
  const toRemove = [...current].filter((r) => !desired.has(r));

  const person = await db.person.findUnique({
    where: { id: personId },
    select: { firstName: true, lastName: true },
  });
  const personName = person ? `${person.firstName} ${person.lastName}` : personId;

  await db.$transaction(async (tx) => {
    if (toRemove.length) {
      await tx.personRole.deleteMany({
        where: { personId, role: { in: toRemove } },
      });
    }
    if (toAdd.length) {
      await tx.personRole.createMany({
        data: toAdd.map((role) => ({ personId, role })),
        skipDuplicates: true,
      });
    }
  });

  for (const role of toAdd) {
    await logAudit({
      actorUserId,
      action: "person.role_added",
      entity: "PersonRole",
      entityId: personId,
      details: { personId, personName, role },
    });
  }
  for (const role of toRemove) {
    await logAudit({
      actorUserId,
      action: "person.role_removed",
      entity: "PersonRole",
      entityId: personId,
      details: { personId, personName, role },
    });
  }

  return getPersonRoles(personId);
}

/** Add a single role (idempotent). Enforces login-required rule. */
export async function ensurePersonRole(opts: {
  personId: string;
  role: string;
  actorUserId?: string;
}): Promise<void> {
  const { personId, role } = opts;
  if (!(ALL_STAFF_ROLES as readonly string[]).includes(role as StaffRole)) {
    throw new Error(`Unknown role: ${role}`);
  }
  if (LOGIN_REQUIRED_ROLES.has(role) && !(await personHasLogin(personId))) {
    throw new RolesRequireLoginError(
      "Admin and PeopleManager roles require a login account. Create a login first.",
    );
  }
  await db.personRole
    .create({ data: { personId, role } })
    .then(async () => {
      const person = await db.person.findUnique({
        where: { id: personId },
        select: { firstName: true, lastName: true },
      });
      await logAudit({
        actorUserId: opts.actorUserId,
        action: "person.role_added",
        entity: "PersonRole",
        entityId: personId,
        details: {
          personId,
          personName: person ? `${person.firstName} ${person.lastName}` : personId,
          role,
        },
      });
    })
    .catch(() => {
      // Already exists (unique constraint) — ignore.
    });
}

/** Remove a single role (idempotent). */
export async function removePersonRole(opts: {
  personId: string;
  role: string;
  actorUserId?: string;
}): Promise<void> {
  const { personId, role, actorUserId } = opts;
  await db.personRole.deleteMany({ where: { personId, role } });
  const person = await db.person.findUnique({
    where: { id: personId },
    select: { firstName: true, lastName: true },
  });
  await logAudit({
    actorUserId,
    action: "person.role_removed",
    entity: "PersonRole",
    entityId: personId,
    details: {
      personId,
      personName: person ? `${person.firstName} ${person.lastName}` : personId,
      role,
    },
  });
}

/** Thrown when assigning a login-required role to a login-less Person. */
export class RolesRequireLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RolesRequireLoginError";
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
bunx tsc --noEmit 2>&1 | grep "person-roles" || echo "person-roles clean"
```
Expected: "person-roles clean".

- [ ] **Step 3: Commit**

```bash
git add src/lib/person-roles.ts
git commit -m "feat(lib): add person-roles helpers with login-required enforcement"
```

---

### Task 2.2: Rework `src/lib/auth.ts` — permissions from PersonRole + PIN from Person

**Files:**
- Modify: `src/lib/auth.ts`

This task has three parts: (a) role derivation, (b) NextAuth PIN check, (c) defense-in-depth.

- [ ] **Step 1: Replace `getRolesForUser` to read from PersonRole**

Find:
```ts
export async function getRolesForUser(userId: string): Promise<string[]> {
  const rows = await db.userRole.findMany({ where: { userId } });
  return rows.map((r) => r.role);
}
```

Replace with a person-based lookup. The callers pass a `userId`; we need the linked `personId`:

```ts
/**
 * All role strings assigned to a user's Person (roles live on Person, not User).
 */
export async function getRolesForUser(userId: string): Promise<string[]> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      personId: true,
      status: true,
      person: { select: { roles: { select: { role: true } } } },
    },
  });
  if (!user) return [];

  // Defense-in-depth: Admin/PeopleManager require a login. We only reach here
  // for a real User row, so those roles are valid. (A login-less Person can't
  // have a session.) Still filter out any role string that isn't a known staff
  // role, to be safe.
  return user.person.roles
    .map((r) => r.role)
    .filter((r) => ALL_STAFF_ROLE_NAMES.has(r));
}
```

Add a module-level constant near the top of `auth.ts` (after imports):
```ts
import { ALL_STAFF_ROLES } from "@/lib/person-roles";
const ALL_STAFF_ROLE_NAMES = new Set<string>(ALL_STAFF_ROLES);
```

- [ ] **Step 2: Update `getCurrentUser` to fetch roles via PersonRole**

Find the `getCurrentUser` function. It currently selects `user.roles` (the `UserRole[]`) or calls `getRolesForUser`. Replace its role-loading to use `getRolesForUser(user.id)` (already updated in Step 1) so it pulls from `PersonRole`. Remove any `roles: { select: { role: true } }` from the User select clause (the User relation no longer exists).

If `getCurrentUser` builds the returned object with `roles: user.roles.map(...)`, change it to `roles: await getRolesForUser(user.id)`.

- [ ] **Step 3: Update the NextAuth `authorize` PIN check to read Person.pinHash**

Find the `authorize` callback (credentials provider). Locate where it checks the PIN against `user.pinHash`. Replace the User query's `select` to also fetch `person: { select: { pinHash: true } }`, and change the comparison:

Before (illustrative — match the actual code):
```ts
const user = await db.user.findUnique({ where: { username }, select: { id, personId, passwordHash, pinHash, status } });
...
if (isPin && user.pinHash && (await verifyPin(pin, user.pinHash))) { ... }
```

After:
```ts
const user = await db.user.findUnique({
  where: { username },
  select: {
    id: true,
    personId: true,
    passwordHash: true,
    status: true,
    person: { select: { pinHash: true } },
  },
});
...
const personPinHash = user.person?.pinHash ?? null;
if (isPin && personPinHash && (await verifyPin(pin, personPinHash))) { ... }
```

Keep the existing `status === "Active"` check for the login (User) — that still applies to staff login. The PIN-vs-password branching logic stays the same; only the source of the hash changes.

- [ ] **Step 4: Remove any remaining `db.userRole` or `user.roles` references in auth.ts**

Run:
```bash
grep -n "userRole\|UserRole\|user\.roles\|\.roles\b" src/lib/auth.ts
```
For each hit, decide: if it's the old role-loading path, replace with `getRolesForUser`/`PersonRole`; if it's `user.roles` in a type annotation, remove it. After this step the command above should return nothing (or only the new `getRolesForUser` usage).

- [ ] **Step 5: Typecheck**

```bash
bunx tsc --noEmit 2>&1 | grep "lib/auth" || echo "auth clean"
```
Expected: "auth clean". Note: OTHER files that imported role types from auth may now error — those are fixed in their own tasks; do not chase them here.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth.ts
git commit -m "feat(auth): derive roles from PersonRole, verify PIN against Person.pinHash"
```

---

### Task 2.3: Update `src/lib/people.ts` — DTO gains `hasPin` + `roles`; list `role` filter

**Files:**
- Modify: `src/lib/people.ts`

- [ ] **Step 1: Add fields to `PersonDetailDTO`**

In the `PersonDetailDTO` interface, add (alongside `hasUser`):
```ts
  hasPin: boolean;
  roles: string[];
```

- [ ] **Step 2: Populate them in `toPersonDetailDTO`**

Find `toPersonDetailDTO` (around line 224 where `hasUser: !!person.user`). Ensure the function's input includes `pinHash` and `roles` on the query. Add:
```ts
  hasPin: !!person.pinHash,
  roles: (person.roles ?? []).map((r) => r.role),
```
The Prisma caller (`/api/admin/people/[id]/route.ts`) must `select`/`include` `pinHash` and `roles: { select: { role: true } }` — that's done in Task 4.1.

- [ ] **Step 3: Support a `role` filter in the list query helper**

Find the list builder (the `GET` in `/api/admin/people/route.ts` builds the `where` inline). We'll add the `role` filter directly in that route (Task 4.2) rather than in people.ts, so no change here unless a shared `toPersonListDTO` needs roles — it does not. Skip; just verify `toPersonListDTO` does not reference `user.pinHash`.

- [ ] **Step 4: Typecheck**

```bash
bunx tsc --noEmit 2>&1 | grep "lib/people" || echo "people clean"
```
Expected: "people clean" (errors in route files consuming the DTO are expected and fixed in Phase 4).

- [ ] **Step 5: Commit**

```bash
git add src/lib/people.ts
git commit -m "feat(people): PersonDetailDTO gains hasPin + roles"
```

---

## Phase 3 — PIN/role read sites (kiosk + guardian)

These are the "move the PIN read" tasks. They're small and independent. Do them before the API/UI changes so the PIN flows keep working throughout.

### Task 3.1: Guardian sign-in + PIN APIs read from Person

**Files:**
- Modify: `src/app/api/guardian/signin/route.ts`
- Modify: `src/app/api/guardian/pin/route.ts`
- Modify: `src/app/api/kiosk/guardian-signin/route.ts`

- [ ] **Step 1: Update `guardian/signin` — read `person.pinHash`**

Open `src/app/api/guardian/signin/route.ts`. Find where it loads family members and checks each member's PIN. It currently does something like `member.person.user?.pinHash` and gates on `user.status === "Active"`.

Change the person include to select `pinHash` directly:
```ts
person: { select: { id: true, firstName: true, lastName: true, pinHash: true } }
```
Change the verification:
```ts
// before
// if (!u || u.status !== "Active" || !u.pinHash) continue;
// if (!(await verifyPin(pin, u.pinHash))) continue;

// after
if (!m.person.pinHash) continue;
if (!(await verifyPin(pin, m.person.pinHash))) continue;
```
Remove the `user` include and the `user.status` gate. A PIN-bearing Person with no login is valid.

- [ ] **Step 2: Update `guardian/pin` — write `Person.pinHash`**

Open `src/app/api/guardian/pin/route.ts`. It currently loads `person.user.pinHash` and updates `User.pinHash`, requiring `person.user`. Change to load and update `Person.pinHash` directly:

```ts
// load the guardian's person
const person = await db.person.findUnique({
  where: { id: g.personId },
  select: { id: true, pinHash: true },
});
if (!person) return NextResponse.json({ error: "person not found" }, { status: 404 });

// verify current PIN if one exists
if (person.pinHash) {
  if (!currentPin || !(await verifyPin(currentPin, person.pinHash))) {
    return NextResponse.json({ error: "current PIN is incorrect" }, { status: 403 });
  }
}

// set/clear
const pinHash = newPin ? await hashPin(newPin) : null;
await db.person.update({ where: { id: person.id }, data: { pinHash } });
```
Remove any `requireGuardianSession`/`User` dependency logic that gated on having a login. Audit action stays a `person.pin_set` / `person.pin_cleared` (rename if it was `user.pin_set`).

- [ ] **Step 3: Update `kiosk/guardian-signin` — read `person.pinHash`**

Same transformation as Step 1 applied to `src/app/api/kiosk/guardian-signin/route.ts`. Read `member.person.pinHash`; drop the `user.status` gate and the `user` include.

- [ ] **Step 4: Typecheck the three files**

```bash
bunx tsc --noEmit 2>&1 | grep -E "guardian/signin|guardian/pin|kiosk/guardian-signin" || echo "guardian PIN flows clean"
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/guardian/ src/app/api/kiosk/guardian-signin/route.ts
git commit -m "feat(api): guardian/kiosk PIN flows read+write Person.pinHash"
```

---

### Task 3.2: Kiosk checkout reads Person.pinHash

**Files:**
- Modify: `src/app/api/kiosk/checkout/route.ts`

- [ ] **Step 1: Update the PIN collector check**

Find the `method === "pin"` branch in `src/app/api/kiosk/checkout/route.ts`. It checks `membership.person.user?.pinHash`. Change the family-membership include to select `person: { select: { pinHash: true, ... } }` and compare against `membership.person.pinHash`. Remove the `user?.pinHash` and any `user.status` gate.

- [ ] **Step 2: Typecheck**

```bash
bunx tsc --noEmit 2>&1 | grep "kiosk/checkout" || echo "checkout clean"
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/kiosk/checkout/route.ts
git commit -m "feat(kiosk): checkout PIN check reads Person.pinHash"
```

---

## Phase 4 — Admin people APIs

### Task 4.1: Person detail API returns `hasPin` + `roles`

**Files:**
- Modify: `src/app/api/admin/people/[id]/route.ts`

- [ ] **Step 1: Include `pinHash` and `roles` in the person query**

Find the `GET` handler's `db.person.findUnique`. Add to its `select`/`include`:
```ts
  pinHash: true,
  roles: { select: { role: true } },
```
(`hasPin` is derived as `!!person.pinHash`.)

- [ ] **Step 2: Verify `toPersonDetailDTO` receives them**

`toPersonDetailDTO(person)` now needs `person.pinHash` and `person.roles`. The select in Step 1 provides them. If the function is called with a pre-shaped object, ensure `pinHash` and `roles` pass through. (Task 2.3 already taught `toPersonDetailDTO` to read these.)

- [ ] **Step 3: Typecheck + manual check**

```bash
bunx tsc --noEmit 2>&1 | grep "people/\[id\]" || echo "person detail clean"
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/people/[id]/route.ts
git commit -m "feat(api): person detail returns hasPin + roles"
```

---

### Task 4.2: Person list API — `?role=` filter

**Files:**
- Modify: `src/app/api/admin/people/route.ts`

- [ ] **Step 1: Parse the `role` query param**

In the `GET` handler, after parsing `q`, `personType`, etc., add:
```ts
const role = url.searchParams.get("role");
```

- [ ] **Step 2: Add to the `where` clause**

After the existing `where.AND` pushes, add:
```ts
if (role) {
  where.AND.push({
    roles: { some: { role } },
  });
}
```

- [ ] **Step 3: Typecheck**

```bash
bunx tsc --noEmit 2>&1 | grep "people/route" || echo "people list clean"
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/people/route.ts
git commit -m "feat(api): people list supports ?role= filter"
```

---

### Task 4.3: Person create API — optional `pin` + `roles` + `familyId`/`familyRole`

**Files:**
- Modify: `src/app/api/admin/people/route.ts` (the `POST` handler)

- [ ] **Step 1: Extend the Zod create schema**

Add optional fields to `createSchema`:
```ts
  pin: z.string().regex(/^\d{4,6}$/).optional().nullable(),
  roles: z.array(z.string()).optional(),
  familyId: z.string().max(60).optional().nullable(),
  familyRole: z.enum(["PrimaryCarer", "AuthorisedGuardian", "Child"]).optional().nullable(),
```

- [ ] **Step 2: In the POST handler, after creating the Person, write pin/roles/family**

After `db.person.create(...)`, in the same transaction:

```ts
const person = await db.person.create({ data: { ...baseData, ...(pin ? { pinHash: await hashPin(pin) } : {}) } });

if (roles?.length) {
  // reuse the same enforcement logic as setPersonRoles
  await setPersonRoles({ personId: person.id, roles, actorUserId: user.id });
}

if (familyId && familyRole) {
  const family = await db.family.findUnique({ where: { id: familyId } });
  if (!family) return NextResponse.json({ error: "family not found" }, { status: 404 });
  if (familyRole === "AuthorisedGuardian" && person.personType !== "Adult") {
    return NextResponse.json({ error: "AuthorisedGuardian requires an Adult" }, { status: 400 });
  }
  await db.familyMember.create({ data: { familyId, personId: person.id, role: familyRole } });
}
```

Import `hashPin` (from wherever the existing pin helpers live — check `src/lib/`) and `setPersonRoles` from `@/lib/person-roles`. Wrap the create + role-set + family-link in a `db.$transaction` if not already.

Audit: if `pin`, log `person.pin_set`; if roles changed, `setPersonRoles` already audits.

- [ ] **Step 3: Typecheck**

```bash
bunx tsc --noEmit 2>&1 | grep "people/route" || echo "people create clean"
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/people/route.ts
git commit -m "feat(api): create person with optional pin, roles, family membership"
```

---

### Task 4.4: New `POST /api/admin/people/[id]/pin` (relocated set-pin)

**Files:**
- Create: `src/app/api/admin/people/[id]/pin/route.ts`
- Delete: `src/app/api/admin/users/[id]/set-pin/route.ts`

- [ ] **Step 1: Create the new route**

```ts
// src/app/api/admin/people/[id]/pin/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { hashPin } from "@/lib/password"; // hashPin/verifyPin live in password.ts

export const dynamic = "force-dynamic";

const schema = z.object({
  pin: z.union([z.string().regex(/^\d{4,6}$/), z.literal("")]).optional().nullable(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const person = await db.person.findUnique({ where: { id }, select: { firstName: true, lastName: true } });
  if (!person) return NextResponse.json({ error: "person not found" }, { status: 404 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation", details: parsed.error.flatten() }, { status: 400 });

  const pin = parsed.data.pin ?? "";
  const pinHash = pin ? await hashPin(pin) : null;
  await db.person.update({ where: { id }, data: { pinHash } });

  await logAudit({
    actorUserId: user.id,
    action: pin ? "person.pin_set" : "person.pin_cleared",
    entity: "Person",
    entityId: id,
    details: { personId: id, personName: `${person.firstName} ${person.lastName}` },
  });

  return NextResponse.json({ ok: true, hasPin: !!pin });
}
```

Verify the actual `hashPin` import path first: `grep -rn "export.*hashPin" src/lib/`.

- [ ] **Step 2: Delete the old users set-pin route**

```bash
git rm src/app/api/admin/users/\[id\]/set-pin/route.ts
```
If the folder becomes empty, remove it too.

- [ ] **Step 3: Typecheck**

```bash
bunx tsc --noEmit 2>&1 | grep -E "people/\[id\]/pin|set-pin" || echo "pin route clean"
```

- [ ] **Step 4: Commit**

```bash
git add -A src/app/api/admin/people/\[id\]/pin/ src/app/api/admin/users/\[id\]/set-pin/
git commit -m "feat(api): relocate set-pin to /api/admin/people/[id]/pin (manage_people)"
```

---

### Task 4.5: New role APIs — `people/[id]/roles`, `roles/people`, `roles/assign`

**Files:**
- Create: `src/app/api/admin/people/[id]/roles/route.ts`
- Create: `src/app/api/admin/roles/people/route.ts`
- Create: `src/app/api/admin/roles/assign/route.ts`

- [ ] **Step 1: `GET/PUT /api/admin/people/[id]/roles`**

```ts
// src/app/api/admin/people/[id]/roles/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { getPersonRoles, setPersonRoles, RolesRequireLoginError } from "@/lib/person-roles";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "view_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const roles = await getPersonRoles(id);
  return NextResponse.json({ roles });
}

const body = z.object({ roles: z.array(z.string()) });

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  let json: unknown;
  try { json = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const parsed = body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "validation", details: parsed.error.flatten() }, { status: 400 });

  try {
    const roles = await setPersonRoles({ personId: id, roles: parsed.data.roles, actorUserId: user.id });
    return NextResponse.json({ roles });
  } catch (e) {
    if (e instanceof RolesRequireLoginError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
```

- [ ] **Step 2: `GET /api/admin/roles/people?role=...`**

```ts
// src/app/api/admin/roles/people/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "view_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const role = new URL(req.url).searchParams.get("role");
  if (!role) return NextResponse.json({ error: "role required" }, { status: 400 });

  const people = await db.person.findMany({
    where: { roles: { some: { role } }, isActive: true },
    select: { id: true, firstName: true, lastName: true, personType: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
  const items = people.map((p) => ({
    id: p.id,
    name: `${p.firstName} ${p.lastName}`.trim(),
    personType: p.personType,
    hasLogin: false, // set below
  }));

  // attach hasLogin
  const logins = await db.user.findMany({
    where: { personId: { in: people.map((p) => p.id) } },
    select: { personId: true },
  });
  const loginSet = new Set(logins.map((l) => l.personId));
  for (const it of items) it.hasLogin = loginSet.has(it.id);

  return NextResponse.json({ items });
}
```

- [ ] **Step 3: `POST/DELETE /api/admin/roles/assign`**

```ts
// src/app/api/admin/roles/assign/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { ensurePersonRole, removePersonRole, RolesRequireLoginError } from "@/lib/person-roles";

export const dynamic = "force-dynamic";

const body = z.object({ personId: z.string().min(1), role: z.string().min(1) });

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let json: unknown;
  try { json = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const parsed = body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "validation", details: parsed.error.flatten() }, { status: 400 });
  try {
    await ensurePersonRole({ personId: parsed.data.personId, role: parsed.data.role, actorUserId: user.id });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (e instanceof RolesRequireLoginError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let json: unknown;
  try { json = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const parsed = body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "validation", details: parsed.error.flatten() }, { status: 400 });
  await removePersonRole({ personId: parsed.data.personId, role: parsed.data.role, actorUserId: user.id });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Typecheck**

```bash
bunx tsc --noEmit 2>&1 | grep -E "people/\[id\]/roles|roles/people|roles/assign" || echo "role APIs clean"
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/
git commit -m "feat(api): role read/assign endpoints (people/[id]/roles, roles/people, roles/assign)"
```

---

## Phase 5 — Users APIs become login-only

### Task 5.1: Strip pin/roles from users APIs

**Files:**
- Modify: `src/app/api/admin/users/route.ts`
- Modify: `src/app/api/admin/users/[id]/route.ts`

- [ ] **Step 1: Drop `pin`/`roles` from the create (`POST /api/admin/users`) body + handler**

Open `src/app/api/admin/users/route.ts`. In `POST`:
- Remove `pin` (and any `hasPin`) from the Zod schema and handler.
- Remove role creation (any `roles: { create: ... }` on the User).
- If you want to keep optional `roles[]` convenience (per spec), add: after creating the User, call `setPersonRoles({ personId, roles, actorUserId })` wrapped in try/catch.
- The create now takes `personId, username, password, status?` (and optional `roles[]`).

- [ ] **Step 2: Drop `hasPin`/`roles` from responses (GET list + GET/PUT single)**

In both files, remove `hasPin`, `pin` references, and any role badges from the serialized user objects. The User select no longer includes `pinHash`/`roles` (they don't exist on User). If a response builder references `user.pinHash` or `user.roles`, remove it.

- [ ] **Step 3: Typecheck**

```bash
bunx tsc --noEmit 2>&1 | grep -E "api/admin/users" || echo "users APIs clean"
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/users/
git commit -m "feat(api): users APIs are login-only (no pin/roles)"
```

---

## Phase 6 — Family create API gains `newMembers[]`

### Task 6.1: Family create accepts inline new members

**Files:**
- Modify: `src/app/api/admin/families/route.ts`

- [ ] **Step 1: Extend the create schema**

Add alongside the existing `memberIds`:
```ts
  newMembers: z.array(z.object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    personType: z.enum(["Adult", "Child"]).default("Adult"),
    phone: z.string().trim().max(60).optional().nullable(),
    email: z.string().trim().max(160).optional().nullable(),
  })).optional(),
```

- [ ] **Step 2: Create new people + link in the same transaction**

In the `POST` handler, after the family is created and before/with the existing `memberIds` loop, create each new person and collect their ids. Then link BOTH existing `memberIds` and new person ids as `FamilyMember` rows, deriving role from `personType`:

```ts
await db.$transaction(async (tx) => {
  const family = await tx.family.create({ data: { familyName } });

  // create new people
  const newIds: { id: string; role: string }[] = [];
  for (const m of newMembers ?? []) {
    const p = await tx.person.create({
      data: {
        firstName: m.firstName,
        lastName: m.lastName,
        personType: m.personType,
        phone: m.phone ?? null,
        email: m.email ?? null,
        isActive: true,
      },
    });
    newIds.push({ id: p.id, role: m.personType === "Child" ? "Child" : "PrimaryCarer" });
  }

  // link existing
  for (const personId of memberIds ?? []) {
    const person = await tx.person.findUnique({ where: { id: personId } });
    if (!person) continue;
    await tx.familyMember.create({
      data: { familyId: family.id, personId, role: person.personType === "Child" ? "Child" : "PrimaryCarer" },
    }).catch(() => {}); // ignore duplicate
  }

  // link new
  for (const { id, role } of newIds) {
    await tx.familyMember.create({ data: { familyId: family.id, personId: id, role } });
  }

  return family;
});
```
Audit each new person + family member as appropriate (reuse existing audit calls).

- [ ] **Step 3: Typecheck**

```bash
bunx tsc --noEmit 2>&1 | grep "families/route" || echo "family create clean"
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/families/route.ts
git commit -m "feat(api): family create accepts newMembers[] inline person creation"
```

---

## Phase 7 — UI: Person detail "Permissions & Access" card

### Task 7.1: Rework `user-account-section.tsx` into a 3-part card

**Files:**
- Modify: `src/app/admin/people/[id]/user-account-section.tsx`

This is the largest UI task. The existing component handles "promote to user" + status. We add two sections above it: Roles and Guardian PIN.

- [ ] **Step 1: Add the Roles section**

At the top of the card, render a "Roles" block with one checkbox per `ALL_STAFF_ROLES` (import from `@/lib/person-roles`). The component already receives person data; ensure the parent passes `roles: string[]` and `hasUser: boolean` (added to the detail API in Task 4.1).

State: `const [roles, setRoles] = useState<string[]>(initialRoles)`.

On toggle:
```ts
async function toggleRole(role: string) {
  const next = roles.includes(role) ? roles.filter((r) => r !== role) : [...roles, role];
  // optimistic
  setRoles(next);
  const res = await fetch(`/api/admin/people/${personId}/roles`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roles: next }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    toast.error(data.error ?? "Could not update roles");
    setRoles(initialRoles); // revert
  } else {
    const data = await res.json();
    setRoles(data.roles);
    toast.success("Roles updated");
  }
}
```

For `Admin`/`PeopleManager`, if `!hasUser`, render the checkbox **disabled** with a hint:
```tsx
<label className={cn("flex items-center gap-2", !hasUser && "opacity-50")}>
  <input
    type="checkbox"
    disabled={!hasUser && LOGIN_REQUIRED_ROLES.has(role)}
    checked={roles.includes(role)}
    onChange={() => toggleRole(role)}
  />
  <span>{role}</span>
  {!hasUser && LOGIN_REQUIRED_ROLES.has(role) && (
    <span className="text-xs text-muted-foreground">Requires a login — create one below</span>
  )}
</label>
```

Import `LOGIN_REQUIRED_ROLES` from `@/lib/person-roles`.

- [ ] **Step 2: Add the Guardian PIN section**

Below Roles, add a "Guardian PIN" row: a badge ("PIN set" / "No PIN") + a "Set / change PIN" button that opens a dialog. Reuse the dialog pattern from the old users `SetPinDialog` (a simple 2-field PIN + confirm form). On submit:
```ts
const res = await fetch(`/api/admin/people/${personId}/pin`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ pin: pinValue || "" }), // "" clears
});
```
State: `const [hasPin, setHasPin] = useState(initialHasPin)`.

- [ ] **Step 3: Keep the Login account section, reframe wording**

The existing promote/status block stays. Change its heading from "Login account" framing to "Optional staff sign-in". In the promote dialog, remove the PIN field and the role checkboxes (roles now live in the Roles section above; PIN in the PIN section).

- [ ] **Step 4: Ensure the parent page passes the new props**

Open the person detail page that renders this section. Make sure it passes `roles` and `hasPin` from the person detail DTO (now available from Task 4.1). If the page fetches the person inline, ensure its `select`/`include` covers `pinHash` and `roles`.

- [ ] **Step 5: Typecheck**

```bash
bunx tsc --noEmit 2>&1 | grep "user-account-section\|people/\[id\]" || echo "person detail UI clean"
```

- [ ] **Step 6: Manual check**

Start the dev server, open a person detail page, and verify: roles checkboxes toggle and persist; Admin/PM are disabled if no login; Set PIN opens a dialog and updates the badge; Promote still works without pin/role fields.

- [ ] **Step 7: Commit**

```bash
git add src/app/admin/people/
git commit -m "feat(ui): person detail Permissions & Access card (roles + PIN + login)"
```

---

### Task 7.2: Person create form — optional pin + roles + family picker

**Files:**
- Modify: `src/app/admin/people/person-form.tsx`

- [ ] **Step 1: Add optional fields to the form state**

Add state for `pin`, `roles` (string[]), `familyId`, `familyRole`. Add UI controls in an "Optional" section near the bottom:
- PIN input (4–6 digits, masked).
- Role checkboxes (same `ALL_STAFF_ROLES` list). For Admin/PM, show the hint that a login is required (these will fail server-side if no login — acceptable for create, since the person has no login yet; the hint says so).
- A family search picker (reuse the existing people-search pattern but hitting `/api/admin/families?q=...`). Selecting a family sets `familyId`. A role dropdown sets `familyRole`.

- [ ] **Step 2: Submit with the new fields**

In the submit handler, include the new fields in the POST body:
```ts
const res = await fetch("/api/admin/people", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    ...baseFields,
    ...(pin ? { pin } : {}),
    ...(roles.length ? { roles } : {}),
    ...(familyId ? { familyId, familyRole } : {}),
  }),
});
```

- [ ] **Step 3: Typecheck + manual check**

```bash
bunx tsc --noEmit 2>&1 | grep "person-form" || echo "person form clean"
```

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/people/person-form.tsx
git commit -m "feat(ui): person create form with optional pin, roles, family"
```

---

## Phase 8 — UI: Users page role-group filter

### Task 8.1: Add role-group chip filter + remove PIN/role UI from users list

**Files:**
- Modify: `src/app/admin/users/users-list.tsx`

- [ ] **Step 1: Add the role filter chip row**

At the top of the list component, add state `const [roleFilter, setRoleFilter] = useState<string | null>(null)` and a chip row:
```tsx
const chips = [null, ...ALL_STAFF_ROLES];
<div className="flex flex-wrap gap-2">
  {chips.map((r) => (
    <button
      key={r ?? "all"}
      onClick={() => setRoleFilter(r)}
      className={cn("rounded-full border px-3 py-1 text-sm", roleFilter === r ? "bg-primary text-primary-foreground" : "bg-background")}
    >
      {r ?? "All"}
    </button>
  ))}
</div>
```

- [ ] **Step 2: When a role is selected, show People in that role instead of Users**

```ts
const { items } = roleFilter
  ? await fetch(`/api/admin/roles/people?role=${roleFilter}`).then((r) => r.json())
  : { items: null };
```
Render a different table when `roleFilter` is set: columns Name, Type, Has login, and an action "Remove from role" (DELETE `/api/admin/roles/assign`). Add an "Add person to role" button opening a person-picker that POSTs to `/api/admin/roles/assign`. For Admin/PM roles, the picker should only offer people with a login — filter the search results client-side by `hasLogin` or filter server-side (simplest: filter client-side on the returned `hasLogin`).

- [ ] **Step 3: Remove the PIN column and Set PIN action**

Delete the PIN badge column and the Set PIN dialog/action from the Users table. Pin now lives on the Person detail page.

- [ ] **Step 4: Remove role badges / edit-roles from the login row**

Delete role display/edit from the Users table rows. Roles now live on the Person detail page.

- [ ] **Step 5: Update the Promote dialog**

In the promote-to-user dialog, remove the PIN field and role checkboxes. It now only asks for username + password (+ status).

- [ ] **Step 6: Typecheck + manual check**

```bash
bunx tsc --noEmit 2>&1 | grep "users-list" || echo "users list clean"
```
Manual: click each role chip, verify People list appears; add/remove a person from a role; promote a person without pin/role fields.

- [ ] **Step 7: Commit**

```bash
git add src/app/admin/users/users-list.tsx
git commit -m "feat(ui): users page role-group filter; remove pin/role UI (moved to person)"
```

---

## Phase 9 — Family form: create new members inline

### Task 9.1: Family create form — inline new member section

**Files:**
- Modify: `src/app/admin/families/family-form.tsx`

- [ ] **Step 1: Add a "New members" list + "Create new member" inline form**

Add state `const [newMembers, setNewMembers] = useState<NewMember[]>([])` where `NewMember = { firstName, lastName, personType, phone, email }`. Add a collapsible section below the existing people search:
- A small inline form (firstName, lastName, personType select, optional phone/email) with an "Add" button that pushes to `newMembers` and clears the inline form.
- A list showing the pending new members with a remove (×) button.

- [ ] **Step 2: Submit with `newMembers`**

In the submit handler:
```ts
const res = await fetch("/api/admin/families", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    familyName,
    memberIds,           // existing
    newMembers,          // new
  }),
});
```

- [ ] **Step 3: Typecheck + manual check**

```bash
bunx tsc --noEmit 2>&1 | grep "family-form" || echo "family form clean"
```
Manual: create a family, add one existing person and one new person inline, verify both appear.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/families/family-form.tsx
git commit -m "feat(ui): family create form — inline new member creation"
```

---

## Phase 10 — Final verification

### Task 10.1: Full typecheck + reseed + manual end-to-end

- [ ] **Step 1: Full typecheck**

```bash
bunx tsc --noEmit 2>&1 | grep -v "node_modules" | head -40
```
Any remaining errors should be investigated. Ideally zero errors. Fix any stragglers that reference removed `user.pinHash`, `user.roles`, `userRole`, or `db.userRole`.

- [ ] **Step 2: Grep for leftover references**

```bash
grep -rn "userRole\|UserRole\|user\.pinHash\|user\.roles\b\|set-pin" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules
```
Expected: no hits (or only comments). Fix any real references.

- [ ] **Step 3: Reseed from scratch**

```bash
bun run db:reset
bun run seed:demo
```
Verify no errors. Check the demo data: teacher has a PIN on their Person; admin has an Admin PersonRole.

- [ ] **Step 4: Start dev server and exercise the flows**

```bash
bun run dev
```
Manual checklist:
1. Sign in as admin (username + password).
2. Open a person → Roles checkboxes work; Set PIN works; Promote works without pin/role fields.
3. Create a person with a PIN + Volunteer role + family link in one go.
4. Users page → click "Volunteer" chip → see the volunteers; add/remove a person.
5. Create a family with an existing + a new inline member.
6. Guardian area → sign in with family + PIN → change PIN → signs in with new PIN.
7. Kiosk → check out a child via guardian PIN.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: final verification of PIN-on-Person + roles refactor"
```

---

## Notes for the implementer

- **`hashPin`/`verifyPin` location:** confirmed at `src/lib/password.ts` (`export function hashPin`, `export function verifyPin`). Import as `@/lib/password`.
- **Audit action strings:** use the new `person.*` actions consistently. Check `src/lib/audit.ts` for any allow-list of actions; if there is one, add the new strings.
- **`toPersonDetailDTO`:** it may be called from multiple places. After Task 2.3, any caller that doesn't select `pinHash`/`roles` will break at typecheck — fix those callers to include them.
- **Defense-in-depth note:** `getRolesForUser` (auth.ts, Task 2.2) naturally implements the "login-less Person can't have staff powers via session" guard because it's only ever called for an authenticated User. The `getCurrentUser` path is the choke point.
- **If `bun run db:reset` fails** after editing the migration, the migration SQL likely has a statement-ordering issue (drop before copy). Re-read Task 1.2 Step 2.
