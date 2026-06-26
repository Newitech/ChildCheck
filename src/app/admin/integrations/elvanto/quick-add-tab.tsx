"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  UserPlus,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

type FieldKey =
  | "firstName"
  | "lastName"
  | "email"
  | "mobile"
  | "birthday"
  | "gender"
  | "familyName"
  | "familyRole"
  | "schoolGrade"
  | "medicalInfo"
  | "allergies";

const EMPTY_FORM: Record<FieldKey, string> = {
  firstName: "",
  lastName: "",
  email: "",
  mobile: "",
  birthday: "",
  gender: "",
  familyName: "",
  familyRole: "Head of Household",
  schoolGrade: "",
  medicalInfo: "",
  allergies: "",
};

interface DryRunResponse {
  dryRun: true;
  person: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    dateOfBirth: string | null;
    gender: string | null;
    personType: string;
    isVisitor: boolean;
  };
  familyRole: string;
  familyName: string;
  familyIdElvanto: string | null;
  action: "create" | "match";
  matchedPersonId: string | null;
  matchReason: string | null;
  existingFamilyId: string | null;
}

interface ImportResponse {
  dryRun: false;
  personId: string;
  action: "create" | "match";
  familyId: string;
  familyCreated: boolean;
  familyRole: string;
}

/**
 * Quick-add tab — a single-record form with Elvanto field labels. Submits
 * to the individual import API. Dry-run optional.
 */
