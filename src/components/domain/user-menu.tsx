import { Badge } from "@/components/ui/badge";
import { UserRound } from "lucide-react";
import type { SessionUser } from "@/lib/auth";

/**
 * Small user identity chip: avatar glyph + name + role badges.
 *
 * Server-rendered (the parent layout passes the session user as a prop).
 */
export function UserMenu({ user }: { user: SessionUser }) {
  const initials = (user.name ?? user.username ?? "?")
    .split(" ")
    .map((p) => p.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex items-center gap-3">
      <div className="hidden sm:flex flex-col items-end leading-tight">
        <span className="text-sm font-medium">{user.name ?? user.username}</span>
        <div className="flex flex-wrap gap-1 justify-end">
          {user.roles.length === 0 ? (
            <Badge variant="outline" className="text-[10px]">No role</Badge>
          ) : (
            user.roles.map((r) => (
              <Badge key={r} variant="secondary" className="text-[10px]">
                {r}
              </Badge>
            ))
          )}
        </div>
      </div>
      <span
        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary"
        aria-hidden
      >
        {initials ? (
          <span className="text-xs font-semibold">{initials}</span>
        ) : (
          <UserRound className="h-5 w-5" />
        )}
      </span>
    </div>
  );
}
