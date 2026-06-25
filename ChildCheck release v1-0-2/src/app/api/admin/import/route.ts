import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  parsePeopleCsv,
  parseFamiliesCsv,
  insertPeopleBatch,
  insertFamiliesBatch,
  type PersonRowValidationError,
} from "@/lib/import-export";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/import?dryRun=(true|false)
 *
 * Multipart form data:
 *   - file: the .csv file (text/csv or any text/* content type)
 *   - type: "people" | "families"
 *
 * dryRun=true (default): parse + validate ONLY. Returns a preview with row
 *   count, valid count, per-row errors, and the first 10 rows. NO DB writes.
 *
 * dryRun=false: parse + validate + insert in a single transaction. If ANY row
 *   has a hard error, NOTHING is written (atomic rollback). Returns the count
 *   imported + any skipped rows.
 *
 * Requires Admin or PeopleManager.
 */
export async function POST(req: Request) {
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
  const dryRunParam = url.searchParams.get("dryRun");
  const dryRun = dryRunParam === null ? true : dryRunParam === "true";

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data with a `file` field." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  const typeRaw = (form.get("type") ?? "").toString().trim();
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Missing `file` field (expected a CSV file upload)." },
      { status: 400 },
    );
  }
  if (typeRaw !== "people" && typeRaw !== "families") {
    return NextResponse.json(
      { error: `Unknown import type "${typeRaw}". Expected "people" or "families".` },
      { status: 400 },
    );
  }

  // Read the file text. We accept up to 5MB to avoid pathological memory use.
  const MAX_BYTES = 5 * 1024 * 1024;
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large: ${buf.length} bytes (max ${MAX_BYTES}).` },
      { status: 413 },
    );
  }
  const text = buf.toString("utf-8");

  if (typeRaw === "people") {
    return await handlePeople(text, dryRun, user.id);
  }
  return await handleFamilies(text, dryRun, user.id);
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

interface PeoplePreviewRow {
  row: number;
  firstName: string;
  lastName: string;
  personType: string;
  email: string;
  valid: boolean;
}

interface PeopleDryRunResponse {
  type: "people";
  dryRun: true;
  totalRows: number;
  valid: number;
  errors: PersonRowValidationError[];
  preview: PeoplePreviewRow[];
  parseWarnings: string[];
}

interface PeopleImportResponse {
  type: "people";
  dryRun: false;
  imported: number;
  skipped: number;
  errors: PersonRowValidationError[];
  parseWarnings: string[];
}

async function handlePeople(
  text: string,
  dryRun: boolean,
  actorUserId: string,
): Promise<NextResponse> {
  let parsed;
  try {
    parsed = parsePeopleCsv(text);
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "CSV parse error",
      },
      { status: 400 },
    );
  }

  if (dryRun) {
    const body: PeopleDryRunResponse = {
      type: "people",
      dryRun: true,
      totalRows: parsed.totalRows,
      valid: parsed.valid.length,
      errors: parsed.errors,
      preview: parsed.preview,
      parseWarnings: parsed.parseWarnings,
    };
    return NextResponse.json(body);
  }

  // Real import: HARD STOP if any row has an error. No partial imports.
  if (parsed.errors.length > 0) {
    return NextResponse.json(
      {
        error: "Import aborted: one or more rows failed validation. No rows were written.",
        errors: parsed.errors,
      },
      { status: 400 },
    );
  }
  if (parsed.valid.length === 0) {
    return NextResponse.json(
      { error: "No valid rows to import." },
      { status: 400 },
    );
  }

  try {
    const { imported } = await insertPeopleBatch(parsed.valid, actorUserId);
    await logAudit({
      actorUserId,
      action: "import.people",
      entity: "Person",
      details: { count: imported, dryRun: false },
    });
    const body: PeopleImportResponse = {
      type: "people",
      dryRun: false,
      imported,
      skipped: 0,
      errors: [],
      parseWarnings: parsed.parseWarnings,
    };
    return NextResponse.json(body);
  } catch (err) {
    // Atomic: the transaction rolled back. Surface the message.
    return NextResponse.json(
      {
        error: "Import failed — entire batch rolled back.",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------

interface FamiliesPreviewRow {
  row: number;
  familyName: string;
  memberCount: number;
  primaryCarerEmail: string;
  valid: boolean;
}

interface FamiliesDryRunResponse {
  type: "families";
  dryRun: true;
  totalRows: number;
  valid: number;
  errors: PersonRowValidationError[];
  preview: FamiliesPreviewRow[];
  parseWarnings: string[];
}

interface FamiliesImportResponse {
  type: "families";
  dryRun: false;
  imported: number;
  membersCreated: number;
  errors: PersonRowValidationError[];
  parseWarnings: string[];
}

async function handleFamilies(
  text: string,
  dryRun: boolean,
  actorUserId: string,
): Promise<NextResponse> {
  let parsed;
  try {
    parsed = parseFamiliesCsv(text);
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "CSV parse error",
      },
      { status: 400 },
    );
  }

  if (dryRun) {
    const body: FamiliesDryRunResponse = {
      type: "families",
      dryRun: true,
      totalRows: parsed.totalRows,
      valid: parsed.valid.length,
      errors: parsed.errors,
      preview: parsed.preview,
      parseWarnings: parsed.parseWarnings,
    };
    return NextResponse.json(body);
  }

  if (parsed.errors.length > 0) {
    return NextResponse.json(
      {
        error: "Import aborted: one or more rows failed validation. No rows were written.",
        errors: parsed.errors,
      },
      { status: 400 },
    );
  }
  if (parsed.valid.length === 0) {
    return NextResponse.json(
      { error: "No valid rows to import." },
      { status: 400 },
    );
  }

  try {
    const { imported, membersCreated } = await insertFamiliesBatch(
      parsed.valid,
      actorUserId,
    );
    await logAudit({
      actorUserId,
      action: "import.families",
      entity: "Family",
      details: { count: imported, membersCreated, dryRun: false },
    });
    const body: FamiliesImportResponse = {
      type: "families",
      dryRun: false,
      imported,
      membersCreated,
      errors: [],
      parseWarnings: parsed.parseWarnings,
    };
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Import failed — entire batch rolled back.",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
