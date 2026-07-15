import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { logAudit } from "@/lib/audit";
import { seedDefaultPrograms } from "@/lib/seed-programs";

export const dynamic = "force-dynamic";

const SetupSchema = z.object({
  organisationName: z.string().trim().min(1, "Organisation name is required"),
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  email: z
    .string()
    .trim()
    .email("Email is invalid")
    .optional()
    .or(z.literal("")),
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(64, "Username is too long")
    .regex(/^[A-Za-z0-9._-]+$/, "Username may only contain letters, numbers, '.', '_' and '-'"),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

export async function POST(req: Request) {
  // Guard: only available before any user exists.
  let userCount = 0;
  try {
    userCount = await db.user.count();
  } catch (err) {
    console.error("[setup] user count failed:", err);
    return NextResponse.json(
      { error: "Database unavailable" },
      { status: 503 },
    );
  }
  if (userCount > 0) {
    return NextResponse.json(
      { error: "Setup already complete" },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = SetupSchema.safeParse(body);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message ?? "Invalid input";
    return NextResponse.json({ error: firstError }, { status: 400 });
  }

  const { organisationName, firstName, lastName, email, username, password } =
    parsed.data;
  const cleanEmail = email && email.length > 0 ? email : null;

  try {
    const passwordHash = await hashPassword(password);

    // Check username uniqueness defensively (DB also enforces unique).
    const existing = await db.user.findUnique({ where: { username } });
    if (existing) {
      return NextResponse.json(
        { error: "Username already taken" },
        { status: 409 },
      );
    }

    const user = await db.$transaction(async (tx) => {
      // Upsert the organisation singleton with the provided name.
      await tx.organisation.upsert({
        where: { id: "default" },
        update: { name: organisationName, appName: organisationName },
        create: {
          id: "default",
          name: organisationName,
          appName: organisationName,
        },
      });

      const person = await tx.person.create({
        data: {
          firstName,
          lastName,
          email: cleanEmail,
          personType: "Adult",
        },
      });

      const created = await tx.user.create({
        data: {
          personId: person.id,
          username,
          passwordHash,
          status: "Active",
        },
      });

      await tx.personRole.create({
        data: { personId: person.id, role: "Admin" },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: created.id,
          action: "setup.complete",
          entity: "User",
          entityId: created.id,
          details: JSON.stringify({ username: created.username }),
        },
      });

      return created;
    });

    // Best-effort post-transaction audit (the in-tx row is the source of truth;
    // this is a no-op safety net for callers that prefer the helper API).
    await logAudit({
      actorUserId: user.id,
      action: "setup.complete",
      entity: "User",
      entityId: user.id,
      details: { username: user.username },
    });

    // Stage 5 — seed the default programs for this org-type (SDA by default
    // — the fresh-install default). Idempotent: re-runs never duplicate.
    try {
      await seedDefaultPrograms("SDA", user.id);
    } catch (err) {
      console.error("[setup] default program seeding failed:", err);
      // Non-fatal — admin can re-run from the Programs admin page.
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[setup] failed:", err);
    return NextResponse.json(
      { error: "Setup failed. Please try again." },
      { status: 500 },
    );
  }
}

/** GET → helpful for the setup wizard to check whether setup is allowed. */
export async function GET() {
  try {
    const count = await db.user.count();
    return NextResponse.json({ setupComplete: count > 0 });
  } catch {
    return NextResponse.json({ setupComplete: false });
  }
}
