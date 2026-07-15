"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Search,
  Loader2,
  Users,
  AlertTriangle,
  Baby,
  ChevronRight,
  ShieldCheck,
  KeyRound,
  Delete,
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

const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 2;

interface SearchResultItem {
  familyId: string;
  familyName: string;
  primaryCarers: { firstName: string; middleName: string | null; lastName: string }[];
  childCount: number;
  hasAlerts: boolean;
}

function formatFullName(c: { firstName: string; middleName: string | null; lastName: string }): string {
  return [c.firstName, c.middleName, c.lastName].filter(Boolean).join(" ");
}

export function GuardianSigninForm({ orgName }: { orgName: string }) {
  const router = useRouter();
  const { t } = useTerminology();

  // Step state: "search" | "pin" | "submitting"
  const [step, setStep] = useState<"search" | "pin" | "submitting">("search");
  const [selectedFamily, setSelectedFamily] = useState<SearchResultItem | null>(null);

  // Search state.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // PIN state.
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const pinRef = useRef<HTMLInputElement>(null);

  // Auto-focus on mount.
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Debounced search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY_LEN) {
      setResults([]);
      setSearchLoading(false);
      setSearchError(null);
      return;
    }
    setSearchLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/kiosk/search?q=${encodeURIComponent(q)}`,
          { cache: "no-store" },
        );
        if (res.status === 429) {
          setSearchError("Too many searches — wait a moment.");
          setResults([]);
          return;
        }
        if (!res.ok) {
          setSearchError("Search failed. Try again.");
          setResults([]);
          return;
        }
        const data = (await res.json()) as { items: SearchResultItem[] };
        setResults(data.items);
        setSearchError(null);
      } catch {
        setSearchError("Network error.");
        setResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  const selectFamily = useCallback((family: SearchResultItem) => {
    setSelectedFamily(family);
    setStep("pin");
    setPin("");
    setPinError(null);
  }, []);

  const backToSearch = useCallback(() => {
    setStep("search");
    setSelectedFamily(null);
    setPin("");
    setPinError(null);
    inputRef.current?.focus();
  }, []);

  // Auto-focus PIN input.
  useEffect(() => {
    if (step === "pin") pinRef.current?.focus();
  }, [step]);

  const handlePinSubmit = useCallback(async () => {
    if (!selectedFamily) return;
    if (!/^\d{4,6}$/.test(pin)) {
      setPinError("PIN must be 4–6 digits.");
      return;
    }
    setPinError(null);
    setStep("submitting");
    try {
      const res = await fetch("/api/guardian/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyId: selectedFamily.familyId, pin }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 429) {
          setPinError("Too many attempts. Wait a minute.");
          setStep("pin");
          return;
        }
        if (err.error === "invalid_pin") {
          setPinError("Incorrect PIN. Try again.");
          setStep("pin");
          return;
        }
        setPinError(err.error ?? "Sign-in failed.");
        setStep("pin");
        return;
      }
      toast.success("Signed in");
      router.push("/guardian/family");
    } catch {
      setPinError("Network error. Try again.");
      setStep("pin");
    }
  }, [selectedFamily, pin, router]);

  // --- SEARCH STEP ---
  if (step === "search") {
    return (
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-1.5">
          <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-3">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Guardian sign-in</h1>
          <p className="text-sm text-muted-foreground">
            Find your family, then enter your PIN to manage it.
          </p>
        </div>

        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              ref={inputRef}
              type="search"
              inputMode="search"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Search by family name, phone or email"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-14 pl-12 pr-4 text-lg rounded-xl"
              aria-label="Search for your family"
            />
            {searchLoading && (
              <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 animate-spin text-muted-foreground" />
            )}
          </div>
          {searchError && <p className="text-sm text-destructive">{searchError}</p>}
          <p className="text-xs text-muted-foreground px-1">
            Type at least {MIN_QUERY_LEN} characters.
          </p>
        </div>

        <div className="space-y-2 max-h-[50vh] overflow-y-auto scroll-thin">
          {query.trim().length >= MIN_QUERY_LEN && !searchLoading && results.length === 0 && !searchError && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No families matched &ldquo;{query.trim()}&rdquo;.
              </CardContent>
            </Card>
          )}
          {results.map((r) => (
            <FamilyResultCard key={r.familyId} item={r} t={t} onSelect={selectFamily} />
          ))}
        </div>
      </div>
    );
  }

  // --- PIN STEP ---
  const carerNames = selectedFamily
    ? selectedFamily.primaryCarers.map(formatFullName).join(", ")
    : "—";

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="text-center space-y-1.5">
        <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-3">
          <KeyRound className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Enter your PIN</h1>
        <Card className="text-left">
          <CardContent className="pt-4 space-y-1">
            <p className="font-semibold">{selectedFamily?.familyName}</p>
            <p className="text-sm text-muted-foreground">
              {carerNames}
            </p>
            <p className="text-xs text-muted-foreground">
              {selectedFamily?.childCount} {selectedFamily?.childCount === 1 ? t("child") : t("child_plural")}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <div className="relative">
          <Input
            ref={pinRef}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            placeholder="4–6 digit PIN"
            value={pin}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 6);
              setPin(v);
              setPinError(null);
            }}
            onKeyDown={(e) => { if (e.key === "Enter") handlePinSubmit(); }}
            className="h-16 text-center text-2xl tracking-[0.5em] rounded-xl"
            aria-label="Enter your guardian PIN"
          />
          {pin && (
            <button
              type="button"
              onClick={() => { setPin(""); setPinError(null); pinRef.current?.focus(); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear PIN"
            >
              <Delete className="h-4 w-4" />
            </button>
          )}
        </div>
        {pinError && <p className="text-sm text-destructive text-center">{pinError}</p>}
      </div>

      <div className="space-y-3">
        <Button
          onClick={handlePinSubmit}
          disabled={step === "submitting" || pin.length < 4}
          className="w-full h-12 text-base"
        >
          {step === "submitting" ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in…
            </>
          ) : (
            <>
              <KeyRound className="mr-2 h-4 w-4" /> Sign in
            </>
          )}
        </Button>
        <Button variant="ghost" onClick={backToSearch} className="w-full">
          ← Back to family search
        </Button>
      </div>
    </div>
  );
}

function FamilyResultCard({
  item,
  t,
  onSelect,
}: {
  item: SearchResultItem;
  t: (key: Parameters<ReturnType<typeof useTerminology>["t"]>[0]) => string;
  onSelect: (family: SearchResultItem) => void;
}) {
  const carerLabel =
    item.primaryCarers.length === 0
      ? "—"
      : item.primaryCarers.map(formatFullName).join(", ");
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
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
        Select
        <ChevronRight className="h-4 w-4 ml-1" />
      </span>
    </button>
  );
}
