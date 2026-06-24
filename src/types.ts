export interface PeriodTypeConfig {
  id: string;
  label: string;
  /** Either a hex value ("#rrggbb") or a theme token ("theme:muted" etc.)
   *  resolved from the user's active Obsidian theme — see utils/themeColours. */
  colour: string;
}
/** Period block type id — references PeriodTypeConfig.id ("lesson", "break", custom ids…). */
export type PeriodType = string;

export interface SchoolPeriod {
  id: string;
  name: string;
  start: string;
  end: string;
  type: string;
}
export type SchoolDay = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
/** A named set of periods that shapes one kind of school day (e.g. "Standard day", "Saturday"). */
export interface DaySchedule {
  id: string;
  name: string;
  periods: SchoolPeriod[];
}
export interface AcademicYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  /**
   * Legacy flat list. When daySchedules is present this is maintained as the
   * chronologically-sorted union of all schedules (same object references)
   * so legacy call sites keep working — see utils/scheduleUtils.ts.
   */
  periods: SchoolPeriod[];
  /** Per-day period schedules (Option B). Initialised by ensureDaySchedules(). */
  daySchedules?: DaySchedule[];
  /** Day → DaySchedule id. Unmapped days use the first schedule. */
  dayScheduleMap?: Partial<Record<SchoolDay, string>>;
  abWeekEnabled: boolean;
  abWeekStartsOn: "A" | "B";
  /** Continue A/B rotation across holidays (skip fully-holiday weeks). Default true. */
  abWeekHolidayAware?: boolean;
}
export interface Subject {
  id: string;
  name: string;
  colour?: string;  // kept for class colour defaults; no longer shown in subject header UI
  emoji?: string;   // displayed as subject identifier in settings and wizard
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
  /** With abWeekOverride: false/absent = relabel this week only; true = re-anchor the rotation from here. */
  abWeekAnchor?: boolean;
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
  /** Primary / first period block (kept for back-compat and single-period events). */
  periodId: string;
  /**
   * One or more period blocks the event occupies. When absent or empty,
   * the event occupies the single block named by `periodId`. Custom
   * multi-period events (e.g. a meeting over P1+P2) list every block here.
   */
  periodIds?: string[];
  /**
   * Class or activity id this event mirrors. Empty string ("") for custom
   * free-form events created with a typed title (see `title`).
   */
  classId: string;
  /**
   * Free-form event name. When set, the event is a custom one-off (not tied
   * to a class/activity) and is rendered/labelled from these fields directly.
   */
  title?: string;
  /** Custom event colour (hex). Used when `title` is set. */
  colour?: string;
  /** Whether a custom (title) event counts towards directed time. */
  isDirected?: boolean;
  notes?: string;
  classroom?: string;
  /** Per-event duration override in minutes. Falls back to the activity's durationMinutes. */
  durationMinutes?: number;
  /**
   * Optional custom start time "HH:MM" within the first period block. When absent the
   * event starts at the first block's start. Phase 1 supports a start within a single block.
   */
  startTime?: string;
}

/**
 * Links a lesson occurrence to a lesson-plan note in the vault. Either
 * slotId+date (timetabled lesson on a specific day) or eventId (date event).
 * The note itself is plain markdown and is never modified by the plugin.
 */
export interface LessonPlanLink {
  slotId?: string;
  date?: string;     // ISO "YYYY-MM-DD" — required with slotId
  eventId?: string;
  path: string;      // vault path of the plan note
}

/** One external (outside-the-vault) file or folder attached to a lesson/event. Desktop only; machine-specific paths. */
export interface ExternalResourceLink {
  slotId?: string;
  date?: string;
  eventId?: string;
  path: string;      // absolute OS path
  /** Whether the path points at a file or a folder. Optional on legacy links. */
  kind?: "file" | "folder";
}

/** Manual "lesson prepared" mark — teacher-toggled, independent of plan links. */
export interface PreparedMark {
  slotId?: string;
  date?: string;     // ISO "YYYY-MM-DD" — required with slotId
  eventId?: string;
}

