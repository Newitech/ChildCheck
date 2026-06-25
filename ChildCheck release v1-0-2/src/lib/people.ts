import { db } from "@/lib/db";

/**
 * Shared serialization helpers for the People & Families domain (Stage 3).
 *
 * Critical security note:
 *   - LIST responses MUST strip medical/allergy fields (per Stage 3 spec).
 *     Only DETAIL responses expose them, and only to roles with view_people.
 *   - Photo bytes are NEVER returned inline — only a `hasPhoto: boolean` flag
 *     in list/detail, with photos served by a separate GET route.
 */

export interface PersonListDTO {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  personType: string;
  email: string | null;
  phone: string | null;
  isVisitor: boolean;
  isActive: boolean;
  hasPhoto: boolean;
  familyCount: number;
  ageInfo: { ageYears: number; dateOfBirth: string | null } | null;
  wwccStatusSummary: string | null;
}

export interface FamilyMembershipDTO {
  familyId: string;
  familyName: string;
  role: string;
}

export interface WwccCardDTO {
  id: string;
  cardType: string;
  jurisdiction: string | null;
  cardNumber: string | null;
  status: string;
  issuedAt: string | null;
  expiresAt: string | null;
  verifiedAt: string | null;
  notes: string | null;
}

export interface PersonDetailDTO {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  personType: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  schoolGrade: string | null;
  gender: string | null;
  // Sensitive — only returned to callers with view_people (enforced in route).
  allergies: string | null;
  medicalNotes: string | null;
  dietaryNotes: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  photoPath: string | null;
  hasPhoto: boolean;
  isVisitor: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  hasUser: boolean;
  familyMemberships: FamilyMembershipDTO[];
  wwccCards: WwccCardDTO[];
}

const MEDICAL_FIELDS = [
  "allergies",
  "medicalNotes",
  "dietaryNotes",
  "emergencyContactName",
  "emergencyContactPhone",
] as const;

function ageYears(dob: Date | null): number | null {
  if (!dob) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age >= 0 ? age : null;
}

/**
 * Summarise a person's WWCC card statuses into a single short string for the
 * list view. Returns null if they have no cards.
 *
 * Priority: Verified (most recent) > Pending > Expired > Cancelled.
 */
export function summariseWwcc(cards: { status: string }[]): string | null {
  if (cards.length === 0) return null;
  const has = (s: string) => cards.some((c) => c.status === s);
  if (has("Verified")) return "Verified";
  if (has("Pending")) return "Pending";
  if (has("Expired")) return "Expired";
  if (has("Cancelled")) return "Cancelled";
  return "Pending";
}

/**
 * Build a LIST-safe Person DTO. Strips every medical field.
 * `wwccEnabled` controls whether WWCC summary is computed.
 */
export async function toPersonListDTO(
  person: {
    id: string;
    firstName: string;
    lastName: string;
    preferredName: string | null;
    personType: string;
    email: string | null;
    phone: string | null;
    dateOfBirth: Date | null;
    photoPath: string | null;
    isVisitor: boolean;
    isActive: boolean;
    familyMemberships?: unknown[];
    wwccards?: { status: string }[];
  },
  wwccEnabled: boolean,
): Promise<PersonListDTO> {
  const age = person.personType === "Child" ? ageYears(person.dateOfBirth) : null;
  return {
    id: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
    preferredName: person.preferredName,
    personType: person.personType,
    email: person.email,
    phone: person.phone,
    isVisitor: person.isVisitor,
    isActive: person.isActive,
    hasPhoto: !!person.photoPath,
    familyCount: person.familyMemberships?.length ?? 0,
    ageInfo:
      person.personType === "Child"
        ? { ageYears: age ?? 0, dateOfBirth: person.dateOfBirth ? person.dateOfBirth.toISOString() : null }
        : null,
    wwccStatusSummary: wwccEnabled
      ? summariseWwcc(person.wwccards ?? [])
      : null,
  };
}

/** Build a DETAIL Person DTO. Includes medical fields — caller MUST gate. */
export async function toPersonDetailDTO(
  person: {
    id: string;
    firstName: string;
    lastName: string;
    preferredName: string | null;
    personType: string;
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
    photoPath: string | null;
    isVisitor: boolean;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    user?: { id: string } | null;
    familyMemberships?: {
      id: string;
      role: string;
      family: { id: string; familyName: string };
    }[];
    wwccards?: {
      id: string;
      cardType: string;
      jurisdiction: string | null;
      cardNumber: string | null;
      status: string;
      issuedAt: Date | null;
      expiresAt: Date | null;
      verifiedAt: Date | null;
      notes: string | null;
    }[];
  },
  wwccEnabled: boolean,
): Promise<PersonDetailDTO> {
  return {
    id: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
    preferredName: person.preferredName,
    personType: person.personType,
    email: person.email,
    phone: person.phone,
    dateOfBirth: person.dateOfBirth ? person.dateOfBirth.toISOString() : null,
    schoolGrade: person.schoolGrade,
    gender: person.gender,
    allergies: person.allergies,
    medicalNotes: person.medicalNotes,
    dietaryNotes: person.dietaryNotes,
    emergencyContactName: person.emergencyContactName,
    emergencyContactPhone: person.emergencyContactPhone,
    photoPath: person.photoPath,
    hasPhoto: !!person.photoPath,
    isVisitor: person.isVisitor,
    isActive: person.isActive,
    createdAt: person.createdAt.toISOString(),
    updatedAt: person.updatedAt.toISOString(),
    hasUser: !!person.user,
    familyMemberships: (person.familyMemberships ?? []).map((m) => ({
      familyId: m.family.id,
      familyName: m.family.familyName,
      role: m.role,
    })),
    wwccCards: wwccEnabled
      ? (person.wwccards ?? []).map((c) => ({
          id: c.id,
          cardType: c.cardType,
          jurisdiction: c.jurisdiction,
          cardNumber: c.cardNumber,
          status: c.status,
          issuedAt: c.issuedAt ? c.issuedAt.toISOString() : null,
          expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
          verifiedAt: c.verifiedAt ? c.verifiedAt.toISOString() : null,
          notes: c.notes,
        }))
      : [],
  };
}

/** Convenience: load a person by id with all relations needed for detail. */
export async function loadPersonDetail(id: string, wwccEnabled: boolean) {
  return db.person.findUnique({
    where: { id },
    include: {
      user: { select: { id: true } },
      familyMemberships: { include: { family: { select: { id: true, familyName: true } } } },
      ...(wwccEnabled ? { wwccards: true } : {}),
    },
  });
}

/** Type alias for the medical field list so other modules can reuse. */
export type MedicalField = (typeof MEDICAL_FIELDS)[number];
export const MEDICAL_FIELD_LIST = MEDICAL_FIELDS;
