/**
 * Stage 12 — shared import/export column definitions + validators.
 *
 * Both the import API (`/api/admin/import`) and the export API
 * (`/api/admin/export`) and the template generator (`/api/admin/import/template`)
 * share these column lists so a file exported by `export` round-trips through
 * `import` cleanly.
 *
 * Column names are lowercase, snake-case — matches the convention used by the
 * Person schema fields directly (no mapping needed in the common case).
 */

import { db } from "@/lib/db";
import { parseCsv, rowMapper, pick } from "@/lib/csv-parse";

// ---------------------------------------------------------------------------
// People — column definitions
// ---------------------------------------------------------------------------

export interface PersonColumn {
  /** Canonical lowercase key (matches Person schema field where possible). */
  key: string;
  /** Header text in the exported CSV / template. */
  header: string;
  required: boolean;
  /** A short description used by the UI to render column docs. */
  description: string;
}

export const PERSON_COLUMNS: PersonColumn[] = [
  { key: "id", header: "id", required: false, description: "Existing Person id (cuid). Leave blank on new imports." },
  { key: "firstname", header: "firstName", required: true, description: "Person's given name." },
  { key: "middlename", header: "middleName", required: false, description: "Optional middle name or initial (free text)." },
  { key: "lastname", header: "lastName", required: true, description: "Person's family/surname." },
  { key: "preferredname", header: "preferredName", required: false, description: "Optional preferred/chosen name." },
  { key: "persontype", header: "personType", required: true, description: "\"Adult\" or \"Child\"." },
  { key: "email", header: "email", required: false, description: "Email address (adult primarily)." },
  { key: "phone", header: "phone", required: false, description: "Phone number (adult primarily)." },
  { key: "dateofbirth", header: "dateOfBirth", required: false, description: "ISO date (YYYY-MM-DD). Children primarily." },
  { key: "gender", header: "gender", required: false, description: "\"Male\" | \"Female\" | \"Other\"." },
  { key: "schoolgrade", header: "schoolGrade", required: false, description: "Free-text grade / year level." },
  { key: "isvisitor", header: "isVisitor", required: false, description: "\"true\" or \"false\". Defaults false." },
  { key: "isactive", header: "isActive", required: false, description: "\"true\" or \"false\". Defaults true." },
  { key: "allergies", header: "allergies", required: false, description: "Free-text allergies (children primarily)." },
  { key: "medicalnotes", header: "medicalNotes", required: false, description: "Free-text medical notes." },
  { key: "dietarynotes", header: "dietaryNotes", required: false, description: "Free-text dietary notes." },
  { key: "emergencycontactname", header: "emergencyContactName", required: false, description: "Emergency contact name." },
  { key: "emergencycontactphone", header: "emergencyContactPhone", required: false, description: "Emergency contact phone." },
];

export const PERSON_REQUIRED_HEADERS = PERSON_COLUMNS.filter((c) => c.required).map((c) => c.header);

// ---------------------------------------------------------------------------
// Families — column definitions
// ---------------------------------------------------------------------------

/**
 * Families CSV format:
 *   - `familyName` (required)
 *   - `notes` (optional)
 *   - `isActive` (optional, default true)
 *   - `members` (required) — a single cell containing one or more member
 *     descriptors separated by `;`. Each descriptor is `Name|role|DOB` where:
 *       * Name  = "First Last" (a space-separated full name)
 *       * role  = "PrimaryCarer" | "Child" | "AuthorisedGuardian" | "EmergencyContact"
 *       * DOB   = ISO YYYY-MM-DD (optional, mainly for children)
 *     Example: `John Smith|PrimaryCarer;Mary Smith|Child|2017-03-12`
 *   - `primaryCarerEmail` (optional) — if set, an existing Person with this
 *     email is looked up and attached as a PrimaryCarer member instead of
 *     creating a new Person row.
 *
 * Either `members` or `primaryCarerEmail` must be present.
 */
