"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type { PersonListDTO } from "@/lib/people";
import { ALL_STAFF_ROLES, LOGIN_REQUIRED_ROLES } from "@/lib/person-roles";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: PersonListDTO | null;
  onSaved: () => void;
}

type Form = {
  firstName: string;
  middleName: string;
  lastName: string;
  preferredName: string;
  personType: "Adult" | "Child";
  email: string;
  phone: string;
  dateOfBirth: string;
  schoolGrade: string;
  gender: "Male" | "Female" | "Other" | "";
  allergies: string;
  medicalNotes: string;
  dietaryNotes: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  isVisitor: boolean;
  // Optional one-shot (create only): initial PIN, staff roles, family link.
  pin: string;
  roles: string[];
  familyId: string;
  familyRole: "PrimaryCarer" | "AuthorisedGuardian" | "Child" | "";
};

const empty: Form = {
  firstName: "",
  middleName: "",
  lastName: "",
  preferredName: "",
  personType: "Adult",
  email: "",
  phone: "",
  dateOfBirth: "",
  schoolGrade: "",
  gender: "",
  allergies: "",
  medicalNotes: "",
  dietaryNotes: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  isVisitor: false,
  pin: "",
  roles: [],
  familyId: "",
  familyRole: "",
};

export function PersonForm({ open, onOpenChange, editing, onSaved }: Props) {
  const [form, setForm] = useState<Form>(empty);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      // Load full detail to prefill (medical fields included).
      setLoading(true);
      (async () => {
        try {
          const res = await fetch(`/api/admin/people/${editing.id}`, {
            cache: "no-store",
          });
          if (!res.ok) throw new Error(`status ${res.status}`);
          const d = (await res.json()) as {
            firstName: string;
            middleName: string | null;
            lastName: string;
            preferredName: string | null;
            personType: string;
            email: string | null;
            phone: string | null;
            dateOfBirth: string | null;
            schoolGrade: string | null;
            gender: string | null;
            allergies: string | null;
            medicalNotes: string | null;
            dietaryNotes: string | null;
            emergencyContactName: string | null;
            emergencyContactPhone: string | null;
            isVisitor: boolean;
          };
          setForm({
            firstName: d.firstName,
            middleName: d.middleName ?? "",
            lastName: d.lastName,
            preferredName: d.preferredName ?? "",
            personType: (d.personType === "Child" ? "Child" : "Adult"),
            email: d.email ?? "",
            phone: d.phone ?? "",
            dateOfBirth: d.dateOfBirth ? d.dateOfBirth.slice(0, 10) : "",
            schoolGrade: d.schoolGrade ?? "",
            gender: (d.gender as Form["gender"]) ?? "",
            allergies: d.allergies ?? "",
            medicalNotes: d.medicalNotes ?? "",
            dietaryNotes: d.dietaryNotes ?? "",
            emergencyContactName: d.emergencyContactName ?? "",
            emergencyContactPhone: d.emergencyContactPhone ?? "",
            isVisitor: d.isVisitor,
            pin: "",
            roles: [],
            familyId: "",
            familyRole: "",
          });
        } catch (e) {
          toast.error("Failed to load person", {
            description: e instanceof Error ? e.message : undefined,
          });
        } finally {
          setLoading(false);
        }
      })();
    } else {
      setForm(empty);
    }
  }, [open, editing]);

  const handleSave = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast.error("First name and last name are required.");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        firstName: form.firstName.trim(),
        middleName: form.middleName.trim() || null,
        lastName: form.lastName.trim(),
        preferredName: form.preferredName.trim() || null,
        personType: form.personType,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        dateOfBirth: form.dateOfBirth
          ? new Date(form.dateOfBirth + "T00:00:00Z").toISOString()
          : null,
        schoolGrade: form.schoolGrade.trim() || null,
        gender: form.gender === "" ? null : form.gender,
        allergies: form.allergies.trim() || null,
        medicalNotes: form.medicalNotes.trim() || null,
        dietaryNotes: form.dietaryNotes.trim() || null,
        emergencyContactName: form.emergencyContactName.trim() || null,
        emergencyContactPhone: form.emergencyContactPhone.trim() || null,
        isVisitor: form.isVisitor,
      };
      // Optional one-shot fields (create only).
      if (!editing) {
        if (form.pin && /^\d{4,6}$/.test(form.pin)) {
          payload.pin = form.pin;
        }
        if (form.roles.length > 0) {
          payload.roles = form.roles;
        }
        if (form.familyId && form.familyRole) {
          payload.familyId = form.familyId;
          payload.familyRole = form.familyRole;
        }
      }
      const res = editing
        ? await fetch(`/api/admin/people/${editing.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/admin/people", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success(editing ? "Person updated" : "Person created");
      onSaved();
    } catch (e) {
      toast.error("Save failed", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit person" : "Add person"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update this person's details. Changes are audit-logged."
              : "Create a new adult or child record. Required fields are marked."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <Tabs defaultValue="identity" className="flex-1 overflow-hidden flex flex-col">
            <TabsList className={`grid w-full grid-cols-2 ${editing ? "sm:grid-cols-4" : "sm:grid-cols-5"}`}>
              <TabsTrigger value="identity">Identity</TabsTrigger>
              <TabsTrigger value="contact">Contact</TabsTrigger>
              <TabsTrigger value="child">Child details</TabsTrigger>
              <TabsTrigger value="medical">
                Medical
                <span className="ml-1.5 text-[10px] text-destructive">●</span>
              </TabsTrigger>
              {!editing && <TabsTrigger value="access">Access</TabsTrigger>}
            </TabsList>

            <div className="overflow-y-auto scroll-thin px-1 py-3 flex-1">
              <TabsContent value="identity" className="space-y-4 mt-0">
                <div className="grid sm:grid-cols-3 gap-4">
                  <Field label="First name" required>
                    <Input
                      value={form.firstName}
                      onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                      maxLength={80}
                    />
                  </Field>
                  <Field label="Middle name" hint="Optional — full name or initial">
                    <Input
                      value={form.middleName}
                      onChange={(e) => setForm({ ...form, middleName: e.target.value })}
                      maxLength={80}
                    />
                  </Field>
                  <Field label="Last name" required>
                    <Input
                      value={form.lastName}
                      onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                      maxLength={80}
                    />
                  </Field>
                </div>
                <Field label="Preferred name" hint="Optional — what they like to be called">
                  <Input
                    value={form.preferredName}
                    onChange={(e) =>
                      setForm({ ...form, preferredName: e.target.value })
                    }
                    maxLength={80}
                  />
                </Field>
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Person type">
                    <Select
                      value={form.personType}
                      onValueChange={(v) =>
                        setForm({ ...form, personType: v as "Adult" | "Child" })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Adult">Adult</SelectItem>
                        <SelectItem value="Child">Child</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Gender">
                    <Select
                      value={form.gender || "none"}
                      onValueChange={(v) =>
                        setForm({
                          ...form,
                          gender: v === "none" ? "" : (v as Form["gender"]),
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Not specified" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not specified</SelectItem>
                        <SelectItem value="Male">Male</SelectItem>
                        <SelectItem value="Female">Female</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
                  <Switch
                    id="is-visitor"
                    checked={form.isVisitor}
                    onCheckedChange={(v) => setForm({ ...form, isVisitor: v })}
                  />
                  <Label htmlFor="is-visitor" className="text-sm cursor-pointer">
                    Mark as visitor / first-timer
                  </Label>
                </div>
              </TabsContent>

              <TabsContent value="contact" className="space-y-4 mt-0">
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Email">
                    <Input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      maxLength={160}
                    />
                  </Field>
                  <Field label="Phone">
                    <Input
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      maxLength={60}
                    />
                  </Field>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Emergency contact name">
                    <Input
                      value={form.emergencyContactName}
                      onChange={(e) =>
                        setForm({ ...form, emergencyContactName: e.target.value })
                      }
                      maxLength={120}
                    />
                  </Field>
                  <Field label="Emergency contact phone">
                    <Input
                      value={form.emergencyContactPhone}
                      onChange={(e) =>
                        setForm({ ...form, emergencyContactPhone: e.target.value })
                      }
                      maxLength={60}
                    />
                  </Field>
                </div>
              </TabsContent>

              <TabsContent value="child" className="space-y-4 mt-0">
                <p className="text-xs text-muted-foreground">
                  These fields are most relevant when person type is &ldquo;Child&rdquo;,
                  but can be set for anyone.
                </p>
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Date of birth">
                    <Input
                      type="date"
                      value={form.dateOfBirth}
                      onChange={(e) =>
                        setForm({ ...form, dateOfBirth: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="School grade">
                    <Input
                      value={form.schoolGrade}
                      onChange={(e) =>
                        setForm({ ...form, schoolGrade: e.target.value })
                      }
                      maxLength={40}
                      placeholder="e.g. Year 3, Grade 4"
                    />
                  </Field>
                </div>
              </TabsContent>

              <TabsContent value="medical" className="space-y-4 mt-0">
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                  <strong>Sensitive — visible to authorised roles only.</strong>{" "}
                  These fields are never returned in list responses and only
                  appear in detail views for users with view_people permission.
                </div>
                <Field label="Allergies" hint="Free text — list known allergies">
                  <Textarea
                    value={form.allergies}
                    onChange={(e) => setForm({ ...form, allergies: e.target.value })}
                    rows={2}
                    maxLength={2000}
                  />
                </Field>
                <Field label="Medical notes" hint="Asthma, EpiPen, conditions, etc.">
                  <Textarea
                    value={form.medicalNotes}
                    onChange={(e) =>
                      setForm({ ...form, medicalNotes: e.target.value })
                    }
                    rows={3}
                    maxLength={4000}
                  />
                </Field>
                <Field label="Dietary notes" hint="Vegetarian, halal, gluten-free, etc.">
                  <Textarea
                    value={form.dietaryNotes}
                    onChange={(e) =>
                      setForm({ ...form, dietaryNotes: e.target.value })
                    }
                    rows={2}
                    maxLength={2000}
                  />
                </Field>
              </TabsContent>

              {!editing && (
                <TabsContent value="access" className="space-y-4 mt-0">
                  <p className="text-xs text-muted-foreground">
                    Optional — set an initial guardian PIN, grant staff roles,
                    and/or add this person to a family now. You can do all of
                    this later too.
                  </p>

                  {/* Guardian PIN */}
                  <Field label="Guardian PIN" hint="4–6 digits for kiosk & guardian portal (optional)">
                    <Input
                      inputMode="numeric"
                      pattern="\d*"
                      value={form.pin}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          pin: e.target.value.replace(/\D/g, "").slice(0, 6),
                        })
                      }
                      placeholder="e.g. 1234"
                      autoComplete="off"
                      maxLength={6}
                    />
                  </Field>

                  {/* Roles */}
                  <div className="space-y-2">
                    <Label className="text-sm">Staff roles (optional)</Label>
                    <p className="text-xs text-muted-foreground">
                      Admin &amp; PeopleManager need a login — create one after
                      saving.
                    </p>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {ALL_STAFF_ROLES.map((role) => {
                        const checked = form.roles.includes(role);
                        const locked = LOGIN_REQUIRED_ROLES.has(role);
                        return (
                          <label
                            key={role}
                            className={`flex items-center gap-2 rounded-md border p-2 ${
                              locked
                                ? "opacity-60"
                                : "cursor-pointer hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                            }`}
                          >
                            <input
                              type="checkbox"
                              disabled={locked}
                              checked={checked}
                              onChange={() =>
                                setForm((f) => ({
                                  ...f,
                                  roles: checked
                                    ? f.roles.filter((r) => r !== role)
                                    : [...f.roles, role],
                                }))
                              }
                              className="h-4 w-4"
                            />
                            <span className="text-sm font-medium">{role}</span>
                            {locked && (
                              <span className="text-[10px] text-muted-foreground ml-auto">
                                needs login
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Family */}
                  <div className="space-y-2">
                    <Label className="text-sm">Add to family (optional)</Label>
                    <FamilyPicker
                      value={form.familyId}
                      onChange={(familyId) => setForm((f) => ({ ...f, familyId }))}
                    />
                    {form.familyId && (
                      <Field label="Family role">
                        <Select
                          value={form.familyRole || "PrimaryCarer"}
                          onValueChange={(v) =>
                            setForm((f) => ({
                              ...f,
                              familyRole: v as Form["familyRole"],
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="PrimaryCarer">Primary Carer</SelectItem>
                            <SelectItem value="AuthorisedGuardian">
                              Authorised Guardian
                            </SelectItem>
                            <SelectItem value="Child">Child</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                    )}
                  </div>
                </TabsContent>
              )}
            </div>
          </Tabs>
        )}

        <DialogFooter className="border-t pt-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || loading}>
            {saving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" />
            )}
            {editing ? "Save changes" : "Create person"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

interface FamilyOption {
  id: string;
  familyName: string;
}

function FamilyPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (familyId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<FamilyOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<FamilyOption | null>(null);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    const h = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/families?q=${encodeURIComponent(q)}&pageSize=20`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as { items: FamilyOption[] };
        setResults(data.items);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(h);
  }, [q]);

  return (
    <div className="space-y-2">
      {selected || value ? (
        <div className="flex items-center justify-between rounded-md border p-2">
          <span className="text-sm font-medium">
            {selected?.familyName ?? value}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setSelected(null);
              onChange("");
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <>
          <Input
            placeholder="Search families by name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {searching && (
            <p className="text-xs text-muted-foreground flex items-center">
              <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Searching…
            </p>
          )}
          {results.length > 0 && (
            <ul className="border rounded-md divide-y max-h-40 overflow-y-auto scroll-thin">
              {results.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between gap-2 p-2 text-sm hover:bg-muted/40"
                >
                  <span className="font-medium truncate">{f.familyName}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSelected(f);
                      onChange(f.id);
                      setQ("");
                      setResults([]);
                    }}
                  >
                    Select
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
