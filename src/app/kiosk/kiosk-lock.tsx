"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import { Delete, Lock, LogIn, ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * KioskLock — PIN-pad login for locked-mode kiosks.
 *
 * Stage 1's NextAuth credentials provider already supports PIN login: a
 * 4–6 digit PIN is treated as a PIN if the user has a pinHash. So we feed
 * the typed PIN into signIn("credentials", { username, password: pin }).
 *
 * The username defaults to "kiosk" but is editable in a small field — admins
 * can type their own username if they want to operate the kiosk under their
 * account. After a successful signIn we router.refresh() so the server
 * component re-evaluates the session and reveals the search screen.
 *
 * On error we show a toast + clear the PIN.
 */
export function KioskLock({ orgName }: { orgName: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("kiosk");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const press = (digit: string) => {
    setPin((p) => (p.length >= 8 ? p : p + digit));
  };
  const backspace = () => setPin((p) => p.slice(0, -1));
  const clear = () => setPin("");

  async function submit() {
    if (!username.trim()) {
      toast.error("Enter a kiosk username.");
      return;
    }
    if (pin.length < 4) {
      toast.error("Enter at least 4 digits.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await signIn("credentials", {
        redirect: false,
        username: username.trim(),
        password: pin,
      });
      if (!res || res.error) {
        toast.error("Wrong username or PIN.");
        setPin("");
        return;
      }
      toast.success("Kiosk unlocked");
      // Re-render server component so it sees the new session.
      router.refresh();
    } catch (err) {
      console.error("[kiosk-lock] signIn error:", err);
      toast.error("Something went wrong.");
      setPin("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Lock className="h-7 w-7" />
          </div>
          <div>
            <CardTitle className="text-2xl">Kiosk locked</CardTitle>
            <CardDescription className="mt-1">
              Enter the kiosk PIN for {orgName} to continue.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="kiosk-username" className="text-xs font-medium text-muted-foreground">
              Kiosk username
            </label>
            <Input
              id="kiosk-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
              className="h-11"
              disabled={submitting}
            />
          </div>

          {/* PIN display */}
          <div className="flex items-center justify-center gap-2 py-2">
            <div
              className="flex items-center justify-center gap-2 rounded-md border bg-muted/30 px-4 py-3 min-h-[3.5rem] min-w-[10rem] text-2xl font-mono tracking-[0.4em]"
              aria-live="polite"
              aria-label="PIN entry"
            >
              {pin.length === 0 ? (
                <span className="text-muted-foreground text-base tracking-normal">
                  Enter PIN
                </span>
              ) : (
                "•".repeat(pin.length)
              )}
            </div>
          </div>

          {/* Numeric PIN pad */}
          <div className="grid grid-cols-3 gap-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <Button
                key={d}
                type="button"
                variant="outline"
                className="h-14 text-xl"
                onClick={() => press(d)}
                disabled={submitting}
                aria-label={`Digit ${d}`}
              >
                {d}
              </Button>
            ))}
            <Button
              type="button"
              variant="ghost"
              className="h-14 text-base"
              onClick={clear}
              disabled={submitting || pin.length === 0}
              aria-label="Clear PIN"
            >
              Clear
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-14 text-xl"
              onClick={() => press("0")}
              disabled={submitting}
              aria-label="Digit 0"
            >
              0
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-14"
              onClick={backspace}
              disabled={submitting || pin.length === 0}
              aria-label="Backspace"
            >
              <Delete className="h-5 w-5" />
            </Button>
          </div>

          <Button
            type="button"
            className="w-full h-14 text-base"
            onClick={() => void submit()}
            disabled={submitting || pin.length < 4}
          >
            <LogIn className="mr-2 h-5 w-5" />
            {submitting ? "Unlocking…" : "Unlock kiosk"}
          </Button>

          <div className="flex items-center justify-between pt-1">
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <Link href="/">
                <ArrowLeft className="mr-1.5 h-4 w-4" /> Home
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <Link href="/login">Admin sign-in</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
