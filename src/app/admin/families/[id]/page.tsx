import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Users2 } from "lucide-react";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { FamilyDetail } from "./family-detail";

export const dynamic = "force-dynamic";

/**
 * /admin/families/[id] — Family detail (Stage 3).
 */
export default async function FamilyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("view_people");
  const { id } = await params;

  const family = await db.family.findUnique({
    where: { id },
    include: {
      members: {
        include: {
          person: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              preferredName: true,
              personType: true,
              email: true,
              phone: true,
              photoPath: true,
              isVisitor: true,
              isActive: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!family) notFound();

  const initial = {
    id: family.id,
    familyName: family.familyName,
    notes: family.notes,
    isActive: family.isActive,
    createdAt: family.createdAt.toISOString(),
    members: family.members.map((m) => ({
      id: m.id,
      role: m.role,
      person: {
        id: m.person.id,
        firstName: m.person.firstName,
        lastName: m.person.lastName,
        preferredName: m.person.preferredName,
        personType: m.person.personType,
        email: m.person.email,
        phone: m.person.phone,
        hasPhoto: !!m.person.photoPath,
        isVisitor: m.person.isVisitor,
        isActive: m.person.isActive,
      },
    })),
  };

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
          <Link href="/admin/families">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to families
          </Link>
        </Button>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Users2 className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{family.familyName}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Family — {family.members.length} member{family.members.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </div>

      <FamilyDetail initial={initial} />
    </div>
  );
}
