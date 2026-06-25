import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getOrgConfig, DEFAULT_TERMINOLOGY } from "@/lib/branding";
import { getProfile, type OrgType } from "@/lib/org-profiles";

/**
 * Stage 5 default program + class seeding.
 *
 * The user explicitly asked: "make sure you set defaults for Sabbath School,
 * defaults for Pathfinders and defaults for adventurers."
 *
 * This helper seeds the org's default Programs (and the default classes
 * within them) for the given org-type profile. It is IDEMPOTENT: a program
 * is keyed by its stable `slug`, and a class is keyed by (programId, slug).
 * Running it twice never duplicates rows.
 *
 * When is it called?
 *   - On first setup, from POST /api/setup (after creating org + admin).
 *   - When an org-type profile is applied via POST /api/admin/organisation/profile
 *     (so switching to Scouts adds the Scouts default programs without removing
 *      existing SDA programs).
 *   - Manually, via POST /api/admin/programs/seed (the "Seed default programs"
 *     button on the Programs admin page).
 *
 * Terminology adaptation:
 *   - The slug is ALWAYS the stable canonical key (sabbath_school,
 *     pathfinders, adventurers, community_childcare) — never renamed.
 *   - The human-readable `name` is sourced from getOrgConfig() at seed time,
 *     so a Sunday-Church org gets "Sunday School" as the program name while
 *     keeping slug = "sabbath_school".
 *   - This means if the org later switches profiles, EXISTING programs keep
 *     their old names (seeding skips them) but the helper remains safe to
 *     call repeatedly. To rename an existing program to the new terminology,
 *     the admin can edit it directly from the Programs admin page.
 *
 * Non-SDA org types seed the equivalent default programs per that profile's
 * terminology (SundayChurch → "Sunday School" / "Youth Group" / "Kids Club"
 * / "Community Childcare", still using the stable slugs above so a switch
 * back to SDA re-uses the same Program rows). Scouts / Childcare / School /
 * Club similarly. `Other` seeds nothing.
 */

// ---------------------------------------------------------------------------
// Default class definitions (ages/grade per SDA convention).
// Applied to the same slug keys for every org type — the names come from the
// terminology table where relevant, but the canonical default-class list is
// shared because every org that uses these programs uses the same divisions.
// (A Sunday Church "Sunday School" still has Beginner / Kindergarten / etc.)
// ---------------------------------------------------------------------------

interface DefaultClass {
  slug: string;
  name: string; // canonical name (English) — used unless the org has overridden
  ageMin?: number;
  ageMax?: number;
  gradeLevel?: string;
}

const SABBATH_SCHOOL_CLASSES: DefaultClass[] = [
  { slug: "beginner", name: "Beginner", ageMin: 0, ageMax: 3, gradeLevel: "Pre-K" },
  { slug: "kindergarten", name: "Kindergarten", ageMin: 4, ageMax: 6, gradeLevel: "Pre-K / K" },
  { slug: "primary", name: "Primary", ageMin: 7, ageMax: 9, gradeLevel: "Grades 1–3" },
  { slug: "juniors", name: "Juniors", ageMin: 10, ageMax: 12, gradeLevel: "Grades 4–6" },
  { slug: "earliteens", name: "Earliteens", ageMin: 13, ageMax: 15, gradeLevel: "Grades 7–9" },
  { slug: "youth", name: "Youth", ageMin: 16, ageMax: 18, gradeLevel: "Grades 10–12" },
];

const PATHFINDERS_CLASSES: DefaultClass[] = [
  { slug: "friend", name: "Friend", ageMin: 10, gradeLevel: "Grade 5" },
  { slug: "companion", name: "Companion", ageMin: 11, gradeLevel: "Grade 6" },
  { slug: "explorer", name: "Explorer", ageMin: 12, gradeLevel: "Grade 7" },
  { slug: "ranger", name: "Ranger", ageMin: 13, gradeLevel: "Grade 8" },
  { slug: "voyager", name: "Voyager", ageMin: 14, gradeLevel: "Grade 9" },
  { slug: "guide", name: "Guide", ageMin: 15, gradeLevel: "Grade 10" },
];

const ADVENTURERS_CLASSES: DefaultClass[] = [
  { slug: "little_lamb", name: "Little Lamb", ageMin: 4, gradeLevel: "Pre-K" },
  { slug: "eager_beaver", name: "Eager Beaver", ageMin: 5, gradeLevel: "Kindergarten" },
  { slug: "busy_bee", name: "Busy Bee", ageMin: 6, gradeLevel: "Grade 1" },
  { slug: "sunbeam", name: "Sunbeam", ageMin: 7, gradeLevel: "Grade 2" },
  { slug: "builder", name: "Builder", ageMin: 8, gradeLevel: "Grade 3" },
  { slug: "helping_hand", name: "Helping Hand", ageMin: 9, gradeLevel: "Grade 4" },
];

