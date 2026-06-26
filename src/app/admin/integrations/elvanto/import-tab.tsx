"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
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
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type InputMode = "file" | "json";

interface DryRunMember {
  row: number;
  firstName: string;
  lastName: string;
  email: string | null;
  role: string;
  personType: string;
  action: "create" | "match";
  matchedPersonId?: string;
  matchReason?: string;
}

interface DryRunFamily {
  familyId: string | null;
  familyName: string;
  members: DryRunMember[];
}

interface DryRunResponse {
  dryRun: true;
  totalPeople: number;
  newPeople: number;
  matchedPeople: number;
  families: DryRunFamily[];
  errors: { row: number; message: string }[];
  parseWarnings: string[];
  unmatchedColumns: string[];
}

interface ImportResponse {
  dryRun: false;
  totalPeople: number;
  imported: number;
  updated: number;
  familiesCreated: number;
  familiesMatched: number;
  errors: { row: number; message: string }[];
  parseWarnings: string[];
  unmatchedColumns: string[];
}

/**
 * Import tab — file-upload (CSV) or pasted-JSON path; dry-run preview then
 * real atomic import.
 */
export function ImportTab() {
  const [mode, setMode] = useState<InputMode>("file");
  const [file, setFile] = useState<File | null>(null);
  const [jsonText, setJsonText] = useState("");
  const [dryRunBusy, setDryRunBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [dryRun, setDryRun] = useState<DryRunResponse | null>(null);
  const [importResult, setImportResult] = useState<ImportResponse | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const reset = useCallback(() => {
    setFile(null);
    setJsonText("");
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

  const buildForm = useCallback((): FormData | null => {
    if (mode === "file") {
      if (!file) {
        toast.error("Pick a CSV file first.");
        return null;
      }
      const fd = new FormData();
      fd.append("file", file);
      return fd;
    }
    if (!jsonText.trim()) {
      toast.error("Paste some JSON first.");
      return null;
    }
    const fd = new FormData();
    fd.append("json", jsonText);
    return fd;
  }, [mode, file, jsonText]);

  const runDryRun = useCallback(async () => {
    const fd = buildForm();
    if (!fd) return;
    setDryRunBusy(true);
    setImportResult(null);
    try {
      const res = await fetch(
        "/api/admin/integrations/elvanto/import?dryRun=true",
        { method: "POST", body: fd },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      const data = (await res.json()) as DryRunResponse;
      setDryRun(data);
      if (data.errors.length === 0) {
        toast.success(
          `Dry-run OK — ${data.totalPeople} people, ${data.families.length} family group(s), 0 errors.`,
        );
      } else {
        toast.warning(
          `Dry-run complete — ${data.errors.length} error(s) across ${data.totalPeople} people.`,
        );
      }
    } catch (e) {
      toast.error("Dry-run failed", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setDryRunBusy(false);
    }
  }, [buildForm]);

  const runImport = useCallback(async () => {
    const fd = buildForm();
    if (!fd) return;
    if (dryRun && dryRun.errors.length > 0) {
      toast.error("Cannot import — dry-run reports errors. Fix and re-run the preview.");
      return;
    }
    setImportBusy(true);
    try {
      const res = await fetch(
        "/api/admin/integrations/elvanto/import?dryRun=false",
        { method: "POST", body: fd },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      const data = (await res.json()) as ImportResponse;
      setImportResult(data);
      toast.success(
        `Imported ${data.imported} new, updated ${data.updated} existing (${data.familiesCreated} families created).`,
      );
    } catch (e) {
      toast.error("Import failed", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setImportBusy(false);
    }
  }, [buildForm, dryRun]);

  const canImport =
    dryRun != null &&
    dryRun.errors.length === 0 &&
    dryRun.totalPeople > 0 &&
    (mode === "file" ? !!file : !!jsonText.trim());

  return (
    <div className="space-y-4">
      <Card className="bg-amber-50/50 border-amber-200/60 dark:bg-amber-950/20 dark:border-amber-900/40">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <RotateCcw className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            Idempotent + atomic
          </CardTitle>
          <CardDescription className="text-sm leading-relaxed">
            Re-importing the same file <span className="font-medium">updates</span>
            rather than duplicates: adults are matched by email (or
            firstName+lastName if no email), children by firstName+lastName+DOB.
            Matched records are updated only on fields that are blank in
            ChildCheck — existing data is never overwritten with blanks. The
            real import runs in a single transaction — any error rolls the
            whole batch back. Always run the dry-run preview first.
          </CardDescription>
        </CardHeader>
      </Card>

      <Tabs value={mode} onValueChange={(v) => setMode(v as InputMode)}>
        <TabsList className="grid w-full sm:w-auto grid-cols-2">
          <TabsTrigger value="file" className="gap-1.5">
            <FileUp className="h-4 w-4" /> CSV file
          </TabsTrigger>
          <TabsTrigger value="json" className="gap-1.5">
            <Info className="h-4 w-4" /> Paste JSON / CSV
          </TabsTrigger>
        </TabsList>
        <TabsContent value="file" className="mt-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileUp className="h-4 w-4 text-primary" /> Upload Elvanto CSV
              </CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                Drag-drop or click to pick a .csv file exported from Elvanto.
                The file is sent to the server only when you click dry-run or
                import.
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
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="json" className="mt-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Info className="h-4 w-4 text-primary" /> Paste Elvanto JSON or CSV
              </CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                Paste either a JSON array of records (preferred) or raw CSV
                text. JSON keys are matched case- + separator-insensitively
                (e.g. <code>firstName</code>, <code>First Name</code>, and{" "}
                <code>first_name</code> all map to the same ChildCheck field).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="elv-json" className="text-xs">
                  Elvanto JSON / CSV text
                </Label>
                <Textarea
                  id="elv-json"
                  value={jsonText}
                  onChange={(e) => {
                    setJsonText(e.target.value);
                    setDryRun(null);
                    setImportResult(null);
                  }}
                  rows={10}
                  placeholder={`[
  {
    "First Name": "John",
    "Last Name": "Smith",
    "Email": "john@example.com",
    "Family ID": "FAM-1",
    "Family Name": "Smith",
    "Family Role": "Head of Household"
  },
  {
    "First Name": "Mary",
    "Last Name": "Smith",
    "Birthday": "2017-03-12",
    "Family ID": "FAM-1",
    "Family Name": "Smith",
    "Family Role": "Child"
  }
]`}
                  className="font-mono text-xs"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void runDryRun()} disabled={dryRunBusy} variant="secondary">
          {dryRunBusy ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Info className="mr-1.5 h-4 w-4" />
          )}
          Dry-run (preview)
        </Button>
        <Button onClick={() => void runImport()} disabled={!canImport || importBusy}>
          {importBusy ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-1.5 h-4 w-4" />
          )}
          Import for real
        </Button>
        {(file || jsonText || dryRun || importResult) && (
          <Button variant="ghost" onClick={reset} disabled={dryRunBusy || importBusy}>
            Reset
          </Button>
        )}
      </div>

      {dryRun && <DryRunPreview result={dryRun} />}
      {importResult && <ImportResultCard result={importResult} />}
    </div>
  );
}

function DryRunPreview({ result }: { result: DryRunResponse }) {
  const ok = result.errors.length === 0;
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
            <Badge variant="outline">Total: {result.totalPeople}</Badge>
            <Badge className="bg-emerald-600 hover:bg-emerald-600">
              New: {result.newPeople}
            </Badge>
            <Badge variant="secondary">Matched: {result.matchedPeople}</Badge>
            <Badge variant="outline">Families: {result.families.length}</Badge>
            <Badge variant={ok ? "outline" : "destructive"}>
              Errors: {result.errors.length}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {(result.parseWarnings.length > 0 || result.unmatchedColumns.length > 0) && (
          <div className="rounded-md border border-amber-200/60 bg-amber-50/40 dark:bg-amber-950/20 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-1">
            <div className="font-medium flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> Notices
            </div>
            <ul className="list-disc pl-5 space-y-0.5">
              {result.parseWarnings.slice(0, 10).map((w, i) => (
                <li key={`w-${i}`}>{w}</li>
              ))}
              {result.unmatchedColumns.length > 0 && (
                <li>
                  Unmatched source columns (ignored):{" "}
                  <code>{result.unmatchedColumns.join(", ")}</code>
                </li>
              )}
            </ul>
          </div>
        )}

        {result.errors.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-2">Errors ({result.errors.length})</h4>
            <div className="max-h-60 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="w-[80px]">Row</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.errors.map((e, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">
                        {e.row === 0 ? "—" : e.row}
                      </TableCell>
                      <TableCell className="text-sm">{e.message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {result.families.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-2">
              Family groups ({result.families.length})
            </h4>
            <div className="max-h-96 overflow-y-auto rounded-md border space-y-3 p-2 bg-muted/20">
              {result.families.map((fam, i) => (
                <div key={i} className="rounded-md border bg-card p-3">
                  <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                    <div className="text-sm">
                      <span className="font-medium">{fam.familyName}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {fam.familyId
                          ? `(Elvanto Family ID: ${fam.familyId})`
                          : "(no Elvanto Family ID — singleton)"}
                      </span>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {fam.members.length} member{fam.members.length === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-card">
                        <TableRow>
                          <TableHead className="w-[60px]">Row</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead className="w-[120px]">Type</TableHead>
                          <TableHead className="w-[140px]">Role</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead className="w-[120px]">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {fam.members.map((m) => (
                          <TableRow key={m.row}>
                            <TableCell className="font-mono text-xs">{m.row}</TableCell>
                            <TableCell className="text-sm">
                              {m.firstName} {m.lastName}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[10px]">
                                {m.personType}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="text-[10px]">
                                {m.role}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {m.email || "—"}
                            </TableCell>
                            <TableCell>
                              {m.action === "create" ? (
                                <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                                  <CheckCircle2 className="h-3.5 w-3.5" /> Create
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                                  <Info className="h-3.5 w-3.5" />
                                  Match ({m.matchReason})
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ImportResultCard({ result }: { result: ImportResponse }) {
  return (
    <Card className="bg-emerald-50/50 border-emerald-200/60 dark:bg-emerald-950/20 dark:border-emerald-900/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          Import complete
        </CardTitle>
        <CardDescription className="text-sm mt-0.5">
          The batch was committed atomically — every row was written, or none were.
          An <code>elvanto.import</code> audit-log entry was written.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <Badge className="bg-emerald-600 hover:bg-emerald-600">
            New: {result.imported}
          </Badge>
          <Badge variant="secondary">Updated: {result.updated}</Badge>
          <Badge variant="outline">
            Families created: {result.familiesCreated}
          </Badge>
          <Badge variant="outline">
            Families matched: {result.familiesMatched}
          </Badge>
          <Badge variant="outline">Total people: {result.totalPeople}</Badge>
          {result.errors.length > 0 && (
            <Badge variant="destructive">Errors: {result.errors.length}</Badge>
          )}
        </div>
        {result.errors.length > 0 && (
          <div className="max-h-40 overflow-y-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead className="w-[80px]">Row</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.errors.map((e, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{e.row}</TableCell>
                    <TableCell className="text-sm">{e.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Visit{" "}
          <a href="/admin/people" className="underline">People</a> or{" "}
          <a href="/admin/families" className="underline">Families</a> to verify.
          Re-importing the same file should now report{" "}
          <code>imported: 0, updated: {result.totalPeople}</code> (idempotency).
        </p>
      </CardContent>
    </Card>
  );
}
