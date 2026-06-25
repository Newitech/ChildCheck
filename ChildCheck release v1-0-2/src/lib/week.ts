/**
 * Week / day-of-week helpers — org-aware.
 *
 * SDA convention: the week starts on Sunday, so Sunday = 1st day and
 * Saturday = 7th day (the Sabbath). Other orgs may start the week on Monday
 * (common for schools/childcare) or another day — configurable via
 * Organisation.weekStartsOn (a JS getDay() index 0–6).
 *
 * Internal storage of Schedule.dayOfWeek always uses JS getDay() convention
 * (0=Sunday … 6=Saturday) for compatibility with date libraries. These helpers
 * translate between that internal form and the org's DISPLAY convention
 * (1-based "day N of the week", ordered from the org's weekStartsOn).
 */

export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** JS day names indexed by getDay() (0=Sunday … 6=Saturday). */
export const JS_DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Short JS day names indexed by getDay(). */
export const JS_DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Short weekday label for a JS day index. */
export function dayShort(jsDay: number): string {
  return JS_DAY_SHORT[((jsDay % 7) + 7) % 7];
}

/** Full weekday label for a JS day index. */
export function dayLong(jsDay: number): string {
  return JS_DAY_NAMES[((jsDay % 7) + 7) % 7];
}

/**
 * The 1-based "day N of the week" number for a JS day index, given the org's
 * weekStartsOn. SDA (weekStartsOn=0 / Sunday): Sunday=1 … Saturday=7.
 * Monday-start (weekStartsOn=1): Monday=1 … Sunday=7.
 */
export function dayNumberOfWeek(jsDay: number, weekStartsOn: WeekStart = 0): number {
  const d = ((jsDay % 7) + 7) % 7;
  const start = ((weekStartsOn % 7) + 7) % 7;
  // 0-based offset from the week start, then +1 for 1-based display.
  return (((d - start) % 7) + 7) % 7 + 1;
}

/**
 * Ordered list of JS day indices [0..6] starting from the org's weekStartsOn.
 * Use this to render calendar columns / day-of-week pickers in the right order.
 * SDA → [0,1,2,3,4,5,6] (Sun→Sat). Monday-start → [1,2,3,4,5,6,0].
 */
export function orderedDays(weekStartsOn: WeekStart = 0): number[] {
  const start = ((weekStartsOn % 7) + 7) % 7;
  return Array.from({ length: 7 }, (_, i) => (start + i) % 7);
}

/**
 * Human description of a recurring weekday + time, e.g. "Sat 09:30–10:45".
 * (Day abbreviation uses JS convention regardless of week start, since the
 * abbreviation itself is unambiguous — "Sat" is always Saturday.)
 */
export function describeRecurring(
  jsDay: number | null,
  startTime: string,
  endTime?: string | null,
): string {
  if (jsDay == null) return `${startTime}${endTime ? `–${endTime}` : ""}`;
  return `${dayShort(jsDay)} ${startTime}${endTime ? `–${endTime}` : ""}`;
}

/**
 * react-day-picker / shadcn Calendar `weekStartsOn` prop value (0=Sunday …
 * 6=Saturday). Pass the org's weekStartsOn straight through.
 */
export function calendarWeekStartsOn(weekStartsOn: WeekStart = 0): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return weekStartsOn;
}
