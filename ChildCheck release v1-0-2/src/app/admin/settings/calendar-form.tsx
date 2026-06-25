"use client";

import { useState } from "react";
import { CalendarDays, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConfig } from "@/hooks/use-config";
import { orderedDays, dayLong, dayNumberOfWeek } from "@/lib/week";

const WEEK_START_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "6", label: "Saturday" },
];

/**
 * Calendar settings — which day the week starts on.
 *
 * SDA default: Sunday (so Saturday is the 7th-day Sabbath). Other orgs may
 * prefer Monday (schools, childcare) or another day. Drives calendar column
 * order + "day N of week" numbering across the app.
 */
export function CalendarForm() {
  const { config, refresh } = useConfig();
  const current = String(config?.weekStartsOn ?? 0);
  const [value, setValue] = useState(current);
  const [saving, setSaving] = useState(false);

  const dirty = value !== current;
  const weekStart = (parseInt(value, 10) || 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6;

  async function onSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/organisation/week-start", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStartsOn: parseInt(value, 10) }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? "Could not save calendar setting");
        return;
      }
      toast.success("Calendar setting saved");
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" />
          <div>
            <CardTitle className="text-lg">Calendar &amp; week</CardTitle>
            <CardDescription>
              Which day does your week start on? This sets calendar column order and
              &ldquo;day N of the week&rdquo; numbering. SDA organisations use Sunday
              (Saturday is the 7th-day Sabbath).
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="week-start" className="text-sm font-medium">
            Week starts on
          </label>
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger id="week-start" className="w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEK_START_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="text-sm font-medium mb-2">Preview — your week</p>
          <div className="flex flex-wrap gap-2">
            {orderedDays(weekStart).map((jsDay, i) => (
              <div
                key={jsDay}
                className="flex flex-col items-center justify-center rounded-md border bg-card px-3 py-2 min-w-[3.5rem]"
              >
                <span className="text-[10px] uppercase text-muted-foreground">
                  Day {dayNumberOfWeek(jsDay, weekStart)}
                </span>
                <span className="text-sm font-semibold">{dayLong(jsDay)}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            {weekStart === 0
              ? "Sunday-first: Saturday is the 7th day."
              : weekStart === 1
                ? "Monday-first: Sunday is the 7th day."
                : "Saturday-first: Friday is the 7th day."}
          </p>
        </div>

        <div className="flex justify-end">
          <Button onClick={onSave} disabled={!dirty || saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
