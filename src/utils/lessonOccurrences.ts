import type { TeacherPlannerSettings, SchoolDay } from "../types";
import { getMondayOfWeek, getAbWeekType, localIso, schoolDayOf } from "./weekUtils";
import { getPeriodsForDay } from "./scheduleUtils";
import { resolvedSlotForDate } from "./clashUtils";

export interface LessonOccurrence {
  date: string;        // ISO "YYYY-MM-DD"
  dayName: SchoolDay;
  periodId: string;
  periodName: string;
  start: string;
  end: string;
  slotId: string;
  classroom: string;   // resolved room (per-slot override, else class default)
  notes: string;       // recurring slot note (fallback default for the per-lesson note)
  weekType: "A" | "B" | null;
  weekKey: string;     // ISO Monday date for the week (grouping key)
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/**
 * Every occurrence of a class across the whole academic year, in chronological
 * order, resolving the timetable template, A/B week type and per-date slot
 * exclusions exactly as the week grid does.
 */
export function classOccurrences(s: TeacherPlannerSettings, classId: string): LessonOccurrence[] {
  const ay = s.academicYear;
  if (!ay?.startDate || !ay?.endDate) return [];
  const startIso = ay.startDate;
  const endIso = ay.endDate;
  const schoolDays = new Set<SchoolDay>((s.schoolDays as SchoolDay[]) ?? ["monday", "tuesday", "wednesday", "thursday", "friday"]);
  const abEnabled = !!ay.abWeekEnabled;
  const cls = (s.classes ?? []).find(c => c.id === classId);
  const classDefaultRoom = cls?.classroom ?? "";
  const blockedRanges = (s.weekOverrides ?? []).filter(o => o.type === "holiday" || o.type === "inset");
  const isBlockedDay = (iso: string) => blockedRanges.some(o => iso >= o.startDate && iso <= (o.endDate ?? o.startDate));

  const out: LessonOccurrence[] = [];
  let monday = getMondayOfWeek(new Date(startIso + "T12:00:00"));
  const endDate = new Date(endIso + "T12:00:00");

  let guard = 0;
  while (monday <= endDate && guard++ < 600) {
    const weekKey = localIso(monday);
    const weekType = abEnabled ? getAbWeekType(monday, ay, s.weekOverrides ?? [], s.schoolDays) : null;
    for (let i = 0; i < 7; i++) {
      const d = addDays(monday, i);
      const dateIso = localIso(d);
      if (dateIso < startIso || dateIso > endIso) continue;
      const dayName = schoolDayOf(d);
      if (!dayName || !schoolDays.has(dayName)) continue;
      if (isBlockedDay(dateIso)) continue;
      for (const p of getPeriodsForDay(ay, dayName)) {
        const slot = resolvedSlotForDate(s, dateIso, p.id);
        if (slot && slot.classId === classId) {
          out.push({
            date: dateIso, dayName, periodId: p.id, periodName: p.name,
            start: p.start, end: p.end, slotId: slot.id,
            classroom: slot.classroom ?? classDefaultRoom,
            notes: slot.notes ?? "",
            weekType, weekKey,
          });
        }
      }
    }
    monday = addDays(monday, 7);
  }
  return out;
}

/** Group occurrences into week sections (preserving chronological order). */
export function groupByWeek(occ: LessonOccurrence[]): { weekKey: string; weekType: "A" | "B" | null; lessons: LessonOccurrence[] }[] {
  const groups: { weekKey: string; weekType: "A" | "B" | null; lessons: LessonOccurrence[] }[] = [];
  let cur: { weekKey: string; weekType: "A" | "B" | null; lessons: LessonOccurrence[] } | null = null;
  for (const o of occ) {
    if (!cur || cur.weekKey !== o.weekKey) {
      cur = { weekKey: o.weekKey, weekType: o.weekType, lessons: [] };
      groups.push(cur);
    }
    cur.lessons.push(o);
  }
  return groups;
}

/** The next occurrence on or after `todayIso` (for the picker card), else the last. */
export function nextOccurrence(occ: LessonOccurrence[], todayIso: string): LessonOccurrence | undefined {
  return occ.find(o => o.date >= todayIso) ?? occ[occ.length - 1];
}
