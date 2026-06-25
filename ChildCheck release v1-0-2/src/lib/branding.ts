import { db } from "@/lib/db";

/**
 * Branding & terminology layer.
 *
 * The whole app is "terminology-aware" so the same binary can serve an SDA
 * church ("Sabbath School"), a Sunday church ("Sunday School"), Scouts
 * ("Unit"), a childcare centre ("Room"), etc. — all driven by Organisation
 * config in the Admin Dashboard.
 *
 * Because the DB may not exist yet (first run), everything here degrades
 * gracefully to sensible SDA-defaults.
 */

export const DEFAULT_TERMINOLOGY: Terminology = {
  // Program defaults — SDA terminology, overridable per org.
  program_sabbath_school: "Sabbath School",
  program_pathfinders: "Pathfinders",
  program_adventurers: "Adventurers",
  program_community_childcare: "Community Childcare",
  // Generic terms
  group: "Class",
  group_plural: "Classes",
  room: "Room",
  room_plural: "Rooms",
  carer: "Primary Carer",
  carer_plural: "Primary Carers",
  guardian: "Authorised Guardian",
  guardian_plural: "Authorised Guardians",
  child: "Child",
  child_plural: "Children",
  family: "Family",
  family_plural: "Families",
  volunteer: "Volunteer",
  volunteer_plural: "Volunteers",
  event: "Event",
  event_plural: "Events",
  organisation: "Organisation",
};

export const DEFAULT_BRANDING: Branding = {
  appName: "ChildCheck",
  tagline: "Secure Child Check-In & Check-Out",
  primaryColor: "#0f9d8a", // emerald
  accentColor: "#e8a33d", // amber
  logoUrl: null,
};

export interface Terminology {
  program_sabbath_school: string;
  program_pathfinders: string;
  program_adventurers: string;
  program_community_childcare: string;
  group: string;
  group_plural: string;
  room: string;
  room_plural: string;
  carer: string;
  carer_plural: string;
  guardian: string;
  guardian_plural: string;
  child: string;
  child_plural: string;
  family: string;
  family_plural: string;
  volunteer: string;
  volunteer_plural: string;
  event: string;
  event_plural: string;
  organisation: string;
  [key: string]: string;
}

export interface Branding {
  appName: string;
  tagline: string;
  primaryColor: string;
  accentColor: string;
  logoUrl: string | null;
}

export interface OrgConfig {
  branding: Branding;
  terminology: Terminology;
  /** Organisation-type profile key (see lib/org-profiles.ts ORG_PROFILES). */
  orgType: string;
  /** JS getDay() index of the first day of the week (0=Sun,1=Mon,6=Sat).
   *  SDA default = 0 (Sunday-first; Saturday = 7th-day Sabbath). See src/lib/week.ts. */
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** Daily check-out code length (default 3). */
  dailyCodeLength: number;
  /** Daily check-out code character set: "alphanumeric" | "numeric". */
  dailyCodeCharset: "alphanumeric" | "numeric";
}

let cache: { config: OrgConfig | null; at: number } = { config: null, at: 0 };
const TTL = 5000;

/**
 * Load the organisation config from the DB. Returns defaults if the DB or
 * Organisation row doesn't exist yet (first-run scenario).
 */
export async function getOrgConfig(): Promise<OrgConfig> {
  const now = Date.now();
  if (cache.config && now - cache.at < TTL) return cache.config;

  try {
    const org = await db.organisation.findFirst();
    if (org) {
      const config: OrgConfig = {
        branding: {
          appName: org.appName || DEFAULT_BRANDING.appName,
          tagline: org.tagline || DEFAULT_BRANDING.tagline,
          primaryColor: org.primaryColor || DEFAULT_BRANDING.primaryColor,
          accentColor: org.accentColor || DEFAULT_BRANDING.accentColor,
          logoUrl: org.logoUrl,
        },
        terminology: { ...DEFAULT_TERMINOLOGY, ...(org.terminology ? safeParse(org.terminology) : {}) },
        orgType: org.orgType || "SDA",
        weekStartsOn: (org.weekStartsOn ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6,
        dailyCodeLength: org.dailyCodeLength ?? 3,
        dailyCodeCharset: (org.dailyCodeCharset === "numeric" ? "numeric" : "alphanumeric"),
      };
      cache = { config, at: now };
      return config;
    }
  } catch {
    // DB not ready yet — fall through to defaults.
  }
  const fallback: OrgConfig = {
    branding: DEFAULT_BRANDING,
    terminology: DEFAULT_TERMINOLOGY,
    orgType: "SDA",
    weekStartsOn: 0,
    dailyCodeLength: 3,
    dailyCodeCharset: "alphanumeric",
  };
  cache = { config: fallback, at: now };
  return fallback;
}

/** Invalidate the cache (call after config writes). */
export function invalidateOrgConfigCache() {
  cache = { config: null, at: 0 };
}

function safeParse(s: string): Record<string, string> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

/**
 * t() — terminology resolver for server components / API routes.
 * Client components use the useTerminology() hook (added in Stage 2).
 */
export function t(term: keyof Terminology, config?: OrgConfig | null): string {
  if (config?.terminology?.[term]) return config.terminology[term];
  return DEFAULT_TERMINOLOGY[term] ?? String(term);
}
