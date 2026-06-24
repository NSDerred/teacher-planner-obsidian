import type { TeacherPlannerSettings } from "./types";

/** Default lesson note template */
const DEFAULT_LESSON_TEMPLATE = `## Notes:
---

## Homework set:
---

## Next lesson:
---
`;

export const DEFAULT_LESSON_NOTE_TITLE_TEMPLATE = "{{date}} - {{period}} - {{class}} - {{emoji}} {{subject}}";
export const DEFAULT_EVENT_NOTE_TITLE_TEMPLATE = "{{date}} - {{period}} - {{event}}";

export const DEFAULT_SETTINGS: TeacherPlannerSettings = {
  academicYear: {
    id: "default",
    name: "2025-26",
    startDate: "2025-09-01",
    endDate: "2026-07-15",
    abWeekEnabled: false,
    abWeekStartsOn: "A",
    abWeekHolidayAware: true,
    periods: [
      { id: "before-school",  name: "Before School", start: "07:30", end: "08:30", type: "administration" },
      { id: "registration",   name: "Registration",  start: "08:30", end: "09:00", type: "registration" },
      { id: "period-1",       name: "Period 1",      start: "09:00", end: "10:00", type: "lesson" },
      { id: "break-1",        name: "Break",         start: "10:00", end: "10:30", type: "break" },
      { id: "period-2",       name: "Period 2",      start: "10:30", end: "11:30", type: "lesson" },
      { id: "period-3",       name: "Period 3",      start: "11:30", end: "12:30", type: "lesson" },
      { id: "lunch",          name: "Lunch",         start: "12:30", end: "13:00", type: "break" },
      { id: "period-4",       name: "Period 4",      start: "13:00", end: "14:00", type: "lesson" },
      { id: "period-5",       name: "Period 5",      start: "14:00", end: "15:00", type: "lesson" },
      { id: "after-school",   name: "After School",  start: "15:00", end: "19:00", type: "administration" },
    ],
  },
  periodTypes: [
    { id: "lesson",         label: "Lesson",         colour: "theme:muted" },
    { id: "break",          label: "Break",          colour: "theme:accent" },
    { id: "registration",   label: "Registration",   colour: "theme:faint" },
    { id: "administration", label: "Administration", colour: "theme:surface" },
  ],
  subjects: [
    { id: "subj-biology", name: "Biology", emoji: "🌱", colour: "#a6e3a1" },
    { id: "subj-maths",   name: "Maths",   emoji: "🧮", colour: "#cba6f7" },
    { id: "subj-science", name: "Science", emoji: "🔬", colour: "#89b4fa" },
  ],
  classes: [
    { id: "cls-ibdp1", year: "12", code: "IB DP1", subjectId: "subj-biology", colour: "#a6e3a1", colourOverridden: false, lessonCount: 0, classroom: "S3" },
    { id: "cls-ibdp2", year: "13", code: "IB DP2", subjectId: "subj-biology", colour: "#94e2d5", colourOverridden: false, lessonCount: 0, classroom: "S3" },
    { id: "cls-11x3",  year: "11", code: "11X-3",  subjectId: "subj-maths",   colour: "#cba6f7", colourOverridden: false, lessonCount: 0, classroom: "M4" },
    { id: "cls-9z3",   year: "9",  code: "9Z3",    subjectId: "subj-science", colour: "#89b4fa", colourOverridden: false, lessonCount: 0, classroom: "S1" },
    { id: "cls-9p1",   year: "9",  code: "9P1",    subjectId: "subj-science", colour: "#74c7ec", colourOverridden: false, lessonCount: 0, classroom: "S1" },
  ],
  timetable: [],
  timetableTemplates: [],
  weekOverrides: [],
  activities: [
    { id: "activity-cover",     label: "Cover",          colour: "#e05555", activityType: "directed" as const },
    { id: "activity-cpd",       label: "CPD",            colour: "#cba6f7", activityType: "directed" as const },
    { id: "activity-duty",      label: "Duty",           colour: "#d4903a", activityType: "directed" as const },
    { id: "activity-meeting",   label: "Meeting 1",      colour: "#4a90d9", activityType: "directed" as const },
    { id: "activity-protected", label: "Protected time", colour: "#9070cc", activityType: "directed" as const },
    { id: "activity-trapped",   label: "Trapped time",   colour: "#89dceb", activityType: "directed" as const },
    { id: "activity-tutor",     label: "Tutor",          colour: "#f0956a", activityType: "directed" as const },
  ],
  dateEvents: [],
  slotExclusions: [],
  weekNotes: {},
  notesHeight: 120,
  gridLineColour: "theme:border",
  gridLineWeight: 1,
  blockBorderColour: "theme:border",
  blockBorderWeight: 1,
  plannerFolder: "Teacher Planner",
  lessonNoteTemplate: DEFAULT_LESSON_TEMPLATE,
  lessonNoteTitleTemplate: DEFAULT_LESSON_NOTE_TITLE_TEMPLATE,
  eventNoteTitleTemplate: DEFAULT_EVENT_NOTE_TITLE_TEMPLATE,
  directedTime: {
    enabled: false,
    contractedHours: 1265,
    timetablePercentage: 100,
    defaultLessonDurationMinutes: 60,
  },
  schoolDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
};

