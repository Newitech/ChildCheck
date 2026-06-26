import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { db } from "@/lib/db";
import { createHash } from "node:crypto";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandMark } from "@/components/domain/brand-mark";
import { ResetPasswordForm } from "./reset-password-form";

export const dynamic = "force-dynamic";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * /reset-password?token=... — the landing page for email-based password reset.
 *
 * Validates the token server-side (exists, not used, not expired). If invalid,
 * shows an error card with a link to request a new reset. If valid, shows the
 * new-password form.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token || token.length < 10) {
    return <InvalidTokenCard message="This reset link is missing a token. Request a new one below." />;
  }

  const tokenHash = hashToken(token);
  const resetToken = await db.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: { include: { person: true } } },
  });

  if (!resetToken) {
    return <InvalidTokenCard message="This reset link is not valid. It may have been replaced by a newer request." />;
  }
  if (resetToken.usedAt) {
    return <InvalidTokenCard message="This reset link has already been used. Request a new one to reset your password again." />;
  }
  if (resetToken.expiresAt < new Date()) {
    return <InvalidTokenCard message="This reset link has expired (links are valid for 30 minutes). Request a new one below." />;
  }

  const name = resetToken.user.person?.firstName ?? "there";

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-primary/5 via-background to-background">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <BrandMark size="sm" /> Reset password
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/login"><ArrowLeft className="mr-1.5 h-4 w-4" /> Back to sign in</Link>
          </Button>
        </div>
      </header>

      <main className="flex-1 flex items-start sm:items-center justify-center p-4 sm:p-6 py-10">
        <Card className="w-full max-w-md shadow-sm">
          <CardHeader className="space-y-3 text-center">
            <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <BrandMark size="sm" />
            </div>
            <div>
              <CardTitle className="text-2xl">Set a new password</CardTitle>
              <CardDescription className="mt-1">
                Hi {name}, choose a new password for your account.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ResetPasswordForm token={token} />
          </CardContent>
        </Card>
      </main>

      <footer className="mt-auto border-t bg-background">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-4 text-center text-xs text-muted-foreground">
          Your data stays on your hardware.
        </div>
      </footer>
    </div>
  );
}

function InvalidTokenCard({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-primary/5 via-background to-background">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <BrandMark size="sm" /> Reset password
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/login"><ArrowLeft className="mr-1.5 h-4 w-4" /> Sign in</Link>
          </Button>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle className="text-2xl">Reset link invalid</CardTitle>
            <CardDescription>{message}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full">
              <Link href="/login">Back to sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
      <footer className="mt-auto border-t bg-background">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-4 text-center text-xs text-muted-foreground">
          Your data stays on your hardware.
        </div>
      </footer>
    </div>
  );
}
