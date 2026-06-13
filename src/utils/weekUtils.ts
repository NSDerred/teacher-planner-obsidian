import type { WeekOverride } from "../types";

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

export function weekKey(monday: Date): string {
  // Local date components — NOT toISOString(), which is UTC and yields the
  // Sunday date for a local-midnight Monday in timezones ahead of UTC (e.g. BST).
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const d = String(monday.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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

/**
 * Returns "A" or "B" for the given date based on A/B week rotation config.
 */
export function getAbWeekType(
  date: Date,
  academicStartDate: string,
  startsOn: "A" | "B"
): "A" | "B" {
  const startMonday = getMondayOfWeek(new Date(academicStartDate + "T12:00:00"));
  const currentMonday = getMondayOfWeek(date);
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weeksDiff = Math.round((currentMonday.getTime() - startMonday.getTime()) / msPerWeek);
  const isEven = ((weeksDiff % 2) + 2) % 2 === 0;
  return isEven ? startsOn : (startsOn === "A" ? "B" : "A");
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
  const sorted = [...overrides].sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1].endDate ?? sorted[i - 1].startDate;
    if (sorted[i].startDate <= prevEnd) return [sorted[i - 1], sorted[i]];
  }
  return null;
}

export const DAY_OF_WEEK_MAP: Record<string, number> = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5,
};
