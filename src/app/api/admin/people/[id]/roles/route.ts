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
