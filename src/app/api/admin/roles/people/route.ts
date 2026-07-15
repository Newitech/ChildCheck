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