export const FAMILY_COLUMNS: PersonColumn[] = [
  { key: "id", header: "id", required: false, description: "Existing Family id (cuid). Leave blank on new imports." },
  { key: "familyname", header: "familyName", required: true, description: "Family / household surname." },
  { key: "notes", header: "notes", required: false, description: "Free-text notes." },
  { key: "isactive", header: "isActive", required: false, description: "\"true\" or \"false\". Defaults true." },
  { key: "primarycareremail", header: "primaryCarerEmail", required: false, description: "Email of an existing Person to attach as PrimaryCarer." },
  { key: "members", header: "members", required: false, description: "Semicolon-separated 'Name|role|DOB' entries. See the import docs." },
];

export const FAMILY_REQUIRED_HEADERS = FAMILY_COLUMNS.filter((c) => c.required).map((c) => c.header);

// ---------------------------------------------------------------------------
// People — validation + DTO
// ---------------------------------------------------------------------------

export type PersonType = "Adult" | "Child";
export type Gender = "Male" | "Female" | "Other";

export interface PersonRowValidationError {
  row: number;
  field: string | null;
  message: string;
}

export interface PersonImportRow {
  row: number;
  firstName: string;
  middleName: string | null;
  lastName: string;
  preferredName: string | null;
  personType: PersonType;
  email: string | null;
  phone: string | null;
  dateOfBirth: Date | null;
  gender: Gender | null;
  schoolGrade: string | null;
  isVisitor: boolean;
  isActive: boolean;
  allergies: string | null;
  medicalNotes: string | null;
  dietaryNotes: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  id: string | null;
}

const GENDER_VALUES = new Set<Gender>(["Male", "Female", "Other"]);
const PERSONTYPE_VALUES = new Set<PersonType>(["Adult", "Child"]);

function parseBool(v: string, fallback: boolean): boolean {
  const s = v.trim().toLowerCase();
  if (s === "") return fallback;
  if (s === "true" || s === "1" || s === "yes" || s === "y") return true;
  if (s === "false" || s === "0" || s === "no" || s === "n") return false;
  return fallback;
}

function nullIfEmpty(v: string): string | null {
  const s = v.trim();
  return s.length === 0 ? null : s;
}

