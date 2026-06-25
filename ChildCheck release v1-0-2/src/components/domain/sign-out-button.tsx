"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

/**
 * Sign-out button. Calls NextAuth's `signOut` and bounces to "/".
 * Shows a small loading state to give feedback on slow networks.
 */
export function SignOutButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);

  function handleSignOut() {
    setBusy(true);
    // Fire-and-forget; the page will be navigated away.
    void signOut({ callbackUrl: "/" }).finally(() => setBusy(false));
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleSignOut}
      disabled={busy}
      className={className}
    >
      <LogOut className="mr-1.5 h-4 w-4" />
      {busy ? "Signing out…" : "Sign out"}
    </Button>
  );
}
