import type { DateEvent, SchoolPeriod, TeacherPlannerSettings } from "../types";

/**
 * The period blocks a date event occupies. Falls back to the single
 * `periodId` when `periodIds` is absent/empty (legacy + single-period events).
 */
export function eventPeriodIds(ev: DateEvent): string[] {
  if (ev.periodIds && ev.periodIds.length) return ev.periodIds;
  return ev.periodId ? [ev.periodId] : [];
}

/** A custom (free-form, title-driven) event rather than a class/activity mirror. */
export function isCustomEvent(ev: DateEvent): boolean {
  return typeof ev.title === "string" && ev.title.trim().length > 0;
}

/**
 * Whether an event counts towards directed time.
 * - Custom events: explicit `isDirected` flag.
 * - Legacy/class events: a class lesson counts; an activity counts unless its
 *   activityType is "other".
 */
export function eventIsDirected(ev: DateEvent, s: TeacherPlannerSettings): boolean {
  if (isCustomEvent(ev)) return !!ev.isDirected;
  if (s.classes?.some(c => c.id === ev.classId)) return true;
  const act = s.activities?.find(a => a.id === ev.classId);
  return act ? act.activityType !== "other" : false;
}

/**
 * Group an event's selected periods into contiguous visual runs.
 *
 * Selected periods merge across intervening non-lesson blocks (break, lunch,
 * registration, administration) so e.g. P1 + P2 spanning a morning break show
 * as one block. A run is split when an intervening *lesson* period is not
 * selected (a genuine gap in teaching time).
 *
 * `orderedPeriods` must be the day's period list in chronological order.
 * Returns one array of SchoolPeriods per run, each non-empty and ordered.
 */
export function contiguousRuns(
  orderedPeriods: SchoolPeriod[],
  selectedIds: string[],
): SchoolPeriod[][] {
  const sel = new Set(selectedIds);
  const runs: SchoolPeriod[][] = [];
  let cur: SchoolPeriod[] | null = null;
  for (const p of orderedPeriods) {
    if (sel.has(p.id)) {
      (cur ??= []).push(p);
    } else if (cur) {
      // A non-selected *lesson* period breaks the run; breaks/lunch/etc. don't.
      if (p.type === "lesson") {
        runs.push(cur);
        cur = null;
      }
    }
  }
  if (cur) runs.push(cur);
  return runs;
}

/** Minutes between two "HH:MM" strings (end - start), never negative. */
export function minutesBetween(start: string, end: string): number {
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  return Math.max(0, toMin(end) - toMin(start));
}

/**
 * Default duration for a custom event = sum of the teaching-time spans of its
 * selected periods (using the supplied ordered day periods). Used to pre-fill
 * the duration field, which the user can then override.
 */
export function sumPeriodMinutes(orderedPeriods: SchoolPeriod[], selectedIds: string[]): number {
  const sel = new Set(selectedIds);
  return orderedPeriods
    .filter(p => sel.has(p.id))
    .reduce((acc, p) => acc + minutesBetween(p.start, p.end), 0);
}
