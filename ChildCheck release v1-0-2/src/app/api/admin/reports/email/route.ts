import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  reportType: z.string().trim().min(1).max(80),
  to: z.string().trim().min(1).max(320),
  subject: z.string().trim().max(320).optional(),
  format: z.enum(["json", "csv"]).optional().default("json"),
  params: z.record(z.string(), z.unknown()).optional().default({}),
});

/**
 * POST /api/admin/reports/email — stub endpoint for emailing a generated report.
 *
 * Body: { reportType, to, subject?, format, params }
 *
 * Real SMTP delivery is a future stage (configurable SMTP server). For now we
 * log the request + write an audit entry and return `{ ok: true }` so the
 * dashboard can show a success toast.
 *
 * Access: Admin / PeopleManager / Security.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const isAdminLike =
    user.roles.includes("Admin") ||
    user.roles.includes("PeopleManager") ||
    user.roles.includes("Security");
  if (!isAdminLike) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const p = parsed.data;

  // Stub: log to server stdout + audit log. Real email delivery arrives in a
  // later stage (SMTP-configurable).
  console.info(
    `[reports.email] stub — to=${p.to} reportType=${p.reportType} format=${p.format}`,
    p.params,
  );

  await logAudit({
    actorUserId: user.id,
    action: "report.email",
    entity: "Report",
    entityId: p.reportType,
    details: {
      to: p.to,
      subject: p.subject,
      format: p.format,
      params: p.params,
    },
  });

  return NextResponse.json({ ok: true });
}
