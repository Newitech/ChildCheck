"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Users,
  Baby,
  ShieldCheck,
  KeyRound,
  Loader2,
  Pencil,
  Trash2,
  Plus,
  Search,
  X,
  UserPlus,
  AlertTriangle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { useTerminology } from "@/hooks/use-terminology";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FamilyMemberDTO {
  id: string;
  role: string;
  person: {
    id: string;
    firstName: string;
    middleName: string | null;
    lastName: string;
    preferredName: string | null;
    personType: "Adult" | "Child";
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
    hasPhoto: boolean;
    isVisitor: boolean;
    isActive: boolean;
    isMe: boolean;
    hasPin: boolean;
  };
}

interface FamilyDTO {
  id: string;
  familyName: string;
  notes: string | null;
  me: { personId: string; role: string };
  members: FamilyMemberDTO[];
}

interface PersonSearchItem {
  id: string;
  firstName: string;
  lastName: string;
  personType: string;
  email: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function displayName(m: FamilyMemberDTO): string {
  const p = m.person;
  const first = p.preferredName || p.firstName;
  return `${first} ${p.lastName}`;
}

function displayRole(role: string): string {
  switch (role) {
    case "PrimaryCarer": return "Primary Carer";
    case "AuthorisedGuardian": return "Authorised Guardian";
    case "EmergencyContact": return "Emergency Contact";
    case "Child": return "Child";
    default: return role;
  }
}

const EMPTY_PERSON = {
  firstName: "", middleName: "", lastName: "", preferredName: "",
  email: "", phone: "", dateOfBirth: "", schoolGrade: "", gender: "",
  allergies: "", medicalNotes: "", dietaryNotes: "",
  emergencyContactName: "", emergencyContactPhone: "",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FamilyDashboard() {
  const router = useRouter();
  const { t } = useTerminology();

  const [family, setFamily] = useState<FamilyDTO | null>(null);
  const [loading, setLoading] = useState(true);

  // Edit person dialog.
  const [editOpen, setEditOpen] = useState(false);
  const [editMember, setEditMember] = useState<FamilyMemberDTO | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  // Add member dialog.
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [addResults, setAddResults] = useState<PersonSearchItem[]>([]);
  const [addSearchLoading, setAddSearchLoading] = useState(false);
  const [addRole, setAddRole] = useState("AuthorisedGuardian");
  const [addSaving, setAddSaving] = useState(false);
  const [addMode, setAddMode] = useState<"search" | "create">("search");
  // New-person form fields (create mode)
  const [np, setNp] = useState({
    firstName: "", middleName: "", lastName: "", preferredName: "",
    personType: "Adult" as "Adult" | "Child",
    email: "", phone: "", dateOfBirth: "", schoolGrade: "",
    gender: "" as "" | "Male" | "Female" | "Other",
    allergies: "", medicalNotes: "", dietaryNotes: "",
    emergencyContactName: "", emergencyContactPhone: "",
  });
  const [npShowDetails, setNpShowDetails] = useState(false);

  // Change PIN dialog.
  const [pinOpen, setPinOpen] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinSaving, setPinSaving] = useState(false);

  // Edit family name dialog.
  const [familyEditOpen, setFamilyEditOpen] = useState(false);
  const [familyNameDraft, setFamilyNameDraft] = useState("");
  const [familyNotesDraft, setFamilyNotesDraft] = useState("");

  const canEdit = family?.me.role === "PrimaryCarer";

  // Fetch family data.
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/guardian/family", { cache: "no-store" });
      if (res.status === 401) {
        router.push("/guardian");
        return;
      }
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as FamilyDTO;
      setFamily(data);
    } catch {
      toast.error("Failed to load family data.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { refresh(); }, [refresh]);

  // -----------------------------------------------------------------------
  // Edit person
  // -----------------------------------------------------------------------
  const openEdit = (member: FamilyMemberDTO) => {
    setEditMember(member);
    setEditOpen(true);
  };

  const handleSavePerson = async () => {
    if (!editMember) return;
    setEditSaving(true);
    try {
      const fields: Record<string, unknown> = {};
      const p = editMember.person;
      fields.firstName = p.firstName;
      fields.middleName = p.middleName;
      fields.lastName = p.lastName;
      fields.preferredName = p.preferredName;
      fields.email = p.email;
      fields.phone = p.phone;
      fields.gender = p.gender;
      fields.allergies = p.allergies;
      fields.medicalNotes = p.medicalNotes;
      fields.dietaryNotes = p.dietaryNotes;
      fields.emergencyContactName = p.emergencyContactName;
      fields.emergencyContactPhone = p.emergencyContactPhone;
      if (p.dateOfBirth) {
        fields.dateOfBirth = new Date(p.dateOfBirth).toISOString();
      } else {
        fields.dateOfBirth = null;
      }
      fields.schoolGrade = p.schoolGrade;

      const res = await fetch(`/api/guardian/people/${p.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success(`${displayName(editMember)} updated`);
      setEditOpen(false);
      await refresh();
    } catch (e) {
      toast.error("Failed to save", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setEditSaving(false);
    }
  };

  const updateEditField = (field: string, value: string | null) => {
    if (!editMember) return;
    setEditMember({
      ...editMember,
      person: { ...editMember.person, [field]: value },
    });
  };

  // -----------------------------------------------------------------------
  // Add member (search people)
  // -----------------------------------------------------------------------
  const addTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const q = addQuery.trim();
    if (q.length < 2) { setAddResults([]); return; }
    setAddSearchLoading(true);
    clearTimeout(addTimer.current);
    addTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/guardian/people/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setAddResults(data.items ?? []);
      } catch {
        setAddResults([]);
      } finally {
        setAddSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(addTimer.current);
  }, [addQuery]);

  const handleAddMember = async (personId: string) => {
    setAddSaving(true);
    try {
      const res = await fetch("/api/guardian/family/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId, role: addRole }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success("Member added to family");
      setAddOpen(false);
      setAddQuery("");
      setAddResults([]);
      await refresh();
    } catch (e) {
      toast.error("Failed to add member", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setAddSaving(false);
    }
  };

  const handleCreateMember = async () => {
    if (!np.firstName.trim() || !np.lastName.trim()) {
      toast.error("First and last name are required.");
      return;
    }
    // Validate role/type compatibility.
    if (addRole === "AuthorisedGuardian" && np.personType !== "Adult") {
      toast.error("Authorised Guardian requires an Adult person.");
      return;
    }
    setAddSaving(true);
    try {
      const res = await fetch("/api/guardian/family/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newPerson: {
            firstName: np.firstName.trim(),
            middleName: np.middleName.trim() || null,
            lastName: np.lastName.trim(),
            preferredName: np.preferredName.trim() || null,
            personType: np.personType,
            email: np.email.trim() || null,
            phone: np.phone.trim() || null,
            dateOfBirth: np.dateOfBirth
              ? new Date(np.dateOfBirth + "T00:00:00Z").toISOString()
              : null,
            schoolGrade: np.schoolGrade.trim() || null,
            gender: np.gender === "" ? null : np.gender,
            allergies: np.allergies.trim() || null,
            medicalNotes: np.medicalNotes.trim() || null,
            dietaryNotes: np.dietaryNotes.trim() || null,
            emergencyContactName: np.emergencyContactName.trim() || null,
            emergencyContactPhone: np.emergencyContactPhone.trim() || null,
          },
          role: addRole,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success("Member created and added to family");
      setAddOpen(false);
      setNp({
        firstName: "", middleName: "", lastName: "", preferredName: "",
        personType: "Adult", email: "", phone: "", dateOfBirth: "", schoolGrade: "",
        gender: "", allergies: "", medicalNotes: "", dietaryNotes: "",
        emergencyContactName: "", emergencyContactPhone: "",
      });
      setNpShowDetails(false);
      await refresh();
    } catch (e) {
      toast.error("Failed to create member", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setAddSaving(false);
    }
  };
  // -----------------------------------------------------------------------
  const handleRemoveMember = async (member: FamilyMemberDTO) => {
    if (!family) return;
    const name = displayName(member);
    if (member.person.isMe) {
      toast.error("You cannot remove yourself.");
      return;
    }
    try {
      const res = await fetch(`/api/guardian/family/members/${member.person.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success(`${name} removed from family`);
      await refresh();
    } catch (e) {
      toast.error("Failed to remove", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  // -----------------------------------------------------------------------
  // Change PIN
  // -----------------------------------------------------------------------
  const handleChangePin = async () => {
    if (newPin !== confirmPin) {
      toast.error("New PIN and confirmation do not match.");
      return;
    }
    if (!/^\d{4,6}$/.test(newPin)) {
      toast.error("PIN must be 4–6 digits.");
      return;
    }
    setPinSaving(true);
    try {
      const body: Record<string, string> = { newPin };
      if (family?.members.some((m) => m.person.isMe && m.person.hasPin)) {
        body.currentPin = currentPin;
      }
      const res = await fetch("/api/guardian/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (err.error === "Current PIN is incorrect.") {
          toast.error("Current PIN is incorrect.");
          setPinSaving(false);
          return;
        }
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success("PIN updated. This PIN now works at the kiosk too.");
      setPinOpen(false);
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      await refresh();
    } catch (e) {
      toast.error("Failed to change PIN", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setPinSaving(false);
    }
  };

  // -----------------------------------------------------------------------
  // Edit family name
  // -----------------------------------------------------------------------
  const openFamilyEdit = () => {
    if (!family) return;
    setFamilyNameDraft(family.familyName);
    setFamilyNotesDraft(family.notes ?? "");
    setFamilyEditOpen(true);
  };

  const handleSaveFamily = async () => {
    if (!family) return;
    try {
      const res = await fetch("/api/guardian/family", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyName: familyNameDraft, notes: familyNotesDraft.trim() || null }),
      });
      if (!res.ok) throw new Error();
      toast.success("Family name updated");
      setFamilyEditOpen(false);
      await refresh();
    } catch {
      toast.error("Failed to update family name.");
    }
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!family) return null;

  const adults = family.members.filter((m) => m.person.personType === "Adult");
  const children = family.members.filter((m) => m.person.personType === "Child");
  const me = family.members.find((m) => m.person.isMe);
  const hasExistingPin = me?.person.hasPin ?? false;

  return (
    <div className="space-y-8">
      {/* ---- Family Header ---- */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Users className="h-5 w-5 text-primary shrink-0" />
              <CardTitle className="text-xl truncate">{family.familyName}</CardTitle>
              {canEdit && (
                <Button variant="ghost" size="sm" onClick={openFamilyEdit}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {me?.person.hasPin && (
                <Badge variant="outline" className="gap-1">
                  <KeyRound className="h-3 w-3" /> PIN set
                </Badge>
              )}
              <Badge variant="outline">{adults.length} adults</Badge>
              <Badge variant="outline">{children.length} {children.length === 1 ? t("child") : t("child_plural")}</Badge>
            </div>
          </div>
          <CardDescription>
            Signed in as {displayName(me!)} · {displayRole(me!.role)}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={() => setPinOpen(true)} variant="outline" size="sm">
            <KeyRound className="h-4 w-4 mr-1.5" />
            {hasExistingPin ? "Change my PIN" : "Set my PIN"}
          </Button>
        </CardContent>
      </Card>

      {/* ---- Children ---- */}
      <section>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Baby className="h-5 w-5" />
          {children.length === 0
            ? `No ${t("child_plural").toLowerCase()}`
            : `${children.length} ${children.length === 1 ? t("child") : t("child_plural")}`}
        </h2>
        {children.length === 0 && (
          <p className="text-sm text-muted-foreground">No children registered in this family yet.</p>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          {children.map((child) => (
            <Card key={child.id} className="relative">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{displayName(child)}</CardTitle>
                  {canEdit && (
                    <Button variant="ghost" size="sm" onClick={() => openEdit(child)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="text-sm space-y-1 text-muted-foreground">
                {child.person.dateOfBirth && (
                  <p>DOB: {new Date(child.person.dateOfBirth).toLocaleDateString()}</p>
                )}
                {child.person.schoolGrade && <p>Grade: {child.person.schoolGrade}</p>}
                {child.person.allergies && (
                  <p className="flex items-start gap-1 text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    {child.person.allergies}
                  </p>
                )}
                {child.person.medicalNotes && (
                  <p className="line-clamp-2">Medical: {child.person.medicalNotes}</p>
                )}
                {child.person.dietaryNotes && (
                  <p className="line-clamp-2">Dietary: {child.person.dietaryNotes}</p>
                )}
                {child.person.emergencyContactName && (
                  <p>Emergency: {child.person.emergencyContactName} {child.person.emergencyContactPhone ?? ""}</p>
                )}
                {child.person.isVisitor && <Badge variant="secondary">Visitor</Badge>}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <Separator />

      {/* ---- Adults (Authorised Guardians & Emergency Contacts) ---- */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Adults &amp; authorised collectors
          </h2>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
              <UserPlus className="h-4 w-4 mr-1.5" /> Add
            </Button>
          )}
        </div>
        <div className="space-y-2">
          {adults.map((adult) => (
            <Card key={adult.id} className={adult.person.isMe ? "border-primary/30" : ""}>
              <CardContent className="flex items-center justify-between py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{displayName(adult)}</span>
                    {adult.person.isMe && <Badge variant="default">You</Badge>}
                    <Badge variant="outline">{displayRole(adult.role)}</Badge>
                  </div>
                  {adult.person.email && (
                    <p className="text-xs text-muted-foreground truncate">{adult.person.email}</p>
                  )}
                  {adult.person.phone && (
                    <p className="text-xs text-muted-foreground">{adult.person.phone}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {canEdit && !adult.person.isMe && adult.role !== "PrimaryCarer" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveMember(adult)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {canEdit && (
                    <Button variant="ghost" size="sm" onClick={() => openEdit(adult)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ---- Edit Person Dialog ---- */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Edit {editMember ? displayName(editMember) : "member"}
            </DialogTitle>
            <DialogDescription>
              Update details for {editMember ? displayName(editMember) : "this family member"}.
            </DialogDescription>
          </DialogHeader>
          {editMember && (
            <div className="grid gap-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="edit-firstName">First name *</Label>
                  <Input
                    id="edit-firstName"
                    value={editMember.person.firstName}
                    onChange={(e) => updateEditField("firstName", e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-lastName">Last name *</Label>
                  <Input
                    id="edit-lastName"
                    value={editMember.person.lastName}
                    onChange={(e) => updateEditField("lastName", e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="edit-middleName">Middle name</Label>
                  <Input
                    id="edit-middleName"
                    value={editMember.person.middleName ?? ""}
                    onChange={(e) => updateEditField("middleName", e.target.value || null)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-preferredName">Preferred name</Label>
                  <Input
                    id="edit-preferredName"
                    value={editMember.person.preferredName ?? ""}
                    onChange={(e) => updateEditField("preferredName", e.target.value || null)}
                  />
                </div>
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="edit-phone">Phone</Label>
                  <Input
                    id="edit-phone"
                    value={editMember.person.phone ?? ""}
                    onChange={(e) => updateEditField("phone", e.target.value || null)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-email">Email</Label>
                  <Input
                    id="edit-email"
                    type="email"
                    value={editMember.person.email ?? ""}
                    onChange={(e) => updateEditField("email", e.target.value || null)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="edit-dob">Date of birth</Label>
                  <Input
                    id="edit-dob"
                    type="date"
                    value={editMember.person.dateOfBirth?.split("T")[0] ?? ""}
                    onChange={(e) => updateEditField("dateOfBirth", e.target.value || null)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-grade">Grade / year</Label>
                  <Input
                    id="edit-grade"
                    value={editMember.person.schoolGrade ?? ""}
                    onChange={(e) => updateEditField("schoolGrade", e.target.value || null)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-gender">Gender</Label>
                <Select
                  value={editMember.person.gender ?? "unset"}
                  onValueChange={(v) => updateEditField("gender", v === "unset" ? null : v)}
                >
                  <SelectTrigger id="edit-gender"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">Not set</SelectItem>
                    <SelectItem value="Male">Male</SelectItem>
                    <SelectItem value="Female">Female</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Separator />
              <div className="space-y-1">
                <Label htmlFor="edit-allergies">Allergies</Label>
                <Textarea
                  id="edit-allergies"
                  value={editMember.person.allergies ?? ""}
                  onChange={(e) => updateEditField("allergies", e.target.value || null)}
                  rows={2}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-medical">Medical notes</Label>
                <Textarea
                  id="edit-medical"
                  value={editMember.person.medicalNotes ?? ""}
                  onChange={(e) => updateEditField("medicalNotes", e.target.value || null)}
                  rows={2}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-dietary">Dietary notes</Label>
                <Textarea
                  id="edit-dietary"
                  value={editMember.person.dietaryNotes ?? ""}
                  onChange={(e) => updateEditField("dietaryNotes", e.target.value || null)}
                  rows={2}
                />
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="edit-ec-name">Emergency contact name</Label>
                  <Input
                    id="edit-ec-name"
                    value={editMember.person.emergencyContactName ?? ""}
                    onChange={(e) => updateEditField("emergencyContactName", e.target.value || null)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-ec-phone">Emergency contact phone</Label>
                  <Input
                    id="edit-ec-phone"
                    value={editMember.person.emergencyContactPhone ?? ""}
                    onChange={(e) => updateEditField("emergencyContactPhone", e.target.value || null)}
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSavePerson} disabled={editSaving}>
              {editSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Add Member Dialog ---- */}
      <Dialog open={addOpen} onOpenChange={(v) => { setAddOpen(v); if (!v) { setAddQuery(""); setAddResults([]); setNpShowDetails(false); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto scroll-thin">
          <DialogHeader>
            <DialogTitle>Add a member</DialogTitle>
            <DialogDescription>
              Search for an existing person, or create a new family member with full details.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Mode toggle */}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={addMode === "search" ? "default" : "outline"}
                onClick={() => setAddMode("search")}
              >
                Search existing
              </Button>
              <Button
                size="sm"
                variant={addMode === "create" ? "default" : "outline"}
                onClick={() => setAddMode("create")}
              >
                Create new
              </Button>
            </div>

            {/* Role selector (shared) */}
            <div className="space-y-1">
              <Label>Add as</Label>
              <Select value={addRole} onValueChange={setAddRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PrimaryCarer">Primary Carer</SelectItem>
                  <SelectItem value="AuthorisedGuardian">Authorised Guardian</SelectItem>
                  <SelectItem value="Child">Child</SelectItem>
                  <SelectItem value="EmergencyContact">Emergency Contact</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {addMode === "search" ? (
              /* Search existing */
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={addQuery}
                    onChange={(e) => setAddQuery(e.target.value)}
                    placeholder="Search by name, email or phone"
                    className="pl-10"
                  />
                  {addSearchLoading && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin" />
                  )}
                </div>
                {addResults.length > 0 && (
                  <div className="border rounded-lg max-h-48 overflow-y-auto space-y-1 p-1">
                    {addResults.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleAddMember(p.id)}
                        disabled={addSaving}
                        className="w-full text-left rounded-md px-3 py-2 hover:bg-accent flex items-center justify-between text-sm"
                      >
                        <span>{p.firstName} {p.lastName}</span>
                        <Plus className="h-4 w-4 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                )}
                {addRole !== "AuthorisedGuardian" && addRole !== "EmergencyContact" && (
                  <p className="text-xs text-muted-foreground">
                    Linking existing people is only available for Authorised Guardian or Emergency Contact roles. For Primary Carer or Child, use "Create new".
                  </p>
                )}
              </div>
            ) : (
              /* Create new */
              <div className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">First name *</Label>
                    <Input value={np.firstName} onChange={(e) => setNp({ ...np, firstName: e.target.value })} maxLength={80} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Last name *</Label>
                    <Input value={np.lastName} onChange={(e) => setNp({ ...np, lastName: e.target.value })} maxLength={80} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Person type</Label>
                    <Select
                      value={np.personType}
                      onValueChange={(v) => setNp({ ...np, personType: v as "Adult" | "Child" })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Adult">Adult</SelectItem>
                        <SelectItem value="Child">Child</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Phone</Label>
                    <Input value={np.phone} onChange={(e) => setNp({ ...np, phone: e.target.value })} maxLength={60} />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setNpShowDetails(!npShowDetails)}
                  className="text-xs text-primary hover:underline"
                >
                  {npShowDetails ? "− Hide details" : "+ Add more details (DOB, medical, allergies, etc.)"}
                </button>

                {npShowDetails && (
                  <div className="space-y-2 border-t pt-2">
                    <div className="grid sm:grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Middle name</Label>
                        <Input value={np.middleName} onChange={(e) => setNp({ ...np, middleName: e.target.value })} maxLength={80} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Preferred name</Label>
                        <Input value={np.preferredName} onChange={(e) => setNp({ ...np, preferredName: e.target.value })} maxLength={80} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Date of birth</Label>
                        <Input type="date" value={np.dateOfBirth} onChange={(e) => setNp({ ...np, dateOfBirth: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">School grade</Label>
                        <Input value={np.schoolGrade} onChange={(e) => setNp({ ...np, schoolGrade: e.target.value })} maxLength={40} placeholder="e.g. Year 3" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Gender</Label>
                        <Select
                          value={np.gender || "none"}
                          onValueChange={(v) => setNp({ ...np, gender: v === "none" ? "" : v as "Male" | "Female" | "Other" })}
                        >
                          <SelectTrigger><SelectValue placeholder="Not specified" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Not specified</SelectItem>
                            <SelectItem value="Male">Male</SelectItem>
                            <SelectItem value="Female">Female</SelectItem>
                            <SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Email</Label>
                        <Input type="email" value={np.email} onChange={(e) => setNp({ ...np, email: e.target.value })} maxLength={160} />
                      </div>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Allergies</Label>
                        <Textarea value={np.allergies} onChange={(e) => setNp({ ...np, allergies: e.target.value })} rows={1} maxLength={2000} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Medical notes</Label>
                        <Textarea value={np.medicalNotes} onChange={(e) => setNp({ ...np, medicalNotes: e.target.value })} rows={1} maxLength={4000} />
                      </div>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Dietary notes</Label>
                        <Textarea value={np.dietaryNotes} onChange={(e) => setNp({ ...np, dietaryNotes: e.target.value })} rows={1} maxLength={2000} />
                      </div>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Emergency contact name</Label>
                        <Input value={np.emergencyContactName} onChange={(e) => setNp({ ...np, emergencyContactName: e.target.value })} maxLength={120} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Emergency contact phone</Label>
                        <Input value={np.emergencyContactPhone} onChange={(e) => setNp({ ...np, emergencyContactPhone: e.target.value })} maxLength={60} />
                      </div>
                    </div>
                  </div>
                )}

                <Button
                  size="sm"
                  onClick={() => void handleCreateMember()}
                  disabled={addSaving || !np.firstName.trim() || !np.lastName.trim()}
                >
                  {addSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
                  Create &amp; add member
                </Button>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Change PIN Dialog ---- */}
      <Dialog open={pinOpen} onOpenChange={(open) => { setPinOpen(open); if (!open) { setCurrentPin(""); setNewPin(""); setConfirmPin(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{hasExistingPin ? "Change my PIN" : "Set my PIN"}</DialogTitle>
            <DialogDescription>
              {hasExistingPin
                ? "This PIN is also used at the kiosk for check-in/check-out. Changing it here updates it everywhere."
                : "Set a 4–6 digit PIN. You'll use this to sign in to the guardian portal and at the kiosk."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {hasExistingPin && (
              <div className="space-y-1">
                <Label htmlFor="current-pin">Current PIN</Label>
                <Input
                  id="current-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="text-center tracking-[0.5em]"
                  placeholder="Enter current PIN"
                />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="new-pin">New PIN</Label>
              <Input
                id="new-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="text-center tracking-[0.5em]"
                placeholder="4–6 digits"
              />
              {newPin.length > 0 && newPin.length < 4 && (
                <p className="text-xs text-destructive">PIN is too short — needs 4–6 digits.</p>
              )}
              {newPin.length === 6 && (
                <p className="text-xs text-emerald-700">6-digit PIN — good.</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="confirm-pin">Confirm new PIN</Label>
              <Input
                id="confirm-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="text-center tracking-[0.5em]"
                placeholder="Re-enter new PIN"
              />
              {confirmPin.length > 0 && confirmPin !== newPin && (
                <p className="text-xs text-destructive">PINs do not match.</p>
              )}
              {confirmPin.length > 0 && confirmPin === newPin && newPin.length >= 4 && (
                <p className="text-xs text-emerald-700">PINs match.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPinOpen(false)}>Cancel</Button>
            <Button
              onClick={handleChangePin}
              disabled={pinSaving || newPin.length < 4 || newPin !== confirmPin}
            >
              {pinSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {hasExistingPin ? "Update PIN" : "Set PIN"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Edit Family Name Dialog ---- */}
      <Dialog open={familyEditOpen} onOpenChange={setFamilyEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit family details</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="family-name">Family name</Label>
              <Input
                id="family-name"
                value={familyNameDraft}
                onChange={(e) => setFamilyNameDraft(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="family-notes">Notes</Label>
              <Textarea
                id="family-notes"
                value={familyNotesDraft}
                onChange={(e) => setFamilyNotesDraft(e.target.value)}
                rows={3}
                maxLength={4000}
                placeholder="Optional family notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFamilyEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveFamily}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
