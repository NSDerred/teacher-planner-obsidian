export interface PeriodTypeConfig {
  id: string;
  label: string;
  colour: string;
}
export interface SchoolPeriod {
  id: string;
  name: string;
  start: string;
  end: string;
  type: string;
}
export type SchoolDay = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
export interface AcademicYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  periods: SchoolPeriod[];
  abWeekEnabled: boolean;
  abWeekStartsOn: "A" | "B";
}
export interface Subject {
  id: string;
  name: string;
  colour: string;
}
export interface ClassGroup {
  id: string;
  year: string;
  code: string;
  subjectId: string;
  colour: string;
  colourOverridden: boolean;
  lessonCount: number;
  classroom?: string;
  archived?: boolean;
}
export interface TimetableSlot {
  id: string;
  day: SchoolDay;
  periodId: string;
  classId: string;
  start: string;
  end: string;
  notes?: string;
  weekType?: "A" | "B" | "both";
  classroom?: string;
  /** Per-slot lesson duration override in minutes. Falls back to directedTime.defaultLessonDurationMinutes. */
  durationMinutes?: number;
}
export interface TimetableTemplate {
  id: string;
  name: string;
  startDate: string; // ISO "YYYY-MM-DD" inclusive
  endDate: string;   // ISO "YYYY-MM-DD" inclusive
  slots: TimetableSlot[];
}
export interface WeekOverride {
  /** First day of the override period (any day, ISO "YYYY-MM-DD"). */
  startDate: string;
  /** Last day of the override period (any day, ISO "YYYY-MM-DD"). If absent, the override covers only startDate. */
  endDate?: string;
  type: "holiday" | "inset" | "custom";
  label?: string;
  /** Total directed hours for this INSET period (all working days combined). Only used when type === "inset". */
  insetHours?: number;
  slotOverrides?: Record<string, Partial<TimetableSlot>>;
  abWeekOverride?: "A" | "B";
}
export interface LessonNoteFrontmatter {
  classId: string;
  classCode: string;
  date: string;
  lessonNumber: number;
  topic: string;
  colour: string;
  modified: boolean;
  slotId: string;
}
export interface Activity {
  id: string;
  label: string;
  colour: string;
  info?: string;
  classroom?: string;
  archived?: boolean;
  /**
   * "directed" = counts toward the teacher's directed time tally (default when absent).
   * "other"    = appears in the planner but is excluded from the directed time count.
   */
  activityType?: "directed" | "other";
  /** Default duration in minutes when this activity is placed in the planner. */
  durationMinutes?: number;
}

export interface SlotExclusion {
  slotId: string;
  date: string; // ISO "YYYY-MM-DD" — suppress this timetable slot on this specific date
}

export interface DateEvent {
  id: string;
  date: string;      // ISO date "YYYY-MM-DD"
  periodId: string;
  classId: string;   // class or activity id
  notes?: string;
  classroom?: string;
  /** Per-event duration override in minutes. Falls back to the activity's durationMinutes. */
  durationMinutes?: number;
}

export type PlannerTheme = "carbon" | "paper";
export type PlannerThemeMode = "light" | "dark";

/** Settings for the directed time tracker feature. */
export interface DirectedTimeSettings {
  /** Whether the directed time tracker is enabled. */
  enabled: boolean;
  /**
   * The statutory maximum directed time in hours for a full-time teacher.
   * Default: 1265 (STPCD). Override for schools on different contracts.
   */
  contractedHours: number;
  /**
   * The teacher's timetable fraction as a percentage (1–100).
   * Effective contracted hours = contractedHours × (timetablePercentage / 100).
   * Default: 100 (full-time).
   */
  timetablePercentage: number;
  /**
   * Default lesson duration in minutes applied to all timetable lessons
   * unless overridden at the slot level.
   * Default: 60. Options surfaced in UI: 45, 50, 60, custom.
   */
  defaultLessonDurationMinutes: number;
}

export interface TeacherPlannerSettings {
  academicYear: AcademicYear;
  periodTypes: PeriodTypeConfig[];
  subjects: Subject[];
  classes: ClassGroup[];
  timetable: TimetableSlot[];          // legacy — migrated to timetableTemplates on load
  timetableTemplates: TimetableTemplate[];
  weekOverrides: WeekOverride[];
  activities: Activity[];
  dateEvents: DateEvent[];
  slotExclusions?: SlotExclusion[];
  weekNotes: Record<string, string>;
  notesHeight?: number;
  gridLineColour?: string;
  gridLineWeight?: number;
  blockBorderColour?: string;
  blockBorderWeight?: number;
  plannerFolder: string;
  lessonNoteTemplate: string;
  theme?: PlannerTheme;
  themeMode?: PlannerThemeMode;
  /** Directed time tracker. Undefined on legacy installs — initialised by migration guard in main.ts. */
  directedTime?: DirectedTimeSettings;
  /**
   * Which days of the week are school days.
   * Default Mon–Fri. Extend to include "saturday" or "sunday" for boarding/Saturday schools.
   */
  schoolDays?: SchoolDay[];
}
