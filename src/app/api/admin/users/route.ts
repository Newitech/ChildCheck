import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getCurrentUser, ROLE_PERMISSIONS } from "@/lib/auth";
import { hashPassword, hashPin, isValidPin } from "@/lib/password";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const KNOWN_ROLES = Object.keys(ROLE_PERMISSIONS);

const createSchema = z.object({
  personId: z.string().trim().min(1, "Person is required"),
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(64, "Username is too long (max 64)")
    .regex(
      /^[A-Za-z0-9._-]+$/,
      "Username may only contain letters, numbers, '.', '_' and '-'",
    ),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password is too long (max 128)"),
  pin: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine((v) => v == null || v === "" || isValidPin(v), {
      message: "PIN must be 4–6 digits",
    }),
  roles: z
    .array(z.string())
    .refine(
      (rs) => rs.every((r) => KNOWN_ROLES.includes(r)),
      "Unknown role in list",
    ),
});

/**
 * GET /api/admin/users — list all Users with their Person + roles + status +
 * lastLoginAt. Admin-only. Sorted by Person.lastName asc, then firstName.
 *
 * Returns a safe shape: never includes passwordHash or pinHash. `hasPin` is a
 * boolean derived from the presence of pinHash.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !user.roles.includes("Admin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const users = await db.user.findMany({
    orderBy: {
      person: { lastName: "asc" },
    },
    include: {
      person: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          preferredName: true,
          email: true,
          personType: true,
        },
      },
      roles: { select: { role: true } },
    },
  });

  // SQLite orderBy on related `person.lastName` is supported via the relation
  // by Prisma — but to be safe + deterministic, re-sort in JS by lastName then
  // firstName. (Some Prisma versions ignore nested orderBy silently.)
  users.sort((a, b) => {
    const la = a.person?.lastName ?? "";
    const lb = b.person?.lastName ?? "";
    if (la !== lb) return la.localeCompare(lb);
    const fa = a.person?.firstName ?? "";
    const fb = b.person?.firstName ?? "";
    return fa.localeCompare(fb);
  });

  return NextResponse.json({
    items: users.map((u) => ({
      id: u.id,
      personId: u.personId,
      username: u.username,
      status: u.status,
      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
      hasPin: !!u.pinHash,
      createdAt: u.createdAt.toISOString(),
      person: u.person
        ? {
            id: u.person.id,
            firstName: u.person.firstName,
            lastName: u.person.lastName,
            preferredName: u.person.preferredName,
            email: u.person.email,
            personType: u.person.personType,
          }
        : null,
      roles: u.roles.map((r) => r.role),
    })),
  });
}

/**
 * POST /api/admin/users — create a new User for an existing Person.
 *
 * Body: { personId, username, password, pin?, roles: string[] }
 *
 * Validation:
 *  - personId must exist + must NOT already have a User (1:1 link).
 *  - username 3–64 chars, /^[A-Za-z0-9._-]+$/, unique.
 *  - password min 8.
 *  - pin optional, 4–6 digits (or empty/null).
 *  - roles must all be from the 6 known roles.
 *
 * Hashes password + pin (if provided) and creates User + UserRole rows in a
 * transaction. Audit-logs `user.create`.
 */
export async function POST(req: Request) {
  const actor = await getCurrentUser();
  if (!actor || !actor.roles.includes("Admin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message ?? "Invalid input";
    return NextResponse.json({ error: firstError }, { status: 400 });
  }
  const { personId, username, password, pin, roles } = parsed.data;

  // Person must exist and not already have a user account.
  const person = await db.person.findUnique({
    where: { id: personId },
    include: { user: { select: { id: true } } },
  });
  if (!person) {
    return NextResponse.json(
      { error: "Person not found" },
      { status: 404 },
    );
  }
  if (person.personType !== "Adult") {
    return NextResponse.json(
      { error: "Only Adult persons can be given a login account" },
      { status: 400 },
    );
  }
  if (person.user) {
    return NextResponse.json(
      { error: "This person already has a login account" },
      { status: 409 },
    );
  }

  // Username unique (DB also enforces — defensive).
  const existing = await db.user.findUnique({ where: { username } });
  if (existing) {
    return NextResponse.json(
      { error: "Username already taken" },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(password);
  const pinHash =
    pin && pin.length > 0 ? await hashPin(pin) : null;

  const created = await db.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        personId,
        username,
        passwordHash,
        pinHash,
        status: "Active",
      },
    });
    if (roles.length > 0) {
      // NOTE: Prisma's SQLite connector does not support `skipDuplicates` on
      // createMany (it throws PrismaClientValidationError). The schema has a
      // @@unique([userId, role]) constraint that protects against duplicates,
      // and we just created the User (no roles yet) so duplicates are
      // impossible here anyway.
      await tx.userRole.createMany({
        data: roles.map((r) => ({ userId: u.id, role: r })),
      });
    }
    return u;
  });

  await logAudit({
    actorUserId: actor.id,
    action: "user.create",
    entity: "User",
    entityId: created.id,
    details: {
      username,
      personId,
      roles,
      withPin: !!pinHash,
    },
  });

  return NextResponse.json(
    {
      id: created.id,
      personId: created.personId,
      username: created.username,
      status: created.status,
      hasPin: !!pinHash,
      roles,
    },
    { status: 201 },
  );
}
