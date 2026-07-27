import type { TeacherPlannerSettings } from "../types";
import { classOccurrences, type LessonOccurrence } from "./lessonOccurrences";
import { isSlotPrepared } from "./planLinkUtils";
import { getMondayOfWeek, localIso } from "./weekUtils";

export interface WeekPrepared {
  total: number;
  prepared: number;
  pct: number; // 0..100
}

export interface ClassStats {
  total: number;
  taught: number;
  remaining: number;
  taughtPct: number;
  /** null when the class has no lessons that week (holiday week, or class doesn't run). */
  thisWeek: WeekPrepared | null;
  nextWeek: WeekPrepared | null;
  /** ISO Mondays for the two week boxes — always present, so the date shows even
   *  when that week has no lessons (which is when you most need to know which week). */
  thisWeekStart: string;
  nextWeekStart: string;
  /** Next lesson that hasn't finished yet. */
  next?: LessonOccurrence;
  /** Upcoming lessons before the next break (holiday or INSET), with the date of the last of them. */
  beforeBreak: { count: number; lastDate: string; toYearEnd: boolean } | null;
  /** Next N upcoming lessons that are not marked prepared. */
  needsAttention: LessonOccurrence[];
}

function tMin(t: string): number {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(t ?? "");
  // No parseable end time: treat the lesson as running to the end of the day, so
  // it is never counted taught early. (A 0 fallback would mark it taught at 00:00.)
  if (!m) return 24 * 60;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * A lesson counts as taught once its period's END time has passed — date AND
 * time aware, so counts tick over through the day as each period finishes.
 */
function isTaught(o: LessonOccurrence, nowIso: string, nowMins: number): boolean {
  if (o.date < nowIso) return true;
  if (o.date > nowIso) return false;
  return tMin(o.end) <= nowMins;
}

/**
 * Aggregate a class's year for the overview panel. Pure derivation from existing
 * data (occurrences, prepared marks, holiday overrides) — no new data capture.
 * `classOccurrences` already excludes holiday/INSET days.
 */
export function computeClassStats(
  s: TeacherPlannerSettings,
  classId: string,
  now: Date = new Date(),
  attentionCount = 3,
  /** Injectable occurrence list (tests); defaults to the real derivation. */
  occurrences?: LessonOccurrence[],
): ClassStats {
  const occ = occurrences ?? classOccurrences(s, classId);
  const nowIso = localIso(now);
  const nowMins = now.getHours() * 60 + now.getMinutes();

  const total = occ.length;
  const taught = occ.filter(o => isTaught(o, nowIso, nowMins)).length;
  const remaining = total - taught;
  const taughtPct = total ? Math.round((taught / total) * 100) : 0;

  const thisMonday = localIso(getMondayOfWeek(now));
  const nextMondayD = getMondayOfWeek(now);
  nextMondayD.setDate(nextMondayD.getDate() + 7); // setDate keeps this DST-safe
  const nextMonday = localIso(nextMondayD);

  // Whole-week counts (past lessons included — a complete review of the week).
  const weekStats = (weekKey: string): WeekPrepared | null => {
    const ws = occ.filter(o => o.weekKey === weekKey);
    if (ws.length === 0) return null;
    const prepared = ws.filter(o => isSlotPrepared(s, o.slotId, o.date)).length;
    return { total: ws.length, prepared, pct: Math.round((prepared / ws.length) * 100) };
  };

  const upcoming = occ.filter(o => !isTaught(o, nowIso, nowMins));

  // Lessons left before the next break (falls back to the end of the year).
  // INSET counts as a break — it stops teaching just as a holiday does — and a
  // break starting today counts, so "before break" reads 0 rather than running
  // on to the one after it.
  const nextBreak = (s.weekOverrides ?? [])
    .filter(o => (o.type === "holiday" || o.type === "inset") && o.startDate >= nowIso)
    .map(o => o.startDate)
    .sort()[0];
  const beforeList = nextBreak ? upcoming.filter(o => o.date < nextBreak) : upcoming;
  const beforeBreak = beforeList.length
    ? { count: beforeList.length, lastDate: beforeList[beforeList.length - 1].date, toYearEnd: !nextBreak }
    : null;

  return {
    total,
    taught,
    remaining,
    taughtPct,
    thisWeek: weekStats(thisMonday),
    nextWeek: weekStats(nextMonday),
    thisWeekStart: thisMonday,
    nextWeekStart: nextMonday,
    next: upcoming[0],
    beforeBreak,
    needsAttention: upcoming.filter(o => !isSlotPrepared(s, o.slotId, o.date)).slice(0, attentionCount),
  };
}
