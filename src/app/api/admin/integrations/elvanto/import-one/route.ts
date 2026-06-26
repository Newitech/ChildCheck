import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  parseElvantoDate,
  mapFamilyRole,
  inferPersonType,
  type ChildCheckGender,
  type ChildCheckPersonType,
  type ChildCheckRole,
} from "@/lib/elvanto";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/integrations/elvanto/import-one?dryRun=(true|false)
 *
 * Body: a single Elvanto record (JSON object with Elvanto field names —
 * case + separator insensitive). Recognised keys include:
 *   First Name, Last Name, Email, Mobile, Birthday, Gender, Family ID,
 *   Family Name, Family Role, School Grade, Medical Info, Allergies,
 *   Marital Status, Address, Suburb, State, Postcode, Country.
 *
 * dryRun=true (default): map + preview ONLY. Returns what WOULD happen.
 *   NO DB writes.
 *
 * dryRun=false: create/match the Person (same idempotency rules as the
 *   bulk import — adults by email, children by name+DOB) + attach to a
 *   family (existing if matched, else created). Atomic — wrapped in a
 *   single `$transaction`.
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const parsed = parseSingleRecord(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const mapped = parsed.mapped;
  // Validation: firstName + lastName required.
  if (!mapped.firstName) {
    return NextResponse.json(
      { error: "First Name is required." },
      { status: 400 },
    );
  }
  if (!mapped.lastName) {
    return NextResponse.json(
      { error: "Last Name is required." },
      { status: 400 },
    );
  }

  const role = mapFamilyRole(mapped.familyRole ?? null);
  const dob = parseElvantoDate(mapped.birthday);
  const personType = inferPersonType(dob, role);

  // Gender mapping.
  let gender: ChildCheckGender | null = null;
  if (mapped.gender) {
    const g = mapped.gender.toLowerCase();
    if (g === "male" || g === "m") gender = "Male";
    else if (g === "female" || g === "f") gender = "Female";
    else gender = "Other";
  }

  // Allergies / medical split (mirror of the bulk mapper).
  let allergies = mapped.allergies ?? null;
  let medicalNotes = mapped.medicalInfo ?? null;
  if (mapped.medicalInfo) {
    const lower = mapped.medicalInfo.toLowerCase();
    if (lower.includes("allerg")) {
      allergies = allergies
        ? `${allergies}; ${mapped.medicalInfo}`
        : mapped.medicalInfo;
      medicalNotes = null;
    }
  }

  const isVisitor =
    (mapped.familyRole ?? "").toLowerCase() === "visitor" ||
    (mapped.familyRole ?? "").toLowerCase() === "guest" ||
    (mapped.maritalStatus ?? "").toLowerCase() === "visitor";

  const personInput = {
    firstName: mapped.firstName,
    middleName: mapped.middleName || null,
    lastName: mapped.lastName,
    preferredName: null as string | null,
    email: mapped.email ?? null,
    phone: mapped.mobile ?? null,
    dateOfBirth: dob,
    schoolGrade: mapped.schoolGrade ?? null,
    gender,
    allergies,
    medicalNotes,
    dietaryNotes: null as string | null,
    emergencyContactName: null as string | null,
    emergencyContactPhone: null as string | null,
    personType: personType as ChildCheckPersonType,
    isVisitor,
    isActive: true,
  };

  const familyName = mapped.familyName ?? mapped.lastName;
  const familyIdElvanto = mapped.familyId ?? null;

  if (dryRun) {
    // Preview: find existing person + existing family-by-membership.
    const existing = await findExistingPerson(personInput, role);
    let existingFamilyId: string | null = null;
    if (existing) {
      const membership = await db.familyMember.findFirst({
        where: { personId: existing.id },
        select: { familyId: true, family: { select: { familyName: true } } },
      });
      existingFamilyId = membership?.familyId ?? null;
    }
    return NextResponse.json({
      dryRun: true,
      person: {
        ...personInput,
        dateOfBirth: personInput.dateOfBirth
          ? personInput.dateOfBirth.toISOString()
          : null,
      },
      familyRole: role,
      familyName,
      familyIdElvanto,
      action: existing ? "match" : "create",
      matchedPersonId: existing?.id ?? null,
      matchReason: existing?.matchReason ?? null,
      existingFamilyId,
    });
  }

  // Real import.
  try {
    const result = await runSingleImport(
      personInput,
      role,
      familyName,
      user.id,
    );
    await logAudit({
      actorUserId: user.id,
      action: "elvanto.importOne",
      entity: "Person",
      entityId: result.personId,
      details: {
        dryRun: false,
        action: result.action,
        familyId: result.familyId,
        familyCreated: result.familyCreated,
        familyRole: role,
      },
    });
    return NextResponse.json({
      dryRun: false,
      ...result,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Import failed — rolled back.",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

interface ParsedSingle {
  firstName: string;
  middleName: string;
  lastName: string;
  email: string;
  mobile: string;
  birthday: string;
  gender: string;
  familyId: string;
  familyName: string;
  familyRole: string;
  schoolGrade: string;
  maritalStatus: string;
  medicalInfo: string;
  allergies: string;
  address: string;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
}

/** Build the column-name lookup (mirrors the bulk import). */
function buildColumnIndex(): Record<string, keyof ParsedSingle> {
  const table: [string[], keyof ParsedSingle][] = [
    [["first name", "firstname", "first_name", "givenname", "given name"], "firstName"],
    [["middle name", "middlename", "middle_name", "middle initial", "mi"], "middleName"],
    [["last name", "lastname", "last_name", "surname", "family name"], "lastName"],
    [["email", "emailaddress", "email address"], "email"],
    [["mobile", "phone", "mobile phone", "mobilephone", "phone number"], "mobile"],
    [["birthday", "dob", "date of birth", "dateofbirth", "birthdate"], "birthday"],
    [["gender", "sex"], "gender"],
    [["family id", "familyid", "family_id", "family id", "household id"], "familyId"],
    [["family name", "familyname", "surname (family)", "household name"], "familyName"],
    [["family role", "familyrole", "role", "family position"], "familyRole"],
    [["school grade", "schoolgrade", "grade", "year level"], "schoolGrade"],
    [["marital status", "maritalstatus"], "maritalStatus"],
    [["medical info", "medicalinformation", "medical information", "medical notes"], "medicalInfo"],
    [["allergies", "allergy", "allergy info"], "allergies"],
    [["address", "street", "street address"], "address"],
    [["suburb", "city", "locality"], "suburb"],
    [["state", "province", "region"], "state"],
    [["postcode", "postal code", "postalcode", "zip", "zip code"], "postcode"],
    [["country"], "country"],
  ];
  const out: Record<string, keyof ParsedSingle> = {};
  for (const [variants, key] of table) {
    for (const v of variants) out[v] = key;
  }
  return out;
}

function normaliseKey(k: string): string {
  return k.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Parse + validate a single JSON record into a ParsedSingle shape. */
function parseSingleRecord(
  raw: unknown,
): { mapped: ParsedSingle } | { error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { error: "Body must be a JSON object (single Elvanto record)." };
  }
  const src = raw as Record<string, unknown>;
  const idx = buildColumnIndex();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) {
    const norm = normaliseKey(k);
    const key = idx[norm];
    if (!key) continue;
    if (v === null || v === undefined) continue;
    out[key] = typeof v === "string" ? v.trim() : String(v);
  }
  const get = (k: keyof ParsedSingle): string => out[k] ?? "";
  return {
    mapped: {
      firstName: get("firstName"),
      middleName: get("middleName"),
      lastName: get("lastName"),
      email: get("email"),
      mobile: get("mobile"),
      birthday: get("birthday"),
      gender: get("gender"),
      familyId: get("familyId"),
      familyName: get("familyName"),
      familyRole: get("familyRole"),
      schoolGrade: get("schoolGrade"),
      maritalStatus: get("maritalStatus"),
      medicalInfo: get("medicalInfo"),
      allergies: get("allergies"),
      address: get("address"),
      suburb: get("suburb"),
      state: get("state"),
      postcode: get("postcode"),
      country: get("country"),
    },
  };
}

// ---------------------------------------------------------------------------
// Match helpers (mirror the bulk import)
// ---------------------------------------------------------------------------

interface NewPersonInput {
  firstName: string;
  middleName: string | null;
  lastName: string;
  preferredName: string | null;
  email: string | null;
  phone: string | null;
  dateOfBirth: Date | null;
  schoolGrade: string | null;
  gender: ChildCheckGender | null;
  allergies: string | null;
  medicalNotes: string | null;
  dietaryNotes: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  personType: ChildCheckPersonType;
  isVisitor: boolean;
  isActive: boolean;
}

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

// ---------------------------------------------------------------------------
// Real single import (transactional)
// ---------------------------------------------------------------------------

interface SingleImportResult {
  personId: string;
  action: "create" | "match";
  familyId: string;
  familyCreated: boolean;
  familyRole: ChildCheckRole;
}

async function runSingleImport(
  personInput: NewPersonInput,
  role: ChildCheckRole,
  familyName: string,
  actorUserId: string,
): Promise<SingleImportResult> {
  return await db.$transaction(async (tx) => {
    // 1. Match-or-create the Person.
    const existing = await findExistingPersonTx(tx, personInput, role);
    let personId: string;
    let action: "create" | "match";
    if (existing) {
      const updateData: Record<string, unknown> = {};
      const p = personInput;
      if (p.email && !existing.email) updateData.email = p.email;
      if (p.phone && !existing.phone) updateData.phone = p.phone;
      if (p.dateOfBirth && !existing.dateOfBirth) updateData.dateOfBirth = p.dateOfBirth;
      if (p.schoolGrade && !existing.schoolGrade) updateData.schoolGrade = p.schoolGrade;
      if (p.gender && !existing.gender) updateData.gender = p.gender;
      if (p.allergies && !existing.allergies) updateData.allergies = p.allergies;
      if (p.medicalNotes && !existing.medicalNotes) updateData.medicalNotes = p.medicalNotes;
      if (p.dietaryNotes && !existing.dietaryNotes) updateData.dietaryNotes = p.dietaryNotes;
      if (p.emergencyContactName && !existing.emergencyContactName) {
        updateData.emergencyContactName = p.emergencyContactName;
      }
      if (p.emergencyContactPhone && !existing.emergencyContactPhone) {
        updateData.emergencyContactPhone = p.emergencyContactPhone;
      }
      if (p.preferredName && !existing.preferredName) {
        updateData.preferredName = p.preferredName;
      }
      if (p.middleName && !existing.middleName) {
        updateData.middleName = p.middleName;
      }
      if (p.isVisitor && !existing.isVisitor) updateData.isVisitor = true;
      if (Object.keys(updateData).length > 0) {
        await tx.person.update({ where: { id: existing.id }, data: updateData });
      }
      personId = existing.id;
      // Count any matched record as "match" (idempotency). Whether or not
      // fields actually changed is not surfaced separately — the user just
      // needs to know the record was matched rather than created.
      action = "match";
    } else {
      const created = await tx.person.create({
        data: {
          firstName: personInput.firstName,
          middleName: personInput.middleName,
          lastName: personInput.lastName,
          preferredName: personInput.preferredName,
          personType: personInput.personType,
          email: personInput.email,
          phone: personInput.phone,
          dateOfBirth: personInput.dateOfBirth,
          schoolGrade: personInput.schoolGrade,
          gender: personInput.gender,
          allergies: personInput.allergies,
          medicalNotes: personInput.medicalNotes,
          dietaryNotes: personInput.dietaryNotes,
          emergencyContactName: personInput.emergencyContactName,
          emergencyContactPhone: personInput.emergencyContactPhone,
          isVisitor: personInput.isVisitor,
          isActive: personInput.isActive,
          createdById: actorUserId,
        },
      });
      personId = created.id;
      action = "create";
    }

    // 2. Find-or-create the Family.
    let familyId: string | null = null;
    let familyCreated = false;
    const existingMembership = await tx.familyMember.findFirst({
      where: { personId },
      select: { familyId: true },
    });
    if (existingMembership) {
      familyId = existingMembership.familyId;
    } else {
      const fam = await tx.family.create({
        data: {
          familyName,
          isActive: true,
          createdById: actorUserId,
        },
      });
      familyId = fam.id;
      familyCreated = true;
    }

    // 3. Attach as a family member (idempotent).
    await tx.familyMember.upsert({
      where: {
        familyId_personId: {
          familyId,
          personId,
        },
      },
      update: { role },
      create: { familyId, personId, role },
    });

    return {
      personId,
      action,
      familyId,
      familyCreated,
      familyRole: role,
    };
  });
}

interface ExistingPersonRow {
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

async function findExistingPersonTx(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  person: { firstName: string; lastName: string; email: string | null; dateOfBirth: Date | null; personType: string },
  role: ChildCheckRole,
): Promise<ExistingPersonRow | null> {
  const isChild = person.personType === "Child" || role === "Child";

  if (!isChild && person.email) {
    const m = await tx.person.findFirst({
      where: { email: { equals: person.email } },
    });
    if (m) return m as ExistingPersonRow;
  }
  if (isChild && person.dateOfBirth) {
    const m = await tx.person.findFirst({
      where: {
        firstName: { equals: person.firstName },
        lastName: { equals: person.lastName },
        dateOfBirth: { equals: person.dateOfBirth },
      },
    });
    if (m) return m as ExistingPersonRow;
  }
  const m = await tx.person.findFirst({
    where: {
      firstName: { equals: person.firstName },
      lastName: { equals: person.lastName },
    },
  });
  if (m) return m as ExistingPersonRow;
  return null;
}
