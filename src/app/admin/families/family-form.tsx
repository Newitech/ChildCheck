"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, UserPlus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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

interface PersonOption {
  id: string;
  firstName: string;
  lastName: string;
  personType: string;
  email: string | null;
  phone: string | null;
}

interface NewMember {
  firstName: string;
  middleName: string;
  lastName: string;
  preferredName: string;
  personType: "Adult" | "Child";
  phone: string;
  email: string;
  dateOfBirth: string;
  schoolGrade: string;
  gender: "Male" | "Female" | "Other" | "";
  allergies: string;
  medicalNotes: string;
  dietaryNotes: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
}

const emptyNewMember: NewMember = {
  firstName: "",
  middleName: "",
  lastName: "",
  preferredName: "",
  personType: "Adult",
  phone: "",
  email: "",
  dateOfBirth: "",
  schoolGrade: "",
  gender: "",
  allergies: "",
  medicalNotes: "",
  dietaryNotes: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}

export function FamilyForm({ open, onOpenChange, onSaved }: Props) {
  const [familyName, setFamilyName] = useState("");
  const [notes, setNotes] = useState("");
  const [members, setMembers] = useState<PersonOption[]>([]);
  const [newMembers, setNewMembers] = useState<NewMember[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<PersonOption[]>([]);
  const [saving, setSaving] = useState(false);

  // Inline new-member form fields (single object for cleanliness)
  const [nm, setNm] = useState<NewMember>(emptyNewMember);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (!open) {
      setFamilyName("");
      setNotes("");
      setMembers([]);
      setNewMembers([]);
      setSearchQ("");
      setSearchResults([]);
      setNm(emptyNewMember);
      setShowDetails(false);
    }
  }, [open]);

  useEffect(() => {
    if (!searchQ.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const h = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/people?q=${encodeURIComponent(searchQ)}&pageSize=20`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as { items: PersonOption[] };
        // Filter out already-added members.
        setSearchResults(
          data.items.filter((p) => !members.some((m) => m.id === p.id)),
        );
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(h);
  }, [searchQ, members]);

  const addMember = (p: PersonOption) => {
    if (members.some((m) => m.id === p.id)) return;
    setMembers([...members, p]);
    setSearchResults((prev) => prev.filter((x) => x.id !== p.id));
  };

  const removeMember = (id: string) => {
    setMembers((prev) => prev.filter((m) => m.id !== id));
  };

  const addNewMember = () => {
    if (!nm.firstName.trim() || !nm.lastName.trim()) {
      toast.error("First and last name are required for a new member.");
      return;
    }
    setNewMembers([...newMembers, { ...nm }]);
    setNm(emptyNewMember);
    setShowDetails(false);
  };

  const removeNewMember = (idx: number) => {
    setNewMembers((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!familyName.trim()) {
      toast.error("Family name is required.");
      return;
    }
    if (members.length === 0 && newMembers.length === 0) {
      toast.error("Add at least one member (existing or new).");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/families", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyName: familyName.trim(),
          notes: notes.trim() || null,
          memberIds: members.map((m) => m.id),
          newMembers: newMembers.map((nm) => ({
            firstName: nm.firstName,
            middleName: nm.middleName || null,
            lastName: nm.lastName,
            preferredName: nm.preferredName || null,
            personType: nm.personType,
            phone: nm.phone || null,
            email: nm.email || null,
            dateOfBirth: nm.dateOfBirth
              ? new Date(nm.dateOfBirth + "T00:00:00Z").toISOString()
              : null,
            schoolGrade: nm.schoolGrade || null,
            gender: nm.gender === "" ? null : nm.gender,
            allergies: nm.allergies || null,
            medicalNotes: nm.medicalNotes || null,
            dietaryNotes: nm.dietaryNotes || null,
            emergencyContactName: nm.emergencyContactName || null,
            emergencyContactPhone: nm.emergencyContactPhone || null,
            isVisitor: false,
          })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success("Family created");
      onSaved();
    } catch (e) {
      toast.error("Failed to create family", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Create family</DialogTitle>
          <DialogDescription>
            A family groups primary carers and children. Add existing people
            and/or create new members below.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto scroll-thin space-y-4 py-2">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm">
                Family name<span className="text-destructive ml-0.5">*</span>
              </Label>
              <Input
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
                maxLength={120}
                placeholder="e.g. Smith"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={4000}
            />
          </div>

          {/* Existing people search */}
          <div className="space-y-2">
            <Label className="text-sm">Add existing people</Label>
            <p className="text-xs text-muted-foreground">
              Search for people already in the system. Adults become Primary
              Carers, children become Children.
            </p>
            <Input
              placeholder="Search people by name…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
            />
            {searching && (
              <p className="text-xs text-muted-foreground flex items-center">
                <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Searching…
              </p>
            )}
            {searchResults.length > 0 && (
              <ul className="border rounded-md divide-y max-h-48 overflow-y-auto scroll-thin">
                {searchResults.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 p-2 text-sm hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {p.firstName} {p.lastName}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {p.personType === "Child" ? "Child" : "Adult"}
                        {p.email ? ` · ${p.email}` : ""}
                        {p.phone ? ` · ${p.phone}` : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => addMember(p)}
                    >
                      Add
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {members.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium">Existing people to add:</p>
                <ul className="space-y-1">
                  {members.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
                    >
                      <div className="min-w-0">
                        <span className="font-medium">
                          {m.firstName} {m.lastName}
                        </span>{" "}
                        <Badge variant="outline" className="ml-1">
                          {m.personType === "Child" ? "Child" : "PrimaryCarer"}
                        </Badge>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => removeMember(m.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* New members (created inline) */}
          <div className="space-y-2 border-t pt-3">
            <Label className="text-sm">Create new members</Label>
            <p className="text-xs text-muted-foreground">
              Add brand-new people who aren&apos;t in the system yet. They&apos;ll
              be created and added to this family in one step.
            </p>

            <div className="rounded-md border p-3 bg-muted/20 space-y-3">
              {/* Essential fields */}
              <div className="grid sm:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">First name *</Label>
                  <Input
                    value={nm.firstName}
                    onChange={(e) => setNm({ ...nm, firstName: e.target.value })}
                    maxLength={80}
                    placeholder="Jane"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Last name *</Label>
                  <Input
                    value={nm.lastName}
                    onChange={(e) => setNm({ ...nm, lastName: e.target.value })}
                    maxLength={80}
                    placeholder="Smith"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Person type</Label>
                  <Select
                    value={nm.personType}
                    onValueChange={(v) => setNm({ ...nm, personType: v as "Adult" | "Child" })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Adult">Adult (Primary Carer)</SelectItem>
                      <SelectItem value="Child">Child</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Phone</Label>
                  <Input
                    value={nm.phone}
                    onChange={(e) => setNm({ ...nm, phone: e.target.value })}
                    maxLength={60}
                  />
                </div>
              </div>

              {/* Expandable detailed fields */}
              <button
                type="button"
                onClick={() => setShowDetails(!showDetails)}
                className="text-xs text-primary hover:underline"
              >
                {showDetails ? "− Hide details" : "+ Add more details (DOB, medical, allergies, etc.)"}
              </button>

              {showDetails && (
                <div className="space-y-2 border-t pt-2">
                  <div className="grid sm:grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Middle name</Label>
                      <Input
                        value={nm.middleName}
                        onChange={(e) => setNm({ ...nm, middleName: e.target.value })}
                        maxLength={80}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Preferred name</Label>
                      <Input
                        value={nm.preferredName}
                        onChange={(e) => setNm({ ...nm, preferredName: e.target.value })}
                        maxLength={80}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Date of birth</Label>
                      <Input
                        type="date"
                        value={nm.dateOfBirth}
                        onChange={(e) => setNm({ ...nm, dateOfBirth: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">School grade</Label>
                      <Input
                        value={nm.schoolGrade}
                        onChange={(e) => setNm({ ...nm, schoolGrade: e.target.value })}
                        maxLength={40}
                        placeholder="e.g. Year 3"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Gender</Label>
                      <Select
                        value={nm.gender || "none"}
                        onValueChange={(v) =>
                          setNm({ ...nm, gender: v === "none" ? "" : (v as NewMember["gender"]) })
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
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label className="text-xs">Email</Label>
                      <Input
                        type="email"
                        value={nm.email}
                        onChange={(e) => setNm({ ...nm, email: e.target.value })}
                        maxLength={160}
                      />
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Allergies</Label>
                      <Textarea
                        value={nm.allergies}
                        onChange={(e) => setNm({ ...nm, allergies: e.target.value })}
                        rows={1}
                        maxLength={2000}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Medical notes</Label>
                      <Textarea
                        value={nm.medicalNotes}
                        onChange={(e) => setNm({ ...nm, medicalNotes: e.target.value })}
                        rows={1}
                        maxLength={4000}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Dietary notes</Label>
                      <Textarea
                        value={nm.dietaryNotes}
                        onChange={(e) => setNm({ ...nm, dietaryNotes: e.target.value })}
                        rows={1}
                        maxLength={2000}
                      />
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Emergency contact name</Label>
                      <Input
                        value={nm.emergencyContactName}
                        onChange={(e) => setNm({ ...nm, emergencyContactName: e.target.value })}
                        maxLength={120}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Emergency contact phone</Label>
                      <Input
                        value={nm.emergencyContactPhone}
                        onChange={(e) => setNm({ ...nm, emergencyContactPhone: e.target.value })}
                        maxLength={60}
                      />
                    </div>
                  </div>
                </div>
              )}

              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addNewMember}
                disabled={!nm.firstName.trim() || !nm.lastName.trim()}
              >
                <UserPlus className="mr-1.5 h-4 w-4" /> Add new member
              </Button>
            </div>

            {newMembers.length > 0 && (
              <ul className="space-y-1">
                {newMembers.map((nm, idx) => (
                  <li
                    key={`${nm.firstName}-${nm.lastName}-${idx}`}
                    className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
                  >
                    <div className="min-w-0">
                      <span className="font-medium">
                        {nm.firstName} {nm.lastName}
                      </span>{" "}
                      <Badge variant="outline" className="ml-1">
                        {nm.personType === "Child"
                          ? "Child"
                          : "PrimaryCarer"}
                      </Badge>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => removeNewMember(idx)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter className="border-t pt-3">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" />
            )}
            Create family
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
