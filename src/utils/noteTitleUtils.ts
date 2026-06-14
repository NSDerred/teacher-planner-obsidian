/**
 * Note-title templating for generated lesson and event notes.
 *
 * Templates use {{token}} placeholders. Available tokens:
 *   {{date}}    → UK date, e.g. 13-06-2026
 *   {{period}}  → short period/block label, e.g. P1 (numbered) or Break/Lunch (named)
 *   {{class}}   → class code, e.g. 10A
 *   {{subject}} → subject name, e.g. Biology
 *   {{emoji}}   → subject emoji, e.g. 🌱 (empty for activities)
 *   {{event}}   → event/activity name, e.g. Assembly
 *
 * Empty tokens collapse cleanly: a missing token never leaves a dangling
 * " - " separator, and illegal filename characters are stripped.
 */

export interface NoteTitleParts {
  /** ISO date (YYYY-MM-DD) — converted to UK format by the renderer. */
  dateIso?: string;
  /** Raw period/block name, e.g. "Period 1" — shortened by the renderer. */
  periodName?: string;
  classCode?: string;
  subjectName?: string;
  emoji?: string;
  eventName?: string;
}

type TitleTokenKey = "date" | "period" | "class" | "subject" | "emoji" | "event";

/** Convert an ISO date (YYYY-MM-DD) to UK format (DD-MM-YYYY). */
export function formatUkDate(iso?: string): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

/**
 * Shorten a period/block name for use in a title.
 * A single leading word followed by a number collapses to its initial + number
 * ("Period 1" → "P1", "Lesson 2" → "L2"). Named blocks with no trailing number
 * are kept verbatim ("Break", "Lunch", "Registration").
 */
export function shortPeriodLabel(name?: string): string {
  if (!name) return "";
  const trimmed = name.trim();
  const m = trimmed.match(/^([A-Za-z])[A-Za-z]*\s*(\d+)$/);
  return m ? m[1].toUpperCase() + m[2] : trimmed;
}

/** Strip characters that are illegal in vault filenames. */
export function sanitiseNoteFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, "-").replace(/\s{2,}/g, " ").trim();
}

/**
 * Render a note-title template against the supplied parts.
 * Returns a sanitised, filename-safe string with empty segments collapsed.
 */
export function buildNoteTitle(template: string, parts: NoteTitleParts): string {
  const values: Record<TitleTokenKey, string> = {
    date:    formatUkDate(parts.dateIso),
    period:  shortPeriodLabel(parts.periodName),
    class:   (parts.classCode ?? "").trim(),
    subject: (parts.subjectName ?? "").trim(),
    emoji:   (parts.emoji ?? "").trim(),
    event:   (parts.eventName ?? "").trim(),
  };

  let out = (template ?? "").replace(
    /\{\{(date|period|class|subject|emoji|event)\}\}/g,
    (_match, key: keyof typeof values) => values[key] ?? "",
  );

  // Collapse " - " separated segments, dropping any that are now empty.
  out = out
    .split(/ - /)
    .map(seg => seg.trim())
    .filter(seg => seg.length > 0)
    .join(" - ");

  return sanitiseNoteFileName(out);
}