export function QuickAddTab() {
  const [form, setForm] = useState<Record<FieldKey, string>>(EMPTY_FORM);
  const [dryRunBusy, setDryRunBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [dryRun, setDryRun] = useState<DryRunResponse | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);

  const set = useCallback((k: FieldKey, v: string) => {
    setForm((prev) => ({ ...prev, [k]: v }));
    setDryRun(null);
    setResult(null);
  }, []);

  const buildBody = useCallback((): Record<string, string> | null => {
    if (!form.firstName.trim()) {
      toast.error("First Name is required.");
      return null;
    }
    if (!form.lastName.trim()) {
      toast.error("Last Name is required.");
      return null;
    }
    return {
      "First Name": form.firstName.trim(),
      "Last Name": form.lastName.trim(),
      Email: form.email.trim(),
      Mobile: form.mobile.trim(),
      Birthday: form.birthday.trim(),
      Gender: form.gender,
      "Family Name": form.familyName.trim(),
      "Family Role": form.familyRole,
      "School Grade": form.schoolGrade.trim(),
      "Medical Info": form.medicalInfo.trim(),
      Allergies: form.allergies.trim(),
    };
  }, [form]);

  const runDryRun = useCallback(async () => {
    const body = buildBody();
    if (!body) return;
    setDryRunBusy(true);
    setResult(null);
    try {
      const res = await fetch(
        "/api/admin/integrations/elvanto/import-one?dryRun=true",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      const data = (await res.json()) as DryRunResponse;
      setDryRun(data);
      toast.success(
        data.action === "create"
          ? "Dry-run OK — would CREATE a new person."
          : `Dry-run OK — would MATCH an existing person (${data.matchReason}).`,
      );
    } catch (e) {
      toast.error("Dry-run failed", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setDryRunBusy(false);
    }
  }, [buildBody]);

  const runImport = useCallback(async () => {
    const body = buildBody();
    if (!body) return;
    setImportBusy(true);
    try {
      const res = await fetch(
        "/api/admin/integrations/elvanto/import-one?dryRun=false",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      const data = (await res.json()) as ImportResponse;
      setResult(data);
      toast.success(
        data.action === "create"
          ? `Created new person (${data.familyCreated ? "new family" : "existing family"}).`
          : `Matched existing person; updated + attached to family.`,
      );
    } catch (e) {
      toast.error("Quick-add failed", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setImportBusy(false);
    }
  }, [buildBody]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="h-4 w-4 text-primary" /> Quick add a single Elvanto record
          </CardTitle>
          <CardDescription className="text-sm leading-relaxed">
            For one-off imports (e.g. a new family joins mid-term). Maps the
            Elvanto fields below and either creates a new Person + Family or
            matches an existing one (same idempotency rules as the bulk
            import). Address fields are not stored (see data-minimisation note).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="basic">
            <TabsList className="grid w-full sm:w-auto grid-cols-2">
              <TabsTrigger value="basic">Basic</TabsTrigger>
              <TabsTrigger value="extra">Extra fields</TabsTrigger>
            </TabsList>
            <TabsContent value="basic" className="mt-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField
                  label="First Name"
                  value={form.firstName}
                  onChange={(v) => set("firstName", v)}
                  required
                />
                <FormField
                  label="Last Name"
                  value={form.lastName}
                  onChange={(v) => set("lastName", v)}
                  required
                />
                <FormField
                  label="Email"
                  value={form.email}
                  onChange={(v) => set("email", v)}
                  type="email"
                />
                <FormField
                  label="Mobile"
                  value={form.mobile}
                  onChange={(v) => set("mobile", v)}
                  type="tel"
                />
                <FormField
                  label="Birthday"
                  value={form.birthday}
                  onChange={(v) => set("birthday", v)}
                  placeholder="YYYY-MM-DD"
                />
                <div className="space-y-1.5">
                  <Label className="text-xs">Gender</Label>
                  <Select
                    value={form.gender}
                    onValueChange={(v) => set("gender", v === "—" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="—">—</SelectItem>
                      <SelectItem value="Male">Male</SelectItem>
                      <SelectItem value="Female">Female</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <FormField
                  label="Family Name"
                  value={form.familyName}
                  onChange={(v) => set("familyName", v)}
                />
                <div className="space-y-1.5">
                  <Label className="text-xs">Family Role</Label>
                  <Select
                    value={form.familyRole}
                    onValueChange={(v) => set("familyRole", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Head of Household">Head of Household</SelectItem>
                      <SelectItem value="Spouse">Spouse</SelectItem>
                      <SelectItem value="Child">Child</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                      <SelectItem value="Visitor">Visitor</SelectItem>
                      <SelectItem value="Guest">Guest</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="extra" className="mt-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField
                  label="School Grade"
                  value={form.schoolGrade}
                  onChange={(v) => set("schoolGrade", v)}
                />
                <div className="col-span-1 sm:col-span-2">
                  <FormField
                    label="Medical Info"
                    value={form.medicalInfo}
                    onChange={(v) => set("medicalInfo", v)}
                  />
                </div>
                <div className="col-span-1 sm:col-span-2">
                  <FormField
                    label="Allergies"
                    value={form.allergies}
                    onChange={(v) => set("allergies", v)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Tip: any value in <span className="font-medium">Medical Info</span>{" "}
                containing the word “allerg” is appended to the{" "}
                <code>Allergies</code> field on import.
              </p>
            </TabsContent>
          </Tabs>

          <div className="flex flex-wrap gap-2 mt-4">
            <Button onClick={() => void runDryRun()} disabled={dryRunBusy} variant="secondary">
              {dryRunBusy ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Info className="mr-1.5 h-4 w-4" />
              )}
              Dry-run
            </Button>
            <Button onClick={() => void runImport()} disabled={importBusy}>
              {importBusy ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="mr-1.5 h-4 w-4" />
              )}
              Import person
            </Button>
          </div>
        </CardContent>
      </Card>

      {dryRun && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              {dryRun.action === "create" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Info className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              )}
              Dry-run preview
            </CardTitle>
            <CardDescription className="text-sm mt-0.5">
              No database writes occurred.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-1.5">
              <Badge variant={dryRun.action === "create" ? "default" : "secondary"}>
                Action: {dryRun.action}
              </Badge>
              {dryRun.matchReason && (
                <Badge variant="outline">Match: {dryRun.matchReason}</Badge>
              )}
              <Badge variant="outline">Role: {dryRun.familyRole}</Badge>
              <Badge variant="outline">Family: {dryRun.familyName || "(derived from surname)"}</Badge>
            </div>
            <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto">
{JSON.stringify(dryRun, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {result && (
        <Card className="bg-emerald-50/50 border-emerald-200/60 dark:bg-emerald-950/20 dark:border-emerald-900/40">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              {result.action === "create" ? "Person created" : "Person matched + updated"}
            </CardTitle>
            <CardDescription className="text-sm mt-0.5">
              An <code>elvanto.importOne</code> audit-log entry was written.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-1.5">
              <Badge className="bg-emerald-600 hover:bg-emerald-600">
                {result.action === "create" ? "New" : "Matched"}
              </Badge>
              <Badge variant="outline">
                Family {result.familyCreated ? "created" : "matched"}
              </Badge>
              <Badge variant="outline">Role: {result.familyRole}</Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              Person ID: <code>{result.personId}</code>
              <br />
              Family ID: <code>{result.familyId}</code>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              <a href={`/admin/people/${result.personId}`} className="underline">
                Open person detail →
              </a>
            </p>
          </CardContent>
        </Card>
      )}

      {!result && !dryRun && (
        <Card className="bg-muted/30">
          <CardContent className="py-3 flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-amber-600 dark:text-amber-400" />
            <span>
              Real imports are wrapped in a single transaction — any error
              rolls the entire record back. The Person is matched (by email for
              adults, by name+DOB for children) before the Family is created,
              so re-submitting the same record will update rather than
              duplicate.
            </span>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface FormFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}

function FormField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
}: FormFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
