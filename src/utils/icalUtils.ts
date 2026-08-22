import type {
  TeacherPlannerSettings, SchoolDay, SchoolPeriod,
} from "../types";
import { getMondayOfWeek, getAbWeekType, schoolDayOf } from "./weekUtils";
import { getPeriodsForDay } from "./scheduleUtils";
import { eventPeriodIds } from "./eventUtils";

/** Options for the iCal export, gathered in the Export modal. */
export interface IcalOptions {
  /** Inclusive ISO date range to export. */
  fromDate: string;
  toDate: string;
  /** Timetabled lessons & activities placed in periods. */
  includeLessons: boolean;
  /** One-off date events (cover, meetings, trips...). */
  includeDateEvents: boolean;
  /** Holidays and INSET periods as all-day events. */
  includeOverrides: boolean;
  /** Structural non-lesson periods (break, registration...) with no slot. */
  includeNonLessons: boolean;
  /** X-WR-CALNAME shown by calendar apps. */
  calendarName: string;
  /** Days of the week to export. Defaults to the planner's school days. */
  days?: SchoolDay[];
}

/** Escape per RFC 5545 §3.3.11 (TEXT): backslash, semicolon, comma, newline. */
function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold lines longer than 73 chars with CRLF + single space (RFC 5545 §3.1). */
function foldLine(line: string): string {
  if (line.length <= 73) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 73));
  rest = rest.slice(73);
  while (rest.length > 0) {
    parts.push(" " + rest.slice(0, 72));
    rest = rest.slice(72);
  }
  return parts.join("\r\n");
}

/** "2026-09-14" + "08:50" -> "20260914T085000" (floating local time). */
function icsDateTime(iso: string, hhmm: string): string {
  return iso.replace(/-/g, "") + "T" + hhmm.replace(":", "") + "00";
}

/** "2026-09-14" -> "20260914" (all-day VALUE=DATE). */
function icsDate(iso: string): string {
  return iso.replace(/-/g, "");
}

