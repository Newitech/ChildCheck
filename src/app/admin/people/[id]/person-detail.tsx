"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Loader2,
  Mail,
  PencilLine,
  Phone,
  Trash2,
  Upload,
  UserCircle2,
  X,
} from "lucide-react";

import { useTerminology } from "@/hooks/use-terminology";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PersonForm } from "../person-form";
import type { PersonDetailDTO, WwccCardDTO } from "@/lib/people";
import { PersonGuardianFamiliesSection } from "./guardian-families-section";
import { PersonCollectionPermissionsSection } from "./collection-permissions-section";

interface Props {
  personId: string;
  wwccEnabled: boolean;
  initial: PersonDetailDTO;
}

const WWCC_STATUSES = ["Pending", "Verified", "Expired", "Cancelled"] as const;
const WWCC_TYPES = [
  "QLD Blue Card",
  "NSW WWCC",
  "VIC WWCC",
  "ACT WWVP",
  "SA DHS",
  "WA WWC",
  "Tas WWCC",
  "NT Ochre Card",
  "NZ Police Vet",
  "International",
  "Other",
];

export function PersonDetail({ personId, wwccEnabled, initial }: Props) {
  const router = useRouter();
  const { t } = useTerminology();
  const [data, setData] = useState<PersonDetailDTO>(initial);
  const [editOpen, setEditOpen] = useState(false);
  const [photoCacheBust, setPhotoCacheBust] = useState(0);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // WWCC add-form state
  const [cardType, setCardType] = useState<string>(WWCC_TYPES[0]);
  const [cardNumber, setCardNumber] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [status, setStatus] = useState<(typeof WWCC_STATUSES)[number]>("Pending");
  const [expiresAt, setExpiresAt] = useState("");
  const [wwccSaving, setWwccSaving] = useState(false);

  const refresh = async () => {
    try {
      const res = await fetch(`/api/admin/people/${personId}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const d = (await res.json()) as PersonDetailDTO;
      setData(d);
      setPhotoCacheBust((n) => n + 1);
    } catch (e) {
      toast.error("Failed to refresh", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  useEffect(() => {
    // nothing — initial state already set from server
  }, []);

  const handlePhotoUpload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/admin/people/${personId}/photo`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      setPhotoCacheBust((n) => n + 1);
      toast.success("Photo uploaded");
    } catch (e) {
      toast.error("Photo upload failed", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setUploading(false);
    }
  };

  const handlePhotoRemove = async () => {
    setUploading(true);
    try {
      const res = await fetch(`/api/admin/people/${personId}/photo`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      setPhotoCacheBust((n) => n + 1);
      toast.success("Photo removed");
    } catch (e) {
      toast.error("Failed to remove photo", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setUploading(false);
    }
  };

  const handleAddWwcc = async () => {
    setWwccSaving(true);
    try {
      const res = await fetch(`/api/admin/people/${personId}/wwcc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardType,
          cardNumber: cardNumber.trim() || null,
          jurisdiction: jurisdiction.trim() || null,
          status,
          expiresAt: expiresAt
            ? new Date(expiresAt + "T00:00:00Z").toISOString()
            : null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      setCardNumber("");
      setJurisdiction("");
      setExpiresAt("");
      setStatus("Pending");
      toast.success("WWCC card added");
      await refresh();
    } catch (e) {
      toast.error("Failed to add WWCC card", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setWwccSaving(false);
    }
  };

  const handleUpdateWwccStatus = async (card: WwccCardDTO, newStatus: string) => {
    try {
      const res = await fetch(`/api/admin/wwcc/${card.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success(`Card marked ${newStatus}`);
      await refresh();
    } catch (e) {
      toast.error("Failed to update card", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const handleDeleteWwcc = async (card: WwccCardDTO) => {
    try {
      const res = await fetch(`/api/admin/wwcc/${card.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success("Card removed");
      await refresh();
    } catch (e) {
      toast.error("Failed to remove card", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const handleArchive = async () => {
    try {
      const res = await fetch(`/api/admin/people/${personId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `status ${res.status}`);
      }
      toast.success("Person archived");
      router.push("/admin/people");
      router.refresh();
    } catch (e) {
      toast.error("Failed to archive", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const ageYears = data.dateOfBirth
    ? (() => {
        const dob = new Date(data.dateOfBirth);
        const now = new Date();
        let age = now.getFullYear() - dob.getFullYear();
        const m = now.getMonth() - dob.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
        return age >= 0 ? age : null;
      })()
    : null;

  return (
    <div className="space-y-6">
      {/* Top: avatar + name + badges */}
      <Card>
        <CardContent className="py-6 flex flex-col sm:flex-row gap-6 items-start">
          <div className="flex flex-col items-center gap-3">
            <img
              key={photoCacheBust}
              src={`/api/people/${personId}/photo?cb=${photoCacheBust}`}
              alt={`Photo of ${data.firstName} ${data.lastName}`}
              className="h-32 w-32 rounded-lg border object-cover bg-muted"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handlePhotoUpload(f);
                e.target.value = "";
              }}
            />
            <div className="flex flex-col gap-2 w-full">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-1.5 h-4 w-4" />
                )}
                Upload
              </Button>
              {data.hasPhoto && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={uploading}
                  onClick={() => void handlePhotoRemove()}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" /> Remove
                </Button>
              )}
            </div>
          </div>

          <div className="flex-1 space-y-3 min-w-0">
            <div>
              <h2 className="text-xl font-semibold">
                {data.firstName} {data.lastName}
              </h2>
              {data.preferredName && (
                <p className="text-sm text-muted-foreground">
                  Goes by &ldquo;{data.preferredName}&rdquo;
                </p>
              )}
              <div className="flex flex-wrap gap-1.5 mt-2">
                <Badge variant={data.personType === "Child" ? "default" : "secondary"}>
                  {data.personType === "Child" ? t("child") : "Adult"}
                </Badge>
                {data.isVisitor && <Badge variant="outline">Visitor</Badge>}
                {data.hasUser && <Badge variant="outline">Has login</Badge>}
                {!data.isActive && <Badge variant="destructive">Archived</Badge>}
              </div>
            </div>

            {ageYears !== null && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                Born {new Date(data.dateOfBirth!).toLocaleDateString()} (age {ageYears})
              </div>
            )}

            <div className="flex flex-wrap gap-4 text-sm">
              {data.email && (
                <div className="flex items-center gap-1.5">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <a href={`mailto:${data.email}`} className="hover:underline">
                    {data.email}
                  </a>
                </div>
              )}
              {data.phone && (
                <div className="flex items-center gap-1.5">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <a href={`tel:${data.phone}`} className="hover:underline">
                    {data.phone}
                  </a>
                </div>
              )}
              {!data.email && !data.phone && (
                <div className="text-xs text-muted-foreground">No contact details</div>
              )}
            </div>

            {data.schoolGrade && (
              <p className="text-sm text-muted-foreground">
                School grade: <span className="font-medium text-foreground">{data.schoolGrade}</span>
              </p>
            )}
            {data.gender && (
              <p className="text-sm text-muted-foreground">
                Gender: <span className="font-medium text-foreground">{data.gender}</span>
              </p>
            )}
            {(data.emergencyContactName || data.emergencyContactPhone) && (
              <p className="text-sm text-muted-foreground">
                Emergency contact:{" "}
                <span className="font-medium text-foreground">
                  {data.emergencyContactName ?? "—"}
                  {data.emergencyContactPhone && ` (${data.emergencyContactPhone})`}
                </span>
              </p>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button size="sm" onClick={() => setEditOpen(true)}>
                <PencilLine className="mr-1.5 h-4 w-4" /> Edit
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Trash2 className="mr-1.5 h-4 w-4" /> Archive
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Archive this person?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Soft-deletes the record (isActive=false). The person will
                      disappear from the default list but remain in the database
                      for audit and child-safety purposes.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void handleArchive()}>
                      Archive
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Family memberships */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <UserCircle2 className="h-4 w-4" /> {t("family_plural")}
            </CardTitle>
            <CardDescription>
              {t("family_plural")} this person belongs to.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.familyMemberships.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Not a member of any {t("family").toLowerCase()} yet.{" "}
                <Link href="/admin/families" className="text-primary hover:underline">
                  Add to a {t("family").toLowerCase()} →
                </Link>
              </p>
            ) : (
              <ul className="space-y-2">
                {data.familyMemberships.map((m) => (
                  <li
                    key={m.familyId}
                    className="flex items-center justify-between gap-3 rounded-md border p-2"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/admin/families/${m.familyId}`}
                        className="font-medium hover:underline"
                      >
                        {m.familyName}
                      </Link>
                      <p className="text-xs text-muted-foreground">Role: {m.role}</p>
                    </div>
                    <Badge variant="outline">{m.role}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Medical / sensitive */}
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" /> Medical &amp; allergy
            </CardTitle>
            <CardDescription>
              Sensitive — visible to authorised roles only. Never returned in list views.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <MedicalField label="Allergies" value={data.allergies} />
            <MedicalField label="Medical notes" value={data.medicalNotes} />
            <MedicalField label="Dietary notes" value={data.dietaryNotes} />
            {data.personType === "Adult" &&
              !data.allergies &&
              !data.medicalNotes &&
              !data.dietaryNotes && (
                <p className="text-xs text-muted-foreground">
                  No medical information on file.
                </p>
              )}
          </CardContent>
        </Card>
      </div>

      {/* WWCC */}
      {wwccEnabled && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" /> Working with Children cards
            </CardTitle>
            <CardDescription>
              Blue Card / WWCC tracking. Disable in feature toggles to hide this section.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.wwccCards.length > 0 ? (
              <ul className="space-y-2">
                {data.wwccCards.map((c) => (
                  <li
                    key={c.id}
                    className="rounded-md border p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{c.cardType}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.jurisdiction && <>{c.jurisdiction} · </>}
                          {c.cardNumber && <># {c.cardNumber} · </>}
                          {c.expiresAt && (
                            <>expires {new Date(c.expiresAt).toLocaleDateString()}</>
                          )}
                          {!c.expiresAt && <>no expiry set</>}
                        </p>
                        {c.verifiedAt && (
                          <p className="text-xs text-emerald-700 mt-0.5">
                            Verified {new Date(c.verifiedAt).toLocaleDateString()}
                          </p>
                        )}
                        {c.notes && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {c.notes}
                          </p>
                        )}
                      </div>
                      <WwccBadge status={c.status} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Select
                        value={c.status}
                        onValueChange={(v) => void handleUpdateWwccStatus(c, v)}
                      >
                        <SelectTrigger className="h-8 w-[140px]" aria-label="Change status">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {WWCC_STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>
                              Mark {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="text-destructive">
                            <X className="h-4 w-4" /> Remove
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove this card?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This permanently deletes the card record. This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => void handleDeleteWwcc(c)}>
                              Remove
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No WWCC cards on file.
              </p>
            )}

            {/* Add card form */}
            <div className="rounded-md border bg-muted/30 p-3 space-y-3">
              <p className="text-sm font-medium">Add a card</p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Card type</Label>
                  <Select value={cardType} onValueChange={setCardType}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WWCC_TYPES.map((tt) => (
                        <SelectItem key={tt} value={tt}>
                          {tt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Card number</Label>
                  <Input
                    value={cardNumber}
                    onChange={(e) => setCardNumber(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Jurisdiction</Label>
                  <Input
                    value={jurisdiction}
                    onChange={(e) => setJurisdiction(e.target.value)}
                    placeholder="e.g. AU-QLD"
                    className="h-9"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Status</Label>
                  <Select
                    value={status}
                    onValueChange={(v) => setStatus(v as typeof status)}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WWCC_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 sm:col-span-2 lg:col-span-1">
                  <Label className="text-xs">Expiry date</Label>
                  <Input
                    type="date"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    size="sm"
                    className="h-9"
                    disabled={wwccSaving}
                    onClick={() => void handleAddWwcc()}
                  >
                    {wwccSaving ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : null}
                    Add card
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <PersonForm
        open={editOpen}
        onOpenChange={setEditOpen}
        editing={{
          id: data.id,
          firstName: data.firstName,
          lastName: data.lastName,
          personType: data.personType,
        }}
        onSaved={() => {
          setEditOpen(false);
          void refresh();
          router.refresh();
        }}
      />

      {/* Stage 4 — Adult: families where they're an AuthorisedGuardian */}
      {data.personType === "Adult" && (
        <PersonGuardianFamiliesSection personId={personId} />
      )}

      {/* Stage 4 — Child: who is authorised / blocked to collect this child */}
      {data.personType === "Child" && (
        <PersonCollectionPermissionsSection personId={personId} />
      )}
    </div>
  );
}

function MedicalField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {value ? (
        <Textarea
          readOnly
          value={value}
          className="mt-1 bg-background min-h-[60px] resize-y"
        />
      ) : (
        <p className="text-sm mt-0.5">—</p>
      )}
    </div>
  );
}

function WwccBadge({ status }: { status: string }) {
  if (status === "Verified")
    return <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-200">{status}</Badge>;
  if (status === "Expired")
    return <Badge variant="destructive">{status}</Badge>;
  if (status === "Cancelled")
    return <Badge variant="outline">{status}</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}
