import type { TeacherPlannerSettings, SchoolDay } from "../types";
import { getMondayOfWeek, getAbWeekType } from "./weekUtils";

export interface WeekBreakdown {
  weekStart: string;         // ISO "YYYY-MM-DD" Monday
  status: "teaching" | "holiday" | "inset";
  isPast: boolean;
  lessonCount: number;
  lessonMins: number;
  activityCount: number;
  activityMins: number;
  eventCount: number;
  eventMins: number;
  totalMins: number;
}

export interface DirectedTimeCalc {
  contractedMins: number;
  accruedMins: number;
  predictedMins: number;
  weeks: WeekBreakdown[];
}

/** Maps JS getDay() return values to SchoolDay strings. */
const DAY_INDEX_MAP: Record<number, SchoolDay> = {
  0: "sunday", 1: "monday", 2: "tuesday", 3: "wednesday",
  4: "thursday", 5: "friday", 6: "saturday",
};

function isDirectedId(classId: string, s: TeacherPlannerSettings): boolean {
  if (s.classes?.find(c => c.id === classId)) return true;
  const act = s.activities?.find(a => a.id === classId);
  return act ? act.activityType !== "other" : false;
}

function isClassId(classId: string, s: TeacherPlannerSettings): boolean {
  return !!s.classes?.find(c => c.id === classId);
}

function resolveSlotMins(slot: any, s: TeacherPlannerSettings, def: number): number {
  if (slot.durationMinutes) return slot.durationMinutes;
  const act = s.activities?.find(a => a.id === slot.classId);
  if (act?.durationMinutes) return act.durationMinutes;
  return def;
}

function resolveEventMins(ev: any, s: TeacherPlannerSettings, def: number): number {
  if (ev.durationMinutes) return ev.durationMinutes;
  const act = s.activities?.find(a => a.id === ev.classId);
  if (act?.durationMinutes) return act.durationMinutes;
  return def;
}

/**
 * Returns an array of ISO date strings for every calendar day in [start, end]
 * that falls on one of the given school days.
 */
function workingDaysInRange(startIso: string, endIso: string, schoolDays: SchoolDay[]): string[] {
  const MS_DAY = 24 * 60 * 60 * 1000;
  const start = new Date(startIso + "T12:00:00");
  const end   = new Date(endIso   + "T12:00:00");
  const days: string[] = [];
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + MS_DAY)) {
    if (schoolDays.includes(DAY_INDEX_MAP[d.getDay()])) {
      days.push(d.toISOString().slice(0, 10));
    }
  }
  return days;
}

