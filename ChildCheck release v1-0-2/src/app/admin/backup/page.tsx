import Link from "next/link";
import { ArrowLeft, DatabaseBackup } from "lucide-react";

import { requirePermission } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { BackupConsole } from "./backup-console";

export const dynamic = "force-dynamic";

/**
 * /admin/backup — Stage 13 Backup & Restore admin page.
 *
 * Three sections:
 *   1. Backup now — POST /api/admin/backup → downloads an encrypted .cbak.
 *   2. Existing backups — table of every .cbak in data/backups/, with
 *      download + delete buttons.
 *   3. Restore — upload a .cbak, verify, confirm (with the scary "this
 *      overwrites everything" dialog), restore.
 *
 * Requires Admin (the same triad as the rest of admin-side config).
 */
export default async function BackupPage() {
  await requirePermission("manage_people"); // Admin-only gate

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
          <Link href="/admin">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Admin home
          </Link>
        </Button>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <DatabaseBackup className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Backup &amp; Restore</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Encrypted, downloadable, restorable backups. Scheduled backups
              can be enabled from the Feature Toggles page.
            </p>
          </div>
        </div>
      </div>

      <BackupConsole />
    </div>
  );
}
