import type { TeacherPlannerSettings } from "../types";

/**
 * Orphaned-record audit (0.3.8).
 *
 * Plan links, external file links, prepared marks, per-lesson notes and rooms,
 * and one-off lesson removals are all keyed to a timetable slot or a date
 * event. Deleting an event has cleaned up after itself since 0.3.6
 * (`clearEventRecords`), but deleting a slot never did, so a planner
 * accumulated records pointing at lessons that no longer exist. They are
 * invisible, they are carried in every save of data.json, and a slot id that is
 * later reused would inherit them.
 *
 * Everything here is pure so it can be counted before anything is removed —
 * nothing in this plugin should delete a user's data without showing them what
 * and how much first.
 */

export interface OrphanReport {
  slotExclusions: number;
  planLinks: number;
  externalLinks: number;
  preparedMarks: number;
  lessonNotes: number;
  lessonRooms: number;
  total: number;
}

export function emptyReport(): OrphanReport {
  return {
    slotExclusions: 0, planLinks: 0, externalLinks: 0,
    preparedMarks: 0, lessonNotes: 0, lessonRooms: 0, total: 0,
  };
}

/** Every slot id that still exists, across all templates and the legacy flat list. */
export function knownSlotIds(s: TeacherPlannerSettings): Set<string> {
  const ids = new Set<string>();
  for (const t of s.timetableTemplates ?? []) for (const slot of t.slots ?? []) ids.add(slot.id);
  for (const slot of s.timetable ?? []) ids.add(slot.id);
  return ids;
}

/** Every date-event id that still exists. */
export function knownEventIds(s: TeacherPlannerSettings): Set<string> {
  return new Set((s.dateEvents ?? []).map(e => e.id));
}

/**
 * Is this record pointing at something that is gone? A record carrying neither
 * a slot nor an event id is left alone rather than treated as rubbish: it is
 * malformed in some other way, and guessing is how data gets lost.
 */
function isOrphan(
  rec: { slotId?: string; eventId?: string },
  slots: Set<string>,
  events: Set<string>,
): boolean {
  if (rec.slotId) return !slots.has(rec.slotId);
  if (rec.eventId) return !events.has(rec.eventId);
  return false;
}

/** Count the orphaned records without touching anything. */
export function findOrphans(s: TeacherPlannerSettings): OrphanReport {
  const slots = knownSlotIds(s);
  const events = knownEventIds(s);
  const r = emptyReport();
  r.slotExclusions = (s.slotExclusions ?? []).filter(x => !slots.has(x.slotId)).length;
  r.planLinks      = (s.lessonPlanLinks ?? []).filter(x => isOrphan(x, slots, events)).length;
  r.externalLinks  = (s.externalLinks ?? []).filter(x => isOrphan(x, slots, events)).length;
  r.preparedMarks  = (s.preparedMarks ?? []).filter(x => isOrphan(x, slots, events)).length;
  r.lessonNotes    = (s.lessonNotes ?? []).filter(x => !slots.has(x.slotId)).length;
  r.lessonRooms    = (s.lessonRooms ?? []).filter(x => !slots.has(x.slotId)).length;
  r.total = r.slotExclusions + r.planLinks + r.externalLinks + r.preparedMarks + r.lessonNotes + r.lessonRooms;
  return r;
}

/** Remove the orphaned records, returning what was removed. Caller saves. */
export function pruneOrphans(s: TeacherPlannerSettings): OrphanReport {
  const removed = findOrphans(s);
  if (removed.total === 0) return removed;
  const slots = knownSlotIds(s);
  const events = knownEventIds(s);
  s.slotExclusions  = (s.slotExclusions ?? []).filter(x => slots.has(x.slotId));
  s.lessonPlanLinks = (s.lessonPlanLinks ?? []).filter(x => !isOrphan(x, slots, events));
  s.externalLinks   = (s.externalLinks ?? []).filter(x => !isOrphan(x, slots, events));
  s.preparedMarks   = (s.preparedMarks ?? []).filter(x => !isOrphan(x, slots, events));
  s.lessonNotes     = (s.lessonNotes ?? []).filter(x => slots.has(x.slotId));
  s.lessonRooms     = (s.lessonRooms ?? []).filter(x => slots.has(x.slotId));
  return removed;
}

/** One line per non-empty category, for the confirmation dialog. */
export function describeOrphans(r: OrphanReport): string[] {
  const rows: [number, string][] = [
    [r.slotExclusions, "one-off lesson removals"],
    [r.planLinks,      "lesson plan links"],
    [r.externalLinks,  "external file links"],
    [r.preparedMarks,  "prepared marks"],
    [r.lessonNotes,    "per-lesson notes"],
    [r.lessonRooms,    "per-lesson rooms"],
  ];
  return rows.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`);
}
