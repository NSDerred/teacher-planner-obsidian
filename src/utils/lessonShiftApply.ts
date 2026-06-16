import type { TeacherPlannerSettings, UnplacedLesson } from "../types";
import { classOccurrences, type LessonOccurrence } from "./lessonOccurrences";
import { planForward, planBackward } from "./lessonShift";
import {
  getSlotPlan, setSlotPlan, clearSlotPlan,
  isSlotPrepared, setSlotPrepared,
  getSlotExternal, setSlotExternal, clearSlotExternal,
  getLessonNote, setLessonNote, clearLessonNote,
  getLessonRoom, setLessonRoom, clearLessonRoom,
} from "./planLinkUtils";

export interface Bundle {
  plan?: string;
  prepared: boolean;
  external?: { path: string; kind?: "file" | "folder" };
  note: string;
  room: string;
}

export function bundleEmpty(b: Bundle): boolean {
  return !b.plan && !b.prepared && !b.external && !b.note && !b.room;
}

function readBundle(s: TeacherPlannerSettings, o: LessonOccurrence): Bundle {
  const ext = getSlotExternal(s, o.slotId, o.date);
  return {
    plan: getSlotPlan(s, o.slotId, o.date)?.path,
    prepared: isSlotPrepared(s, o.slotId, o.date),
    external: ext ? { path: ext.path, kind: ext.kind } : undefined,
    note: getLessonNote(s, o.slotId, o.date),
    room: getLessonRoom(s, o.slotId, o.date),
  };
}
function clearBundle(s: TeacherPlannerSettings, o: LessonOccurrence): void {
  clearSlotPlan(s, o.slotId, o.date);
  setSlotPrepared(s, o.slotId, o.date, false);
  clearSlotExternal(s, o.slotId, o.date);
  clearLessonNote(s, o.slotId, o.date);
  clearLessonRoom(s, o.slotId, o.date);
}
function writeBundle(s: TeacherPlannerSettings, o: LessonOccurrence, b: Bundle): void {
  if (b.plan) setSlotPlan(s, o.slotId, o.date, b.plan);
  if (b.prepared) setSlotPrepared(s, o.slotId, o.date, true);
  if (b.external) setSlotExternal(s, o.slotId, o.date, b.external.path, b.external.kind);
  if (b.note) setLessonNote(s, o.slotId, o.date, b.note);
  if (b.room) setLessonRoom(s, o.slotId, o.date, b.room);
}

function labelFromBundle(b: Bundle): string {
  if (b.plan) return (b.plan.split("/").pop() ?? b.plan).replace(/\.md$/, "");
  if (b.note) return b.note.length > 40 ? b.note.slice(0, 40) + "…" : b.note;
  return "Lesson";
}
function toUnplaced(classId: string, b: Bundle, fromDate: string): UnplacedLesson {
  return {
    id: "unpl-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
    classId, plan: b.plan, prepared: b.prepared || undefined, external: b.external,
    note: b.note || undefined, room: b.room || undefined, label: labelFromBundle(b), pushedFromDate: fromDate,
  };
}
function fromUnplaced(u: UnplacedLesson): Bundle {
  return { plan: u.plan, prepared: !!u.prepared, external: u.external, note: u.note ?? "", room: u.room ?? "" };
}

export type NoteMove =
  | { kind: "slot"; from: LessonOccurrence; to: LessonOccurrence }
  | { kind: "toUnplaced"; from: LessonOccurrence; unplacedId: string }
  | { kind: "fromUnplaced"; unplacedId: string; to: LessonOccurrence };

export interface ShiftResult { moved: number; overflowed: boolean; filled: boolean; parked: boolean; noteMoves: NoteMove[]; }

