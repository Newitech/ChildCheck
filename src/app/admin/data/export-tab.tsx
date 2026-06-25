"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  CalendarRange,
  Download,
  FileText,
  Loader2,
  ScrollText,
  Users,
  UsersRound,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface ExportCardProps {
  title: string;
  description: string;
  icon: typeof Users;
  busy: boolean;
  onDownload: () => void;
  withDateRange?: boolean;
  dateFrom?: string;
  dateTo?: string;
  setDateFrom?: (v: string) => void;
  setDateTo?: (v: string) => void;
}

function ExportCard({
  title,
  description,
  icon: Icon,
  busy,
  onDownload,
  withDateRange,
  dateFrom,
  dateTo,
  setDateFrom,
  setDateTo,
}: ExportCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-3 min-w-0">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <CardTitle className="text-base">{title}</CardTitle>
              <CardDescription className="text-sm leading-relaxed mt-0.5">
                {description}
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="text-[10px] shrink-0">CSV</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {withDateRange && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${title}-from`} className="text-xs">
                Date from
              </Label>
              <Input
                id={`${title}-from`}
                type="date"
                value={dateFrom ?? ""}
                onChange={(e) => setDateFrom?.(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${title}-to`} className="text-xs">
                Date to
              </Label>
              <Input
                id={`${title}-to`}
                type="date"
                value={dateTo ?? ""}
                onChange={(e) => setDateTo?.(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>
        )}
        <Button onClick={onDownload} disabled={busy} className="w-full sm:w-auto">
          {busy ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-1.5 h-4 w-4" />
          )}
          Download CSV
        </Button>
      </CardContent>
    </Card>
  );
}

function todayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysAgoIsoDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function ExportTab() {
  const [busyType, setBusyType] = useState<string | null>(null);
  const [attendanceFrom, setAttendanceFrom] = useState(daysAgoIsoDate(29));
  const [attendanceTo, setAttendanceTo] = useState(todayIsoDate());
  const [auditFrom, setAuditFrom] = useState(daysAgoIsoDate(29));
  const [auditTo, setAuditTo] = useState(todayIsoDate());

  const download = useCallback(
    async (type: "people" | "families" | "attendance" | "audit", params?: Record<string, string>) => {
      setBusyType(type);
      try {
        const qs = new URLSearchParams({ type, format: "csv" });
        if (params) {
          for (const [k, v] of Object.entries(params)) {
            if (v) qs.set(k, v);
          }
        }
        // The browser handles the CSV download via Content-Disposition.
        const url = `/api/admin/export?${qs.toString()}`;
        const res = await fetch(url);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `status ${res.status}`);
        }
        const blob = await res.blob();
        // Extract filename from Content-Disposition, fallback to a sensible name.
        const cd = res.headers.get("Content-Disposition") ?? "";
        const m = /filename="?([^";]+)"?/i.exec(cd);
        const filename = m?.[1] ?? `${type}-export.csv`;
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objUrl);
        toast.success(`${type[0].toUpperCase()}${type.slice(1)} CSV downloaded`);
      } catch (e) {
        toast.error("Export failed", {
          description: e instanceof Error ? e.message : undefined,
        });
      } finally {
        setBusyType(null);
      }
    },
    [],
  );

  return (
    <div className="space-y-4">
      <Card className="bg-muted/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-primary" /> Export format &amp; permissions
          </CardTitle>
          <CardDescription className="text-sm leading-relaxed">
            All exports are RFC-4180 CSV files with a header row and properly
            quoted fields. The export runs against your current database; if you
            need an offline backup, also use the backup feature (Stage 13).
            Exports are audited. Admin / PeopleManager / Security can download.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ExportCard
          title="People"
          description="Every person (adults + children) with all relevant fields. Sensitive medical / allergy fields are included — handle the file with care."
          icon={Users}
          busy={busyType === "people"}
          onDownload={() => void download("people")}
        />
        <ExportCard
          title="Families"
          description="One row per family with carer / child / guardian name lists (semicolon-separated) and a member count."
          icon={UsersRound}
          busy={busyType === "families"}
          onDownload={() => void download("families")}
        />
        <ExportCard
          title="Attendance"
          description="One row per check-in record. Includes program / class / room, check-in / check-out times, duration in minutes, method, daily code."
          icon={CalendarRange}
          busy={busyType === "attendance"}
          withDateRange
          dateFrom={attendanceFrom}
          dateTo={attendanceTo}
          setDateFrom={setAttendanceFrom}
          setDateTo={setAttendanceTo}
          onDownload={() =>
            void download("attendance", {
              dateFrom: attendanceFrom,
              dateTo: attendanceTo,
            })
          }
        />
        <ExportCard
          title="Audit log"
          description="Every audit-log entry (action, actor, entity, details, IP, timestamp). Useful for compliance review."
          icon={ScrollText}
          busy={busyType === "audit"}
          withDateRange
          dateFrom={auditFrom}
          dateTo={auditTo}
          setDateFrom={setAuditFrom}
          setDateTo={setAuditTo}
          onDownload={() =>
            void download("audit", {
              dateFrom: auditFrom,
              dateTo: auditTo,
            })
          }
        />
      </div>
    </div>
  );
}
