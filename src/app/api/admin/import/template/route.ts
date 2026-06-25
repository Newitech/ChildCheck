import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { csvResponseHeaders } from "@/lib/csv";
import { PERSON_COLUMNS, FAMILY_COLUMNS } from "@/lib/import-export";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/import/template?type=(people|families)
 *
 * Returns a sample CSV file with the canonical header row + 2 example rows,
 * so admins have a starting point for a manual upload.
 *
 * Requires Admin / PeopleManager (same gate as the import route).
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const isAdminLike =
    user.roles.includes("Admin") || user.roles.includes("PeopleManager");
  if (!isAdminLike) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const type = (url.searchParams.get("type") ?? "").trim();

  if (type === "people") {
    const header = PERSON_COLUMNS.map((c) => c.header);
    const example1 = [
      "", // id (blank for new)
      "Jane",
      "Admin",
      "",
      "Adult",
      "jane@example.com",
      "+1 555 0100",
      "",
      "Female",
      "",
      "false",
      "true",
      "",
      "",
      "",
      "",
      "",
    ];
    const example2 = [
      "",
      "Mary",
      "Smith",
      "Maz",
      "Child",
      "",
      "",
      "2017-03-12",
      "Female",
      "Grade 2",
      "false",
      "true",
      "Peanuts",
      "Asthma — inhaler in bag",
      "",
      "John Smith",
      "+1 555 0144",
    ];
    const csv = [header, example1, example2]
      .map((r) => r.map((v) => escapeCsvField(v)).join(","))
      .join("\n");
    return new NextResponse(csv, {
      status: 200,
      headers: csvResponseHeaders("people-template.csv"),
    });
  }

  if (type === "families") {
    const header = FAMILY_COLUMNS.map((c) => c.header);
    const example1 = [
      "", // id (blank for new)
      "Smith",
      "Sunday family",
      "true",
      "john@example.com",
      "Mary Smith|Child|2017-03-12;Tom Smith|Child|2009-08-22",
    ];
    const example2 = [
      "",
      "Doe",
      "",
      "true",
      "",
      "Jane Doe|PrimaryCarer;Alex Doe|Child|2015-06-30",
    ];
    const csv = [header, example1, example2]
      .map((r) => r.map((v) => escapeCsvField(v)).join(","))
      .join("\n");
    return new NextResponse(csv, {
      status: 200,
      headers: csvResponseHeaders("families-template.csv"),
    });
  }

  return NextResponse.json(
    { error: `Unknown template type "${type}". Expected "people" or "families".` },
    { status: 400 },
  );
}

/** RFC-4180 escape a single field (mirror of csvEscape in src/lib/csv.ts). */
function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
