import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { getServerSession, type Session } from "next-auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  hashPassword,
  verifyPassword,
  verifyPin,
  isValidPin,
} from "@/lib/password";
import { logAudit } from "@/lib/audit";

/**
 * Role → permission matrix for ChildCheck.
 *
 * The Admin role has "*" which short-circuits every permission check.
 * Other roles are explicit allow-lists; later stages may extend them.
 */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  Admin: ["*"],
  Security: [
    "view_roster",
    "override_checkout",
    "view_audit",
    "view_people",
    "view_programs",
  ],
  Teacher: [
    "check_in",
    "check_out",
    "override_checkout",
    "view_roster",
    "headcount",
    "run_reports",
    "view_programs",
  ],
  Volunteer: ["check_in", "check_out", "view_roster", "headcount", "view_programs"],
  Kiosk: ["kiosk_operate", "view_programs"],
  PeopleManager: [
    "view_people",
    "manage_people",
    "manage_families",
    "view_programs",
    "manage_programs",
  ],
};

/** Union of every permission string in the matrix (reference only). */
export const PERMISSIONS: string[] = Array.from(
  new Set(Object.values(ROLE_PERMISSIONS).flat()),
).sort();

/**
 * True if any of the user's roles grants `perm`.
 * The Admin role (or any role whose permission list contains "*") bypasses.
 */
export function hasPermission(roles: string[], perm: string): boolean {
  if (!roles || roles.length === 0) return false;
  for (const r of roles) {
    const perms = ROLE_PERMISSIONS[r];
    if (!perms) continue;
    if (perms.includes("*") || perms.includes(perm)) return true;
  }
  return false;
}

/** All role strings assigned to a user. */
export async function getRolesForUser(userId: string): Promise<string[]> {
  const rows = await db.userRole.findMany({ where: { userId } });
  return rows.map((r) => r.role);
}

// ---------------------------------------------------------------------------
// Augmented NextAuth types
// ---------------------------------------------------------------------------

export interface SessionUser {
  id: string;
  name?: string | null;
  email?: string | null;
  username: string;
  roles: string[];
}

declare module "next-auth" {
  interface User {
    id: string;
    username: string;
    roles: string[];
  }
  interface Session {
    user: SessionUser;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    username?: string;
    roles?: string[];
  }
}

// ---------------------------------------------------------------------------
// NextAuth options
// ---------------------------------------------------------------------------

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    signOut: "/",
  },
  providers: [
    CredentialsProvider({
      id: "credentials",
      name: "Sign in",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password or PIN", type: "password" },
      },
      async authorize(raw) {
        const input = {
          username: (raw?.username ?? "").toString().trim(),
          password: (raw?.password ?? "").toString(),
        };
        if (!input.username || !input.password) return null;

        // SQLite does not support `mode: "insensitive"` on String filters, so
        // we use plain `equals` (SQLite's default LIKE/COLLATE is already
        // case-insensitive for ASCII). Prisma enforces this as a validation
        // error — see PLAN.md §5 / auth spec.
        const user = await db.user.findFirst({
          where: { username: { equals: input.username } },
          include: { roles: true, person: true },
        });
        if (!user) return null;
        if (user.status !== "Active") return null;
        if (!user.person) return null;

        // PIN login: input looks like a PIN (4–6 digits) AND the user has a pinHash.
        // Otherwise fall back to full password verification.
        let ok = false;
        if (isValidPin(input.password) && user.pinHash) {
          ok = await verifyPin(input.password, user.pinHash);
        } else {
          ok = await verifyPassword(input.password, user.passwordHash);
        }
        if (!ok) return null;

        // Success: stamp lastLoginAt and write an audit entry.
        try {
          await db.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
          });
        } catch {
          /* non-fatal */
        }
        await logAudit({
          actorUserId: user.id,
          action: "user.login",
          entity: "User",
          entityId: user.id,
          details: { username: user.username },
        });

        return {
          id: user.id,
          name: `${user.person.firstName} ${user.person.lastName}`,
          username: user.username,
          roles: user.roles.map((r) => r.role),
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as SessionUser).id;
        token.username = (user as SessionUser).username;
        token.roles = (user as SessionUser).roles;
      }
      return token;
    },
    async session({ session, token }): Promise<Session> {
      if (session.user) {
        (session.user as SessionUser).id = token.id ?? "";
        (session.user as SessionUser).username = token.username ?? "";
        (session.user as SessionUser).roles = token.roles ?? [];
      }
      return session;
    },
  },
  events: {
    async signOut(message) {
      // Best-effort audit write. The userId may not always be reachable from
      // the signOut event payload — log null if so.
      const token = (message as { jwt?: { id?: string; username?: string } })
        .jwt;
      const actorUserId = token?.id ?? null;
      await logAudit({
        actorUserId,
        action: "user.signout",
        entity: "User",
        entityId: actorUserId ?? undefined,
        details: token?.username ? { username: token.username } : null,
      });
    },
  },
};

// ---------------------------------------------------------------------------
// Server-side guard helpers (for server components / route handlers)
// ---------------------------------------------------------------------------

/** Return the current session's user, or null if not signed in. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  return session.user as SessionUser;
}

/**
 * Require that the current session has `perm`.
 *
 * - No session → redirect to /login?error=unauthorized (with the current
 *   path so we could bounce back later).
 * - Session lacking the permission → redirect to /login?error=unauthorized.
 *
 * We chose redirect (over throwing) because Next.js server components can
 * call redirect() cleanly without triggering error boundaries. The /login
 * page shows a friendly "unauthorized" message via the ?error= param.
 */
export async function requirePermission(
  perm: string,
): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?error=unauthorized");
  }
  if (!hasPermission(user.roles, perm)) {
    redirect("/login?error=unauthorized");
  }
  return user;
}

/** Require that the current session has any of the listed roles. */
export async function requireRole(
  ...roles: string[]
): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?error=unauthorized");
  }
  if (!roles.some((r) => user.roles.includes(r))) {
    redirect("/login?error=unauthorized");
  }
  return user;
}

// Re-export hashPassword so other modules can import auth-related primitives
// from a single entry point if they wish.
export { hashPassword };
