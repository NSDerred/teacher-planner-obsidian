import type { TeacherPlannerSettings, DirectedTimeSettings } from "./types";

/** Default lesson note template */
const DEFAULT_LESSON_TEMPLATE = `## Notes:
---

## Homework set:
---

## Next lesson:
---
`;

export const DEFAULT_SETTINGS: TeacherPlannerSettings = {
  academicYear: {
    id: "default",
    name: "2025-26",
    startDate: "2025-09-01",
    endDate: "2026-07-15",
    abWeekEnabled: false,
    abWeekStartsOn: "A",
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
    { id: "lesson",         label: "Lesson",         colour: "#6b8edd" },
    { id: "break",          label: "Break",          colour: "#d4a84b" },
    { id: "registration",   label: "Registration",   colour: "#6aaa72" },
    { id: "administration", label: "Administration", colour: "#4badb5" },
  ],
  subjects: [
    { id: "subj-biology", name: "Biology", colour: "#a6e3a1" },
    { id: "subj-maths",   name: "Maths",   colour: "#cba6f7" },
    { id: "subj-science", name: "Science", colour: "#89b4fa" },
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
  gridLineColour: "#555555",
  gridLineWeight: 1,
  blockBorderColour: "#444444",
  blockBorderWeight: 1,
  plannerFolder: "Teacher Planner",
  lessonNoteTemplate: DEFAULT_LESSON_TEMPLATE,
  directedTime: {
    enabled: false,
    contractedHours: 1265,
    timetablePercentage: 100,
    defaultLessonDurationMinutes: 60,
  },
  schoolDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
};

// Colour palette ordered by spectrum (red to pink)
export const CLASS_COLOUR_PALETTE = [
  "#f6a9a9", "#fab387", "#f2c97d", "#f9e2af",
  "#a6e3a1", "#80c787", "#b5d5c5", "#94e2d5",
  "#89dceb",
  "#a8d8ea", "#74c7ec", "#89b4fa",
  "#b4befe", "#c3b1e1", "#cba6f7", "#d4a5c9",
  "#e8a2b8", "#f38ba8",
];
