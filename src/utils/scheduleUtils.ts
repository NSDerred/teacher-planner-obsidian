import type { AcademicYear, DaySchedule, SchoolDay, SchoolPeriod } from "../types";

/**
 * Day-schedule helpers (Option B, Phase 1).
 *
 * `academicYear.daySchedules` is the source of truth for which periods exist
 * on which day. `academicYear.periods` is maintained as the chronologically
 * sorted union of all schedules so that legacy call sites (pickers, CSV
 * export, week-view rows) keep working unchanged. Union entries share object
 * identity with schedule entries — editing a period via either path edits
 * the same object.
 */

/** Initialise daySchedules from the legacy flat period list. Idempotent. */
export function ensureDaySchedules(ay: AcademicYear): void {
  if (!ay.daySchedules || ay.daySchedules.length === 0) {
    ay.daySchedules = [{
      id: "schedule-standard",
      name: "Standard day",
      periods: ay.periods ?? [],
    }];
  }
  if (!ay.dayScheduleMap) ay.dayScheduleMap = {};
  syncPeriodsUnion(ay);
}

/** The schedule covering a given day — explicit mapping, else the first schedule. */
export function getScheduleForDay(ay: AcademicYear, day: SchoolDay): DaySchedule | undefined {
  const schedules = ay.daySchedules ?? [];
  if (schedules.length === 0) return undefined;
  const mapped = ay.dayScheduleMap?.[day];
  return schedules.find(s => s.id === mapped) ?? schedules[0];
}

/** Periods that apply on a given day. Falls back to the legacy flat list. */
export function getPeriodsForDay(ay: AcademicYear, day: SchoolDay): SchoolPeriod[] {
  const sched = getScheduleForDay(ay, day);
  return sched ? sched.periods : (ay.periods ?? []);
}

/** True if the period is part of the given day's schedule. */
export function periodAppliesTo(ay: AcademicYear, periodId: string, day: SchoolDay): boolean {
  if (!ay.daySchedules || ay.daySchedules.length === 0) return true; // legacy: everything applies
  return getPeriodsForDay(ay, day).some(p => p.id === periodId);
}

/** Rebuild `ay.periods` as the de-duplicated, time-sorted union of all schedules. */
export function syncPeriodsUnion(ay: AcademicYear): void {
  if (!ay.daySchedules || ay.daySchedules.length === 0) return;
  const seen = new Map<string, SchoolPeriod>();
  for (const sched of ay.daySchedules) {
    for (const p of sched.periods) {
      if (!seen.has(p.id)) seen.set(p.id, p);
    }
  }
  ay.periods = [...seen.values()].sort((a, b) => a.start.localeCompare(b.start));
}

/** Length of a period in minutes (end - start). 0 if the period is unknown. */
export function periodLengthMinutes(ay: AcademicYear, periodId: string): number {
  const pr = (ay.periods ?? []).find(pp => pp.id === periodId);
  if (!pr) return 0;
  const toMin = (hm: string) => { const [h, m] = (hm ?? "").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
  return Math.max(0, toMin(pr.end) - toMin(pr.start));
}