export function calcDirectedTime(s: TeacherPlannerSettings): DirectedTimeCalc {
  const dt = s.directedTime;
  if (!dt) return { contractedMins: 0, accruedMins: 0, predictedMins: 0, weeks: [] };

  const contractedMins = dt.contractedHours * (dt.timetablePercentage / 100) * 60;
  const def = dt.defaultLessonDurationMinutes;
  const todayMonday = getMondayOfWeek(new Date());
  const MS_DAY  = 24 * 60 * 60 * 1000;
  const MS_WEEK = 7 * MS_DAY;

  const schoolDays: SchoolDay[] = s.schoolDays ?? ["monday", "tuesday", "wednesday", "thursday", "friday"];

  // ── Pre-compute per-day override sets ────────────────────────────────────
  const holidayDates = new Set<string>();
  const insetDates   = new Map<string, number>(); // ISO date → minutes

  for (const o of s.weekOverrides ?? []) {
    const rangeStart = o.startDate;
    const rangeEnd   = o.endDate ?? o.startDate;
    const working    = workingDaysInRange(rangeStart, rangeEnd, schoolDays);

    if (o.type === "holiday") {
      for (const iso of working) holidayDates.add(iso);
    } else if (o.type === "inset") {
      const minsPerDay = working.length > 0
        ? Math.round(((o.insetHours ?? 0) * 60) / working.length)
        : 0;
      for (const iso of working) insetDates.set(iso, minsPerDay);
    }
  }

  // ── Week-by-week accumulation ─────────────────────────────────────────────
  let accruedMins   = 0;
  let predictedMins = 0;
  const weeks: WeekBreakdown[] = [];

  let weekMon = getMondayOfWeek(new Date(s.academicYear.startDate + "T12:00:00"));
  const ayEnd = new Date(s.academicYear.endDate + "T23:59:59");

  while (weekMon <= ayEnd) {
    const wKey   = weekMon.toISOString().slice(0, 10);
    const isPast = weekMon.getTime() <= todayMonday.getTime();

    // School days within this week
    const weekDays: { iso: string; dayName: SchoolDay; offset: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekMon.getTime() + i * MS_DAY);
      const dayName = DAY_INDEX_MAP[d.getDay()];
      if (schoolDays.includes(dayName)) {
        weekDays.push({ iso: d.toISOString().slice(0, 10), dayName, offset: i });
      }
    }

    const totalSchoolDays  = weekDays.length;
    const holidayDayCount  = weekDays.filter(d => holidayDates.has(d.iso)).length;
    const insetDayCount    = weekDays.filter(d => insetDates.has(d.iso)).length;

    // Full-holiday week
    if (totalSchoolDays > 0 && holidayDayCount === totalSchoolDays) {
      weeks.push({
        weekStart: wKey, status: "holiday", isPast,
        lessonCount: 0, lessonMins: 0,
        activityCount: 0, activityMins: 0,
        eventCount: 0, eventMins: 0, totalMins: 0,
      });
      weekMon = new Date(weekMon.getTime() + MS_WEEK);
      continue;
    }

    // Full-inset week
    if (totalSchoolDays > 0 && insetDayCount === totalSchoolDays) {
      const insetMins = weekDays.reduce((s, d) => s + (insetDates.get(d.iso) ?? 0), 0);
      predictedMins += insetMins;
      if (isPast) accruedMins += insetMins;
      weeks.push({
        weekStart: wKey, status: "inset", isPast,
        lessonCount: 0, lessonMins: 0,
        activityCount: 0, activityMins: 0,
        eventCount: 0, eventMins: 0, totalMins: insetMins,
      });
      weekMon = new Date(weekMon.getTime() + MS_WEEK);
      continue;
    }

    // Mixed / teaching week
    const template = s.timetableTemplates?.find(t => t.startDate <= wKey && t.endDate >= wKey);
    let lessonCount = 0, lessonMins = 0, activityCount = 0, activityMins = 0;

    if (template) {
      const abType = s.academicYear.abWeekEnabled
        ? getAbWeekType(weekMon, s.academicYear.startDate, s.academicYear.abWeekStartsOn)
        : null;

      for (const slot of template.slots) {
        if (abType && slot.weekType && slot.weekType !== "both" && slot.weekType !== abType) continue;
        if (!isDirectedId(slot.classId, s)) continue;

        const dayEntry = weekDays.find(d => d.dayName === slot.day);
        if (!dayEntry) continue;                          // Day not a school day this week
        const slotIso = dayEntry.iso;
        if (holidayDates.has(slotIso)) continue;         // Holiday day — skip
        if (insetDates.has(slotIso)) continue;           // INSET day — no lessons
        if (s.slotExclusions?.some(ex => ex.slotId === slot.id && ex.date === slotIso)) continue;

        const mins = resolveSlotMins(slot, s, def);
        if (isClassId(slot.classId, s)) { lessonCount++; lessonMins += mins; }
        else { activityCount++; activityMins += mins; }
      }
    }

    let eventCount = 0, eventMins = 0;
    for (const ev of s.dateEvents ?? []) {
      const evMon = getMondayOfWeek(new Date(ev.date + "T12:00:00")).toISOString().slice(0, 10);
      if (evMon !== wKey || !isDirectedId(ev.classId, s)) continue;
      if (holidayDates.has(ev.date)) continue;
      eventCount++;
      eventMins += resolveEventMins(ev, s, def);
    }

    // Add any partial-week inset minutes (mixed week)
    const weekInsetMins = weekDays.reduce((s, d) => s + (insetDates.get(d.iso) ?? 0), 0);

    const totalMins = lessonMins + activityMins + eventMins + weekInsetMins;
    predictedMins += totalMins;
    if (isPast) accruedMins += totalMins;

    weeks.push({
      weekStart: wKey, status: "teaching", isPast,
      lessonCount, lessonMins, activityCount, activityMins,
      eventCount, eventMins, totalMins,
    });

    weekMon = new Date(weekMon.getTime() + MS_WEEK);
  }

  return { contractedMins, accruedMins, predictedMins, weeks };
}

export function fmtMins(totalMins: number): string {
  const abs = Math.abs(totalMins);
  const h = Math.floor(abs / 60);
  const m = Math.round(abs % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function minsToDecimalHours(mins: number): number {
  return Math.round((mins / 60) * 100) / 100;
}