function parseISODate(v: string): Date | null {
  const s = v.trim();
  if (!s) return null;
  // Accept YYYY-MM-DD or full ISO datetime. new Date handles both.
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Parse + validate a single people CSV row.
 * Returns `{ row, errors }` — `errors` is empty when the row is valid.
 */
export function parsePersonRow(
  row: Record<string, string>,
  rowNumber: number,
): { row: PersonImportRow | null; errors: PersonRowValidationError[] } {
  const errors: PersonRowValidationError[] = [];

  const firstName = pick(row, ["firstname", "first_name", "givenname"]).trim();
  const middleName = nullIfEmpty(pick(row, ["middlename", "middle_name", "middleinitial", "middle_initial"]));
  const lastName = pick(row, ["lastname", "last_name", "surname", "familyname"]).trim();

  if (!firstName) {
    errors.push({ row: rowNumber, field: "firstName", message: "firstName is required." });
  }
  if (!lastName) {
    errors.push({ row: rowNumber, field: "lastName", message: "lastName is required." });
  }

  const personTypeRaw = pick(row, ["persontype", "person_type"]).trim() || "Adult";
  const personTypeLower = personTypeRaw.toLowerCase();
  const personType: PersonType | null =
    personTypeLower === "adult" ? "Adult" :
    personTypeLower === "child" ? "Child" : null;
  if (personType === null) {
    errors.push({
      row: rowNumber,
      field: "personType",
      message: `personType must be "Adult" or "Child" (got "${personTypeRaw}").`,
    });
  }

  const genderRaw = pick(row, ["gender"]).trim();
  let gender: Gender | null = null;
  if (genderRaw) {
    const gl = genderRaw.toLowerCase();
    if (gl === "male") gender = "Male";
    else if (gl === "female") gender = "Female";
    else if (gl === "other") gender = "Other";
    if (!gender) {
      errors.push({
        row: rowNumber,
        field: "gender",
        message: `gender must be "Male", "Female", or "Other" (got "${genderRaw}").`,
      });
    }
  }

  const dobRaw = pick(row, ["dateofbirth", "dob", "date_of_birth"]).trim();
  let dateOfBirth: Date | null = null;
  if (dobRaw) {
    dateOfBirth = parseISODate(dobRaw);
    if (!dateOfBirth) {
      errors.push({
        row: rowNumber,
        field: "dateOfBirth",
        message: `dateOfBirth must be a valid ISO date (got "${dobRaw}").`,
      });
    }
  }

  const id = nullIfEmpty(pick(row, ["id"]));
  const email = nullIfEmpty(pick(row, ["email"]));
  const phone = nullIfEmpty(pick(row, ["phone"]));
  const preferredName = nullIfEmpty(pick(row, ["preferredname", "preferred_name"]));
  const schoolGrade = nullIfEmpty(pick(row, ["schoolgrade", "school_grade"]));
  const allergies = nullIfEmpty(pick(row, ["allergies"]));
  const medicalNotes = nullIfEmpty(pick(row, ["medicalnotes", "medical_notes"]));
  const dietaryNotes = nullIfEmpty(pick(row, ["dietarynotes", "dietary_notes"]));
  const emergencyContactName = nullIfEmpty(pick(row, ["emergencycontactname", "emergency_contact_name"]));
  const emergencyContactPhone = nullIfEmpty(pick(row, ["emergencycontactphone", "emergency_contact_phone"]));

  const isVisitor = parseBool(pick(row, ["isvisitor", "is_visitor"]), false);
  const isActive = parseBool(pick(row, ["isactive", "is_active"]), true);

  if (errors.length > 0) {
    return { row: null, errors };
  }

  return {
    row: {
      row: rowNumber,
      firstName,
      middleName,
      lastName,
      preferredName,
      personType,
      email,
      phone,
      dateOfBirth,
      gender,
      schoolGrade,
      isVisitor,
      isActive,
      allergies,
      medicalNotes,
      dietaryNotes,
      emergencyContactName,
      emergencyContactPhone,
      id,
    },
    errors,
  };
}

export interface ParsedPeopleImport {
  totalRows: number;
  valid: PersonImportRow[];
  errors: PersonRowValidationError[];
  /** First 10 rows for preview display (valid + invalid). */
  preview: {
    row: number;
    firstName: string;
    lastName: string;
    personType: string;
    email: string;
    valid: boolean;
  }[];
  parseWarnings: string[];
}

/**
 * Parse a CSV text blob as a People import.
 *
 * Performs header validation (all required columns present) then parses each
 * row, returning valid rows + per-row error details.
 */
export function parsePeopleCsv(text: string): ParsedPeopleImport {
  const parsed = parseCsv(text);
  if (parsed.fields.length === 0) {
    return {
      totalRows: 0,
      valid: [],
      errors: [{ row: 0, field: null, message: "CSV file is empty." }],
      preview: [],
      parseWarnings: [],
    };
  }

  // Header validation: ensure every required column is present (case-insensitive).
  const headerSet = new Set(parsed.fields.map((f) => f.toLowerCase()));
  const missing = PERSON_REQUIRED_HEADERS.filter((h) => !headerSet.has(h.toLowerCase()));
  if (missing.length > 0) {
    return {
      totalRows: 0,
      valid: [],
      errors: [
        {
          row: 0,
          field: null,
          message: `Missing required column(s): ${missing.join(", ")}.`,
        },
      ],
      preview: [],
      parseWarnings: parsed.warnings,
    };
  }

  const map = rowMapper(parsed.fields);
  const valid: PersonImportRow[] = [];
  const errors: PersonRowValidationError[] = [];
  const preview: ParsedPeopleImport["preview"] = [];

  parsed.rows.forEach((rawRow, idx) => {
    const rowNumber = idx + 2; // 1 = header, 2 = first data row.
    const obj = map(rawRow);
    const { row, errors: rowErrors } = parsePersonRow(obj, rowNumber);
    if (row) {
      valid.push(row);
      if (preview.length < 10) {
        preview.push({
          row: rowNumber,
          firstName: row.firstName,
          lastName: row.lastName,
          personType: row.personType,
          email: row.email ?? "",
          valid: true,
        });
      }
    } else {
      errors.push(...rowErrors);
      if (preview.length < 10) {
        preview.push({
          row: rowNumber,
          firstName: obj.firstname ?? "",
          lastName: obj.lastname ?? "",
          personType: obj.persontype ?? "",
          email: obj.email ?? "",
          valid: false,
        });
      }
    }
  });

  return {
    totalRows: parsed.rows.length,
    valid,
    errors,
    preview,
    parseWarnings: parsed.warnings,
  };
}

// ---------------------------------------------------------------------------
// Families — validation + DTO
// ---------------------------------------------------------------------------

export type FamilyRole = "PrimaryCarer" | "Child" | "AuthorisedGuardian" | "EmergencyContact";

const FAMILY_ROLES = new Set<FamilyRole>([
  "PrimaryCarer",
  "Child",
  "AuthorisedGuardian",
  "EmergencyContact",
]);

/** Lowercase-keyed lookup so role matching is case-insensitive. */
const FAMILY_ROLE_BY_LOWER: Record<string, FamilyRole> = {
  primarycarer: "PrimaryCarer",
  child: "Child",
  authorisedguardian: "AuthorisedGuardian",
  emergencycontact: "EmergencyContact",
};

export interface FamilyMemberSpec {
  firstName: string;
  lastName: string;
  role: FamilyRole;
  dateOfBirth: Date | null;
  /** Raw descriptor text (for error messages). */
  raw: string;
}

export interface FamilyImportRow {
  row: number;
  id: string | null;
  familyName: string;
  notes: string | null;
  isActive: boolean;
  primaryCarerEmail: string | null;
  members: FamilyMemberSpec[];
}

export interface ParsedFamiliesImport {
  totalRows: number;
  valid: FamilyImportRow[];
  errors: PersonRowValidationError[];
  preview: {
    row: number;
    familyName: string;
    memberCount: number;
    primaryCarerEmail: string;
    valid: boolean;
  }[];
  parseWarnings: string[];
}

/**
 * Parse a "Name|role|DOB" descriptor. `Name` is a "First Last" pair (split on
 * the first space). Returns null + an error message on failure.
 */
function parseMemberSpec(
  raw: string,
): { spec: FamilyMemberSpec | null; error: string | null } {
  const parts = raw.split("|").map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length < 2) {
    return { spec: null, error: `Member descriptor "${raw}" must be "Name|role[|DOB]".` };
  }
  const [namePart, rolePart, dobPart] = parts;
  const spaceIdx = namePart.indexOf(" ");
  let firstName: string;
  let lastName: string;
  if (spaceIdx === -1) {
    firstName = namePart;
    lastName = "";
  } else {
    firstName = namePart.slice(0, spaceIdx).trim();
    lastName = namePart.slice(spaceIdx + 1).trim();
  }
  if (!firstName) {
    return { spec: null, error: `Member descriptor "${raw}" is missing a name.` };
  }
  // Role: case-insensitive match against the canonical PascalCase set.
  const roleNorm = FAMILY_ROLE_BY_LOWER[rolePart.toLowerCase()];
  if (!roleNorm) {
    return {
      spec: null,
      error: `Unknown role "${rolePart}" in descriptor "${raw}". Expected one of: ${Array.from(FAMILY_ROLES).join(", ")}.`,
    };
  }
  const role = roleNorm;
  let dateOfBirth: Date | null = null;
  if (dobPart) {
    dateOfBirth = parseISODate(dobPart);
    if (!dateOfBirth) {
      return { spec: null, error: `Invalid date "${dobPart}" in descriptor "${raw}".` };
    }
  }
  return {
    spec: { firstName, lastName, role, dateOfBirth, raw },
    error: null,
  };
}

