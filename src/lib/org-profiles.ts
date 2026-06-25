import type { Terminology } from "@/lib/branding";

/**
 * Organisation-type profile registry (Stage 3 — dual org-type defaults).
 *
 * The user explicitly wants:
 *   "Seventh-day Adventist defaults for a Seventh-day Adventist organisation
 *    and suitable non-Seventh-day Adventist defaults for other organisations."
 *
 * Each profile defines: a human label + short description, a default
 * terminology override set (merged on top of DEFAULT_TERMINOLOGY), and a
 * default set of feature-flag values (merged on top of FLAG defaults).
 *
 * The SDA profile is the canonical default — see Organisation.orgType schema
 * default ("SDA") and the fallback in getProfile().
 *
 * Apply-profile API: src/app/api/admin/organisation/profile/route.ts.
 * The merge semantics are intentionally NON-destructive: profile terminology
 * keys overwrite existing values for the SAME keys, but DO NOT wipe other
 * customised keys (merge, not replace). Same for flags — only the keys
 * present in the profile are touched.
 */

export type OrgType =
  | "SDA"
  | "SundayChurch"
  | "Scouts"
  | "Childcare"
  | "School"
  | "Club"
  | "Other";

export const ORG_TYPES: OrgType[] = [
  "SDA",
  "SundayChurch",
  "Scouts",
  "Childcare",
  "School",
  "Club",
  "Other",
];

export interface OrgProfile {
  type: OrgType;
  label: string; // "Seventh-day Adventist"
  description: string; // short blurb
  terminology: Partial<Terminology>; // overrides on top of DEFAULT_TERMINOLOGY
  flags: Partial<Record<string, boolean>>; // overrides on top of FLAG defaults
  /** JS getDay() index of the first day of the week (0=Sun,1=Mon,6=Sat).
   *  SDA = 0 (Sunday-first; Saturday is the 7th-day Sabbath). Other profiles
   *  pick a sensible default; admins can override in /admin/settings. */
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export const ORG_PROFILES: Record<OrgType, OrgProfile> = {
  SDA: {
    type: "SDA",
    label: "Seventh-day Adventist",
    description:
      "Sabbath-keeping church. Programs include Sabbath School, Pathfinders, Adventurers, and community childcare. The week starts on Sunday; Saturday is the 7th-day Sabbath.",
    terminology: {
      program_sabbath_school: "Sabbath School",
      program_pathfinders: "Pathfinders",
      program_adventurers: "Adventurers",
      program_community_childcare: "Community Childcare",
    },
    flags: {
      guardian_pin_signin: true,
      photo_verification: true,
      working_with_children_tracking: true,
    },
    weekStartsOn: 0, // Sunday-first (Saturday = 7th day)
  },
  SundayChurch: {
    type: "SundayChurch",
    label: "Sunday Church",
    description:
      "Sunday-observing church. Renames 'Sabbath School' to 'Sunday School'.",
    terminology: {
      program_sabbath_school: "Sunday School",
      program_pathfinders: "Youth Group",
      program_adventurers: "Kids Club",
      program_community_childcare: "Community Childcare",
    },
    flags: {
      guardian_pin_signin: true,
      photo_verification: true,
      working_with_children_tracking: true,
    },
    weekStartsOn: 0, // Sunday-first
  },
  Scouts: {
    type: "Scouts",
    label: "Scouts / Youth Movement",
    description:
      "Youth movement (Scouts, Guides). Uses 'Unit' instead of 'Class', 'Youth' instead of 'Child'.",
    terminology: {
      program_sabbath_school: "Unit Night",
      program_pathfinders: "Venturers",
      program_adventurers: "Cubs",
      program_community_childcare: "Community Care",
      group: "Unit",
      group_plural: "Units",
      child: "Youth",
      child_plural: "Youth",
      volunteer: "Leader",
      volunteer_plural: "Leaders",
    },
    flags: {
      guardian_pin_signin: true,
      photo_verification: true,
      working_with_children_tracking: true,
    },
    weekStartsOn: 1, // Monday-first (common for Scouts/weekly programmes)
  },
  Childcare: {
    type: "Childcare",
    label: "Childcare Centre",
    description:
      "Daycare / long-day-care centre. Uses 'Room' prominently; weekly recurring sessions.",
    terminology: {
      program_sabbath_school: "Daycare",
      program_pathfinders: "After-School Care",
      program_adventurers: "Pre-School",
      program_community_childcare: "Community Childcare",
    },
    flags: {
      guardian_pin_signin: true,
      photo_verification: true,
      working_with_children_tracking: true,
      guardian_self_registration: true,
    },
    weekStartsOn: 1, // Monday-first (childcare week)
  },
  School: {
    type: "School",
    label: "School",
    description:
      "School (primary/secondary). Uses 'Grade' / 'Student' terminology.",
    terminology: {
      program_sabbath_school: "Assembly",
      program_pathfinders: "Clubs",
      program_adventurers: "Sports",
      program_community_childcare: "After-School Care",
      group: "Grade",
      group_plural: "Grades",
      child: "Student",
      child_plural: "Students",
    },
    flags: {
      guardian_pin_signin: true,
      photo_verification: true,
      working_with_children_tracking: true,
    },
    weekStartsOn: 1, // Monday-first (school week)
  },
  Club: {
    type: "Club",
    label: "Club / Community Group",
    description: "Generic club or community group (playgroup, sports club, etc.).",
    terminology: {
      program_sabbath_school: "Main Session",
      program_pathfinders: "Activity Group",
      program_adventurers: "Juniors",
      program_community_childcare: "Community Care",
    },
    flags: {
      guardian_pin_signin: true,
      photo_verification: true,
      working_with_children_tracking: true,
    },
    weekStartsOn: 0, // Sunday-first
  },
  Other: {
    type: "Other",
    label: "Other / Custom",
    description:
      "Custom organisation. Configure terminology and toggles manually.",
    terminology: {},
    flags: {},
    weekStartsOn: 0, // Sunday-first (admin can change)
  },
};

export function getProfile(type: string): OrgProfile {
  return ORG_PROFILES[type as OrgType] ?? ORG_PROFILES.Other;
}

export function isOrgType(value: unknown): value is OrgType {
  return typeof value === "string" && (ORG_TYPES as string[]).includes(value);
}
