import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { buildCsv, csvResponseHeaders, type CsvValue } from "@/lib/csv";
import {
  toElvantoCsvRow,
  elvantoRowToArray,
  ELVANTO_EXPORT_COLUMNS,
  isoDay,
  type ChildCheckRole,
} from "@/lib/elvanto";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/integrations/elvanto/export
 *
 * Streams an Elvanto-format CSV of every active ChildCheck person, grouped
 * by their family (so re-importing the CSV into Elvanto — or back into
 * ChildCheck — recreates the family structure).
 *
 * Columns (canonical Elvanto order):
 *   First Name, Last Name, Email, Mobile, Birthday, Gender, Family ID,
 *   Family Name, Family Role, School Grade, Medical Info, Allergies
 *
 * Family ID: the ChildCheck Family.id. Elvanto will treat them as new
 * families on re-import (which is the documented behaviour for a one-way
 * push).
 *
 * Family Role: derived from FamilyMember.role (PrimaryCarer → "Head of
 * Household", Child → "Child", AuthorisedGuardian/EmergencyContact →
 * "Other").
 *
 * People with no family membership are exported with empty Family ID /
 * Family Name / Family Role cells.
 *
 * Content-Type: text/csv
 * Content-Disposition: attachment; filename=childcheck-to-elvanto-<date>.csv
 *
 * Requires Admin / PeopleManager / Security (view_people permission).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "view_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Load all active people + their family memberships (with the family name).
  const people = await db.person.findMany({
    where: { isActive: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: {
      familyMemberships: {
        include: {
          family: {
            select: { id: true, familyName: true },
          },
        },
      },
    },
  });

  // Build one Elvanto row per (person × family-membership). A person in
  // multiple families appears on multiple rows (one per family) — this
  // mirrors how Elvanto would export a shared-custody child.
  //
  // People with no family membership get a single row with empty family
  // fields.
  const rows: CsvValue[][] = [];
  for (const p of people) {
    if (p.familyMemberships.length === 0) {
      const ep = toElvantoCsvRow({
        person: p,
        familyId: null,
        familyName: null,
        familyRole: "EmergencyContact" as ChildCheckRole,
      });
      rows.push(elvantoRowToArray(ep));
    } else {
      for (const m of p.familyMemberships) {
        const ep = toElvantoCsvRow({
          person: p,
          familyId: m.family.id,
          familyName: m.family.familyName,
          familyRole: m.role as ChildCheckRole,
        });
        rows.push(elvantoRowToArray(ep));
      }
    }
  }

  const header = ELVANTO_EXPORT_COLUMNS.slice();
  const csv = buildCsv(header, rows);
  const filename = `childcheck-to-elvanto-${todayTag()}.csv`;

  await logAudit({
    actorUserId: user.id,
    action: "elvanto.export",
    entity: "Person",
    details: {
      count: rows.length,
      format: "csv",
      peopleCount: people.length,
    },
  });

  return new NextResponse(csv, {
    status: 200,
    headers: csvResponseHeaders(filename),
  });
}

function todayTag(): string {
  return isoDay(new Date());
}
