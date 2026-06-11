import type { TeacherPlannerSettings, LessonPlanLink, ExternalResourceLink, SchoolDay } from "../types";
import { getMondayOfWeek, getAbWeekType } from "./weekUtils";
import { periodAppliesTo } from "./scheduleUtils";

/**
 * Lesson plan links — connect lessons (timetabled slot occurrences or date
 * events) to ordinary markdown notes in the vault. The link lives in plugin
 * data only; the note itself is never modified, which is what makes plans
 * reusable across lessons and academic years.
 */

const DAY_INDEX_MAP: Record<number, SchoolDay> = {
  0: "sunday", 1: "monday", 2: "tuesday", 3: "wednesday",
  4: "thursday", 5: "friday", 6: "saturday",
};

function shiftIso(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function links(s: TeacherPlannerSettings): LessonPlanLink[] {
  if (!s.lessonPlanLinks) s.lessonPlanLinks = [];
  return s.lessonPlanLinks;
}

export function getSlotPlan(s: TeacherPlannerSettings, slotId: string, date: string): LessonPlanLink | undefined {
  return (s.lessonPlanLinks ?? []).find(l => l.slotId === slotId && l.date === date);
}

export function getEventPlan(s: TeacherPlannerSettings, eventId: string): LessonPlanLink | undefined {
  return (s.lessonPlanLinks ?? []).find(l => l.eventId === eventId);
}

export function clearSlotPlan(s: TeacherPlannerSettings, slotId: string, date: string): void {
  s.lessonPlanLinks = (s.lessonPlanLinks ?? []).filter(l => !(l.slotId === slotId && l.date === date));
}

export function clearEventPlan(s: TeacherPlannerSettings, eventId: string): void {
  s.lessonPlanLinks = (s.lessonPlanLinks ?? []).filter(l => l.eventId !== eventId);
}

export function setSlotPlan(s: TeacherPlannerSettings, slotId: string, date: string, path: string): void {
  clearSlotPlan(s, slotId, date);
  links(s).push({ slotId, date, path });
}

export function setEventPlan(s: TeacherPlannerSettings, eventId: string, path: string): void {
  clearEventPlan(s, eventId);
  links(s).push({ eventId, path });
}

/** When a slot occurrence is dragged (converted to a date event), the plan follows. */
export function migrateSlotPlanToEvent(s: TeacherPlannerSettings, slotId: string, date: string, eventId: string): void {
  const link = getSlotPlan(s, slotId, date);
  if (!link) return;
  clearSlotPlan(s, slotId, date);
  setEventPlan(s, eventId, link.path);
}

export interface BulkApplyResult {
  count: number;
  entries: { slotId: string; date: string; prevPath?: string }[];
}

/**
 * Link `path` to every future timetabled lesson of `classId`, from `fromIso`
 * to the end of the academic year. Resolves the timetable exactly as the
 * week view does: template per week, A/B rotation, day schedules,
 * holiday/INSET days, slot exclusions. Returns the affected occurrences
 * (with any previously-linked path) for the undo journal. Pass dryRun to
 * count without mutating — used for the confirmation dialog.
 */
export function bulkApplyPlan(s: TeacherPlannerSettings, classId: string, fromIso: string, path: string, dryRun = false): BulkApplyResult {
  const result: BulkApplyResult = { count: 0, entries: [] };
  const ay = s.academicYear;
  if (!ay?.endDate) return result;
  const schoolDays: SchoolDay[] = s.schoolDays ?? ["monday", "tuesday", "wednesday", "thursday", "friday"];

  const overrideDates = new Set<string>();
  for (const o of s.weekOverrides ?? []) {
    const end = o.endDate ?? o.startDate;
    for (let iso = o.startDate; iso <= end; iso = shiftIso(iso, 1)) overrideDates.add(iso);
  }

  for (let iso = fromIso; iso <= ay.endDate; iso = shiftIso(iso, 1)) {
    const d = new Date(iso + "T12:00:00");
    const dayName = DAY_INDEX_MAP[d.getDay()];
    if (!schoolDays.includes(dayName)) continue;
    if (overrideDates.has(iso)) continue;

    const mondayKey = getMondayOfWeek(d).toISOString().slice(0, 10);
    const template = s.timetableTemplates?.find(t => t.startDate <= mondayKey && t.endDate >= mondayKey);
    if (!template) continue;
    const abType = ay.abWeekEnabled ? getAbWeekType(d, ay.startDate, ay.abWeekStartsOn) : null;

    for (const slot of template.slots) {
      if (slot.classId !== classId || slot.day !== dayName) continue;
      if (abType && slot.weekType && slot.weekType !== "both" && slot.weekType !== abType) continue;
      if (!periodAppliesTo(ay, slot.periodId, dayName)) continue;
      if (s.slotExclusions?.some(ex => ex.slotId === slot.id && ex.date === iso)) continue;
      const prev = getSlotPlan(s, slot.id, iso)?.path;
      result.entries.push({ slotId: slot.id, date: iso, ...(prev ? { prevPath: prev } : {}) });
      result.count++;
      if (!dryRun) setSlotPlan(s, slot.id, iso, path);
    }
  }
  return result;
}

/**
 * Revert the last bulk apply: remove the links it created and restore any
 * links it overwrote. Returns the number of lessons reverted.
 */
export function undoBulkApply(s: TeacherPlannerSettings): number {
  const journal = s.lastBulkApply;
  if (!journal) return 0;
  let n = 0;
  for (const e of journal.entries) {
    clearSlotPlan(s, e.slotId, e.date);
    if (e.prevPath) links(s).push({ slotId: e.slotId, date: e.date, path: e.prevPath });
    n++;
  }
  s.lastBulkApply = undefined;
  return n;
}

// ── External resources (absolute OS paths — desktop only, not synced) ─────

function extLinks(s: TeacherPlannerSettings): ExternalResourceLink[] {
  if (!s.externalLinks) s.externalLinks = [];
  return s.externalLinks;
}

export function getSlotExternal(s: TeacherPlannerSettings, slotId: string, date: string): ExternalResourceLink | undefined {
  return (s.externalLinks ?? []).find(l => l.slotId === slotId && l.date === date);
}

export function getEventExternal(s: TeacherPlannerSettings, eventId: string): ExternalResourceLink | undefined {
  return (s.externalLinks ?? []).find(l => l.eventId === eventId);
}

export function clearSlotExternal(s: TeacherPlannerSettings, slotId: string, date: string): void {
  s.externalLinks = (s.externalLinks ?? []).filter(l => !(l.slotId === slotId && l.date === date));
}

export function clearEventExternal(s: TeacherPlannerSettings, eventId: string): void {
  s.externalLinks = (s.externalLinks ?? []).filter(l => l.eventId !== eventId);
}

export function setSlotExternal(s: TeacherPlannerSettings, slotId: string, date: string, path: string): void {
  clearSlotExternal(s, slotId, date);
  extLinks(s).push({ slotId, date, path });
}

export function setEventExternal(s: TeacherPlannerSettings, eventId: string, path: string): void {
  clearEventExternal(s, eventId);
  extLinks(s).push({ eventId, path });
}

export function migrateSlotExternalToEvent(s: TeacherPlannerSettings, slotId: string, date: string, eventId: string): void {
  const link = getSlotExternal(s, slotId, date);
  if (!link) return;
  clearSlotExternal(s, slotId, date);
  setEventExternal(s, eventId, link.path);
}

/** Keep stored paths current when notes are renamed/moved. Returns true if anything changed. */
export function renamePlanPaths(s: TeacherPlannerSettings, oldPath: string, newPath: string): boolean {
  let changed = false;
  for (const l of s.lessonPlanLinks ?? []) {
    if (l.path === oldPath) { l.path = newPath; changed = true; }
  }
  return changed;
}

/** Folder for new plans: explicit setting, else "<planner folder>/Plans". */
export function defaultPlansFolder(s: TeacherPlannerSettings): string {
  const f = s.lessonPlansFolder?.trim();
  return f || ((s.plannerFolder || "Teacher Planner") + "/Plans");
}

export const DEFAULT_PLAN_TEMPLATE = `---
type: lesson-plan
class: {{class}}
subject: {{subject}}
topic: ""
created: {{date}}
---
## Objectives

## Starter / Do now

## Main activity

## Assessment & homework
`;
