"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2, FileDown } from "lucide-react";

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

const EXPORT_COLUMNS = [
  "First Name",
  "Last Name",
  "Email",
  "Mobile",
  "Birthday",
  "Gender",
  "Family ID",
  "Family Name",
  "Family Role",
  "School Grade",
  "Medical Info",
  "Allergies",
];

interface PreviewRow {
  cells: string[];
}

/**
 * Export tab — downloads an Elvanto-format CSV of every active ChildCheck
 * person (one row per family membership). Includes a "preview first 5
 * rows" panel that fires the same endpoint and parses the CSV client-side.
 */
export function ExportTab() {
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const download = useCallback(async () => {
    setDownloadBusy(true);
    try {
      const res = await fetch("/api/admin/integrations/elvanto/export");
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const m = /filename="?([^";]+)"?/i.exec(cd);
      const filename = m?.[1] ?? `childcheck-to-elvanto-${new Date().toISOString().slice(0, 10)}.csv`;
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
      toast.success("Elvanto CSV downloaded");
    } catch (e) {
      toast.error("Export failed", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setDownloadBusy(false);
    }
  }, []);

  const loadPreview = useCallback(async () => {
    setPreviewBusy(true);
    setPreviewError(null);
    setPreview(null);
    try {
      const res = await fetch("/api/admin/integrations/elvanto/export");
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      const text = await res.text();
      const rows = parseCsvClient(text).slice(0, 5);
      setPreview(rows.map((r) => ({ cells: r })));
      toast.success(`Preview loaded (${rows.length} rows shown).`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPreviewError(msg);
      toast.error("Preview failed", { description: msg });
    } finally {
      setPreviewBusy(false);
    }
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-3 min-w-0">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                <FileDown className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <CardTitle className="text-base">Export to Elvanto CSV</CardTitle>
                <CardDescription className="text-sm leading-relaxed mt-0.5">
                  Streams an Elvanto-format CSV of every active ChildCheck
                  person. A person with multiple family memberships appears on
                  multiple rows (one per family). Family ID is the ChildCheck
                  Family.id — Elvanto will treat them as new families on
                  re-import.
                </CardDescription>
              </div>
            </div>
            <Badge variant="outline" className="text-[10px] shrink-0">CSV</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void download()} disabled={downloadBusy}>
              {downloadBusy ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-1.5 h-4 w-4" />
              )}
              Download Elvanto CSV
            </Button>
            <Button
              onClick={() => void loadPreview()}
              disabled={previewBusy}
              variant="outline"
            >
              {previewBusy ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <FileDown className="mr-1.5 h-4 w-4" />
              )}
              Preview first 5 rows
            </Button>
          </div>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none hover:text-foreground">
              Column order ({EXPORT_COLUMNS.length} columns)
            </summary>
            <div className="mt-2 leading-relaxed">
              <code>{EXPORT_COLUMNS.join(", ")}</code>
            </div>
          </details>
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Preview (first 5 rows)</CardTitle>
            <CardDescription className="text-sm mt-0.5">
              From the actual export endpoint — exactly what the download would
              contain.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border max-h-96">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    {EXPORT_COLUMNS.map((c) => (
                      <TableHead key={c}>{c}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((r, i) => (
                    <TableRow key={i}>
                      {r.cells.map((c, j) => (
                        <TableCell
                          key={j}
                          className="text-xs text-muted-foreground whitespace-nowrap"
                        >
                          {c || "—"}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {previewError && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-4 text-sm text-destructive">
            Preview failed: <code>{previewError}</code>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Tiny client-side CSV parser for the preview. Handles quoted fields,
 * doubled double-quotes, CRLF + LF. (Mirror of the server-side parser.)
 */
function parseCsvClient(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.length > 0)) rows.push(row);
  }
  return rows;
}
