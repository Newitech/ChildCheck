import { db } from "@/lib/db";

/**
 * Stage 5 "today's sessions" helper.
 *
 * For a given date, return every program that has at least one class with a
 * recurring schedule matching that date's day-of-week OR an adhoc schedule on
 * that date, plus any events on that date. This is what the Stage 6 kiosk uses
 * to show "what can I check in to right now?".
 *
 * Standalone events (no programId) are returned under a pseudo program entry
 * with `programId: null` and `programName: "Standalone events"`.
 */

export interface ActiveSessionClass {
  classId: string;
  className: string;
  roomId: string | null;
  roomName: string | null;
  scheduleStart: string;
  scheduleEnd: string | null;
}

export interface ActiveSessionEvent {
  eventId: string;
  eventName: string;
  date: string;
}

export interface ActiveProgramForDate {
  programId: string | null;
  programName: string;
  slug: string | null;
  classes: ActiveSessionClass[];
  events: ActiveSessionEvent[];
}

/** Get the start of the given date (00:00 local) for range comparisons. */
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Get the end of the given date (just before midnight local). */
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

interface ProgramBucket {
  program: { id: string; name: string; slug: string };
  classes: ActiveSessionClass[];
  events: ActiveSessionEvent[];
}

/**
 * Return programs with active classes for the given date (recurring
 * day-of-week match OR adhoc schedule on that date), plus events on that date.
 *
 * @param date The date to check. Defaults to now.
 */
export async function getActiveProgramsForDate(
  date: Date = new Date(),
): Promise<ActiveProgramForDate[]> {
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);
  // JS getDay: 0=Sunday ... 6=Saturday — matches our Schedule.dayOfWeek convention.
  const jsDay = date.getDay();

  // -----------------------------------------------------------------------
  // 1. Pull every active class with its program (+ program-level schedules)
  //    + room + class-level schedules.
  //    A class is "active today" if it matches any class-level schedule OR
  //    any program-level schedule inherited from its parent program.
  // -----------------------------------------------------------------------
  const classes = await db.groupClass.findMany({
    where: { isActive: true, program: { isActive: true } },
    include: {
      program: {
        // Can't mix select + include — use include with the fields we need
        // (Prisma includes all scalar fields by default + the schedules relation).
        include: { schedules: { where: { isActive: true } } },
      },
      room: { select: { id: true, name: true } },
      schedules: { where: { isActive: true } },
    },
  });

  // Group classes by their program id, collecting the matching schedule info.
  const byProgram = new Map<string, ProgramBucket>();

  /** Check if a single schedule matches the given date. */
  function scheduleMatches(
    s: { kind: string; dayOfWeek: number | null; weekOfMonth: number | null; adhocDate: Date | null },
  ): boolean {
    if (s.kind === "recurring") {
      if (s.dayOfWeek !== jsDay) return false;
      // No weekOfMonth = every week. With weekOfMonth, check the date is the
      // Nth occurrence of this day-of-week in the month.
      if (s.weekOfMonth == null) return true;
      const dom = date.getDate(); // 1–31
      const occurrence = Math.ceil(dom / 7); // 1=first, 2=second, etc.
      if (s.weekOfMonth === 5) {
        // "Last" — adding 7 days moves to next month.
        const next = new Date(date);
        next.setDate(next.getDate() + 7);
        return next.getMonth() !== date.getMonth();
      }
      return occurrence === s.weekOfMonth;
    }
    if (s.kind === "adhoc" && s.adhocDate) {
      const d = new Date(s.adhocDate);
      return d >= dayStart && d <= dayEnd;
    }
    return false;
  }

  for (const cls of classes) {
    // Check class-level schedules first, then inherited program-level schedules.
    const allSchedules = [
      ...cls.schedules,
      ...(cls.program.schedules ?? []),
    ];
    const match = allSchedules.find(scheduleMatches);
    if (!match) continue;

    const prog = cls.program;
    if (!byProgram.has(prog.id)) {
      byProgram.set(prog.id, {
        program: { id: prog.id, name: prog.name, slug: prog.slug },
        classes: [],
        events: [],
      });
    }
    byProgram.get(prog.id)!.classes.push({
      classId: cls.id,
      className: cls.name,
      roomId: cls.room?.id ?? null,
      roomName: cls.room?.name ?? null,
      scheduleStart: match.startTime,
      scheduleEnd: match.endTime,
    });
  }

  // -----------------------------------------------------------------------
  // 2. Pull events on this date. Attach program-scoped events under their
  //    program; standalone (no program) events under a pseudo program entry.
  // -----------------------------------------------------------------------
  const events = await db.event.findMany({
    where: {
      isActive: true,
      // event.date is the start; an event "is on this date" if its start falls
      // within [dayStart, dayEnd]. Stage 6 may extend this to multi-day spans.
      date: { gte: dayStart, lte: dayEnd },
    },
    include: {
      program: { select: { id: true, name: true, slug: true } },
    },
  });

  const standalone: ActiveSessionEvent[] = [];

  for (const ev of events) {
    const evEntry: ActiveSessionEvent = {
      eventId: ev.id,
      eventName: ev.name,
      date: ev.date.toISOString(),
    };
    if (ev.program) {
      if (!byProgram.has(ev.program.id)) {
        byProgram.set(ev.program.id, {
          program: { id: ev.program.id, name: ev.program.name, slug: ev.program.slug },
          classes: [],
          events: [],
        });
      }
      byProgram.get(ev.program.id)!.events.push(evEntry);
    } else {
      standalone.push(evEntry);
    }
  }

  // -----------------------------------------------------------------------
  // 3. Assemble the typed return.
  // -----------------------------------------------------------------------
  const result: ActiveProgramForDate[] = [];
  for (const entry of byProgram.values()) {
    result.push({
      programId: entry.program.id,
      programName: entry.program.name,
      slug: entry.program.slug,
      classes: entry.classes,
      events: entry.events,
    });
  }

  if (standalone.length > 0) {
    result.push({
      programId: null,
      programName: "Standalone events",
      slug: null,
      classes: [],
      events: standalone,
    });
  }

  // Stable sort: programs first (alphabetical), standalone events last.
  result.sort((a, b) => {
    if (a.programId === null) return 1;
    if (b.programId === null) return -1;
    return a.programName.localeCompare(b.programName);
  });

  return result;
}
