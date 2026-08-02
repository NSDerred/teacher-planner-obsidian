import type { WeekOverride, AcademicYear, SchoolDay, TeacherPlannerSettings } from "../types";

/**
 * Returns the Monday of the week containing the given date.
 */
export function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export function getWeekLabel(date: Date): string {
  const monday = getMondayOfWeek(date);
  const thisMonday = getMondayOfWeek(new Date());
  const diffMs = monday.getTime() - thisMonday.getTime();
  const diffWeeks = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
  if (diffWeeks === 0) return "This Week";
  if (diffWeeks === -1) return "Previous Week";
  if (diffWeeks === 1) return "Next Week";
  const yy = String(monday.getFullYear()).slice(-2);
  return `Week of ${monday.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} '${yy}`;
}

export function formatDateRange(date: Date): string {
  const monday = getMondayOfWeek(date);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const fmt = (d: Date): string => {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}-${mm}-${yy}`;
  };
  return `${fmt(monday)} – ${fmt(friday)}`;
}

/**
 * Format a Date as a local `yyyy-mm-dd` string — the single date-key formatter
 * for the plugin. Deliberately NOT toISOString(), which is UTC and yields the
 * previous day for a local-midnight date in timezones ahead of UTC (e.g. BST).
 */
export function localIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** The date key for a week, keyed on its Monday. */
export function weekKey(monday: Date): string {
  return localIso(monday);
}

/**
 * Convert a legacy week-note key (which, under the old toISOString scheme, was
 * sometimes the Sunday-before instead of the Monday) to the correct local
 * Monday key. Idempotent for keys that are already Mondays.
 */
export function normalizeLegacyWeekKey(key: string): string {
  const d = new Date(key + "T12:00:00");
  if (isNaN(d.getTime())) return key;
  const dow = d.getDay();
  if (dow === 0) d.setDate(d.getDate() + 1);        // Sunday → the Monday it represented
  else if (dow !== 1) d.setDate(d.getDate() + (1 - dow)); // safety: snap to that week's Monday
  return weekKey(d);
}

export function addWeeks(date: Date, weeks: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + weeks * 7);
  return d;
}

export function isSameWeek(a: Date, b: Date): boolean {
  return getMondayOfWeek(a).getTime() === getMondayOfWeek(b).getTime();
}

export function isWithinAcademicYear(date: Date, startDate: string, endDate: string): boolean {
  const d = date.getTime();
  return d >= new Date(startDate).getTime() && d <= new Date(endDate).getTime();
}

const _AB_DAY_KEYS: SchoolDay[] = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
const _DEFAULT_SCHOOL_DAYS: SchoolDay[] = ["monday","tuesday","wednesday","thursday","friday"];

function _isoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** A week is "fully holiday" if every school day in it falls inside a holiday override. */
export function isFullyHolidayWeek(monday: Date, schoolDays: SchoolDay[], overrides: WeekOverride[]): boolean {
  const holidays = overrides.filter(o => o.type === "holiday");
  if (holidays.length === 0) return false;
  let sawSchoolDay = false;
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(d.getDate() + i);
    const key = _AB_DAY_KEYS[(d.getDay() + 6) % 7];
    if (!schoolDays.includes(key)) continue;
    sawSchoolDay = true;
    const iso = _isoLocal(d);
    const covered = holidays.some(h => iso >= h.startDate && iso <= (h.endDate ?? h.startDate));
    if (!covered) return false;
  }
  return sawSchoolDay;
}

/** The A/B override pinned to a given week's Monday, if any. */
function _abOverrideForMonday(monday: Date, overrides: WeekOverride[]): { value: "A" | "B"; anchor: boolean } | null {
  for (const o of overrides) {
    if (!o.abWeekOverride) continue;
    if (getMondayOfWeek(new Date(o.startDate + "T12:00:00")).getTime() === monday.getTime()) {
      return { value: o.abWeekOverride, anchor: !!o.abWeekAnchor };
    }
  }
  return null;
}

/**
 * Returns "A", "B", or null for a date's week.
 *
 * The rotation counts TEACHING weeks from the academic-year start, alternating
 * from `abWeekStartsOn`. When holiday-aware (default), fully-holiday weeks are
 * skipped (they don't advance the count), so teaching continues seamlessly
 * across breaks. Per-week overrides (WeekOverride.abWeekOverride) pin a week:
 * a non-anchor override just relabels that week, while an anchor override
 * re-bases the rotation from there. Returns null for a skipped holiday week or
 * a week before the academic year starts.
 */
export function getAbWeekType(
  date: Date,
  ay: AcademicYear,
  overrides: WeekOverride[] = [],
  schoolDays: SchoolDay[] = _DEFAULT_SCHOOL_DAYS,
): "A" | "B" | null {
  const opp = (x: "A" | "B"): "A" | "B" => (x === "A" ? "B" : "A");
  const startMonday = getMondayOfWeek(new Date(ay.startDate + "T12:00:00"));
  const target = getMondayOfWeek(date);

  if (target.getTime() < startMonday.getTime()) {
    const wk = Math.round((target.getTime() - startMonday.getTime()) / (7 * 24 * 60 * 60 * 1000));
    return (((wk % 2) + 2) % 2) === 0 ? ay.abWeekStartsOn : opp(ay.abWeekStartsOn);
  }

  const holidayAware = ay.abWeekHolidayAware !== false; // default on
  let next: "A" | "B" = ay.abWeekStartsOn;
  const m = new Date(startMonday);
  for (let guard = 0; guard < 400; guard++) {
    const ov = _abOverrideForMonday(m, overrides);
    const skipped = holidayAware && !ov && isFullyHolidayWeek(m, schoolDays, overrides);
    let weekType: "A" | "B" | null;
    if (skipped) {
      weekType = null; // holiday week — does not advance the rotation
    } else if (ov) {
      weekType = ov.value;
      next = ov.anchor ? opp(ov.value) : opp(next);
    } else {
      weekType = next;
      next = opp(next);
    }
    if (m.getTime() === target.getTime()) return weekType;
    m.setDate(m.getDate() + 7);
    if (m.getTime() > target.getTime()) return null;
  }
  return null;
}

/**
 * True if `s` is a real calendar date in YYYY-MM-DD form.
 * Rejects well-formed but impossible dates like "2025-02-30" or "2025-13-01".
 */
export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T12:00:00");
  if (isNaN(d.getTime())) return false;
  const [y, m, day] = s.split("-").map(Number);
  return d.getFullYear() === y && d.getMonth() + 1 === m && d.getDate() === day;
}

/**
 * Returns the first pair of overlapping holiday/INSET overrides, or null.
 * Overlaps make directed-time calculations silently wrong (last-write-wins).
 */
export function findOverlappingOverrides(
  overrides: WeekOverride[]
): [WeekOverride, WeekOverride] | null {
  const sorted = [...overrides].filter(o => o.type === "holiday" || o.type === "inset").sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1].endDate ?? sorted[i - 1].startDate;
    if (sorted[i].startDate <= prevEnd) return [sorted[i - 1], sorted[i]];
  }
  return null;
}

export const DAY_OF_WEEK_MAP: Record<string, number> = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5,
};

/**
 * Folder a dated note lives in: "<planner>/WC - <Monday>" when weekly folders
 * are on, else the planner folder. Single source of truth for the week-grid
 * (wcFolderFor) and lesson-note creation (noteFolder). (P8 dedupe.)
 */
export function wcNoteFolder(s: TeacherPlannerSettings, dateIso: string): string {
  const base = s.plannerFolder || "Teacher Planner";
  if (!(s.weeklyNoteFolders ?? true)) return base;
  const monday = getMondayOfWeek(new Date(dateIso + "T12:00:00"));
  return `${base}/WC - ${localIso(monday)}`;
}