/** Snapshot the stores a shift touches, for undo. */
export interface ShiftSnapshot {
  lessonPlanLinks: unknown; preparedMarks: unknown; externalLinks: unknown;
  lessonNotes: unknown; lessonRooms: unknown; unplacedLessons: unknown;
}
export function snapshotState(s: TeacherPlannerSettings): ShiftSnapshot {
  const c = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null));
  return {
    lessonPlanLinks: c(s.lessonPlanLinks), preparedMarks: c(s.preparedMarks),
    externalLinks: c(s.externalLinks), lessonNotes: c(s.lessonNotes), lessonRooms: c(s.lessonRooms), unplacedLessons: c(s.unplacedLessons),
  };
}
export function restoreState(s: TeacherPlannerSettings, snap: ShiftSnapshot): void {
  const c = <T>(v: unknown): T => JSON.parse(JSON.stringify(v ?? null));
  s.lessonPlanLinks = c(snap.lessonPlanLinks);
  s.preparedMarks = c(snap.preparedMarks);
  s.externalLinks = c(snap.externalLinks);
  s.lessonNotes = c(snap.lessonNotes);
  s.lessonRooms = c(snap.lessonRooms);
  s.unplacedLessons = c(snap.unplacedLessons);
}

/** "Lesson didn't happen at fromIndex — shift the rest forward." */
export function shiftForward(s: TeacherPlannerSettings, classId: string, fromIndex: number): ShiftResult {
  const occ = classOccurrences(s, classId);
  const n = occ.length;
  const plan = planForward(n, fromIndex);
  const snap = occ.map(o => readBundle(s, o));
  for (let j = fromIndex; j < n; j++) clearBundle(s, occ[j]);
  const noteMoves: NoteMove[] = [];
  let overflowed = false;
  if (plan.overflowIndex !== null && !bundleEmpty(snap[plan.overflowIndex])) {
    if (!s.unplacedLessons) s.unplacedLessons = [];
    const entry = toUnplaced(classId, snap[plan.overflowIndex], occ[plan.overflowIndex].date);
    s.unplacedLessons.unshift(entry);
    noteMoves.push({ kind: "toUnplaced", from: occ[plan.overflowIndex], unplacedId: entry.id });
    overflowed = true;
  }
  for (const m of plan.moves) {
    writeBundle(s, occ[m.to], snap[m.from]);
    noteMoves.push({ kind: "slot", from: occ[m.from], to: occ[m.to] });
  }
  return { moved: plan.moves.length, overflowed, filled: false, parked: false, noteMoves };
}

/** "Pull later lessons back into this slot." Fills the freed end slot from the unplaced queue. */
export function shiftBackward(s: TeacherPlannerSettings, classId: string, fromIndex: number): ShiftResult {
  const occ = classOccurrences(s, classId);
  const n = occ.length;
  const plan = planBackward(n, fromIndex);
  const snap = occ.map(o => readBundle(s, o));
  for (let j = fromIndex; j < n; j++) clearBundle(s, occ[j]);
  const noteMoves: NoteMove[] = [];

  // The clicked slot is about to be overwritten by the next lesson. If it holds
  // anything (note, room, plan, prepared, external), park it in Unplaced so it
  // is never lost. A genuinely empty slot is just a gap being closed.
  const clicked = snap[fromIndex];
  let parked = false;
  if (!bundleEmpty(clicked)) {
    if (!s.unplacedLessons) s.unplacedLessons = [];
    const entry = toUnplaced(classId, clicked, occ[fromIndex].date);
    s.unplacedLessons.unshift(entry);
    noteMoves.push({ kind: "toUnplaced", from: occ[fromIndex], unplacedId: entry.id });
    parked = true;
  }

  for (const m of plan.moves) {
    writeBundle(s, occ[m.to], snap[m.from]);
    noteMoves.push({ kind: "slot", from: occ[m.from], to: occ[m.to] });
  }

  // Only refill the freed end slot from the queue when we were closing a real
  // gap (empty clicked slot) — i.e. undoing an earlier push. When we parked a
  // lesson, the end slot stays free instead.
  let filled = false;
  if (!parked && plan.fillIndex !== null && s.unplacedLessons?.length) {
    const up = s.unplacedLessons.find(u => u.classId === classId);
    if (up) {
      s.unplacedLessons = s.unplacedLessons.filter(u => u.id !== up.id);
      writeBundle(s, occ[plan.fillIndex], fromUnplaced(up));
      noteMoves.push({ kind: "fromUnplaced", unplacedId: up.id, to: occ[plan.fillIndex] });
      filled = true;
    }
  }
  return { moved: plan.moves.length, overflowed: false, filled, parked, noteMoves };
}
