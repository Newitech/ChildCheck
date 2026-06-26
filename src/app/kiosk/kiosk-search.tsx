"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Search,
  Loader2,
  Users,
  AlertTriangle,
  Baby,
  UserPlus,
  CalendarClock,
  ChevronRight,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTerminology } from "@/hooks/use-terminology";
import { formatFullName } from "@/lib/people";

export interface KioskSessionSummary {
  programId: string | null;
  programName: string;
  slug: string | null;
  classCount: number;
  firstScheduleTime: string | null;
  eventCount: number;
}

export interface KioskSearchProps {
  orgName: string;
  todayLabel: string;
  activePrograms: KioskSessionSummary[];
}

interface SearchResultItem {
  familyId: string;
  familyName: string;
  primaryCarers: { firstName: string; middleName: string | null; lastName: string }[];
  childCount: number;
  hasAlerts: boolean;
}

const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 2;

export function KioskSearch({
  orgName,
  todayLabel,
  activePrograms,
}: KioskSearchProps) {
  const router = useRouter();
  const { t } = useTerminology();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the search input on mount + when the kiosk:reset event fires.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const reset = useCallback(() => {
    setQuery("");
    setResults([]);
    setError(null);
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onReset = () => reset();
    window.addEventListener("kiosk:reset", onReset);
    return () => window.removeEventListener("kiosk:reset", onReset);
  }, [reset]);

  // Debounced search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY_LEN) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/kiosk/search?q=${encodeURIComponent(q)}`,
          { cache: "no-store" },
        );
        if (res.status === 429) {
          setError("Too many searches — please wait a moment and try again.");
          setResults([]);
          toast.error("Rate limited", {
            description: "Too many searches. Slow down a little.",
          });
          return;
        }
        if (res.status === 401) {
          setError("Kiosk session expired — please unlock again.");
          setResults([]);
          return;
        }
        if (!res.ok) {
          setError("Search failed. Please try again.");
          setResults([]);
          return;
        }
        const data = (await res.json()) as { items: SearchResultItem[] };
        setResults(data.items);
        setError(null);
      } catch (e) {
        console.error("[kiosk-search] fetch error:", e);
        setError("Network error — please try again.");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  const hasActivePrograms = activePrograms.length > 0;

  return (
    <div className="flex-1 flex flex-col">
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 sm:py-10 flex-1 flex flex-col gap-6">
        {/* Header */}
        <div className="text-center space-y-1.5">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
            {orgName}
          </h1>
          <p className="text-base text-muted-foreground">
            Search for your family to check in or check out.
          </p>
        </div>

        {/* Search input */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-6 w-6 text-muted-foreground" />
            <Input
              ref={inputRef}
              type="search"
              inputMode="search"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Search family by name, phone or email"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-16 pl-14 pr-4 text-lg sm:text-xl rounded-xl"
              aria-label="Search for your family"
            />
            {loading && (
              <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 h-6 w-6 animate-spin text-muted-foreground" />
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <p className="text-xs text-muted-foreground px-1">
            Type at least {MIN_QUERY_LEN} characters. Searches are rate-limited
            to protect privacy.
          </p>
        </div>

        {/* Today's sessions panel */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-primary" />
              Today&apos;s sessions
            </CardTitle>
            <CardDescription className="text-xs">
              {todayLabel}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {hasActivePrograms ? (
              <div className="flex flex-wrap gap-2">
                {activePrograms.map((p) => {
                  const label =
                    p.programId === null
                      ? `${p.eventCount} event${p.eventCount === 1 ? "" : "s"}`
                      : p.programName;
                  const sub =
                    p.programId === null
                      ? "Standalone"
                      : p.firstScheduleTime
                        ? `${p.classCount} ${t("group_plural").toLowerCase()} · ${p.firstScheduleTime}`
                        : `${p.classCount} ${t("group_plural").toLowerCase()}`;
                  return (
                    <div
                      key={p.programId ?? "standalone"}
                      className="inline-flex flex-col items-start rounded-lg border bg-muted/30 px-4 py-2"
                    >
                      <span className="font-medium text-sm">{label}</span>
                      <span className="text-[11px] text-muted-foreground">{sub}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No scheduled programs today — use Events for one-off check-ins.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Visitor quick-add */}
        <Button
          asChild
          variant="outline"
          className="h-14 text-base"
          size="lg"
        >
          <Link href="/kiosk/visitor" aria-label="Start visitor quick check-in">
            <UserPlus className="mr-2 h-5 w-5" />
            Visitor / First-time check-in
          </Link>
        </Button>

        {/* Search results */}
        <div className="space-y-2">
          {query.trim().length >= MIN_QUERY_LEN && !loading && results.length === 0 && !error && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No families matched &ldquo;{query.trim()}&rdquo;.
              </CardContent>
            </Card>
          )}
          <div className="max-h-[55vh] overflow-y-auto scroll-thin space-y-2">
            {results.map((r) => (
              <FamilyResultCard key={r.familyId} item={r} t={t} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FamilyResultCard({
  item,
  t,
}: {
  item: SearchResultItem;
  t: (key: Parameters<ReturnType<typeof useTerminology>["t"]>[0]) => string;
}) {
  const router = useRouter();
  const carerLabel =
    item.primaryCarers.length === 0
      ? "—"
      : item.primaryCarers.map((c) => formatFullName(c)).join(", ");
  return (
    <button
      type="button"
      onClick={() => router.push(`/kiosk/family/${item.familyId}`)}
      className="w-full text-left rounded-xl border bg-card hover:bg-accent/40 transition-colors p-4 flex items-center gap-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Select ${item.familyName} family`}
    >
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
        <Users className="h-6 w-6" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-lg truncate">{item.familyName}</p>
          {item.hasAlerts && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> Alerts
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground truncate">{carerLabel}</p>
        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
          <Baby className="h-3 w-3" />
          {item.childCount} {item.childCount === 1 ? t("child") : t("child_plural")}
        </p>
      </div>
      <span className="inline-flex items-center justify-center rounded-md border bg-background px-3 h-12 text-sm font-medium shrink-0">
        View
        <ChevronRight className="h-4 w-4 ml-1" />
      </span>
    </button>
  );
}