/** Small per-lesson room field, keyed to the lesson (slot + date). Travels with shifts. */
export interface LessonRoom {
  slotId: string;
  date: string;
  room: string;
}

/** Small per-lesson notes field, keyed to the lesson (slot + date). Travels with shifts. */
export interface LessonNote {
  slotId: string;
  date: string;      // ISO "YYYY-MM-DD"
  text: string;
}

/** A lesson pushed off the end of the year by a forward shift. Parked, never lost. */
export interface UnplacedLesson {
  id: string;
  classId: string;
  label?: string;        // display label (plan title / note snippet)
  plan?: string;         // plan note path
  prepared?: boolean;
  external?: { path: string; kind?: "file" | "folder" };
  note?: string;         // per-lesson notes text
  room?: string;         // per-lesson room
  notePath?: string;     // parked MD note file path (set when the note file is moved)
  pushedFromDate?: string;
}

/** Undo journal for the last "Apply plan to future lessons" action. */
export interface BulkApplyJournal {
  path: string;
  entries: { slotId: string; date: string; prevPath?: string }[];
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
  /** Opt-in: store each week's sidebar note as a vault markdown file instead of in data.json. */
  weekNoteFiles?: boolean;
  /** Folder for week-note files. Empty → "<plannerFolder>/Week notes". */
  weekNotesFolder?: string;
  /** Confirm before destructive deletes (remove event / lesson / subject / class …). Default on. Global. */
  confirmBeforeDelete?: boolean;
  /** Where the "open full note" button opens the week note. Global. Default "tab". */
  weekNoteOpenIn?: "tab" | "split" | "current";
  notesHeight?: number;
  gridLineColour?: string;
  gridLineWeight?: number;
  blockBorderColour?: string;
  blockBorderWeight?: number;
  plannerFolder: string;
  lessonNoteTemplate: string;
  /** Template for generated lesson-note titles. Tokens: {{date}} {{period}} {{class}} {{subject}} {{emoji}}. */
  lessonNoteTitleTemplate?: string;
  /** Template for generated event-note titles. Tokens: {{date}} {{period}} {{event}}. */
  eventNoteTitleTemplate?: string;
  theme?: PlannerTheme;
  themeMode?: PlannerThemeMode;
  /** Lesson plan links (issue #— linkable reusable plans). */
  lessonPlanLinks?: LessonPlanLink[];
  /** Folder for new lesson plans. Empty → "<plannerFolder>/Plans". */
  lessonPlansFolder?: string;
  /** Template for new lesson plans ({{class}}, {{subject}}, {{date}} placeholders). */
  lessonPlanTemplate?: string;
  /** Show a faint hollow dot on lessons without a linked plan. Default true. */
  showUnplannedDot?: boolean;
  /** Manual "lesson prepared" marks (Option B tick). */
  preparedMarks?: PreparedMark[];
  /** Show the manual lesson-prepared tick on chips. Default true. */
  showPreparedMark?: boolean;
  /** Mobile-only view mode: day | agenda | grid. Default "day" on mobile. */
  mobileViewMode?: "day" | "agenda" | "grid";
  /** External (outside-the-vault) file/folder attachments. Desktop only. */
  externalLinks?: ExternalResourceLink[];
  lessonNotes?: LessonNote[];
  lessonRooms?: LessonRoom[];
  unplacedLessons?: UnplacedLesson[];
  /** Lesson overview main line source: notes then plan title (default) | notes only | plan title. */
  lessonOverviewMainLine?: "notes-plan" | "notes" | "plan";
  /** Undo journal for the last bulk plan apply. */
  lastBulkApply?: BulkApplyJournal;
  /** Create dated notes inside "WC - <Monday>" weekly folders. Default true. */
  weeklyNoteFolders?: boolean;
  /** Directed time tracker. Undefined on legacy installs — initialised by migration guard in main.ts. */
  directedTime?: DirectedTimeSettings;
  /**
   * Which days of the week are school days.
   * Default Mon–Fri. Extend to include "saturday" or "sunday" for boarding/Saturday schools.
   */
  schoolDays?: SchoolDay[];
}

