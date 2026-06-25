import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";

/**
 * Feature-flag registry & helpers (Stage 2).
 *
 * The canonical list of flags lives in FEATURE_FLAGS below. Defaults are
 * merged with FeatureFlag DB rows: a missing row means "use the default".
 *
 * Reads are cached with a short TTL (5s) to keep them cheap; writes
 * invalidate the cache AND the branding cache (callers must import
 * invalidateOrgConfigCache themselves if they need it).
 */

export type FlagCategory =
  | "Kiosk"
  | "Guardians"
  | "Security"
  | "Photos & Printing"
  | "Checkout"
  | "Data & Privacy"
  | "System";

export interface FlagDef {
  key: string;
  label: string;
  description: string;
  default: boolean;
  category: FlagCategory;
}

export const FEATURE_FLAGS: FlagDef[] = [
  // Kiosk
  {
    key: "kiosk_requires_login",
    label: "Kiosk requires account login",
    description:
      "Require a Kiosk-Account PIN before showing the family search screen (prevents random users searching families).",
    default: false,
    category: "Kiosk",
  },
  // Guardians
  {
    key: "guardian_pin_signin",
    label: "Guardian PIN sign-in",
    description:
      "Allow carers / authorised guardians to sign in with PIN/password at the kiosk to sign children in and out.",
    default: true,
    category: "Guardians",
  },
  {
    key: "guardian_self_registration",
    label: "Guardian self-registration",
    description:
      "Allow guardians to self-register and self-manage their family data, PIN and password.",
    default: false,
    category: "Guardians",
  },
  {
    key: "older_sibling_collect",
    label: "Older sibling collection",
    description:
      "Allow authorising an older sibling to collect a younger sibling.",
    default: false,
    category: "Guardians",
  },
  // Checkout
  {
    key: "override_checkout",
    label: "Override checkout",
    description:
      "Allow admins/teachers to override checkout after confirming with an authorised guardian (requires confirmation checkbox + note).",
    default: false,
    category: "Checkout",
  },
  // Photos & Printing
  {
    key: "photo_verification",
    label: "Photo verification",
    description:
      "Use photos of children and adults for visual verification at checkout.",
    default: true,
    category: "Photos & Printing",
  },
  {
    key: "print_name_labels",
    label: "Print name labels",
    description: "Print a child name label at check-in.",
    default: true,
    category: "Photos & Printing",
  },
  {
    key: "print_signout_code",
    label: "Print signout code slip",
    description:
      "Print the daily 3-digit code and relevant details for the guardian at check-in.",
    default: true,
    category: "Photos & Printing",
  },
  // Data & Privacy
  {
    key: "visitors_add_to_db",
    label: "Offer to add visitors to database",
    description:
      "In the visitor quick-add flow, offer a checkbox to add the visitor family to the regular People/Family database.",
    default: true,
    category: "Data & Privacy",
  },
  {
    key: "working_with_children_tracking",
    label: "Working-with-Children card tracking",
    description:
      "Track Working-With-Children / Blue Card status for volunteers (national & international).",
    default: true,
    category: "Data & Privacy",
  },
  {
    key: "email_as_contact",
    label: "Email as contact method",
    description:
      "Store email as a contact/communication method (not used for authentication).",
    default: true,
    category: "Data & Privacy",
  },
  {
    key: "email_recovery",
    label: "Email password recovery",
    description:
      "Allow email-based password recovery (requires internet/SMTP). Disable for fully offline installs.",
    default: false,
    category: "Data & Privacy",
  },
  // System
  {
    key: "audit_log_detailed",
    label: "Detailed audit logging",
    description: "Write verbose audit entries for all sensitive actions.",
    default: true,
    category: "System",
  },
  {
    key: "scheduled_backups",
    label: "Scheduled encrypted backups",
    description:
      "Automatically create encrypted backups on a schedule (stored under ./data/backups).",
    default: false,
    category: "System",
  },
];

/** Map of key → default value, for fast lookup. */
export const DEFAULT_FLAGS: Record<string, boolean> = Object.fromEntries(
  FEATURE_FLAGS.map((f) => [f.key, f.default]),
);

/** Set of valid keys, for cheap validation. */
export const FLAG_KEYS: Set<string> = new Set(FEATURE_FLAGS.map((f) => f.key));

let cache: { flags: Record<string, boolean> | null; at: number } = {
  flags: null,
  at: 0,
};
const TTL = 5000;

/**
 * Read every feature flag, merging DB overrides with defaults.
 * Missing DB rows fall back to their default and are lazily seeded.
 */
export async function getFeatureFlags(): Promise<Record<string, boolean>> {
  const now = Date.now();
  if (cache.flags && now - cache.at < TTL) return cache.flags;

  const flags: Record<string, boolean> = { ...DEFAULT_FLAGS };
  try {
    const rows = await db.featureFlag.findMany();
    for (const row of rows) {
      if (row.key in DEFAULT_FLAGS) {
        flags[row.key] = row.value;
      }
    }
  } catch {
    // DB not ready — fall back to all-defaults.
  }
  cache = { flags, at: now };
  return flags;
}

/** Convenience: read a single flag. */
export async function getFeatureFlag(key: string): Promise<boolean> {
  const all = await getFeatureFlags();
  return all[key] ?? DEFAULT_FLAGS[key] ?? false;
}

/** Alias of getFeatureFlag, for ergonomic call sites. */
export async function isFeatureEnabled(key: string): Promise<boolean> {
  return getFeatureFlag(key);
}

/**
 * Upsert a flag value. Rejects unknown keys with a validation error.
 * Invalidates the cache and writes an audit log entry.
 */
export async function setFeatureFlag(
  key: string,
  value: boolean,
  updatedBy?: string,
): Promise<void> {
  if (!FLAG_KEYS.has(key)) {
    throw new Error(`Unknown feature flag: ${key}`);
  }
  await db.featureFlag.upsert({
    where: { key },
    create: { key, value, updatedBy: updatedBy ?? null },
    update: { value, updatedBy: updatedBy ?? null },
  });
  invalidateFlagCache();
  await logAudit({
    actorUserId: updatedBy,
    action: "flag.update",
    entity: "FeatureFlag",
    entityId: key,
    details: { value },
  });
}

/** Invalidate the in-memory flag cache (call after writes). */
export function invalidateFlagCache(): void {
  cache = { flags: null, at: 0 };
}

/**
 * Idempotent: create FeatureFlag rows for any missing keys using their
 * defaults. Safe to run on first boot.
 */
export async function seedDefaultFlags(): Promise<void> {
  for (const def of FEATURE_FLAGS) {
    try {
      await db.featureFlag.upsert({
        where: { key: def.key },
        create: { key: def.key, value: def.default, updatedBy: null },
        update: {}, // don't overwrite existing values
      });
    } catch {
      // best-effort
    }
  }
  invalidateFlagCache();
}
