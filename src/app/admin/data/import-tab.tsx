"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileDown,
  FileUp,
  Info,
  Loader2,
  RotateCcw,
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
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

type ImportType = "people" | "families";

interface ImportError {
  row: number;
  field: string | null;
  message: string;
}

interface PeoplePreviewRow {
  row: number;
  firstName: string;
  lastName: string;
  personType: string;
  email: string;
  valid: boolean;
}

interface FamiliesPreviewRow {
  row: number;
  familyName: string;
  memberCount: number;
  primaryCarerEmail: string;
  valid: boolean;
}

interface DryRunResult {
  type: ImportType;
  dryRun: true;
  totalRows: number;
  valid: number;
  errors: ImportError[];
  preview: PeoplePreviewRow[] | FamiliesPreviewRow[];
  parseWarnings: string[];
}

interface ImportResult {
  type: ImportType;
  dryRun: false;
  imported: number;
  skipped?: number;
  membersCreated?: number;
  errors: ImportError[];
  parseWarnings: string[];
}

export function ImportTab() {
  const [importType, setImportType] = useState<ImportType>("people");
  const [file, setFile] = useState<File | null>(null);
  const [dryRunBusy, setDryRunBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const reset = useCallback(() => {
    setFile(null);
    setDryRun(null);
    setImportResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const onPickFile = useCallback((f: File | null) => {
    setFile(f);
    setDryRun(null);
    setImportResult(null);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const f = e.dataTransfer.files?.[0];
      if (f) onPickFile(f);
    },
    [onPickFile],
  );

  const downloadTemplate = useCallback(async (type: ImportType) => {
    try {
      const res = await fetch(`/api/admin/import/template?type=${type}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const m = /filename="?([^";]+)"?/i.exec(cd);
      const filename = m?.[1] ?? `${type}-template.csv`;
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
      toast.success(`${type[0].toUpperCase()}${type.slice(1)} template downloaded`);
    } catch (e) {
      toast.error("Template download failed", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }, []);

  const runDryRun = useCallback(async () => {
    if (!file) {
      toast.error("Pick a CSV file first.");
      return;
    }
    setDryRunBusy(true);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("type", importType);
      const res = await fetch("/api/admin/import?dryRun=true", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      const data = (await res.json()) as DryRunResult;
      setDryRun(data);
      if (data.errors.length === 0) {
        toast.success(
          `Dry-run OK — ${data.valid} of ${data.totalRows} rows valid, 0 errors.`,
        );
      } else {
        toast.warning(
          `Dry-run complete — ${data.errors.length} error(s) across ${data.totalRows} rows.`,
        );
      }
    } catch (e) {
      toast.error("Dry-run failed", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setDryRunBusy(false);
    }
  }, [file, importType]);

  const runImport = useCallback(async () => {
    if (!file) {
      toast.error("Pick a CSV file first.");
      return;
    }
    if (dryRun && dryRun.errors.length > 0) {
      toast.error("Cannot import — dry-run reports errors. Fix the file and re-run the preview.");
      return;
    }
    setImportBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("type", importType);
      const res = await fetch("/api/admin/import?dryRun=false", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      const data = (await res.json()) as ImportResult;
      setImportResult(data);
      toast.success(`Imported ${data.imported} ${importType}.`);
    } catch (e) {
      toast.error("Import failed", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setImportBusy(false);
    }
  }, [file, importType, dryRun]);

  const canImport =
    !!file && dryRun != null && dryRun.errors.length === 0 && dryRun.valid > 0;

  return (
    <div className="space-y-4">
      {/* Rollback note */}
      <Card className="bg-amber-50/50 border-amber-200/60 dark:bg-amber-950/20 dark:border-amber-900/40">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <RotateCcw className="h-4 w-4 text-amber-600 dark:text-amber-400" /> Atomic imports — no partial commits
          </CardTitle>
          <CardDescription className="text-sm leading-relaxed">
            If <span className="font-medium">any</span> row fails validation or
            a database constraint, the <span className="font-medium">entire
            batch</span> is rolled back. Nothing is half-imported. Always run
            the dry-run preview first — the real import button stays disabled
            until the preview is clean.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Step 1 — pick type + download template */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileDown className="h-4 w-4 text-primary" /> 1. Template
            </CardTitle>
            <CardDescription className="text-sm leading-relaxed">
              Download the canonical CSV template for the type you want to
              import. Each includes the header row + 2 example rows.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Import type</Label>
              <Select
                value={importType}
                onValueChange={(v) => setImportType(v as ImportType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="people">People (adults + children)</SelectItem>
                  <SelectItem value="families">Families (with members)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              onClick={() => void downloadTemplate(importType)}
              className="w-full sm:w-auto"
            >
              <Download className="mr-1.5 h-4 w-4" /> Download {importType} template
            </Button>

            <details className="text-xs text-muted-foreground mt-2">
              <summary className="cursor-pointer select-none hover:text-foreground">
                Column reference ({importType})
              </summary>
              <div className="mt-2 space-y-1.5 leading-relaxed">
                {importType === "people" ? (
                  <>
                    <p><strong>Required:</strong> firstName, lastName, personType.</p>
                    <p><strong>personType:</strong> "Adult" or "Child".</p>
                    <p><strong>dateOfBirth:</strong> ISO YYYY-MM-DD (e.g. 2017-03-12).</p>
                    <p><strong>gender:</strong> "Male", "Female", or "Other".</p>
                    <p><strong>isVisitor / isActive:</strong> "true" / "false".</p>
                    <p><strong>Optional:</strong> preferredName, email, phone, schoolGrade, allergies, medicalNotes, dietaryNotes, emergencyContactName, emergencyContactPhone.</p>
                  </>
                ) : (
                  <>
                    <p><strong>Required:</strong> familyName.</p>
                    <p><strong>primaryCarerEmail:</strong> email of an existing Person to attach as PrimaryCarer. The Person must already be in the DB.</p>
                    <p><strong>members:</strong> semicolon-separated descriptors of the form <code>Name|role|DOB</code>. e.g. <code>Mary Smith|Child|2017-03-12;Tom Smith|Child|2009-08-22</code>.</p>
                    <p><strong>role:</strong> PrimaryCarer, Child, AuthorisedGuardian, or EmergencyContact.</p>
                    <p><strong>Either</strong> primaryCarerEmail <strong>or</strong> members must be present.</p>
                  </>
                )}
              </div>
            </details>
          </CardContent>
        </Card>

        {/* Step 2 — upload a CSV */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileUp className="h-4 w-4 text-primary" /> 2. Upload CSV
            </CardTitle>
            <CardDescription className="text-sm leading-relaxed">
              Drag-drop or click to pick a .csv file. The file is sent to the
              server only when you click dry-run or import.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={onDrop}
              className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-muted/40 transition-colors"
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  inputRef.current?.click();
                }
              }}
            >
              <Upload className="h-6 w-6 mx-auto text-muted-foreground" />
              <p className="text-sm font-medium mt-2">
                {file ? file.name : "Drop CSV here or click to browse"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {file
                  ? `${(file.size / 1024).toFixed(1)} KB · ${file.type || "unknown type"}`
                  : "Accepts .csv up to 5 MB"}
              </p>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="sr-only"
                onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void runDryRun()}
                disabled={!file || dryRunBusy}
                variant="secondary"
              >
                {dryRunBusy ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Info className="mr-1.5 h-4 w-4" />
                )}
                Dry-run (preview)
              </Button>
              <Button
                onClick={() => void runImport()}
                disabled={!canImport || importBusy}
              >
                {importBusy ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-1.5 h-4 w-4" />
                )}
                Import for real
              </Button>
              {(file || dryRun || importResult) && (
                <Button variant="ghost" onClick={reset} disabled={dryRunBusy || importBusy}>
                  Reset
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Step 3 — preview / result */}
      {dryRun && (
        <DryRunPreview result={dryRun} />
      )}
      {importResult && (
        <ImportResultCard result={importResult} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DryRunPreview({ result }: { result: DryRunResult }) {
  const ok = result.errors.length === 0;
  const isPeople = result.type === "people";
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              {ok ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              )}
              Dry-run preview
            </CardTitle>
            <CardDescription className="text-sm mt-0.5">
              No database writes occurred. Fix any errors below, then re-run the preview.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline">Total: {result.totalRows}</Badge>
            <Badge className="bg-emerald-600 hover:bg-emerald-600">Valid: {result.valid}</Badge>
            <Badge variant={ok ? "outline" : "destructive"}>
              Errors: {result.errors.length}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {result.parseWarnings.length > 0 && (
          <div className="rounded-md border border-amber-200/60 bg-amber-50/40 dark:bg-amber-950/20 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-1">
            <div className="font-medium flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> Parse warnings
            </div>
            <ul className="list-disc pl-5 space-y-0.5">
              {result.parseWarnings.slice(0, 10).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {result.errors.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-2">
              Errors ({result.errors.length})
            </h4>
            <div className="max-h-72 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="w-[80px]">Row</TableHead>
                    <TableHead className="w-[180px]">Field</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.errors.map((e, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">
                        {e.row === 0 ? "—" : e.row}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {e.field ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">{e.message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {result.preview.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-2">
              Preview (first {result.preview.length} rows)
            </h4>
            <div className="max-h-72 overflow-y-auto rounded-md border">
              {isPeople ? (
                <Table>
                  <TableHeader className="sticky top-0 bg-card z-10">
                    <TableRow>
                      <TableHead className="w-[80px]">Row</TableHead>
                      <TableHead>First name</TableHead>
                      <TableHead>Last name</TableHead>
                      <TableHead className="w-[100px]">Type</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead className="w-[80px]">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(result.preview as PeoplePreviewRow[]).map((r) => (
                      <TableRow key={r.row}>
                        <TableCell className="font-mono text-xs">{r.row}</TableCell>
                        <TableCell>{r.firstName}</TableCell>
                        <TableCell>{r.lastName}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">{r.personType}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.email || "—"}</TableCell>
                        <TableCell>
                          {r.valid ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <XCircle className="h-4 w-4 text-destructive" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Table>
                  <TableHeader className="sticky top-0 bg-card z-10">
                    <TableRow>
                      <TableHead className="w-[80px]">Row</TableHead>
                      <TableHead>Family</TableHead>
                      <TableHead className="w-[120px]">Members</TableHead>
                      <TableHead>Carer email</TableHead>
                      <TableHead className="w-[80px]">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(result.preview as FamiliesPreviewRow[]).map((r) => (
                      <TableRow key={r.row}>
                        <TableCell className="font-mono text-xs">{r.row}</TableCell>
                        <TableCell>{r.familyName}</TableCell>
                        <TableCell>{r.memberCount}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.primaryCarerEmail || "—"}</TableCell>
                        <TableCell>
                          {r.valid ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <XCircle className="h-4 w-4 text-destructive" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ImportResultCard({ result }: { result: ImportResult }) {
  return (
    <Card className="bg-emerald-50/50 border-emerald-200/60 dark:bg-emerald-950/20 dark:border-emerald-900/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          Import complete
        </CardTitle>
        <CardDescription className="text-sm mt-0.5">
          The batch was committed atomically — every row was written, or none were.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="summary">
          <TabsList>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            {result.parseWarnings.length > 0 && (
              <TabsTrigger value="warnings">Warnings ({result.parseWarnings.length})</TabsTrigger>
            )}
            {result.errors.length > 0 && (
              <TabsTrigger value="errors">Errors ({result.errors.length})</TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="summary" className="mt-3">
            <div className="flex flex-wrap gap-1.5">
              <Badge className="bg-emerald-600 hover:bg-emerald-600">
                Imported: {result.imported}
              </Badge>
              {typeof result.membersCreated === "number" && (
                <Badge variant="secondary">
                  Members created: {result.membersCreated}
                </Badge>
              )}
              {typeof result.skipped === "number" && (
                <Badge variant="outline">Skipped: {result.skipped}</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Audit log entries were written for this import. Visit the Audit
              export to review them.
            </p>
          </TabsContent>
          {result.parseWarnings.length > 0 && (
            <TabsContent value="warnings" className="mt-3">
              <ul className="list-disc pl-5 text-xs space-y-1 text-muted-foreground max-h-40 overflow-y-auto">
                {result.parseWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </TabsContent>
          )}
          {result.errors.length > 0 && (
            <TabsContent value="errors" className="mt-3">
              <div className="max-h-60 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader className="sticky top-0 bg-card z-10">
                    <TableRow>
                      <TableHead className="w-[80px]">Row</TableHead>
                      <TableHead className="w-[180px]">Field</TableHead>
                      <TableHead>Message</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.errors.map((e, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{e.row}</TableCell>
                        <TableCell className="font-mono text-xs">{e.field ?? "—"}</TableCell>
                        <TableCell className="text-sm">{e.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
    </Card>
  );
}
