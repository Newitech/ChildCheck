import Link from "next/link";
import { db } from "@/lib/db";
import { ArrowLeft, ShieldCheck, AlertCircle } from "lucide-react";
import { BrandMark } from "@/components/domain/brand-mark";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

/**
 * Login page (server shell). Renders:
 *   - a setup banner if no users exist yet, and
 *   - the client login form.
 *
 * URL params:
 *   - ?error=unauthorized → friendly "you need permission" alert.
 *   - ?reason=idle        → "signed out due to inactivity" alert.
 *   - ?reason=setup-success → "account created, sign in".
 *   - ?callback=…         → forwarded to NextAuth for post-login bounce.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const errorParam = typeof sp.error === "string" ? sp.error : null;
  const reasonParam = typeof sp.reason === "string" ? sp.reason : null;
  const callbackParam = typeof sp.callback === "string" ? sp.callback : null;

  let userCount = 0;
  try {
    userCount = await db.user.count();
  } catch {
    // ignore — treat as not-setup
  }
  const setupMode = userCount === 0;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-primary/5 via-background to-background">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <BrandMark size="sm" /> ChildCheck
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/">
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Home
            </Link>
          </Button>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 gap-4">
        {setupMode && (
          <Card className="w-full max-w-md border-primary/40 ring-1 ring-primary/20">
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Finish setup first</CardTitle>
              </div>
              <CardDescription>
                No admin accounts exist yet. Run the first-run wizard to create
                your organisation and first admin, then come back here to sign in.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full h-11">
                <Link href="/setup">Open setup wizard</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {errorParam === "unauthorized" && (
          <Alert variant="destructive" className="w-full max-w-md">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Not authorized</AlertTitle>
            <AlertDescription>
              You don&apos;t have permission to view that page, or your session
              expired. Please sign in with an authorised account.
            </AlertDescription>
          </Alert>
        )}

        {reasonParam === "idle" && (
          <Alert className="w-full max-w-md">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Signed out for security</AlertTitle>
            <AlertDescription>
              You were signed out automatically after 15 minutes of inactivity.
            </AlertDescription>
          </Alert>
        )}

        {reasonParam === "setup-success" && (
          <Alert className="w-full max-w-md">
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>Admin account created</AlertTitle>
            <AlertDescription>
              Sign in with your new admin credentials.
            </AlertDescription>
          </Alert>
        )}

        {/* Always render the form (so non-setup users see it).
            Hide it during setup-mode for clarity. */}
        {!setupMode && (
          <div className="w-full flex flex-col items-center">
            <LoginForm key={callbackParam ?? "default"} />
          </div>
        )}
      </main>

      <footer className="mt-auto border-t bg-background">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-4 text-center text-xs text-muted-foreground">
          All data stays on your hardware.
        </div>
      </footer>
    </div>
  );
}