interface DefaultSchedule {
  kind: "recurring";
  dayOfWeek: number; // 0=Sunday ... 6=Saturday
  startTime: string; // "HH:MM" 24h
  endTime: string; // "HH:MM" 24h
  notes?: string;
}

interface DefaultProgram {
  slug: string;
  terminologyKey: keyof typeof DEFAULT_TERMINOLOGY;
  sortOrder: number;
  classes: DefaultClass[];
  schedule?: DefaultSchedule;
}

// The 4 canonical default programs. The Community Childcare program is
// created with NO default classes and NO default schedule (varies too much).
const DEFAULT_PROGRAMS: DefaultProgram[] = [
  {
    slug: "sabbath_school",
    terminologyKey: "program_sabbath_school",
    sortOrder: 10,
    classes: SABBATH_SCHOOL_CLASSES,
    schedule: {
      kind: "recurring",
      dayOfWeek: 6, // Saturday (Sabbath)
      startTime: "09:30",
      endTime: "10:45",
      notes: "Default Sabbath School time",
    },
  },
  {
    slug: "pathfinders",
    terminologyKey: "program_pathfinders",
    sortOrder: 20,
    classes: PATHFINDERS_CLASSES,
    schedule: {
      kind: "recurring",
      dayOfWeek: 6, // Saturday — typical Pathfinder meeting afternoon
      startTime: "16:00",
      endTime: "18:00",
      notes: "Default Pathfinder club meeting time (Saturday afternoon)",
    },
  },
  {
    slug: "adventurers",
    terminologyKey: "program_adventurers",
    sortOrder: 30,
    classes: ADVENTURERS_CLASSES,
    schedule: {
      kind: "recurring",
      dayOfWeek: 6, // Saturday — Adventurers often run alongside Sabbath School
      startTime: "09:30",
      endTime: "10:45",
      notes: "Default Adventurer meeting time (alongside Sabbath School)",
    },
  },
  {
    slug: "community_childcare",
    terminologyKey: "program_community_childcare",
    sortOrder: 40,
    classes: [], // no default classes — varies too much per org
  },
];

export interface SeedResult {
  created: number;
  skipped: number;
}

/**
 * Seed (idempotently) the default programs for the given org type.
 *
 * For "Other", seeds nothing.
 * For all other org types, seeds the 4 canonical default programs using the
 * CURRENT org terminology for the human-readable names (so a Sunday Church
 * org gets "Sunday School" as the program name; the slug stays
 * "sabbath_school" for stability).
 *
 * Each program creation is wrapped in its own try/catch so a failure on one
 * doesn't abort the rest. A best-effort audit log is written on success.
 */
export async function seedDefaultPrograms(
  orgType: string,
  actorUserId?: string | null,
): Promise<SeedResult> {
  const profile = getProfile(orgType);

  // "Other" / unknown org types seed nothing — admin configures manually.
  if (profile.type === ("Other" as OrgType) || !profile) {
    return { created: 0, skipped: 0 };
  }

  const config = await getOrgConfig();
  const term = config.terminology;

  let created = 0;
  let skipped = 0;

  for (const def of DEFAULT_PROGRAMS) {
    try {
      const existing = await db.program.findUnique({
        where: { slug: def.slug },
      });
      if (existing) {
        skipped += 1;
        continue;
      }

      // Use the org's current terminology for the human-readable name.
      const name = term[def.terminologyKey] ?? DEFAULT_TERMINOLOGY[def.terminologyKey] ?? def.slug;

      // Create the program + (in the same tx) its default classes + schedules.
      await db.$transaction(async (tx) => {
        const program = await tx.program.create({
          data: {
            slug: def.slug,
            name,
            sortOrder: def.sortOrder,
            isDefault: true,
            isActive: true,
          },
        });

        for (let i = 0; i < def.classes.length; i++) {
          const c = def.classes[i];
          const cls = await tx.groupClass.create({
            data: {
              programId: program.id,
              slug: c.slug,
              name: c.name,
              ageMin: c.ageMin ?? null,
              ageMax: c.ageMax ?? null,
              gradeLevel: c.gradeLevel ?? null,
              sortOrder: (i + 1) * 10,
              isDefault: true,
              isActive: true,
            },
          });

          if (def.schedule) {
            await tx.schedule.create({
              data: {
                classId: cls.id,
                kind: def.schedule.kind,
                dayOfWeek: def.schedule.dayOfWeek,
                startTime: def.schedule.startTime,
                endTime: def.schedule.endTime,
                notes: def.schedule.notes ?? null,
                isActive: true,
              },
            });
          }
        }
      });

      created += 1;
    } catch (err) {
      // A failure on one program must NOT abort the rest.
      console.error(`[seed-programs] failed to seed "${def.slug}":`, err);
    }
  }

  if (created > 0) {
    try {
      await logAudit({
        actorUserId: actorUserId ?? null,
        action: "program.seed",
        entity: "Program",
        details: { orgType, created, skipped },
      });
    } catch {
      // best-effort
    }
  }

  return { created, skipped };
}
