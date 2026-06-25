import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { SetupForm } from "./setup-form";
import { BrandMark } from "@/components/domain/brand-mark";

export const dynamic = "force-dynamic";

/**
 * First-run setup wizard.
 *
 * Available only when no users exist yet. After the first admin is created,
 * visiting /setup bounces to "/" (home).
 */
export default async function SetupPage() {
  let userCount = 0;
  try {
    userCount = await db.user.count();
  } catch {
    // DB not ready — treat as setup-allowed.
  }
  if (userCount > 0) {
    redirect("/");
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-primary/5 via-background to-background">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <BrandMark size="sm" /> ChildCheck setup
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-start sm:items-center justify-center p-4 sm:p-6 py-10">
        <div className="w-full flex flex-col items-center">
          <SetupForm />
        </div>
      </main>

      <footer className="mt-auto border-t bg-background">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-4 text-center text-xs text-muted-foreground">
          Your data stays on your hardware. This wizard only runs once.
        </div>
      </footer>
    </div>
  );
}
