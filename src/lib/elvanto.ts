/**
 * Elvanto ↔ ChildCheck connector — field mapping + parsing helpers.
 *
 * Elvanto is a church management system. Its people/family exports are
 * typically CSV (or JSON via its REST API). This module:
 *
 *   - Defines `ElvantoPerson` (the intermediate shape for an Elvanto record).
 *   - Documents the column-name → ChildCheck-field mapping (with common
 *     spelling variants accepted, e.g. "First Name" / "Firstname" /
 *     "first_name").
 *   - Parses an Elvanto CSV export into `ElvantoPerson[]` using the
 *     RFC-4180 parser in `src/lib/csv-parse.ts`.
 *   - Maps an `ElvantoPerson` to the ChildCheck `NewPerson` + family-role
 *     shape used by the import API.
 *   - Reverses the mapping for the export-back-to-Elvanto flow
 *     (`toElvantoCsvRow`).
 *
 * Design notes
 * ------------
 * ChildCheck does NOT store a street address on Person (deliberate data
 * minimisation for child safety). Elvanto's Address/Suburb/State/Postcode
 * columns are accepted on import (for round-trip friendliness) but are NOT
 * persisted — they're documented + ignored. The reverse mapping therefore
 * emits empty address fields.
 *
 * Elvanto "Family Role" values vary; we collapse the common ones:
 *   "Head of Household" | "Head" | "Spouse" | "Primary Carer" | "Adult"
 *       → ChildCheck FamilyMember.role = "PrimaryCarer"
 *   "Child" | "Dependant" | "Minor"
 *       → ChildCheck FamilyMember.role = "Child"
 *   "Other" | "Visitor" | "Guest" | "" (blank)
 *       → ChildCheck FamilyMember.role = "EmergencyContact" (default)
 *
 * `AuthorisedGuardian` is a valid ChildCheck role but Elvanto has no direct
 * equivalent; admins can re-assign via the family-detail UI post-import.
 */

import { parseCsv, pick, type CsvParseResult } from "@/lib/csv-parse";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Intermediate shape for one Elvanto record (post-parse, pre-mapping).
 *
 * All fields nullable: Elvanto exports vary wildly in which columns are
 * present and populated. `familyId` is the Elvanto-side Family ID used to
 * group rows into a family; if absent we treat the row as a singleton.
 */
export interface ElvantoPerson {
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  email: string | null;
  mobile: string | null;
  birthday: string | null; // raw — may be YYYY-MM-DD, DD/MM/YYYY, etc.
  gender: string | null;
  familyId: string | null;
  familyName: string | null;
  familyRole: string | null;
  schoolGrade: string | null;
  maritalStatus: string | null;
  medicalInfo: string | null;
  allergies: string | null;
  // Address fields — accepted but NOT persisted (child-safety data minimisation).
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
  photoUrl: string | null;
  createdDate: string | null;
}

/** ChildCheck-side role enum (mirrors the Prisma FamilyMember.role values). */
export type ChildCheckRole =
  | "PrimaryCarer"
  | "Child"
  | "AuthorisedGuardian"
  | "EmergencyContact";

/** ChildCheck-side person type. */
export type ChildCheckPersonType = "Adult" | "Child";

/** ChildCheck-side gender. */
export type ChildCheckGender = "Male" | "Female" | "Other";

/**
 * The mapped ChildCheck shape used by the import API.
 *
 * `familyName` is set if the Elvanto record carries one (or derived from the
 * head of household's surname downstream). `familyRole` is always present
 * (defaults to "EmergencyContact").
 */