/**
 * Parse + validate a single families CSV row.
 */
export function parseFamilyRow(
  row: Record<string, string>,
  rowNumber: number,
): { row: FamilyImportRow | null; errors: PersonRowValidationError[] } {
  const errors: PersonRowValidationError[] = [];

  const familyName = pick(row, ["familyname", "family_name"]).trim();
  if (!familyName) {
    errors.push({ row: rowNumber, field: "familyName", message: "familyName is required." });
  }

  const primaryCarerEmail = nullIfEmpty(pick(row, ["primarycareremail", "primary_carer_email"]));
  const membersRaw = pick(row, ["members"]);

  const memberSpecs: FamilyMemberSpec[] = [];
  if (membersRaw.trim()) {
    const descs = membersRaw.split(";").map((d) => d.trim()).filter((d) => d.length > 0);
    for (const d of descs) {
      const { spec, error } = parseMemberSpec(d);
      if (spec) memberSpecs.push(spec);
      else if (error) errors.push({ row: rowNumber, field: "members", message: error });
    }
  }

  // Need at least one of: primaryCarerEmail or members.
  if (!primaryCarerEmail && memberSpecs.length === 0) {
    errors.push({
      row: rowNumber,
      field: "members",
      message: "Either `primaryCarerEmail` (existing person) or a `members` cell is required.",
    });
  }

  if (errors.length > 0) {
    return { row: null, errors };
  }

  return {
    row: {
      row: rowNumber,
      id: nullIfEmpty(pick(row, ["id"])),
      familyName,
      notes: nullIfEmpty(pick(row, ["notes"])),
      isActive: parseBool(pick(row, ["isactive", "is_active"]), true),
      primaryCarerEmail,
      members: memberSpecs,
    },
    errors,
  };
}

