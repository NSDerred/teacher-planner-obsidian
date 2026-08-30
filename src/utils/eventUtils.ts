import type { DateEvent, SchoolPeriod, TeacherPlannerSettings } from "../types";
import { timeMins } from "./scheduleUtils";

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

/**
 * An occupant's blocks split into runs, breaking where a block is not free for
 * it. `isFree` decides that: a block shared with a lesson or another event ends
 * the run and stands alone, so the occupant still appears there.
 *
 * `contiguousRuns` above ignores clashes entirely, which is right for laying
 * out the desktop grid's merge candidates but wrong for the mobile lists, where
 * it could draw one card for blocks the desktop had split into two.
 */
export function runsWhereFree(
  orderedPeriods: SchoolPeriod[],
  selectedIds: string[],
  isFree: (periodId: string) => boolean,
): SchoolPeriod[][] {
  const covered = new Set(selectedIds);
  const runs: SchoolPeriod[][] = [];
  let run: SchoolPeriod[] = [];
  const flush = () => { if (run.length) { runs.push(run); run = []; } };
  for (const pr of orderedPeriods) {
    if (!covered.has(pr.id)) {
      // Same rule as contiguousRuns: an unselected *lesson* period is a real
      // gap, a break or lunch the occupant spans is not.
      if (pr.type === "lesson") flush();
      continue;
    }
    if (isFree(pr.id)) { run.push(pr); continue; }
    flush();
    runs.push([pr]);
  }
  flush();
  return runs;
}

/** Minutes between two "HH:MM" strings (end - start), never negative. */
export function minutesBetween(start: string, end: string): number {
  return Math.max(0, timeMins(end) - timeMins(start));
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


// ── Occurrence times (partial periods / custom ranges) ──────────────────────

/** Resolved clock span of one lesson or event occurrence inside its period run. */
export interface OccurrenceTime {
  /** Start, minutes since midnight. */
  startMin: number;
  /** End, minutes since midnight — never past the run's last period. */
  endMin: number;
  /** Wall-clock length in minutes (endMin - startMin). Use for geometry. */
  mins: number;
  /** Minutes actually spent inside periods, i.e. excluding any break the run spans. Use for "N min" labels. */
  teachingMins: number;
  /** Empty minutes before the occurrence starts. */
  leadMins: number;
  /** Empty minutes after the occurrence ends. */
  trailMins: number;
  /** True when the occurrence does not fill the whole run. */
  isPartial: boolean;
  /** Zero-padded "HH:MM" start. */
  startLabel: string;
  /** Zero-padded "HH:MM" end. */
  endLabel: string;
  /** "10:20\u201310:45" */
  range: string;
}

function toClock(mins: number): string {
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Resolve the real clock span of an occupant of `run` — one or more
 * chronologically ordered periods (a single period for a timetabled lesson or
 * a single-block event, the whole contiguous run for a multi-period event).
 *
 * `start` ("HH:MM") and `durationMinutes` are the per-lesson / per-event
 * overrides and either may be absent: no start means "start of the run", no
 * duration means "run to the end of the run".
 *
 * The duration is spent as *teaching* minutes, matching how the event editor
 * pre-fills it (`sumPeriodMinutes` — the sum of the selected blocks, breaks
 * excluded). So a 120-minute event over P1+P2 either side of a 20-minute break
 * still ends at P2's end rather than 20 minutes early. Everything is clamped
 * to the run, so an over-long duration can never spill past the last period
 * and a start before the run simply pins to its beginning.
 *
 * This is the single source of truth for partial-period display — the desktop
 * grid chips, the mobile day cards, the mobile agenda rows and the chip action
 * menu header all read their times from here.
 */
export function occurrenceTime(
  run: SchoolPeriod[],
  opts: { start?: string; durationMinutes?: number },
): OccurrenceTime {
  if (!run || run.length === 0) {
    return {
      startMin: 0, endMin: 0, mins: 0, teachingMins: 0, leadMins: 0, trailMins: 0,
      isPartial: false, startLabel: "", endLabel: "", range: "",
    };
  }
  const runStart = timeMins(run[0].start);
  const runEnd   = Math.max(runStart, timeMins(run[run.length - 1].end));
  // A start past the end of the run would give a zero-length occurrence; pin it
  // one minute short so the block still renders (matches the pre-0.3.7 clamp).
  const startMin = opts.start
    ? Math.max(runStart, Math.min(timeMins(opts.start), Math.max(runStart, runEnd - 1)))
    : runStart;

  // Walk the run consuming teaching minutes, skipping any gap between blocks.
  let endMin = startMin;
  let teachingMins = 0;
  let remaining = opts.durationMinutes && opts.durationMinutes > 0 ? opts.durationMinutes : Infinity;
  for (const pr of run) {
    const ps = timeMins(pr.start), pe = timeMins(pr.end);
    if (pe <= startMin) continue;                 // block already behind the start
    const from = Math.max(ps, startMin);
    const avail = Math.max(0, pe - from);
    if (avail === 0) continue;
    if (remaining <= avail) { endMin = from + remaining; teachingMins += remaining; remaining = 0; break; }
    remaining -= avail; teachingMins += avail; endMin = pe;
  }
  endMin = Math.max(startMin, Math.min(endMin, runEnd));

  const startLabel = toClock(startMin);
  const endLabel   = toClock(endMin);
  return {
    startMin,
    endMin,
    mins: endMin - startMin,
    teachingMins,
    leadMins: startMin - runStart,
    trailMins: runEnd - endMin,
    isPartial: startMin > runStart || endMin < runEnd,
    startLabel,
    endLabel,
    range: `${startLabel}\u2013${endLabel}`,
  };
}
