import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { getFeatureFlags } from "@/lib/feature-flags";
import { startOfDayUTC } from "@/lib/daily-code";
import { db } from "@/lib/db";
import { VolunteerDashboard } from "./volunteer-dashboard";

export const dynamic = "force-dynamic";

/**
 * Stage 9 — Volunteer / Teacher Dashboard.
 *
 * Server component shell. The /volunteer/layout.tsx already gates access to
 * Teacher / Volunteer / Security / Admin roles, so here we just load the
 * current user + the initial scope-options data (rooms, classes, programs)
 * and pass them to the client component for the realtime + interaction layer.
 */
export default async function VolunteerHomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callback=/volunteer");

  // Load initial dropdown options server-side (avoids a loading flash on the
  // client). The client refetches nothing here — only the roster/headcount/
  // report data, which is scope-dependent.
  const startOfToday = startOfDayUTC(new Date());
  const [rooms, classes, programs, events, flags] = await Promise.all([
    db.room.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true, building: true, capacity: true },
      orderBy: { name: "asc" },
    }),
    db.groupClass.findMany({
      where: { isActive: true, program: { isActive: true } },
      select: {
        id: true,
        name: true,
        slug: true,
        programId: true,
        program: { select: { id: true, name: true } },
        room: { select: { id: true, name: true } },
        ageMin: true,
        ageMax: true,
      },
      orderBy: [
        { program: { name: "asc" } },
        { sortOrder: "asc" },
        { name: "asc" },
      ],
    }),
    db.program.findMany({
      where: { isActive: true },
      select: { id: true, name: true, slug: true, color: true },
      orderBy: { sortOrder: "asc" },
    }),
    db.event.findMany({
      where: { isActive: true, date: { gte: startOfToday } },
      select: {
        id: true,
        name: true,
        date: true,
        endDate: true,
        location: true,
        programId: true,
        program: { select: { id: true, name: true } },
      },
      orderBy: { date: "asc" },
    }),
    getFeatureFlags(),
  ]);

  const scopeOptions = {
    rooms: rooms.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      building: r.building,
      capacity: r.capacity,
    })),
    classes: classes.map((c) => ({
      id: c.id,
      name: c.name,
      programId: c.programId,
      programName: c.program.name,
      roomId: c.room?.id ?? null,
      roomName: c.room?.name ?? null,
      ageMin: c.ageMin,
      ageMax: c.ageMax,
    })),
    programs: programs.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      color: p.color,
    })),
    events: events.map((e) => ({
      id: e.id,
      name: e.name,
      date: e.date.toISOString(),
      endDate: e.endDate ? e.endDate.toISOString() : null,
      location: e.location,
      programId: e.programId,
      programName: e.program?.name ?? null,
    })),
  };

  return (
    <VolunteerDashboard
      user={{
        id: user.id,
        name: user.name,
        username: user.username,
        roles: user.roles,
      }}
      initialScopeOptions={scopeOptions}
      photoVerificationEnabled={flags.photo_verification}
      overrideCheckoutEnabled={flags.override_checkout}
    />
  );
}
