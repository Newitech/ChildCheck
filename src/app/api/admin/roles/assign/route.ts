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