export interface NewPerson {
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

export interface MappedElvantoRecord {
  person: NewPerson;
  familyName: string | null;
  familyRole: ChildCheckRole;
  /** The Elvanto Family ID this row belongs to (null = singleton). */
  familyId: string | null;
  /** Original row index in the source CSV/JSON (1-based, header = 0). */
  rowNumber: number;
}

// ---------------------------------------------------------------------------
// Field mapping table
// ---------------------------------------------------------------------------

/**
 * Documented mapping from Elvanto CSV column names → ChildCheck fields.
 *
 * Each entry lists every accepted column-name variant (case-insensitive,
 * space/underscore-insensitive on parse). The first listed is the canonical
 * Elvanto name (used when emitting CSV on export).
 */
export const ELVANTO_FIELD_MAP = [
  {
    childCheckField: "firstName",
    canonical: "First Name",
    variants: ["First Name", "Firstname", "First_Name", "GivenName", "Given Name"],
  },
  {
    childCheckField: "middleName",
    canonical: "Middle Name",
    variants: ["Middle Name", "MiddleName", "Middle_Name", "Middlename", "Middle Initial", "MI"],
  },
  {
    childCheckField: "lastName",
    canonical: "Last Name",
    variants: ["Last Name", "Lastname", "Last_Name", "Surname", "Family Name"],
  },
  {
    childCheckField: "email",
    canonical: "Email",
    variants: ["Email", "EmailAddress", "Email Address"],
  },
  {
    childCheckField: "phone",
    canonical: "Mobile",
    variants: ["Mobile", "Phone", "Mobile Phone", "MobilePhone", "Phone Number"],
  },
  {
    childCheckField: "dateOfBirth",
    canonical: "Birthday",
    variants: ["Birthday", "DOB", "Date of Birth", "DateOfBirth", "Birthdate"],
  },
  {
    childCheckField: "gender",
    canonical: "Gender",
    variants: ["Gender", "Sex"],
  },
  {
    childCheckField: "familyId",
    canonical: "Family ID",
    variants: ["Family ID", "FamilyID", "Family_Id", "Family Id", "Household ID"],
  },
  {
    childCheckField: "familyName",
    canonical: "Family Name",
    variants: ["Family Name", "FamilyName", "Surname (Family)", "Household Name"],
  },
  {
    childCheckField: "familyRole",
    canonical: "Family Role",
    variants: ["Family Role", "FamilyRole", "Role", "Family Position"],
  },
  {
    childCheckField: "schoolGrade",
    canonical: "School Grade",
    variants: ["School Grade", "SchoolGrade", "Grade", "Year Level"],
  },
  {
    childCheckField: "medicalNotes",
    canonical: "Medical Info",
    variants: ["Medical Info", "MedicalInformation", "Medical Information", "Medical Notes"],
  },
  {
    childCheckField: "allergies",
    canonical: "Allergies",
    variants: ["Allergies", "Allergy", "Allergy Info"],
  },
  {
    childCheckField: "maritalStatus",
    canonical: "Marital Status",
    variants: ["Marital Status", "MaritalStatus"],
  },
  {
    childCheckField: "address",
    canonical: "Address",
    variants: ["Address", "Street", "Street Address"],
  },
  {
    childCheckField: "suburb",
    canonical: "Suburb",
    variants: ["Suburb", "City", "Locality"],
  },
  {
    childCheckField: "state",
    canonical: "State",
    variants: ["State", "Province", "Region"],
  },
  {
    childCheckField: "postcode",
    canonical: "Postcode",
    variants: ["Postcode", "Postal Code", "PostalCode", "Zip", "ZIP", "Zip Code"],
  },
  {
    childCheckField: "country",
    canonical: "Country",
    variants: ["Country"],
  },
  {
    childCheckField: "photoUrl",
    canonical: "Photo URL",
    variants: ["Photo URL", "PhotoUrl", "Photo", "Avatar", "Picture"],
  },
  {
    childCheckField: "createdDate",
    canonical: "Created Date",
    variants: ["Created Date", "CreatedDate", "Date Created"],
  },
] as const;

// ---------------------------------------------------------------------------
// Column-name normalisation helper
// ---------------------------------------------------------------------------

/**
 * Normalise a column name for matching: lowercase + collapse spaces /
 * underscores / hyphens to a single space + trim. e.g.
 *   "First Name" → "first name"
 *   "first_name" → "first name"
 *   "First-Name" → "first name"
 *   "FirstName"  → "firstname"   (no separator → stays one word)
 */
export function normaliseColumn(name: string): string {
  return name
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build a lookup from every variant of every Elvanto field (normalised) to
 * the canonical ChildCheck field key. Case + separator insensitive.
 *
 * Used by `parseElvantoCsv` to map a CSV header row to canonical keys
 * regardless of which spelling the export used.
 */
export function buildElvantoColumnIndex(): Record<string, string> {
  const idx: Record<string, string> = {};
  for (const entry of ELVANTO_FIELD_MAP) {
    for (const v of entry.variants) {
      idx[normaliseColumn(v)] = entry.childCheckField;
    }
  }
  return idx;
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

/**
 * Result of parsing an Elvanto CSV — mirrors `CsvParseResult` but exposes
 * the typed `ElvantoPerson[]` (one per data row) + warnings + the list of
 * column headers that couldn't be matched to any known field (informational).
 */
export interface ElvantoParseResult {
  people: ElvantoPerson[];
  /** Elvanto column headers as found in the source (original spelling). */
  headerColumns: string[];
  /**
   * Source columns that didn't match any known Elvanto field name. These
   * are silently ignored on import (e.g. "Marital Status" is read but not
   * persisted; an unknown "Custom Field 1" is dropped here). Surfaced in
   * the dry-run preview for transparency.
   */
  unmatchedColumns: string[];
  parseWarnings: string[];
}

/**
 * Parse an Elvanto CSV text blob into `ElvantoPerson[]`.
 *
 * Uses the RFC-4180 parser from `src/lib/csv-parse.ts`, then maps each row's
 * raw values into the typed `ElvantoPerson` shape using the column-name
 * variant index. Missing columns are returned as null.
 */
export function parseElvantoCsv(csvText: string): ElvantoParseResult {
  let parsed: CsvParseResult;
  try {
    parsed = parseCsv(csvText);
  } catch (err) {
    // Re-throw with a friendly message; the import API catches this.
    throw new Error(
      `Elvanto CSV parse error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (parsed.fields.length === 0) {
    return {
      people: [],
      headerColumns: [],
      unmatchedColumns: [],
      parseWarnings: ["CSV file was empty (no header row)."],
    };
  }

  const idx = buildElvantoColumnIndex();
  // For each header column, compute its canonical ChildCheck key (or null).
  const headerKeys: (string | null)[] = parsed.fields.map((f) => {
    const norm = normaliseColumn(f);
    return idx[norm] ?? null;
  });

  const headerColumns = parsed.fields.slice();
  const unmatchedColumns = parsed.fields
    .filter((_f, i) => headerKeys[i] === null)
    .slice();

  const people: ElvantoPerson[] = parsed.rows.map((rawRow) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < headerKeys.length; i++) {
      const k = headerKeys[i];
      if (!k) continue;
      obj[k] = (rawRow[i] ?? "").trim();
    }
    return elvantoPersonFromObject(obj);
  });

  return {
    people,
    headerColumns,
    unmatchedColumns,
    parseWarnings: parsed.warnings,
  };
}

/**
 * Convert a flat `Record<string,string>` (column key → raw value) into an
 * `ElvantoPerson` with nullable fields + trimmed values. Used by the CSV
 * parser AND the JSON importer (which accepts the same keys).
 */
export function elvantoPersonFromObject(
  obj: Record<string, string>,
): ElvantoPerson {
  const get = (k: string): string | null => {
    const v = obj[k];
    if (v === undefined) return null;
    const s = v.trim();
    return s.length === 0 ? null : s;
  };
  return {
    firstName: get("firstName"),
    middleName: get("middleName"),
    lastName: get("lastName"),
    email: get("email"),
    mobile: get("phone"),
    birthday: get("dateOfBirth"),
    gender: get("gender"),
    familyId: get("familyId"),
    familyName: get("familyName"),
    familyRole: get("familyRole"),
    schoolGrade: get("schoolGrade"),
    maritalStatus: get("maritalStatus"),
    medicalInfo: get("medicalNotes"),
    allergies: get("allergies"),
    address: get("address"),
    suburb: get("suburb"),
    state: get("state"),
    postcode: get("postcode"),
    country: get("country"),
    photoUrl: get("photoUrl"),
    createdDate: get("createdDate"),
  };
}

// ---------------------------------------------------------------------------
// JSON parsing (for the paste-JSON import path)
// ---------------------------------------------------------------------------

/**
 * Normalise the keys of an arbitrary JSON record into the canonical
 * ElvantoPerson field names. Accepts both camelCase ("firstName") and the
 * human forms ("First Name", "First_Name").
 *
 * Returns null if the record is not a non-null object.
 */
export function normaliseElvantoJsonRecord(
  raw: unknown,
): Record<string, string> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const idx = buildElvantoColumnIndex();
  const out: Record<string, string> = {};
  const src = raw as Record<string, unknown>;
  for (const [k, v] of Object.entries(src)) {
    const norm = normaliseColumn(k);
    const canonical = idx[norm];
    if (!canonical) continue;
    if (v === null || v === undefined) continue;
    const s = typeof v === "string" ? v : String(v);
    out[canonical] = s;
  }
  return out;
}

/**
 * Parse a pasted JSON blob (string) into `ElvantoPerson[]`. Accepts either
 * a single record object or an array of records.
 *
 * Throws on hard JSON syntax errors. Records that aren't objects are
 * skipped (with a warning pushed into `parseWarnings`).
 */
export function parseElvantoJson(jsonText: string): ElvantoParseResult {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `Elvanto JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const arr: unknown[] = Array.isArray(data) ? data : [data];
  const people: ElvantoPerson[] = [];
  const warnings: string[] = [];

  arr.forEach((rec, i) => {
    const obj = normaliseElvantoJsonRecord(rec);
    if (obj === null) {
      warnings.push(
        `Record ${i + 1} is not a JSON object — skipped.`,
      );
      return;
    }
    people.push(elvantoPersonFromObject(obj));
  });

  return {
    people,
    headerColumns: [],
    unmatchedColumns: [],
    parseWarnings: warnings,
  };
}

// ---------------------------------------------------------------------------
// Elvanto → ChildCheck mapping
// ---------------------------------------------------------------------------

/**
 * Elvanto Family Role → ChildCheck FamilyMember.role.
 *
 *   "Head of Household" | "Head" | "Spouse" | "Primary Carer" | "Adult"
 *       → "PrimaryCarer"
 *   "Child" | "Dependant" | "Minor"
 *       → "Child"
 *   "Other" | "Visitor" | "Guest" | "" (blank)
 *       → "EmergencyContact" (default)
 *   "Authorised Guardian" | "Guardian" (rare in Elvanto but supported)
 *       → "AuthorisedGuardian"
 */
export function mapFamilyRole(role: string | null): ChildCheckRole {
  const r = (role ?? "").trim().toLowerCase();
  if (!r) return "EmergencyContact";
  if (
    r === "head of household" ||
    r === "head" ||
    r === "spouse" ||
    r === "primary carer" ||
    r === "primarycarer" ||
    r === "adult" ||
    r === "parent"
  ) {
    return "PrimaryCarer";
  }
  if (r === "child" || r === "dependant" || r === "dependent" || r === "minor") {
    return "Child";
  }
  if (r === "authorised guardian" || r === "authorisedguardian" || r === "guardian") {
    return "AuthorisedGuardian";
  }
  if (r === "emergency contact" || r === "emergencycontact") {
    return "EmergencyContact";
  }
  // Default: anything we don't recognise becomes EmergencyContact (the
  // least-permissioned ChildCheck role).
  return "EmergencyContact";
}

/**
 * Infer a ChildCheck person type (Adult/Child) from an Elvanto record.
 *
 * - If the family role maps to "Child" → personType "Child".
 * - Else if a date-of-birth is present and the person is < 18 years old → "Child".
 * - Else → "Adult".
 */
export function inferPersonType(
  dob: Date | null,
  role: ChildCheckRole,
): ChildCheckPersonType {
  if (role === "Child") return "Child";
  if (dob) {
    const age = ageYears(dob);
    if (age !== null && age < 18) return "Child";
  }
  return "Adult";
}

/** Compute whole-year age from a DOB; null on invalid date. */
export function ageYears(dob: Date | null): number | null {
  if (!dob || Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age >= 0 ? age : null;
}

/**
 * Parse a date string from Elvanto. Accepts:
 *   - YYYY-MM-DD
 *   - YYYY-MM-DDTHH:MM:SS...
 *   - DD/MM/YYYY  or  D/M/YYYY  (Australian/UK convention; Elvanto default for AU)
 *   - MM/DD/YYYY  (US convention; tried last)
 *
 * Returns null for blank or unparseable values.
 */
export function parseElvantoDate(raw: string | null): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  // ISO-style first (YYYY-MM-DD or YYYY/MM/DD or full ISO datetime).
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(.*)$/;
  const isoM = iso.exec(s);
  if (isoM) {
    const y = parseInt(isoM[1], 10);
    const mo = parseInt(isoM[2], 10) - 1;
    const d = parseInt(isoM[3], 10);
    const dt = new Date(Date.UTC(y, mo, d));
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  // DD/MM/YYYY or MM/DD/YYYY — try DD/MM first (Elvanto AU default).
  const dmy = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/;
  const dmyM = dmy.exec(s);
  if (dmyM) {
    const a = parseInt(dmyM[1], 10);
    const b = parseInt(dmyM[2], 10);
    const y = parseInt(dmyM[3], 10);
    // If a > 12 it must be DD/MM. If b > 12 it must be MM/DD. If both <= 12,
    // assume DD/MM (AU/UK convention — Elvanto's default for AU orgs).
    if (a > 12) {
      const dt = new Date(Date.UTC(y, b - 1, a));
      if (!Number.isNaN(dt.getTime())) return dt;
    } else if (b > 12) {
      const dt = new Date(Date.UTC(y, a - 1, b));
      if (!Number.isNaN(dt.getTime())) return dt;
    } else {
      const dt = new Date(Date.UTC(y, b - 1, a));
      if (!Number.isNaN(dt.getTime())) return dt;
    }
  }

  // Last-ditch: let JS Date try (handles "Jan 5 2018" etc.).
  const fallback = new Date(s);
  if (!Number.isNaN(fallback.getTime())) return fallback;
  return null;
}

/**
 * Map an Elvanto record to the ChildCheck `NewPerson` + family-role shape.
 *
 * Side effects: none. Pure function.
 *
 * Notes:
 *   - The `medicalInfo` Elvanto field is split: any value containing the
 *     word "allerg" (case-insensitive) is appended to `allergies` rather
 *     than `medicalNotes` (best-effort separation). Everything else goes
 *     to `medicalNotes`.
 *   - `maritalStatus` is read but not stored (ChildCheck has no field).
 *   - Address fields are accepted but not stored (child-safety minimisation).
 *   - `isVisitor` is set to true if the Elvanto family role is "Visitor"
 *     or "Guest", or if `maritalStatus` is "Visitor" (rare). Otherwise false.
 */
export function mapElvantoToChildCheck(
  ep: ElvantoPerson,
  rowNumber: number = 0,
): MappedElvantoRecord {
  const role = mapFamilyRole(ep.familyRole);
  const dob = parseElvantoDate(ep.birthday);
  const personType = inferPersonType(dob, role);

  // Split medicalInfo: allergy-ish content goes to allergies, rest to medicalNotes.
  let allergies = ep.allergies ?? null;
  let medicalNotes = ep.medicalInfo ?? null;
  if (ep.medicalInfo) {
    const lower = ep.medicalInfo.toLowerCase();
    if (lower.includes("allerg")) {
      // Move to allergies (append if allergies already set).
      allergies = allergies
        ? `${allergies}; ${ep.medicalInfo}`
        : ep.medicalInfo;
      medicalNotes = null;
    }
  }

  // isVisitor heuristic: visitor/guest role or maritalStatus === "Visitor".
  const roleLower = (ep.familyRole ?? "").toLowerCase();
  const maritalLower = (ep.maritalStatus ?? "").toLowerCase();
  const isVisitor =
    roleLower === "visitor" ||
    roleLower === "guest" ||
    maritalLower === "visitor";

  // Gender mapping (case-insensitive).
  let gender: ChildCheckGender | null = null;
  if (ep.gender) {
    const g = ep.gender.toLowerCase();
    if (g === "male" || g === "m") gender = "Male";
    else if (g === "female" || g === "f") gender = "Female";
    else gender = "Other";
  }

  const person: NewPerson = {
    firstName: ep.firstName ?? "",
    middleName: ep.middleName ?? null,
    lastName: ep.lastName ?? "",
    preferredName: null,
    email: ep.email ?? null,
    phone: ep.mobile ?? null,
    dateOfBirth: dob,
    schoolGrade: ep.schoolGrade ?? null,
    gender,
    allergies,
    medicalNotes,
    dietaryNotes: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    personType,
    isVisitor,
    isActive: true,
  };

  return {
    person,
    familyName: ep.familyName ?? null,
    familyRole: role,
    familyId: ep.familyId ?? null,
    rowNumber,
  };
}

// ---------------------------------------------------------------------------
// ChildCheck → Elvanto (export) mapping
// ---------------------------------------------------------------------------

/**
 * Reverse-map a ChildCheck Person + their FamilyMember role into an
 * `ElvantoPerson` (for the export-to-Elvanto CSV).
 *
 * `familyId` is the ChildCheck Family.id (Elvanto will treat them as new
 * families on re-import, which is fine for a one-way push).
 * `familyName` is the ChildCheck Family.familyName.
 */
export function toElvantoCsvRow(input: {
  person: {
    firstName: string;
    middleName?: string | null;
    lastName: string;
    email: string | null;
    phone: string | null;
    dateOfBirth: Date | null;
    gender: string | null;
    schoolGrade: string | null;
    allergies: string | null;
    medicalNotes: string | null;
  };
  familyId: string | null;
  familyName: string | null;
  familyRole: ChildCheckRole;
}): ElvantoPerson {
  const { person: p, familyId, familyName, familyRole } = input;

  // Reverse-map role.
  let elvantoRole = "Other";
  if (familyRole === "PrimaryCarer") elvantoRole = "Head of Household";
  else if (familyRole === "Child") elvantoRole = "Child";
  else if (familyRole === "AuthorisedGuardian") elvantoRole = "Other";
  else if (familyRole === "EmergencyContact") elvantoRole = "Other";

  return {
    firstName: p.firstName || null,
    middleName: p.middleName ?? null,
    lastName: p.lastName || null,
    email: p.email ?? null,
    mobile: p.phone ?? null,
    birthday: p.dateOfBirth ? isoDay(p.dateOfBirth) : null,
    gender: (p.gender as string | null) ?? null,
    familyId,
    familyName,
    familyRole: elvantoRole,
    schoolGrade: p.schoolGrade ?? null,
    maritalStatus: null,
    medicalInfo: p.medicalNotes ?? null,
    allergies: p.allergies ?? null,
    address: null, // ChildCheck doesn't store address.
    suburb: null,
    state: null,
    postcode: null,
    country: null,
    photoUrl: null,
    createdDate: null,
  };
}

/** Format a Date as YYYY-MM-DD (UTC, for stable cross-tz CSV output). */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// CSV column ordering for the export-back-to-Elvanto flow
// ---------------------------------------------------------------------------

/**
 * The canonical column order for an Elvanto-format CSV emitted by the
 * ChildCheck export. Matches the "typical Elvanto CSV export" header set
 * described in the docs.
 */
export const ELVANTO_EXPORT_COLUMNS = [
  "First Name",
  "Middle Name",
  "Last Name",
  "Email",
  "Mobile",
  "Birthday",
  "Gender",
  "Family ID",
  "Family Name",
  "Family Role",
  "School Grade",
  "Medical Info",
  "Allergies",
] as const;

/**
 * Render an `ElvantoPerson` as an array of string values in the order
 * defined by `ELVANTO_EXPORT_COLUMNS`. Empty fields become "" (per RFC 4180).
 */
export function elvantoRowToArray(ep: ElvantoPerson): string[] {
  return ELVANTO_EXPORT_COLUMNS.map((col) => {
    switch (col) {
      case "First Name": return ep.firstName ?? "";
      case "Middle Name": return ep.middleName ?? "";
      case "Last Name": return ep.lastName ?? "";
      case "Email": return ep.email ?? "";
      case "Mobile": return ep.mobile ?? "";
      case "Birthday": return ep.birthday ?? "";
      case "Gender": return ep.gender ?? "";
      case "Family ID": return ep.familyId ?? "";
      case "Family Name": return ep.familyName ?? "";
      case "Family Role": return ep.familyRole ?? "";
      case "School Grade": return ep.schoolGrade ?? "";
      case "Medical Info": return ep.medicalInfo ?? "";
      case "Allergies": return ep.allergies ?? "";
      default: return "";
    }
  });
}
