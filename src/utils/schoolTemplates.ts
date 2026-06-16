import { TFile, TFolder } from "obsidian";
import type TeacherPlannerPlugin from "../main";
import type {
  SchoolPeriod, DaySchedule, PeriodTypeConfig, WeekOverride, SchoolDay,
} from "../types";
import { ensureDaySchedules, syncPeriodsUnion } from "./scheduleUtils";

/**
 * Reusable "school template" save/load. Two kinds, both plain-JSON files in a
 * vault "Templates" folder (so they sync and can be shared by dropping the file
 * in):
 *   - structure: the school shell (periods, block types, A/B pattern, school
 *     days). NO personal data — classes, timetable, notes, dates are excluded.
 *   - holidays: the holiday / inset entries, to drop in and re-date each year.
 */

const TEMPLATE_TYPE = "teacher-planner-template";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null));

export interface SchoolStructureTemplate {
  periods: SchoolPeriod[];
  daySchedules?: DaySchedule[];
  dayScheduleMap?: Partial<Record<SchoolDay, string>>;
  abWeekEnabled: boolean;
  abWeekStartsOn: "A" | "B";
  abWeekHolidayAware?: boolean;
  periodTypes: PeriodTypeConfig[];
  schoolDays?: SchoolDay[];
}

export interface HolidayCalendarTemplate {
  overrides: WeekOverride[];
}

export type TemplateKind = "structure" | "holidays";

export interface ParsedTemplate {
  kind: TemplateKind;
  name: string;
  structure?: SchoolStructureTemplate;
  holidays?: HolidayCalendarTemplate;
}

// ── Folders ─────────────────────────────────────────────────────────────────

function templatesRoot(plugin: TeacherPlannerPlugin): string {
  const root = plugin.plannerData.rootPlannerFolder || "Teacher Planner";
  return `${root}/Templates`;
}
export function structureTemplatesFolder(plugin: TeacherPlannerPlugin): string {
  return `${templatesRoot(plugin)}/School structure`;
}
export function holidayTemplatesFolder(plugin: TeacherPlannerPlugin): string {
  return `${templatesRoot(plugin)}/Holiday calendars`;
}
function folderFor(plugin: TeacherPlannerPlugin, kind: TemplateKind): string {
  return kind === "structure" ? structureTemplatesFolder(plugin) : holidayTemplatesFolder(plugin);
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, "-").replace(/\s{2,}/g, " ").trim() || "Template";
}

// ── Build (extract from the current planner) ────────────────────────────────

export function buildStructureTemplate(plugin: TeacherPlannerPlugin, name: string): string {
  const s = plugin.settings;
  const ay = s.academicYear;
  const structure: SchoolStructureTemplate = {
    periods: clone(ay.periods ?? []),
    daySchedules: clone(ay.daySchedules),
    dayScheduleMap: clone(ay.dayScheduleMap),
    abWeekEnabled: !!ay.abWeekEnabled,
    abWeekStartsOn: ay.abWeekStartsOn ?? "A",
    abWeekHolidayAware: ay.abWeekHolidayAware,
    periodTypes: clone(s.periodTypes ?? []),
    schoolDays: clone(s.schoolDays),
  };
  return JSON.stringify({ type: TEMPLATE_TYPE, version: 1, kind: "structure", name, exportedAt: new Date().toISOString(), structure }, null, 2);
}

export function buildHolidayTemplate(plugin: TeacherPlannerPlugin, name: string): string {
  const overrides = (plugin.settings.weekOverrides ?? []).filter(o => o.type === "holiday" || o.type === "inset");
  const holidays: HolidayCalendarTemplate = { overrides: clone(overrides) };
  return JSON.stringify({ type: TEMPLATE_TYPE, version: 1, kind: "holidays", name, exportedAt: new Date().toISOString(), holidays }, null, 2);
}

/** How many holiday/inset entries the current planner would save (for the UI). */
export function holidayCount(plugin: TeacherPlannerPlugin): number {
  return (plugin.settings.weekOverrides ?? []).filter(o => o.type === "holiday" || o.type === "inset").length;
}

// ── Write / list / parse ────────────────────────────────────────────────────