// ── Multi-planner data model ───────────────────────────────────────────────────

/**
 * All settings that belong to a single planner instance.
 * The active planner's fields are surfaced on plugin.settings (TeacherPlannerSettings)
 * so that all existing views and modals require no changes.
 */
export interface PlannerRecord {
  /** Unique stable identifier, e.g. "planner-1717000000000" */
  id: string;
  /** Display name, also used as the vault subfolder name, e.g. "2025-26" */
  name: string;
  /** Vault path for lesson notes. Migrated planners keep their original path; new planners get rootPlannerFolder/name. */
  plannerFolder: string;
  academicYear: AcademicYear;
  periodTypes: PeriodTypeConfig[];
  subjects: Subject[];
  classes: ClassGroup[];
  /** Legacy flat slot list — migrated to timetableTemplates on load. */
  timetable: TimetableSlot[];
  timetableTemplates: TimetableTemplate[];
  weekOverrides: WeekOverride[];
  activities: Activity[];
  dateEvents: DateEvent[];
  slotExclusions: SlotExclusion[];
  weekNotes: Record<string, string>;
  /** Opt-in: store each week's sidebar note as a vault markdown file instead of in data.json. */
  weekNoteFiles?: boolean;
  /** Folder for week-note files. Empty → "<plannerFolder>/Week notes". */
  weekNotesFolder?: string;
  notesHeight: number;
  lessonNoteTemplate: string;
  /** Template for generated lesson-note titles. Tokens: {{date}} {{period}} {{class}} {{subject}} {{emoji}}. */
  lessonNoteTitleTemplate?: string;
  /** Template for generated event-note titles. Tokens: {{date}} {{period}} {{event}}. */
  eventNoteTitleTemplate?: string;
  lessonPlanLinks?: LessonPlanLink[];
  lessonPlansFolder?: string;
  lessonPlanTemplate?: string;
  showUnplannedDot?: boolean;
  preparedMarks?: PreparedMark[];
  showPreparedMark?: boolean;
  /** Mobile-only view mode: day | agenda | grid. Default "day" on mobile. */
  mobileViewMode?: "day" | "agenda" | "grid";
  externalLinks?: ExternalResourceLink[];
  lessonNotes?: LessonNote[];
  lessonRooms?: LessonRoom[];
  unplacedLessons?: UnplacedLesson[];
  /** Lesson overview main line source: notes then plan title (default) | notes only | plan title. */
  lessonOverviewMainLine?: "notes-plan" | "notes" | "plan";
  lastBulkApply?: BulkApplyJournal;
  weeklyNoteFolders?: boolean;
  directedTime: DirectedTimeSettings;
  schoolDays: SchoolDay[];
}


/**
 * Top-level structure persisted to data.json in the multi-planner format.
 * Visual/vault preferences that apply across all planners live here.
 */
export interface GlobalPluginData {
  /** Sentinel that distinguishes the new format from the legacy flat object. */
  _version: 2;
  /**
   * Schema/migration version. Incremented by main.ts whenever a new ordered
   * migration is added. Use this in preference to the older _version sentinel
   * for any future schema evolution — _version is reserved for the
   * legacy-vs-multi-planner format split only.
   */
  dataVersion?: number;
  activePlannerId: string;
  /** Root vault folder. Subfolders per planner are created inside it. Default: "Teacher Planner". */
  rootPlannerFolder: string;
  /** These visual settings are global — shared across all planners. */
  gridLineColour: string;
  gridLineWeight: number;
  blockBorderColour: string;
  blockBorderWeight: number;
  /** Optional global theme overrides — applied via the data-tp-theme attribute. */
  theme?: PlannerTheme;
  themeMode?: PlannerThemeMode;
  /** Confirm before destructive deletes. Global (cross-planner). Default on. */
  confirmBeforeDelete?: boolean;
  /** Where the "open full note" button opens the week note. Global. Default "tab". */
  weekNoteOpenIn?: "tab" | "split" | "current";
  /** All planner records. Always at least one once setup is complete; empty array triggers the wizard. */
  planners: PlannerRecord[];
}
