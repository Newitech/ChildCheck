"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  Download,
  FileDown,
  FileUp,
  HardDrive,
  Info,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface BackupItem {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

interface RestoreResult {
  ok: boolean;
  preRestoreBackup?: string;
  message?: string;
  photoCount?: number;
  hadLogo?: boolean;
  error?: string;
  details?: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  const val = bytes / Math.pow(k, i);
  return `${val.toFixed(i === 0 ? 0 : val < 10 ? 1 : 0)} ${sizes[i]}`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * The Stage 13 Backup & Restore console.
 *
 * Three sections:
 *   1. Backup now — calls POST /api/admin/backup, downloads the .cbak.
 *   2. Existing backups — table with download + delete buttons.
 *   3. Restore — upload .cbak → verify → confirm dialog → restore.
 *
 * The console polls the scheduled backup tick on mount (and every 60s) so
 * scheduled backups (when the flag is ON) get created even if the operator
 * never hits the "Backup now" button.
 */
export function BackupConsole() {
  const [items, setItems] = useState<BackupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [backingUp, setBackingUp] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Restore state
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/backup", { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { items: BackupItem[] };
      setItems(data.items);
    } catch (e) {
      toast.error("Failed to load backups", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + scheduled-backup tick (best-effort, no toast on no-op).
  useEffect(() => {
    void load();
    void fetch("/api/admin/backup/tick", { method: "POST" })
      .then(async (r) => r.ok ? await r.json() : null)
      .then((j: { created?: boolean; filename?: string } | null) => {
        if (j?.created) {
          toast.success(`Scheduled backup created: ${j.filename}`);
          void load();
        }
      })
      .catch(() => {});
    const id = setInterval(() => {
      void load();
    }, 60_000);
    return () => clearInterval(id);
  }, [load]);

  // --- Backup now ---
  const onBackupNow = useCallback(async () => {
    setBackingUp(true);
    try {
      const res = await fetch("/api/admin/backup", { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const m = /filename="?([^";]+)"?/i.exec(cd);
      const filename =
        m?.[1] ??
        res.headers.get("X-ChildCheck-Filename") ??
        "childcheck-backup.cbak";
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
      toast.success(`Backup created: ${filename}`, {
        description: `Encrypted bundle downloaded (${formatBytes(blob.size)}).`,
      });
      // Refresh list — the backup is also on disk.
      await load();
    } catch (e) {
      toast.error("Backup failed", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBackingUp(false);
    }
  }, [load]);

  // --- Download existing ---
  const onDownload = useCallback(async (filename: string) => {
    try {
      const res = await fetch(
        `/api/admin/backup/${encodeURIComponent(filename)}`,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
      toast.success(`Downloaded ${filename}`);
    } catch (e) {
      toast.error("Download failed", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }, []);

  // --- Delete ---
  const onConfirmDelete = useCallback(async () => {
    if (!deleting) return;
    const filename = deleting;
    try {
      const res = await fetch(
        `/api/admin/backup/${encodeURIComponent(filename)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success(`${filename} deleted`);
      setDeleting(null);
      await load();
    } catch (e) {
      toast.error("Delete failed", {
        description: e instanceof Error ? e.message : undefined,
      });
      setDeleting(null);
    }
  }, [deleting, load]);

  // --- Restore flow ---
  const onPickRestoreFile = useCallback((f: File | null) => {
    setRestoreFile(f);
    setVerified(false);
    setRestoreResult(null);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const f = e.dataTransfer.files?.[0];
      if (f) onPickRestoreFile(f);
    },
    [onPickRestoreFile],
  );

  const onVerify = useCallback(async () => {
    if (!restoreFile) {
      toast.error("Pick a .cbak file first.");
      return;
    }
    setVerifying(true);
    setRestoreResult(null);
    try {
      const fd = new FormData();
      fd.append("file", restoreFile);
      const res = await fetch("/api/admin/backup/restore?dryRun=1", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json().catch(() => ({}))) as RestoreResult;
      if (!res.ok) {
        throw new Error(data.error ?? data.details ?? `status ${res.status}`);
      }
      setVerified(true);
      toast.success("Bundle is valid and decrypts with this server's key.", {
        description: "Click 'Restore now' to proceed.",
      });
    } catch (e) {
      setVerified(false);
      toast.error("Bundle verification failed", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setVerifying(false);
    }
  }, [restoreFile]);

  const onRestore = useCallback(async () => {
    if (!restoreFile) return;
    setRestoring(true);
    setRestoreResult(null);
    try {
      const fd = new FormData();
      fd.append("file", restoreFile);
      const res = await fetch("/api/admin/backup/restore", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json().catch(() => ({}))) as RestoreResult;
      if (!res.ok) {
        throw new Error(data.error ?? data.details ?? `status ${res.status}`);
      }
      setRestoreResult(data);
      toast.success("Restore complete", {
        description: data.message,
      });
      setConfirmOpen(false);
      // Refresh the backup list — a pre-restore backup now exists.
      await load();
    } catch (e) {
      toast.error("Restore failed", {
        description: e instanceof Error ? e.message : undefined,
      });
      setConfirmOpen(false);
    } finally {
      setRestoring(false);
    }
  }, [restoreFile, load]);

  const resetRestore = useCallback(() => {
    setRestoreFile(null);
    setVerified(false);
    setRestoreResult(null);
    if (restoreInputRef.current) restoreInputRef.current.value = "";
  }, []);

  return (
    <div className="space-y-6">
      {/* Section 1 — Backup now */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4 text-primary" /> Backup now
          </CardTitle>
          <CardDescription className="text-sm leading-relaxed">
            Create an encrypted <code>.cbak</code> bundle containing the
            SQLite database, every encrypted verification photo, the brand
            logo, and the Organisation + Feature Flag config. The bundle is
            encrypted with the same AES-256-GCM key used for photos — without
            <code> CHILDCHECK_DATA_KEY</code> it is unreadable. The file is
            saved to <code>data/backups/</code> AND downloaded to your device.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row sm:items-center gap-3">
          <Button onClick={() => void onBackupNow()} disabled={backingUp}>
            {backingUp ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="mr-1.5 h-4 w-4" />
            )}
            Backup now
          </Button>
          <p className="text-xs text-muted-foreground">
            The download also stays on the server — it&apos;ll appear in the
            list below within a second.
          </p>
        </CardContent>
      </Card>

      {/* Section 2 — Existing backups */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <HardDrive className="h-4 w-4 text-primary" /> Existing backups
              </CardTitle>
              <CardDescription className="text-sm mt-0.5">
                Every <code>.cbak</code> file in <code>data/backups/</code>.
                Download or delete from here.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              <span className="ml-1.5">Refresh</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12 text-muted-foreground">
              <Loader2 className="inline h-5 w-5 animate-spin mr-2" /> Loading backups…
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No backups yet. Click <span className="font-medium text-foreground">Backup now</span> to create one.
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="min-w-[260px]">Filename</TableHead>
                    <TableHead className="w-[100px]">Size</TableHead>
                    <TableHead className="w-[180px]">Created</TableHead>
                    <TableHead className="w-[80px]">Type</TableHead>
                    <TableHead className="w-[140px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((b) => {
                    const isPreRestore = b.filename.includes("-pre-restore");
                    return (
                      <TableRow key={b.filename} className="hover:bg-muted/40">
                        <TableCell className="font-mono text-xs break-all">
                          {b.filename}
                        </TableCell>
                        <TableCell className="text-sm">{formatBytes(b.sizeBytes)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          <Clock className="inline h-3 w-3 mr-1 align-text-bottom" />
                          {formatDate(b.createdAt)}
                        </TableCell>
                        <TableCell>
                          {isPreRestore ? (
                            <Badge variant="secondary" className="text-[10px]">pre-restore</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">manual/sched</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void onDownload(b.filename)}
                              aria-label={`Download ${b.filename}`}
                            >
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleting(b.filename)}
                              aria-label={`Delete ${b.filename}`}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 3 — Restore */}
      <Card className="border-amber-200/60 dark:border-amber-900/40">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-amber-600 dark:text-amber-400" /> Restore
          </CardTitle>
          <CardDescription className="text-sm leading-relaxed">
            Upload a <code>.cbak</code> file. We&apos;ll verify it decrypts
            with this server&apos;s key before offering the restore button. An
            automatic pre-restore backup is created <span className="font-medium">before</span>{" "}
            any data is overwritten — so you can roll back if needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Pre-restore + overwrite warning */}
          <div className="rounded-md border border-amber-200/60 bg-amber-50/40 dark:bg-amber-950/20 p-3 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
            <div className="font-medium flex items-center gap-1.5 mb-1">
              <AlertTriangle className="h-3.5 w-3.5" /> Restore overwrites everything
            </div>
            The DB file, every photo, the brand logo, and the Organisation +
            Feature Flag config will be replaced with the bundle&apos;s
            contents. <span className="font-medium">A pre-restore backup is
            created automatically first.</span> After the restore completes,
            <span className="font-medium"> restart the server</span> for all
            changes to take effect (in dev with hot-reload, Prisma&apos;s
            cached connection may hold onto the old DB).
          </div>

          {/* File picker */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={onDrop}
            className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-muted/40 transition-colors"
            role="button"
            tabIndex={0}
            onClick={() => restoreInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                restoreInputRef.current?.click();
              }
            }}
          >
            <Upload className="h-6 w-6 mx-auto text-muted-foreground" />
            <p className="text-sm font-medium mt-2">
              {restoreFile ? restoreFile.name : "Drop .cbak here or click to browse"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {restoreFile
                ? `${formatBytes(restoreFile.size)}`
                : "Accepts .cbak up to 200 MB"}
            </p>
            <input
              ref={restoreInputRef}
              type="file"
              accept=".cbak,application/octet-stream"
              className="sr-only"
              onChange={(e) => onPickRestoreFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => void onVerify()}
              disabled={!restoreFile || verifying || restoring}
            >
              {verifying ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Info className="mr-1.5 h-4 w-4" />
              )}
              Verify bundle
            </Button>
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={!restoreFile || !verified || restoring}
              variant="default"
            >
              <FileUp className="mr-1.5 h-4 w-4" />
              Restore now
            </Button>
            {(restoreFile || verified || restoreResult) && (
              <Button
                variant="ghost"
                onClick={resetRestore}
                disabled={verifying || restoring}
              >
                Reset
              </Button>
            )}
            {verified && (
              <Badge className="bg-emerald-600 hover:bg-emerald-600">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Verified
              </Badge>
            )}
          </div>

          {/* Restore result */}
          {restoreResult && (
            <div className="rounded-md border border-emerald-200/60 bg-emerald-50/40 dark:bg-emerald-950/20 p-4 text-sm space-y-2">
              <div className="flex items-center gap-2 font-medium text-emerald-900 dark:text-emerald-200">
                <CheckCircle2 className="h-4 w-4" /> Restore complete
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <div>
                  <span className="font-medium">Pre-restore backup:</span>{" "}
                  <code className="break-all">{restoreResult.preRestoreBackup}</code>
                </div>
                <div>
                  <span className="font-medium">Photos restored:</span>{" "}
                  {restoreResult.photoCount ?? 0}
                </div>
                <div>
                  <span className="font-medium">Logo restored:</span>{" "}
                  {restoreResult.hadLogo ? "Yes" : "No"}
                </div>
                <div>
                  <span className="font-medium">Next step:</span>{" "}
                  {restoreResult.message}
                </div>
              </div>
            </div>
          )}

          {/* Info note */}
          <div className="text-xs text-muted-foreground flex items-start gap-1.5">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Scheduled backups (daily, 24h) can be enabled from{" "}
              <a className="underline" href="/admin/settings">Feature Toggles</a>.
              When ON, this page polls a tick endpoint on load — for production
              reliability wire up a real cron / systemd timer hitting{" "}
              <code>POST /api/admin/backup/tick</code>.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-destructive" /> Delete this backup?
            </AlertDialogTitle>
            <AlertDialogDescription>
              <code className="break-all">{deleting}</code>
              <br />
              This cannot be undone. If this is your only backup, the data it
              contains will be permanently lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void onConfirmDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Restore confirm */}
      <AlertDialog open={confirmOpen} onOpenChange={(o) => { if (!o && !restoring) setConfirmOpen(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              This will OVERWRITE all current data
            </AlertDialogTitle>
            <AlertDialogDescription>
              The uploaded <code>.cbak</code> will replace the entire SQLite
              database, every verification photo, the brand logo, and the
              Organisation + Feature Flag config. An automatic pre-restore
              backup is created <span className="font-medium">first</span>,
              saved to <code>data/backups/</code>.
              <br /><br />
              After the restore, you should <span className="font-medium">restart the server</span>{" "}
              for all changes to take effect.
              <br /><br />
              Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={restoring}
              onClick={(e) => {
                e.preventDefault();
                void onRestore();
              }}
            >
              {restoring ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <FileUp className="h-3.5 w-3.5 mr-1.5" />
              )}
              {restoring ? "Restoring…" : "Restore"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