export async function writeTemplateFile(plugin: TeacherPlannerPlugin, kind: TemplateKind, name: string, json: string): Promise<string> {
  const app = plugin.app;
  const root = templatesRoot(plugin);
  const folder = folderFor(plugin, kind);
  for (const f of [root, folder]) {
    if (!app.vault.getAbstractFileByPath(f)) {
      try { await app.vault.createFolder(f); } catch { /* exists / race — non-fatal */ }
    }
  }
  const base = safeName(name);
  let path = `${folder}/${base}.json`;
  let i = 2;
  while (app.vault.getAbstractFileByPath(path)) path = `${folder}/${base} (${i++}).json`;
  await app.vault.create(path, json);
  return path;
}

export function listTemplateFiles(plugin: TeacherPlannerPlugin, kind: TemplateKind): TFile[] {
  const folder = plugin.app.vault.getAbstractFileByPath(folderFor(plugin, kind));
  if (!(folder instanceof TFolder)) return [];
  return folder.children
    .filter((c): c is TFile => c instanceof TFile && c.extension === "json")
    .sort((a, b) => b.stat.mtime - a.stat.mtime);
}

/** Parse + validate a template file's text. Throws with a friendly message on failure. */
export function parseTemplate(text: string): ParsedTemplate {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("Not valid JSON."); }
  if (typeof parsed !== "object" || parsed === null) throw new Error("Not a Teacher Planner template file.");
  const o = parsed as { type?: unknown; kind?: unknown; name?: unknown; structure?: unknown; holidays?: unknown };
  if (o.type !== TEMPLATE_TYPE) throw new Error("Not a Teacher Planner template file.");
  const name = typeof o.name === "string" ? o.name : "Template";

  if (o.kind === "structure") {
    const st = o.structure as Partial<SchoolStructureTemplate> | undefined;
    if (!st || typeof st !== "object" || !Array.isArray(st.periods)) throw new Error("School structure template is malformed.");
    return { kind: "structure", name, structure: st as SchoolStructureTemplate };
  }
  if (o.kind === "holidays") {
    const h = o.holidays as Partial<HolidayCalendarTemplate> | undefined;
    if (!h || typeof h !== "object" || !Array.isArray(h.overrides)) throw new Error("Holiday calendar template is malformed.");
    return { kind: "holidays", name, holidays: h as HolidayCalendarTemplate };
  }
  throw new Error("Unknown template kind.");
}

// ── Apply ───────────────────────────────────────────────────────────────────

/**
 * Replace the current planner's school shell with a structure template. The
 * academic-year dates, name and id are kept; classes/timetable are left as-is
 * (the caller warns that slots pinned to old periods will detach).
 */
export async function applyStructureTemplate(plugin: TeacherPlannerPlugin, structure: SchoolStructureTemplate): Promise<void> {
  const s = plugin.settings;
  const ay = s.academicYear;
  ay.periods = clone(structure.periods);
  ay.daySchedules = clone(structure.daySchedules);
  ay.dayScheduleMap = clone(structure.dayScheduleMap);
  ay.abWeekEnabled = !!structure.abWeekEnabled;
  ay.abWeekStartsOn = structure.abWeekStartsOn ?? "A";
  ay.abWeekHolidayAware = structure.abWeekHolidayAware;
  s.periodTypes = clone(structure.periodTypes ?? []);
  if (structure.schoolDays) s.schoolDays = clone(structure.schoolDays);
  ensureDaySchedules(ay);
  syncPeriodsUnion(ay);
  await plugin.saveSettings();
}

/** Add a holiday calendar template's entries to the current planner (additive; user re-dates). */
export async function applyHolidayTemplate(plugin: TeacherPlannerPlugin, holidays: HolidayCalendarTemplate): Promise<number> {
  const s = plugin.settings;
  if (!s.weekOverrides) s.weekOverrides = [];
  const add = clone(holidays.overrides ?? []).filter(o => o && (o.type === "holiday" || o.type === "inset"));
  s.weekOverrides.push(...add);
  await plugin.saveSettings();
  return add.length;
}

/** Shift every holiday/inset override's dates by a number of days (re-dating helper). */
export function shiftOverrideDates(overrides: WeekOverride[], days: number): WeekOverride[] {
  const shift = (iso: string): string => {
    const d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  return overrides.map(o => ({
    ...o,
    startDate: shift(o.startDate),
    endDate: o.endDate ? shift(o.endDate) : o.endDate,
  }));
}
