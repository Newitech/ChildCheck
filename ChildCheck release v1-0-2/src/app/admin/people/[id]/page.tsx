import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Users } from "lucide-react";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { Button } from "@/components/ui/button";
import { PersonDetail } from "./person-detail";

export const dynamic = "force-dynamic";

/**
 * /admin/people/[id] — Person detail (Stage 3).
 *
 * Server component: loads the person, renders the client detail shell which
 * handles photo upload, WWCC add/edit, edit dialog, family links.
 */
export default async function PersonDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("view_people");
  const { id } = await params;
  const wwccEnabled = await isFeatureEnabled("working_with_children_tracking");

  const person = await db.person.findUnique({
    where: { id },
    include: {
      familyMemberships: {
        include: { family: { select: { id: true, familyName: true, isActive: true } } },
      },
      ...(wwccEnabled ? { wwccards: { orderBy: { createdAt: "desc" } } } : {}),
    },
  });
  if (!person || (!person.isActive && person.familyMemberships.length === 0)) {
    // We still allow viewing archived people if they have family ties (defensive)
    if (!person) notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
          <Link href="/admin/people">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to people
          </Link>
        </Button>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Users className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {person!.firstName} {person!.lastName}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Person record — view, edit, manage photo, family &amp; WWCC.
            </p>
          </div>
        </div>
      </div>

      <PersonDetail
        personId={person!.id}
        wwccEnabled={wwccEnabled}
        initial={{
          id: person!.id,
          firstName: person!.firstName,
          lastName: person!.lastName,
          preferredName: person!.preferredName,
          personType: person!.personType,
          email: person!.email,
          phone: person!.phone,
          dateOfBirth: person!.dateOfBirth
            ? person!.dateOfBirth.toISOString()
            : null,
          schoolGrade: person!.schoolGrade,
          gender: person!.gender,
          allergies: person!.allergies,
          medicalNotes: person!.medicalNotes,
          dietaryNotes: person!.dietaryNotes,
          emergencyContactName: person!.emergencyContactName,
          emergencyContactPhone: person!.emergencyContactPhone,
          photoPath: person!.photoPath,
          hasPhoto: !!person!.photoPath,
          isVisitor: person!.isVisitor,
          isActive: person!.isActive,
          createdAt: person!.createdAt.toISOString(),
          updatedAt: person!.updatedAt.toISOString(),
          hasUser: false,
          familyMemberships: person!.familyMemberships.map((m) => ({
            familyId: m.family.id,
            familyName: m.family.familyName,
            role: m.role,
          })),
          wwccCards: wwccEnabled
            ? person!.wwccards?.map((c) => ({
                id: c.id,
                cardType: c.cardType,
                jurisdiction: c.jurisdiction,
                cardNumber: c.cardNumber,
                status: c.status,
                issuedAt: c.issuedAt ? c.issuedAt.toISOString() : null,
                expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
                verifiedAt: c.verifiedAt ? c.verifiedAt.toISOString() : null,
                notes: c.notes,
              })) ?? []
            : [],
        }}
      />
    </div>
  );
}