/**
 * Default theme-derived colour for each built-in period type.
 * Used by the "Reset to theme" buttons in settings. Custom types
 * fall back to FALLBACK_PERIOD_TYPE_COLOUR.
 */
export const DEFAULT_PERIOD_TYPE_COLOURS: Record<string, string> = {
  lesson:         "theme:muted",
  break:          "theme:accent",
  registration:   "theme:faint",
  administration: "theme:surface",
};
export const FALLBACK_PERIOD_TYPE_COLOUR = "theme:muted";

// Colour palette ordered by spectrum (red to pink)
export const CLASS_COLOUR_PALETTE = [
  "#f6a9a9", "#fab387", "#f2c97d", "#f9e2af",
  "#a6e3a1", "#80c787", "#b5d5c5", "#94e2d5",
  "#89dceb",
  "#a8d8ea", "#74c7ec", "#89b4fa",
  "#b4befe", "#c3b1e1", "#cba6f7", "#d4a5c9",
  "#e8a2b8", "#f38ba8",
];

/**
 * Pick a class/subject colour at random from CLASS_COLOUR_PALETTE, preferring a
 * colour not already used by an existing class. Skipping used colours also means
 * the colour just added is never immediately repeated. Falls back to a plain
 * random pick from the full palette once every preset colour is in use.
 */
export function randomClassColour(used: Array<string | undefined> = []): string {
  const taken = new Set(used.filter((c): c is string => !!c).map(c => c.toLowerCase()));
  const free = CLASS_COLOUR_PALETTE.filter(c => !taken.has(c.toLowerCase()));
  const pool = free.length ? free : CLASS_COLOUR_PALETTE;
  return pool[Math.floor(Math.random() * pool.length)];
}

import type { PlannerRecord, GlobalPluginData } from "./types";

/**
 * Default settings for a brand-new planner.
 * The name and id are placeholders — overwritten by the wizard or migration.
 */
export const DEFAULT_PLANNER: PlannerRecord = {
  id: "planner-default",
  name: "2025-26",
  plannerFolder: "Teacher Planner/2025-26",
  academicYear: DEFAULT_SETTINGS.academicYear,
  periodTypes: DEFAULT_SETTINGS.periodTypes,
  subjects: DEFAULT_SETTINGS.subjects,
  classes: DEFAULT_SETTINGS.classes,
  timetable: [],
  timetableTemplates: [],
  weekOverrides: [],
  activities: DEFAULT_SETTINGS.activities,
  dateEvents: [],
  slotExclusions: [],
  weekNotes: {},
  weekNoteFiles: true,
  notesHeight: 120,
  lessonNoteTemplate: DEFAULT_SETTINGS.lessonNoteTemplate,
  lessonNoteTitleTemplate: DEFAULT_SETTINGS.lessonNoteTitleTemplate,
  eventNoteTitleTemplate: DEFAULT_SETTINGS.eventNoteTitleTemplate,
  directedTime: {
    enabled: false,
    contractedHours: 1265,
    timetablePercentage: 100,
    defaultLessonDurationMinutes: 60,
  },
  schoolDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
};

/**
 * Default top-level global data used on a completely fresh install.
 * loadSettings() will either populate this from disk or trigger the wizard.
 */
export const DEFAULT_GLOBAL_DATA: GlobalPluginData = {
  _version: 2,
  activePlannerId: "",
  rootPlannerFolder: "Teacher Planner",
  gridLineColour: "theme:border",
  gridLineWeight: 1,
  blockBorderColour: "theme:border",
  blockBorderWeight: 1,
  confirmBeforeDelete: true,
  weekNoteOpenIn: "tab",
  planners: [],
};
