import type { TeacherPlannerSettings, TimetableSlot } from "../types";
import { getAbWeekType, schoolDayOf } from "./weekUtils";
import { eventPeriodIds, eventIsDirected } from "./eventUtils";

function labelForId(s: TeacherPlannerSettings, classId: string): string {
  const cls = s.classes?.find(c => c.id === classId);
  if (cls) return cls.code;
  const act = s.activities?.find(a => a.id === classId);
  if (act) return act.label;
  return "";
}

/** A class lesson counts as directed; an activity counts unless its type is "other". */
function idIsDirected(s: TeacherPlannerSettings, classId: string): boolean {
  if (s.classes?.some(c => c.id === classId)) return true;
  const act = s.activities?.find(a => a.id === classId);
  return act ? act.activityType !== "other" : false;
}

/**
 * The timetabled lesson resolved for a specific date + period — applying the
 * date's template, A/B week type, and per-date slot exclusions. Mirrors the
 * week grid's `_slotMap`. Returns undefined if the slot is excluded or none.
 */
export function resolvedSlotForDate(
  s: TeacherPlannerSettings, dateIso: string, periodId: string,
): TimetableSlot | undefined {
  const d = new Date(dateIso + "T12:00:00");
  const day = schoolDayOf(d);
  if (!day) return undefined;
  const tmpl = (s.timetableTemplates ?? []).find(t => t.startDate <= dateIso && t.endDate >= dateIso);
  if (!tmpl) return undefined;
  const ab = !!s.academicYear?.abWeekEnabled;
  const wt = ab ? getAbWeekType(d, s.academicYear, s.weekOverrides ?? [], s.schoolDays) : null;
  const slot = tmpl.slots.find(sl =>
    sl.day === day && sl.periodId === periodId &&
    (!ab || !wt || sl.weekType === wt || sl.weekType === "both" || sl.weekType == null)
  );
  if (!slot) return undefined;
  const excluded = (s.slotExclusions ?? []).some(ex => ex.slotId === slot.id && ex.date === dateIso);
  return excluded ? undefined : slot;
}

export interface BlockOccupant {
  kind: "lesson" | "event";
  id: string;       // slot id (lesson) or event id
  label: string;
  directed: boolean;
}

/**
 * Everything occupying a block (one date + period): the timetabled lesson, if
 * any, plus every date event covering that period on that date. `excludeEventId`
 * skips the event currently being edited.
 */
export function blockOccupants(
  s: TeacherPlannerSettings, dateIso: string, periodId: string,
  opts?: { excludeEventId?: string },
): BlockOccupant[] {
  const out: BlockOccupant[] = [];
  const slot = resolvedSlotForDate(s, dateIso, periodId);
  if (slot) out.push({ kind: "lesson", id: slot.id, label: labelForId(s, slot.classId) || "Lesson", directed: idIsDirected(s, slot.classId) });
  for (const ev of s.dateEvents ?? []) {
    if (opts?.excludeEventId && ev.id === opts.excludeEventId) continue;
    if (ev.date !== dateIso) continue;
    if (!eventPeriodIds(ev).includes(periodId)) continue;
    const label = (ev.title && ev.title.trim()) ? ev.title.trim() : (labelForId(s, ev.classId) || "Event");
    out.push({ kind: "event", id: ev.id, label, directed: eventIsDirected(ev, s) });
  }
  return out;
}