export function parseFamiliesCsv(text: string): ParsedFamiliesImport {
  const parsed = parseCsv(text);
  if (parsed.fields.length === 0) {
    return {
      totalRows: 0,
      valid: [],
      errors: [{ row: 0, field: null, message: "CSV file is empty." }],
      preview: [],
      parseWarnings: [],
    };
  }

  const headerSet = new Set(parsed.fields.map((f) => f.toLowerCase()));
  const missing = FAMILY_REQUIRED_HEADERS.filter((h) => !headerSet.has(h.toLowerCase()));
  if (missing.length > 0) {
    return {
      totalRows: 0,
      valid: [],
      errors: [
        {
          row: 0,
          field: null,
          message: `Missing required column(s): ${missing.join(", ")}.`,
        },
      ],
      preview: [],
      parseWarnings: parsed.warnings,
    };
  }

  const map = rowMapper(parsed.fields);
  const valid: FamilyImportRow[] = [];
  const errors: PersonRowValidationError[] = [];
  const preview: ParsedFamiliesImport["preview"] = [];

  parsed.rows.forEach((rawRow, idx) => {
    const rowNumber = idx + 2;
    const obj = map(rawRow);
    const { row, errors: rowErrors } = parseFamilyRow(obj, rowNumber);
    if (row) {
      valid.push(row);
      if (preview.length < 10) {
        preview.push({
          row: rowNumber,
          familyName: row.familyName,
          memberCount: row.members.length + (row.primaryCarerEmail ? 1 : 0),
          primaryCarerEmail: row.primaryCarerEmail ?? "",
          valid: true,
        });
      }
    } else {
      errors.push(...rowErrors);
      if (preview.length < 10) {
        preview.push({
          row: rowNumber,
          familyName: obj.familyname ?? obj.family_name ?? "",
          memberCount: 0,
          primaryCarerEmail: obj.primarycareremail ?? "",
          valid: false,
        });
      }
    }
  });

  return {
    totalRows: parsed.rows.length,
    valid,
    errors,
    preview,
    parseWarnings: parsed.warnings,
  };
}

// ---------------------------------------------------------------------------
// DB-writers — used by the import route's "real" path (non-dry-run).
// Wraps everything in a transaction so any error rolls the whole batch back.
// ---------------------------------------------------------------------------

