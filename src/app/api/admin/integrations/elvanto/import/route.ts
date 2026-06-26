import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  parseElvantoCsv,
  parseElvantoJson,
  mapElvantoToChildCheck,
  type ElvantoPerson,
  type MappedElvantoRecord,
  type ChildCheckRole,
} from "@/lib/elvanto";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/integrations/elvanto/import?dryRun=(true|false)
 *
 * Multipart form data:
 *   - file: an Elvanto CSV export (.csv text file)        [mutually exclusive with `json`]
 *   - json: a pasted Elvanto JSON blob (single record or array)
 *
 * dryRun=true (default): parse + map + match-preview ONLY. Returns a summary
 *   of what WOULD happen: totalPeople, newPeople, matchedPeople, families
 *   with their members + per-member action ("create" | "match"), and any
 *   per-row errors. NO DB writes.
 *
 * dryRun=false: in a single Prisma `$transaction`, create/update Person +
 *   Family + FamilyMember rows. Match adults by email (if email present)
 *   else by firstName+lastName (case-insensitive). Match children by
 *   firstName+lastName+dateOfBirth. On match: UPDATE non-empty fields only
 *   (don't overwrite existing data with blanks). On no match: CREATE.
 *   Group rows by Elvanto Family ID into a single Family (created if new,
 *   re-used if any of its members matched an existing Family via that
 *   person's existing memberships).
 *
 *   AuditLog `elvanto.import` with counts. Atomic — any error rolls the
 *   whole batch back.
 *
 * Requires Admin or PeopleManager (manage_people permission).
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, "manage_people")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRunParam = url.searchParams.get("dryRun");
  const dryRun = dryRunParam === null ? true : dryRunParam === "true";

  // Accept either multipart form (file or json field) or application/json.
  const contentType = req.headers.get("content-type") ?? "";
  let people: ElvantoPerson[];
  let parseWarnings: string[];
  let unmatchedColumns: string[];

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      const jsonField = form.get("json");
      if (file instanceof File) {
        const buf = Buffer.from(await file.arrayBuffer());
        const MAX_BYTES = 5 * 1024 * 1024;
        if (buf.length > MAX_BYTES) {
          return NextResponse.json(
            { error: `File too large: ${buf.length} bytes (max ${MAX_BYTES}).` },
            { status: 413 },
          );
        }
        const text = buf.toString("utf-8");
        const parsed = parseElvantoCsv(text);
        people = parsed.people;
        parseWarnings = parsed.parseWarnings;
        unmatchedColumns = parsed.unmatchedColumns;
      } else if (typeof jsonField === "string" && jsonField.trim()) {
        const parsed = parseElvantoJson(jsonField);
        people = parsed.people;
        parseWarnings = parsed.parseWarnings;
        unmatchedColumns = parsed.unmatchedColumns;
      } else {
        return NextResponse.json(
          { error: "Expected a `file` (CSV) or `json` field in the multipart form." },
          { status: 400 },
        );
      }
    } else if (contentType.includes("application/json")) {
      const text = await req.text();
      if (!text.trim()) {
        return NextResponse.json(
          { error: "Empty JSON body." },
          { status: 400 },
        );
      }
      const parsed = parseElvantoJson(text);
      people = parsed.people;
      parseWarnings = parsed.parseWarnings;
      unmatchedColumns = parsed.unmatchedColumns;
    } else {
      return NextResponse.json(
        { error: "Unsupported content-type. Use multipart/form-data or application/json." },
        { status: 400 },
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Parse error" },
      { status: 400 },
    );
  }

  // Validate + map each record. Reject rows with no firstName AND no lastName.
  const errors: { row: number; message: string }[] = [];
  const mapped: MappedElvantoRecord[] = [];

  people.forEach((ep, idx) => {
    const rowNumber = idx + 1; // 1-based for JSON; CSV is the same here.
    if (!ep.firstName && !ep.lastName) {
      errors.push({
        row: rowNumber,
        message: "Record has no First Name and no Last Name — at least one is required.",
      });
      return;
    }
    if (!ep.firstName) {
      errors.push({
        row: rowNumber,
        message: "First Name is required.",
      });
      return;
    }
    if (!ep.lastName) {
      errors.push({
        row: rowNumber,
        message: "Last Name is required.",
      });
      return;
    }
    mapped.push(mapElvantoToChildCheck(ep, rowNumber));
  });

  // Group by Elvanto Family ID. Null familyId → each row is its own group
  // (singleton), keyed by a synthetic "_solo_<idx>" so each gets its own
  // family IF it has adults; children without a family ID are still placed
  // in a synthetic family for preview purposes but the import path will
  // treat solo children as members of a family named after their surname.
  type FamilyGroup = {
    familyId: string | null;
    familyName: string | null;
    members: MappedElvantoRecord[];
  };
  const familyGroups: FamilyGroup[] = [];
  const groupByKey = (m: MappedElvantoRecord): string =>
    m.familyId ? `elv:${m.familyId}` : `_solo:${m.rowNumber}`;
  const groupMap = new Map<string, FamilyGroup>();
  for (const m of mapped) {
    const key = groupByKey(m);
    const existing = groupMap.get(key);
    if (existing) {
      existing.members.push(m);
      // Prefer a non-null familyName from any member.
      if (!existing.familyName && m.familyName) {
        existing.familyName = m.familyName;
      }
    } else {
      groupMap.set(key, {
        familyId: m.familyId,
        familyName: m.familyName,
        members: [m],
      });
    }
  }
  for (const g of groupMap.values()) familyGroups.push(g);

  if (dryRun) {
    return await buildDryRunPreview(
      familyGroups,
      mapped,
      errors,
      parseWarnings,
      unmatchedColumns,
    );
  }

  // Real import — HARD STOP if any validation errors.
  if (errors.length > 0) {
    return NextResponse.json(
      {
        error: "Import aborted: one or more rows failed validation. No rows were written.",
        errors,
      },
      { status: 400 },
    );
  }
  if (mapped.length === 0) {
    return NextResponse.json(
      { error: "No valid Elvanto records to import." },
      { status: 400 },
    );
  }

  try {
    const result = await runImportTransaction(mapped, familyGroups, user.id);
    await logAudit({
      actorUserId: user.id,
      action: "elvanto.import",
      entity: "Person",
      details: {
        dryRun: false,
        totalPeople: result.totalPeople,
        imported: result.imported,
        updated: result.updated,
        familiesCreated: result.familiesCreated,
        familiesMatched: result.familiesMatched,
        errors: result.errors.length,
      },
    });
    return NextResponse.json({
      dryRun: false,
      ...result,
      parseWarnings,
      unmatchedColumns,
    });
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

// ---------------------------------------------------------------------------
// Dry-run preview
// ---------------------------------------------------------------------------

interface DryRunMemberPreview {
  row: number;
  firstName: string;
  lastName: string;
  email: string | null;
  role: ChildCheckRole;
  personType: string;
  action: "create" | "match";
  /** Existing person id if action=match. */
  matchedPersonId?: string;
  /** Match reason: "email" | "name" | "name+dob". */
  matchReason?: string;
}

interface DryRunFamilyPreview {
  familyId: string | null;
  familyName: string;
  members: DryRunMemberPreview[];
}

interface DryRunResponse {
  dryRun: true;
  totalPeople: number;
  newPeople: number;
  matchedPeople: number;
  families: DryRunFamilyPreview[];
  errors: { row: number; message: string }[];
  parseWarnings: string[];
  unmatchedColumns: string[];
}

async function buildDryRunPreview(
  familyGroups: { familyId: string | null; familyName: string | null; members: MappedElvantoRecord[] }[],
  mapped: MappedElvantoRecord[],
  errors: { row: number; message: string }[],
  parseWarnings: string[],
  unmatchedColumns: string[],
): Promise<NextResponse> {
  // For each mapped record, check if it would match an existing person.
  const memberPreviews: DryRunMemberPreview[] = [];
  let newPeople = 0;
  let matchedPeople = 0;

  for (const m of mapped) {
    const existing = await findExistingPerson(m.person, m.familyRole);
    if (existing) {
      matchedPeople += 1;
      memberPreviews.push({
        row: m.rowNumber,
        firstName: m.person.firstName,
        lastName: m.person.lastName,
        email: m.person.email,
        role: m.familyRole,
        personType: m.person.personType,
        action: "match",
        matchedPersonId: existing.id,
        matchReason: existing.matchReason,
      });
    } else {
      newPeople += 1;
      memberPreviews.push({
        row: m.rowNumber,
        firstName: m.person.firstName,
        lastName: m.person.lastName,
        email: m.person.email,
        role: m.familyRole,
        personType: m.person.personType,
        action: "create",
      });
    }
  }

  // Group member previews by family group.
  const families: DryRunFamilyPreview[] = familyGroups.map((g) => {
    const memberRows = new Set(g.members.map((m) => m.rowNumber));
    const members = memberPreviews.filter((mp) => memberRows.has(mp.row));
    const familyName =
      g.familyName ??
      deriveFamilyNameFromMembers(g.members) ??
      "Unnamed family";
    return {
      familyId: g.familyId,
      familyName,
      members,
    };
  });

  const body: DryRunResponse = {
    dryRun: true,
    totalPeople: mapped.length,
    newPeople,
    matchedPeople,
    families,
    errors,
    parseWarnings,
    unmatchedColumns,
  };
  return NextResponse.json(body);
}

// ---------------------------------------------------------------------------
// Real import — transactional, idempotent
// ---------------------------------------------------------------------------

interface ImportResult {
  totalPeople: number;
  imported: number; // newly created Persons
  updated: number;  // existing Persons updated
  familiesCreated: number;
  familiesMatched: number;
  errors: { row: number; message: string }[];
}

/**
 * Run the real import in a single Prisma `$transaction`. Atomic — any
 * throw rolls the whole batch back.
 *
 * Strategy:
 *   1. For each mapped record, find the existing Person (by email for
 *      adults, by firstName+lastName+dob for children). If found, update
 *      non-empty fields only.
 *   2. Group rows by Elvanto Family ID. For each group:
 *        a. If any member matched an existing Person who is already in a
 *           Family, reuse that Family (the first such membership we find).
 *        b. Otherwise, create a new Family row (using the Elvanto Family
 *           Name or the surname of the head of household).
 *        c. For each member, ensure a FamilyMember row exists
 *           (insert if missing — `@@unique([familyId, personId])` prevents
 *           duplicates; we use upsert).
 */
async function runImportTransaction(
  mapped: MappedElvantoRecord[],
  familyGroups: { familyId: string | null; familyName: string | null; members: MappedElvantoRecord[] }[],
  actorUserId: string,
): Promise<ImportResult> {
  return await db.$transaction(async (tx) => {
    let imported = 0;
    let updated = 0;
    let familiesCreated = 0;
    let familiesMatched = 0;
    const errors: { row: number; message: string }[] = [];

    // Pass 1: resolve/create each Person. Build a map rowNumber → personId.
    const personByRow = new Map<number, { id: string; existed: boolean }>();

    for (const m of mapped) {
      const existing = await findExistingPersonTx(tx, m.person, m.familyRole);
      if (existing) {
        // Update non-empty fields only.
        const updateData: Record<string, unknown> = {};
        const p = m.person;
        if (p.email && !existing.email) updateData.email = p.email;
        if (p.phone && !existing.phone) updateData.phone = p.phone;
        if (p.dateOfBirth && !existing.dateOfBirth) updateData.dateOfBirth = p.dateOfBirth;
        if (p.schoolGrade && !existing.schoolGrade) updateData.schoolGrade = p.schoolGrade;
        if (p.gender && !existing.gender) updateData.gender = p.gender;
        if (p.allergies && !existing.allergies) updateData.allergies = p.allergies;
        if (p.medicalNotes && !existing.medicalNotes) updateData.medicalNotes = p.medicalNotes;
        if (p.dietaryNotes && !existing.dietaryNotes) updateData.dietaryNotes = p.dietaryNotes;
        if (
          p.emergencyContactName &&
          !existing.emergencyContactName
        ) {
          updateData.emergencyContactName = p.emergencyContactName;
        }
        if (
          p.emergencyContactPhone &&
          !existing.emergencyContactPhone
        ) {
          updateData.emergencyContactPhone = p.emergencyContactPhone;
        }
        if (p.preferredName && !existing.preferredName) {
          updateData.preferredName = p.preferredName;
        }
        if (p.middleName && !existing.middleName) {
          updateData.middleName = p.middleName;
        }
        // firstName / lastName are not overwritten (they're the match key).
        if (p.isVisitor && !existing.isVisitor) updateData.isVisitor = true;

        if (Object.keys(updateData).length > 0) {
          await tx.person.update({
            where: { id: existing.id },
            data: updateData,
          });
        }
        // Count any matched record as "updated" — the import touched it
        // (matched it against an existing row + re-attached it to a family
        // if needed). This makes the idempotency story clear: re-importing
        // the same file yields imported:0, updated:N (no duplicates).
        updated += 1;
        personByRow.set(m.rowNumber, { id: existing.id, existed: true });
      } else {
        const created = await tx.person.create({
          data: {
            firstName: m.person.firstName,
            middleName: m.person.middleName,
            lastName: m.person.lastName,
            preferredName: m.person.preferredName,
            personType: m.person.personType,
            email: m.person.email,
            phone: m.person.phone,
            dateOfBirth: m.person.dateOfBirth,
            schoolGrade: m.person.schoolGrade,
            gender: m.person.gender,
            allergies: m.person.allergies,
            medicalNotes: m.person.medicalNotes,
            dietaryNotes: m.person.dietaryNotes,
            emergencyContactName: m.person.emergencyContactName,
            emergencyContactPhone: m.person.emergencyContactPhone,
            isVisitor: m.person.isVisitor,
            isActive: m.person.isActive,
            createdById: actorUserId,
          },
        });
        imported += 1;
        personByRow.set(m.rowNumber, { id: created.id, existed: false });
      }
    }

    // Pass 2: for each family group, find-or-create a Family + attach members.
    for (const g of familyGroups) {
      // Try to reuse an existing Family via any member's existing memberships.
      let familyId: string | null = null;
      for (const m of g.members) {
        const pRow = personByRow.get(m.rowNumber);
        if (!pRow) continue;
        const existingMembership = await tx.familyMember.findFirst({
          where: { personId: pRow.id },
          select: { familyId: true },
        });
        if (existingMembership) {
          familyId = existingMembership.familyId;
          familiesMatched += 1;
          break;
        }
      }

      if (!familyId) {
        // Create a new Family.
        const familyName =
          g.familyName ?? deriveFamilyNameFromMembers(g.members) ?? "Family";
        const fam = await tx.family.create({
          data: {
            familyName,
            isActive: true,
            createdById: actorUserId,
          },
        });
        familyId = fam.id;
        familiesCreated += 1;
      }

      // Attach each member (idempotent via @@unique([familyId, personId])).
      for (const m of g.members) {
        const pRow = personByRow.get(m.rowNumber);
        if (!pRow) {
          errors.push({
            row: m.rowNumber,
            message: "Internal: no Person resolved for this row.",
          });
          continue;
        }
        await tx.familyMember.upsert({
          where: {
            familyId_personId: {
              familyId,
              personId: pRow.id,
            },
          },
          update: {
            // Update role if the Elvanto record specifies a different one.
            role: m.familyRole,
          },
          create: {
            familyId,
            personId: pRow.id,
            role: m.familyRole,
          },
        });
      }
    }

    return {
      totalPeople: mapped.length,
      imported,
      updated,
      familiesCreated,
      familiesMatched,
      errors,
    };
  });
}

// ---------------------------------------------------------------------------
// Match helpers
// ---------------------------------------------------------------------------

interface ExistingPersonMatch {
  id: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: Date | null;
  schoolGrade: string | null;
  gender: string | null;
  allergies: string | null;
  medicalNotes: string | null;
  dietaryNotes: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  preferredName: string | null;
  middleName: string | null;
  isVisitor: boolean;
}

/**
 * Find an existing Person matching the given NewPerson, using the
 * idempotency rules:
 *   - Adults (personType "Adult" or role != "Child"): match by email if
 *     email present, else by firstName+lastName (case-insensitive).
 *   - Children (personType "Child" or role == "Child"): match by
 *     firstName+lastName+dateOfBirth (if DOB present), else by
 *     firstName+lastName.
 *
 * Returns null if no match.
 */
async function findExistingPerson(
  person: { firstName: string; lastName: string; email: string | null; dateOfBirth: Date | null; personType: string },
  role: ChildCheckRole,
): Promise<{ id: string; matchReason: string } | null> {
  const isChild = person.personType === "Child" || role === "Child";

  if (!isChild && person.email) {
    const m = await db.person.findFirst({
      where: { email: { equals: person.email } },
      select: { id: true },
    });
    if (m) return { id: m.id, matchReason: "email" };
  }

  if (isChild && person.dateOfBirth) {
    const m = await db.person.findFirst({
      where: {
        firstName: { equals: person.firstName },
        lastName: { equals: person.lastName },
        dateOfBirth: { equals: person.dateOfBirth },
      },
      select: { id: true },
    });
    if (m) return { id: m.id, matchReason: "name+dob" };
  }

  // Fall back to name match (case-insensitive — SQLite's default).
  const m = await db.person.findFirst({
    where: {
      firstName: { equals: person.firstName },
      lastName: { equals: person.lastName },
    },
    select: { id: true },
  });
  if (m) return { id: m.id, matchReason: "name" };

  return null;
}

/** Same as `findExistingPerson` but inside a transaction. */
async function findExistingPersonTx(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  person: { firstName: string; lastName: string; email: string | null; dateOfBirth: Date | null; personType: string },
  role: ChildCheckRole,
): Promise<ExistingPersonMatch | null> {
  const isChild = person.personType === "Child" || role === "Child";

  if (!isChild && person.email) {
    const m = await tx.person.findFirst({
      where: { email: { equals: person.email } },
    });
    if (m) return m as ExistingPersonMatch;
  }

  if (isChild && person.dateOfBirth) {
    const m = await tx.person.findFirst({
      where: {
        firstName: { equals: person.firstName },
        lastName: { equals: person.lastName },
        dateOfBirth: { equals: person.dateOfBirth },
      },
    });
    if (m) return m as ExistingPersonMatch;
  }

  const m = await tx.person.findFirst({
    where: {
      firstName: { equals: person.firstName },
      lastName: { equals: person.lastName },
    },
  });
  if (m) return m as ExistingPersonMatch;

  return null;
}

/**
 * Derive a family name from a group of members: use the surname of the
 * first PrimaryCarer, else the surname of the first Adult, else the
 * surname of the first member.
 */
function deriveFamilyNameFromMembers(
  members: MappedElvantoRecord[],
): string | null {
  if (members.length === 0) return null;
  const carer =
    members.find((m) => m.familyRole === "PrimaryCarer") ??
    members.find((m) => m.person.personType === "Adult") ??
    members[0];
  return carer.person.lastName || null;
}
