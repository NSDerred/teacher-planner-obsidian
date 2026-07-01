import type { TeacherPlannerSettings, SchoolDay } from "../types";
import { getMondayOfWeek } from "./weekUtils";

export interface WeekInfo {
  /** Local ISO "YYYY-MM-DD" of the week's Monday (matches weekKey / week-note keys). */
  mondayIso: string;
  status: "teaching" | "holiday" | "inset";
  /** Monday is this week or earlier. */
  isPast: boolean;
}

const DAY_INDEX_MAP: Record<number, SchoolDay> = {
  0: "sunday", 1: "monday", 2: "tuesday", 3: "wednesday",
  4: "thursday", 5: "friday", 6: "saturday",
};
const DEFAULT_SCHOOL_DAYS: SchoolDay[] = ["monday", "tuesday", "wednesday", "thursday", "friday"];

function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** Monday at local noon — noon + setDate() advancement is immune to DST shifts. */
function mondayNoon(d: Date): Date {
  const m = getMondayOfWeek(d);
  m.setHours(12, 0, 0, 0);
  return m;
}

/** ISO dates in [start, end] that fall on one of the given school days. */
function workingDaysInRange(startIso: string, endIso: string, schoolDays: SchoolDay[]): string[] {
  const end = new Date(endIso + "T12:00:00");
  const out: string[] = [];
  for (const d = new Date(startIso + "T12:00:00"); d <= end; d.setDate(d.getDate() + 1)) {
    if (schoolDays.includes(DAY_INDEX_MAP[d.getDay()])) out.push(localIso(d));
  }
  return out;
}

/**
 * Enumerate every week of the academic year (Monday-keyed), classifying each as
 * teaching / holiday / inset using the same whole-week rule as the directed-time
 * calculation: a week is "holiday" (or "inset") only when ALL of its school days
 * are holiday (or inset) days; otherwise it is a teaching week. Unlike
 * calcDirectedTime this does not require directed time to be configured.
 *
 * All date advancement uses setDate() on a local-noon anchor so week boundaries
 * stay correct across daylight-saving changes (a fixed-ms step lands on the wrong
 * date around the DST fall-back).
 */
export function enumerateWeeks(s: TeacherPlannerSettings): WeekInfo[] {
  const ay = s.academicYear;
  if (!ay?.startDate || !ay?.endDate) return [];
  const schoolDays = s.schoolDays ?? DEFAULT_SCHOOL_DAYS;

  const holiday = new Set<string>();
  const inset = new Set<string>();
  for (const o of s.weekOverrides ?? []) {
    const days = workingDaysInRange(o.startDate, o.endDate ?? o.startDate, schoolDays);
    if (o.type === "holiday") for (const iso of days) holiday.add(iso);
    else if (o.type === "inset") for (const iso of days) inset.add(iso);
  }

  const todayMon = mondayNoon(new Date());
  const end = new Date(ay.endDate + "T23:59:59");
  const out: WeekInfo[] = [];
  const mon = mondayNoon(new Date(ay.startDate + "T12:00:00"));

  for (let guard = 0; mon <= end && guard < 400; guard++) {
    const weekDays: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon);
      d.setDate(d.getDate() + i);
      if (schoolDays.includes(DAY_INDEX_MAP[d.getDay()])) weekDays.push(localIso(d));
    }
    const total = weekDays.length;
    const hol = weekDays.filter(iso => holiday.has(iso)).length;
    const ins = weekDays.filter(iso => inset.has(iso)).length;
    let status: WeekInfo["status"] = "teaching";
    if (total > 0 && hol === total) status = "holiday";
    else if (total > 0 && ins === total) status = "inset";
    out.push({ mondayIso: localIso(mon), status, isPast: mon.getTime() <= todayMon.getTime() });
    mon.setDate(mon.getDate() + 7);
  }
  return out;
}

/** Just the teaching weeks (holiday/inset weeks removed). */
export function teachingWeeks(s: TeacherPlannerSettings): WeekInfo[] {
  return enumerateWeeks(s).filter(w => w.status === "teaching");
}