/**
 * Insert a batch of People in a transaction. Returns the count created.
 *
 * Atomic: if ANY row fails (DB constraint, etc.) the entire batch rolls back
 * and the error is re-thrown to the caller.
 */
export async function insertPeopleBatch(
  rows: PersonImportRow[],
  actorUserId: string,
): Promise<{ imported: number; personIds: string[] }> {
  const result = await db.$transaction(async (tx) => {
    const personIds: string[] = [];
    for (const r of rows) {
      const created = await tx.person.create({
        data: {
          // Pass `id` only if it was provided AND doesn't already exist (else
          // let Prisma generate a fresh cuid). We don't try to upsert here —
          // imports are append-only; an id collision would roll the batch.
          ...(r.id ? { id: r.id } : {}),
          firstName: r.firstName,
          middleName: r.middleName,
          lastName: r.lastName,
          preferredName: r.preferredName,
          personType: r.personType,
          email: r.email,
          phone: r.phone,
          dateOfBirth: r.dateOfBirth,
          schoolGrade: r.schoolGrade,
          gender: r.gender,
          allergies: r.allergies,
          medicalNotes: r.medicalNotes,
          dietaryNotes: r.dietaryNotes,
          emergencyContactName: r.emergencyContactName,
          emergencyContactPhone: r.emergencyContactPhone,
          isVisitor: r.isVisitor,
          isActive: r.isActive,
          createdById: actorUserId,
        },
      });
      personIds.push(created.id);
    }
    return personIds;
  });
  return { imported: result.length, personIds: result };
}

/**
 * Insert a batch of Families (with their members) in a transaction.
 *
 * For each family row:
 *   - Create the Family row.
 *   - For `primaryCarerEmail`: look up an existing Person with that email.
 *     If found, attach as PrimaryCarer. If not found, ROLL THE WHOLE BATCH
 *     BACK (atomic) — surface a friendly error to the caller.
 *   - For each member spec in `members`: create a new Person row, then attach
 *     as a FamilyMember with the spec's role.
 *
 * Returns the count of families created (and the count of members created).
 */
export async function insertFamiliesBatch(
  rows: FamilyImportRow[],
  actorUserId: string,
): Promise<{ imported: number; familyIds: string[]; membersCreated: number }> {
  const result = await db.$transaction(async (tx) => {
    const familyIds: string[] = [];
    let membersCreated = 0;

    for (const r of rows) {
      const family = await tx.family.create({
        data: {
          ...(r.id ? { id: r.id } : {}),
          familyName: r.familyName,
          notes: r.notes,
          isActive: r.isActive,
          createdById: actorUserId,
        },
      });
      familyIds.push(family.id);

      // Attach existing primary carer by email (if provided).
      if (r.primaryCarerEmail) {
        const carer = await tx.person.findFirst({
          where: { email: { equals: r.primaryCarerEmail } },
          select: { id: true },
        });
        if (!carer) {
          throw new Error(
            `Row ${r.row}: no Person found with email "${r.primaryCarerEmail}".`,
          );
        }
        await tx.familyMember.create({
          data: {
            familyId: family.id,
            personId: carer.id,
            role: "PrimaryCarer",
          },
        });
        membersCreated += 1;
      }

      // Create + attach each member spec.
      for (const m of r.members) {
        const person = await tx.person.create({
          data: {
            firstName: m.firstName,
            lastName: m.lastName,
            personType: m.role === "Child" ? "Child" : "Adult",
            dateOfBirth: m.dateOfBirth,
            createdById: actorUserId,
          },
        });
        await tx.familyMember.create({
          data: {
            familyId: family.id,
            personId: person.id,
            role: m.role,
          },
        });
        membersCreated += 1;
      }
    }
    return { familyIds, membersCreated };
  });
  return {
    imported: result.familyIds.length,
    familyIds: result.familyIds,
    membersCreated: result.membersCreated,
  };
}
