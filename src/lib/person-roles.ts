// src/lib/person-roles.ts
//
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
export async function getPersonRoles(
  personId: string,
): Promise<string[]> {
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
export async function personHasLogin(
  personId: string,
): Promise<boolean> {
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

  const allSet = new Set<string>(ALL_STAFF_ROLES);
  const desired = new Set(roles.filter((r) => allSet.has(r)));

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
  const personName = person
    ? `${person.firstName} ${person.lastName}`
    : personId;

  await db.$transaction(async (tx) => {
    if (toRemove.length) {
      await tx.personRole.deleteMany({
        where: { personId, role: { in: toRemove } },
      });
    }
    if (toAdd.length) {
      await tx.personRole.createMany({
        data: toAdd.map((role) => ({ personId, role })),
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

  if (!(ALL_STAFF_ROLES as readonly string[]).includes(role)) {
    throw new Error(`Unknown role: ${role}`);
  }
  if (LOGIN_REQUIRED_ROLES.has(role) && !(await personHasLogin(personId))) {
    throw new RolesRequireLoginError(
      "Admin and PeopleManager roles require a login account. Create a login first.",
    );
  }

  try {
    await db.personRole.create({ data: { personId, role } });
  } catch {
    // Already exists (unique constraint) — ignore.
  }

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
      personName: person
        ? `${person.firstName} ${person.lastName}`
        : personId,
      role,
    },
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
      personName: person
        ? `${person.firstName} ${person.lastName}`
        : personId,
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