/** Shift an ISO date by N days (noon-anchored, DST-safe). */
function shiftIso(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Add minutes to "HH:MM", clamped to the same day. */
function addMinutes(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = Math.min(h * 60 + m + mins, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

interface VEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  /** Timed event */
  dateIso?: string;
  startHHMM?: string;
  endHHMM?: string;
  /** All-day event (inclusive range) */
  allDayStartIso?: string;
  allDayEndIso?: string;
}

/**
 * Build the calendar's event list by resolving the planner day-by-day,
 * mirroring the week view: template by week Monday, A/B rotation,
 * holiday/INSET suppression, slot exclusions, date events.
 */
function collectEvents(s: TeacherPlannerSettings, opts: IcalOptions): VEvent[] {
  const events: VEvent[] = [];
  const schoolDays: SchoolDay[] =
    opts.days ?? s.schoolDays ?? ["monday", "tuesday", "wednesday", "thursday", "friday"];
  // Union map as fallback for date events placed outside a day's schedule
  const unionById = new Map((s.academicYear?.periods ?? []).map(p => [p.id, p]));

  // ── Per-day override map (holiday/INSET), matching the week view ─────────
  const overrideByDate = new Map<string, { type: "holiday" | "inset" | "custom"; label?: string }>();
  for (const o of s.weekOverrides ?? []) {
    const end = o.endDate ?? o.startDate;
    for (let iso = o.startDate; iso <= end; iso = shiftIso(iso, 1)) {
      overrideByDate.set(iso, { type: o.type, label: o.label });
    }
  }

  // ── Holidays & INSET as all-day range events ──────────────────────────────
  if (opts.includeOverrides) {
    for (const o of s.weekOverrides ?? []) {
      const end = o.endDate ?? o.startDate;
      if (end < opts.fromDate || o.startDate > opts.toDate) continue;
      const label = o.label || (o.type === "inset" ? "INSET" : o.type === "holiday" ? "Holiday" : "School event");
      events.push({
        uid: `tp-ovr-${o.type}-${o.startDate}`,
        summary: label,
        allDayStartIso: o.startDate,
        allDayEndIso: end,
      });
    }
  }

  // ── Label helpers (same precedence as the week view) ─────────────────────
  const labelFor = (classId: string, slotRoom?: string, notes?: string) => {
    const cls = s.classes?.find(c => c.id === classId);
    if (cls) {
      const subj = s.subjects?.find(x => x.id === cls.subjectId);
      const room = slotRoom ?? cls.classroom ?? "";
      return {
        summary: room ? `${cls.code} · ${room}` : cls.code,
        location: room,
        description: [ [cls.year, subj?.name].filter(Boolean).join(" · "), notes ?? "" ].filter(Boolean).join("\n"),
      };
    }
    const act = s.activities?.find(a => a.id === classId);
    if (act) {
      const room = slotRoom ?? act.classroom ?? "";
      return {
        summary: room ? `${act.label} · ${room}` : act.label,
        location: room,
        description: [act.info ?? "", notes ?? ""].filter(Boolean).join("\n"),
      };
    }
    return { summary: "Lesson", location: slotRoom ?? "", description: notes ?? "" };
  };

  // ── Day-by-day walk ───────────────────────────────────────────────────────
  for (let iso = opts.fromDate; iso <= opts.toDate; iso = shiftIso(iso, 1)) {
    const d = new Date(iso + "T12:00:00");
    const dayName = schoolDayOf(d);
    if (!schoolDays.includes(dayName)) continue;
    if (overrideByDate.has(iso)) continue; // holiday/INSET day — nothing timetabled

    const dayPeriods: SchoolPeriod[] = getPeriodsForDay(s.academicYear, dayName);
    const periodById = new Map(dayPeriods.map(p => [p.id, p]));
    const monday = getMondayOfWeek(d);
    const mondayKey = monday.toISOString().slice(0, 10);
    const template = s.timetableTemplates?.find(t => t.startDate <= mondayKey && t.endDate >= mondayKey);
    const abType = s.academicYear?.abWeekEnabled
      ? getAbWeekType(d, s.academicYear, s.weekOverrides ?? [], s.schoolDays)
      : null;

    const occupiedPeriods = new Set<string>();

    // Timetabled slots
    if (template) {
      for (const slot of template.slots) {
        if (slot.day !== dayName) continue;
        if (abType && slot.weekType && slot.weekType !== "both" && slot.weekType !== abType) continue;
        if (s.slotExclusions?.some(ex => ex.slotId === slot.id && ex.date === iso)) continue;
        const period = periodById.get(slot.periodId);
        if (!period) continue;
        occupiedPeriods.add(slot.periodId);
        if (!opts.includeLessons) continue;
        const lbl = labelFor(slot.classId, slot.classroom, slot.notes);
        events.push({
          uid: `tp-slot-${slot.id}-${iso}`,
          summary: lbl.summary,
          description: lbl.description || undefined,
          location: lbl.location || undefined,
          dateIso: iso,
          startHHMM: period.start,
          endHHMM: period.end,
        });
      }
    }

    // One-off date events
    if (opts.includeDateEvents) {
      for (const ev of s.dateEvents ?? []) {
        if (ev.date !== iso) continue;
        // Resolve every block this event occupies (multi-period aware), ordered by start.
        const evPeriods = eventPeriodIds(ev)
          .map(id => periodById.get(id) ?? unionById.get(id))
          .filter((p): p is NonNullable<typeof p> => !!p)
          .sort((a, b) => a.start.localeCompare(b.start));
        const first = evPeriods[0];
        if (!first) continue;
        const last = evPeriods[evPeriods.length - 1];
        const isCustom = !!(ev.title && ev.title.trim());
        const lbl = isCustom
          ? {
              summary: ev.classroom ? `${ev.title!.trim()} · ${ev.classroom}` : ev.title!.trim(),
              location: ev.classroom ?? "",
              description: ev.notes ?? "",
            }
          : labelFor(ev.classId, ev.classroom, ev.notes);
        const end = evPeriods.length > 1
          ? last.end
          : (ev.durationMinutes ? addMinutes(first.start, ev.durationMinutes) : first.end);
        events.push({
          uid: `tp-ev-${ev.id}`,
          summary: lbl.summary,
          description: lbl.description || undefined,
          location: lbl.location || undefined,
          dateIso: iso,
          startHHMM: first.start,
          endHHMM: end,
        });
        for (const p of evPeriods) occupiedPeriods.add(p.id);
      }
    }

    // Structural non-lesson periods (break, registration...) without a slot
    if (opts.includeNonLessons) {
      for (const period of dayPeriods) {
        if (period.type === "lesson") continue;
        if (occupiedPeriods.has(period.id)) continue;
        events.push({
          uid: `tp-per-${period.id}-${iso}`,
          summary: period.name,
          dateIso: iso,
          startHHMM: period.start,
          endHHMM: period.end,
        });
      }
    }
  }

  return events;
}

/** Serialise options + settings into a complete RFC 5545 VCALENDAR string. */
export function generateIcal(s: TeacherPlannerSettings, opts: IcalOptions): string {
  const events = collectEvents(s, opts);
  const now = new Date();
  const dtstamp =
    now.getUTCFullYear().toString() +
    String(now.getUTCMonth() + 1).padStart(2, "0") +
    String(now.getUTCDate()).padStart(2, "0") + "T" +
    String(now.getUTCHours()).padStart(2, "0") +
    String(now.getUTCMinutes()).padStart(2, "0") +
    String(now.getUTCSeconds()).padStart(2, "0") + "Z";

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Teacher Planner//Obsidian Plugin//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    foldLine("X-WR-CALNAME:" + icsEscape(opts.calendarName)),
  ];

  for (const ev of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(foldLine("UID:" + ev.uid + "@teacher-planner-obsidian"));
    lines.push("DTSTAMP:" + dtstamp);
    if (ev.allDayStartIso) {
      lines.push("DTSTART;VALUE=DATE:" + icsDate(ev.allDayStartIso));
      // DTEND is exclusive for all-day events
      lines.push("DTEND;VALUE=DATE:" + icsDate(shiftIso(ev.allDayEndIso ?? ev.allDayStartIso, 1)));
    } else if (ev.dateIso && ev.startHHMM && ev.endHHMM) {
      lines.push("DTSTART:" + icsDateTime(ev.dateIso, ev.startHHMM));
      lines.push("DTEND:" + icsDateTime(ev.dateIso, ev.endHHMM));
    }
    lines.push(foldLine("SUMMARY:" + icsEscape(ev.summary)));
    if (ev.location) lines.push(foldLine("LOCATION:" + icsEscape(ev.location)));
    if (ev.description) lines.push(foldLine("DESCRIPTION:" + icsEscape(ev.description)));
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
