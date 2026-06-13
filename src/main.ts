import { Plugin } from "obsidian";
import type { TeacherPlannerSettings, TimetableSlot, GlobalPluginData, PlannerRecord, WeekOverride } from "./types";
import { DEFAULT_SETTINGS, DEFAULT_PLANNER, DEFAULT_GLOBAL_DATA } from "./settings";
import { WeekView, WEEK_VIEW_TYPE } from "./views/WeekView";
import { CalendarSidebarView, CALENDAR_SIDEBAR_VIEW_TYPE } from "./views/CalendarSidebarView";
import { TeacherPlannerSettingTab } from "./settings/SettingsTab";
import { isValidIsoDate, normalizeLegacyWeekKey } from "./utils/weekUtils";
import { ensureDaySchedules, syncPeriodsUnion } from "./utils/scheduleUtils";
import { renamePlanPaths } from "./utils/planLinkUtils";

type SharedPlannerKey = keyof PlannerRecord & keyof TeacherPlannerSettings;
type SharedGlobalKey  = keyof GlobalPluginData & keyof TeacherPlannerSettings;

/** Old flat-format fields that may linger in stored data from pre-0.1 versions. */
interface LegacyArtifacts {
  gridBorderColour?: string;
  gridBorderWeight?: number;
}

function copyPlannerToSettings<K extends SharedPlannerKey>(dst: TeacherPlannerSettings, src: PlannerRecord, k: K): void {
  dst[k] = src[k] as TeacherPlannerSettings[K];
}
function copySettingsToPlanner<K extends SharedPlannerKey>(dst: PlannerRecord, src: TeacherPlannerSettings, k: K): void {
  const value = src[k];
  // Don't clobber existing planner values with undefined — keeps
  // partially-loaded settings from wiping persisted data.
  if (value !== undefined) dst[k] = value as PlannerRecord[K];
}
function copyGlobalToSettings<K extends SharedGlobalKey>(dst: TeacherPlannerSettings, src: GlobalPluginData, k: K): void {
  dst[k] = src[k] as TeacherPlannerSettings[K];
}
function copySettingsToGlobal<K extends SharedGlobalKey>(dst: GlobalPluginData, src: TeacherPlannerSettings, k: K): void {
  const value = src[k];
  if (value !== undefined) dst[k] = value as GlobalPluginData[K];
}

export default class TeacherPlannerPlugin extends Plugin {
  settings: TeacherPlannerSettings;
  plannerData: GlobalPluginData;
  /** True when there are no planners on load — the wizard is triggered from onload. */
  needsWizard = false;

  async onload() {
    try {
      await this.loadSettings();
    } catch (err) {
      console.error("Teacher Planner: loadSettings() failed — loading with defaults.", err);
      // Fall back so the rest of onload can still register views/commands
      if (!this.plannerData) this.plannerData = { ...DEFAULT_GLOBAL_DATA };
      if (!this.settings)    this.settings    = { ...DEFAULT_SETTINGS };
    }

    this.registerView(WEEK_VIEW_TYPE, (leaf) => new WeekView(leaf, this));
    this.registerView(CALENDAR_SIDEBAR_VIEW_TYPE, (leaf) => new CalendarSidebarView(leaf, this));

    this.addRibbonIcon("calendar-days", "Open Teacher Planner", () => { void this.activateView(); });

    this.addCommand({ id: "open",                    name: "Open planner",             callback: () => { void this.activateView(); } });
    this.addCommand({ id: "go-to-current-week",      name: "Go to current week",      callback: () => this.sendWeekViewCommand("current") });
    this.addCommand({ id: "go-to-previous-week",     name: "Go to previous week",     callback: () => this.sendWeekViewCommand("prev") });
    this.addCommand({ id: "go-to-next-week",         name: "Go to next week",         callback: () => this.sendWeekViewCommand("next") });

    this.addSettingTab(new TeacherPlannerSettingTab(this.app, this));

    // Keep lesson-plan links pointing at their notes across renames/moves —
    // links are stored per planner, so sweep all planners plus live settings.
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      try {
        let changed = renamePlanPaths(this.settings, oldPath, file.path);
        for (const p of this.plannerData?.planners ?? []) {
          for (const l of p.lessonPlanLinks ?? []) {
            if (l.path === oldPath) { l.path = file.path; changed = true; }
          }
        }
        if (changed) this.requestSave();
      } catch (err) {
        console.error("Teacher Planner: plan-link rename sweep failed.", err);
      }
    }));

    // Lazy import to avoid a circular dep at module-load time
    if (this.needsWizard) {
      const { SetupWizardModal } = await import("./modals/SetupWizardModal");
      new SetupWizardModal(this.app, this).open();
    }

    // After the workspace layout is fully ready, refresh any views that were
    // restored from saved state before plugin data finished loading.
    // onLayoutReady fires immediately if the workspace is already ready.
    this.app.workspace.onLayoutReady(() => {
      try { this.refreshViews(); }
      catch (err) { console.error("Teacher Planner: refreshViews() failed.", err); }
    });

  }

  onunload() {
    // Make sure any pending debounced save lands before the plugin is gone.
    // Fire-and-forget — Obsidian doesn't await onunload, but the write itself
    // will still complete.
    this.flushPendingSave().catch(err => {
      console.error("Teacher Planner: flushPendingSave on unload failed.", err);
    });
  }

  // ── View helpers ──────────────────────────────────────────────────────────────────────────

  async activateView() {
    const { workspace } = this.app;
    const leaves = workspace.getLeavesOfType(WEEK_VIEW_TYPE);
    if (leaves.length > 0) {
      await workspace.revealLeaf(leaves[0]);
    } else {
      const leaf = workspace.getLeaf(false);
      await leaf.setViewState({ type: WEEK_VIEW_TYPE, active: true });
      await workspace.revealLeaf(leaf);
    }
    await this.activateSidebar();
  }

  async activateSidebar() {
    const { workspace } = this.app;
    const sidebarLeaves = workspace.getLeavesOfType(CALENDAR_SIDEBAR_VIEW_TYPE);
    if (sidebarLeaves.length === 0) {
      const sidebarLeaf = workspace.getRightLeaf(false);
      if (sidebarLeaf) {
        await sidebarLeaf.setViewState({ type: CALENDAR_SIDEBAR_VIEW_TYPE, active: false });
      }
    }
  }

  notifySidebar(monday: Date) {
    const leaves = this.app.workspace.getLeavesOfType(CALENDAR_SIDEBAR_VIEW_TYPE);
    if (leaves.length === 0) return;
    // During Obsidian startup the leaf may exist with a deferred placeholder
    // view that hasn't been upgraded to our CalendarSidebarView yet. Calling
    // setWeek on the placeholder throws and aborts the caller (typically a
    // Svelte mount), which is what produced the blank-on-reopen bug.
    const view = leaves[0].view;
    if (view instanceof CalendarSidebarView) view.setWeek(monday);
  }

  navigateWeekView(monday: Date) {
    const leaves = this.app.workspace.getLeavesOfType(WEEK_VIEW_TYPE);
    if (leaves.length === 0) return;
    const view = leaves[0].view;
    if (view instanceof WeekView) view.navigateToWeek(monday);
  }

  private sendWeekViewCommand(cmd: "prev" | "next" | "current") {
    const leaves = this.app.workspace.getLeavesOfType(WEEK_VIEW_TYPE);
    if (leaves.length === 0) { void this.activateView(); return; }
    const view = leaves[0].view;
    if (!(view instanceof WeekView)) return;
    if (cmd === "current") view.goToCurrentWeek();
    if (cmd === "prev")    view.goToPrevWeek();
    if (cmd === "next")    view.goToNextWeek();
  }

  private refreshViews() {
    this.app.workspace.getLeavesOfType(WEEK_VIEW_TYPE).forEach(leaf => {
      if (leaf.view instanceof WeekView) leaf.view.onSettingsChange();
    });
    this.app.workspace.getLeavesOfType(CALENDAR_SIDEBAR_VIEW_TYPE).forEach(leaf => {
      if (leaf.view instanceof CalendarSidebarView) leaf.view.onSettingsChange();
    });
  }

  // ── Planner management ──────────────────────────────────────────────────────────────────────────

  getActivePlanner(): PlannerRecord | undefined {
    return this.plannerData.planners.find(p => p.id === this.plannerData.activePlannerId);
  }

  /**
   * Fields stored on the active PlannerRecord. Listed once so populate/sync
   * stay in lockstep — adding a new planner-scoped setting only needs an
   * entry here.
   */
  private static readonly PLANNER_FIELDS: ReadonlyArray<keyof PlannerRecord & keyof TeacherPlannerSettings> = [
    "academicYear", "periodTypes", "subjects", "classes", "timetable",
    "timetableTemplates", "weekOverrides", "activities", "dateEvents",
    "slotExclusions", "weekNotes", "notesHeight", "lessonNoteTemplate",
    "lessonNoteTitleTemplate", "eventNoteTitleTemplate",
    "directedTime", "schoolDays", "plannerFolder",
    "lessonPlanLinks", "lessonPlansFolder", "lessonPlanTemplate", "showUnplannedDot",
    "preparedMarks", "showPreparedMark", "mobileViewMode",
    "externalLinks", "lastBulkApply", "weeklyNoteFolders",
    "weekNoteFiles", "weekNotesFolder",
  ];

  /**
   * Global (cross-planner) fields stored on plannerData. Same pattern as
   * PLANNER_FIELDS — single source of truth for populate/sync.
   */
  private static readonly GLOBAL_FIELDS: ReadonlyArray<keyof GlobalPluginData & keyof TeacherPlannerSettings> = [
    "gridLineColour", "gridLineWeight", "blockBorderColour", "blockBorderWeight",
    "theme", "themeMode",
  ];

  /** Populate plugin.settings from the active planner + global visual settings. */
  private populateSettings() {
    const planner = this.getActivePlanner();
    if (!planner) return;
    const settings: TeacherPlannerSettings = { ...DEFAULT_SETTINGS };
    for (const k of TeacherPlannerPlugin.PLANNER_FIELDS) {
      copyPlannerToSettings(settings, planner, k);
    }
    for (const k of TeacherPlannerPlugin.GLOBAL_FIELDS) {
      copyGlobalToSettings(settings, this.plannerData, k);
    }
    this.settings = settings;
  }

  /** Write plugin.settings back to the active planner record and global visual settings. */
  private syncSettingsToPlanner() {
    const planner = this.getActivePlanner();
    if (planner) {
      for (const k of TeacherPlannerPlugin.PLANNER_FIELDS) {
        copySettingsToPlanner(planner, this.settings, k);
      }
      // Defensive defaults for fields that have explicit fallbacks
      planner.dateEvents      = planner.dateEvents      ?? [];
      planner.slotExclusions  = planner.slotExclusions  ?? [];
      planner.lessonPlanLinks = planner.lessonPlanLinks ?? [];
      planner.externalLinks   = planner.externalLinks   ?? [];
      planner.notesHeight    = planner.notesHeight    ?? 120;
    }
    for (const k of TeacherPlannerPlugin.GLOBAL_FIELDS) {
      copySettingsToGlobal(this.plannerData, this.settings, k);
    }
    // Defensive defaults for global visual settings
    this.plannerData.gridLineColour    = this.plannerData.gridLineColour    ?? DEFAULT_GLOBAL_DATA.gridLineColour;
    this.plannerData.gridLineWeight    = this.plannerData.gridLineWeight    ?? DEFAULT_GLOBAL_DATA.gridLineWeight;
    this.plannerData.blockBorderColour = this.plannerData.blockBorderColour ?? DEFAULT_GLOBAL_DATA.blockBorderColour;
    this.plannerData.blockBorderWeight = this.plannerData.blockBorderWeight ?? DEFAULT_GLOBAL_DATA.blockBorderWeight;
  }

  async createPlanner(record: PlannerRecord) {
    this.plannerData.planners.push(record);
    this.plannerData.activePlannerId = record.id;
    this.populateSettings();
    // Initialise day schedules immediately (wizard-created planners would
    // otherwise rely on the lazy fallback until settings opens).
    try { ensureDaySchedules(this.settings.academicYear); } catch { /* non-fatal */ }
    await this.ensurePlannerFolder(record.plannerFolder);
    await this.saveData(this.plannerData);
    this.refreshViews();
  }

  async switchPlanner(id: string) {
    this.syncSettingsToPlanner();
    this.plannerData.activePlannerId = id;
    this.populateSettings();
    // Re-run per-planner migrations on the now-active planner. Versioned
    // migrations only apply once globally; this call keeps the idempotent
    // baseline fix-ups (defaults, normalisation) in place for older planners.
    try { this.runPlannerMigrations(); }
    catch (err) { console.error("Teacher Planner: runPlannerMigrations() failed on planner switch.", err); }
    // Ensure the target planner's subfolder exists in the vault
    await this.ensurePlannerFolder(this.settings.plannerFolder);
    await this.saveData(this.plannerData);
    this.refreshViews();
  }

  async deletePlanner(id: string) {
    // Flush any pending debounced save first — otherwise a queued
    // saveSettings() could fire after the delete and resurrect stale state.
    await this.flushPendingSave();
    this.plannerData.planners = this.plannerData.planners.filter(p => p.id !== id);
    // Repair the active pointer if the deleted planner was active.
    if (this.plannerData.activePlannerId === id) {
      this.plannerData.activePlannerId = this.plannerData.planners[0]?.id ?? "";
      if (this.plannerData.planners.length > 0) this.populateSettings();
    }
    await this.saveData(this.plannerData);
    this.refreshViews();
  }

  async ensurePlannerFolder(folderPath: string) {
    if (!this.app.vault.getAbstractFileByPath(folderPath)) {
      try { await this.app.vault.createFolder(folderPath); } catch { /* non-fatal */ }
    }
  }

  // ── Settings persistence ──────────────────────────────────────────────────────────────────────────

  async loadSettings() {
    const raw = (await this.loadData()) as
      | (Partial<GlobalPluginData> & Partial<TeacherPlannerSettings> & LegacyArtifacts & { _version?: number })
      | null;

    if (raw?._version === 2) {
      // New multi-planner format — merge over defaults to fill any new fields
      this.plannerData = Object.assign({}, DEFAULT_GLOBAL_DATA, raw as Partial<GlobalPluginData>);
    } else if (raw && Object.keys(raw).length > 0) {
      // Legacy flat format — migrate automatically
      this.plannerData = this.migrateFromLegacy(raw);
    } else {
      // Fresh install
      this.plannerData = { ...DEFAULT_GLOBAL_DATA };
    }

    if (this.plannerData.planners.length === 0) {
      // No planners — wizard will run after onload
      this.needsWizard = true;
      this.settings = { ...DEFAULT_SETTINGS };
      return;
    }

    // Ensure activePlannerId points to a real planner
    if (!this.plannerData.planners.find(p => p.id === this.plannerData.activePlannerId)) {
      this.plannerData.activePlannerId = this.plannerData.planners[0].id;
    }

    this.populateSettings();
    this.runMigrations();
  }

  // ── Migrations ────────────────────────────────────────────────────────────
  //
  // Schema evolution is tracked via plannerData.dataVersion. Every migration
  // is registered in MIGRATIONS with the target version it produces; the
  // runner applies any whose target exceeds the saved version, in order.
  //
  // Adding a new migration:
  //   1. Bump CURRENT_DATA_VERSION below.
  //   2. Append { to: <new>, run: ... } to MIGRATIONS.
  //   3. Keep each migration idempotent — they can be re-run on partially
  //      migrated data without breaking it.
  //
  // The cumulative legacy fix-ups (formerly runPlannerMigrations) are kept
  // as the v1 baseline. They were already designed to be safe to re-run
  // on each planner load, so they remain in the per-planner switch path too.

  private static readonly CURRENT_DATA_VERSION = 1;

  private static readonly MIGRATIONS: ReadonlyArray<{
    to: number;
    description: string;
    run: (plugin: TeacherPlannerPlugin) => void;
  }> = [
    {
      to: 1,
      description: "Cumulative baseline — period type defaults, A/B week defaults, activity defaults, etc.",
      run: (plugin) => plugin.runPlannerMigrations(),
    },
    // Future migrations: add new entries here with strictly increasing `to`.
  ];

  /**
   * Apply any pending versioned migrations to plannerData, then stamp the
   * current version. Called from loadSettings() and switchPlanner().
   */
  private runMigrations() {
    const saved = this.plannerData.dataVersion ?? 0;
    for (const migration of TeacherPlannerPlugin.MIGRATIONS) {
      if (saved >= migration.to) continue;
      try {
        migration.run(this);
      } catch (err) {
        console.error(`Teacher Planner: migration to v${migration.to} (${migration.description}) failed.`, err);
      }
    }
    this.plannerData.dataVersion = TeacherPlannerPlugin.CURRENT_DATA_VERSION;
  }

  /**
   * Convert the old flat settings object to the new GlobalPluginData shape.
   * The migrated planner keeps its original plannerFolder so existing note links are not broken.
   */
  private migrateFromLegacy(raw: Partial<TeacherPlannerSettings> & LegacyArtifacts): GlobalPluginData {
    const planner: PlannerRecord = {
      id:                 "planner-" + Date.now(),
      name:               raw.academicYear?.name ?? "My Planner",
      plannerFolder:      raw.plannerFolder ?? "Teacher Planner",
      academicYear:       raw.academicYear  ?? DEFAULT_PLANNER.academicYear,
      periodTypes:        raw.periodTypes   ?? DEFAULT_PLANNER.periodTypes,
      subjects:           raw.subjects      ?? [],
      classes:            raw.classes       ?? [],
      timetable:          raw.timetable     ?? [],
      timetableTemplates: raw.timetableTemplates ?? [],
      weekOverrides:      raw.weekOverrides ?? [],
      activities:         raw.activities    ?? DEFAULT_PLANNER.activities,
      dateEvents:         raw.dateEvents    ?? [],
      slotExclusions:     raw.slotExclusions ?? [],
      weekNotes:          raw.weekNotes     ?? {},
      notesHeight:        raw.notesHeight   ?? 120,
      lessonNoteTemplate: DEFAULT_PLANNER.lessonNoteTemplate,
      directedTime:       raw.directedTime  ?? DEFAULT_PLANNER.directedTime,
      schoolDays:         raw.schoolDays    ?? ["monday","tuesday","wednesday","thursday","friday"],
    };
    return {
      _version:           2,
      activePlannerId:    planner.id,
      rootPlannerFolder:  raw.plannerFolder ?? "Teacher Planner",
      gridLineColour:     raw.gridLineColour  ?? DEFAULT_GLOBAL_DATA.gridLineColour,
      gridLineWeight:     raw.gridLineWeight  ?? DEFAULT_GLOBAL_DATA.gridLineWeight,
      blockBorderColour:  raw.blockBorderColour ?? DEFAULT_GLOBAL_DATA.blockBorderColour,
      blockBorderWeight:  raw.blockBorderWeight ?? DEFAULT_GLOBAL_DATA.blockBorderWeight,
      theme:              raw.theme,
      themeMode:          raw.themeMode,
      planners:           [planner],
    };
  }

  /**
   * All per-planner migration guards — identical logic to the old loadSettings(),
   * operating on plugin.settings (the active planner view).
   */
  private runPlannerMigrations() {
    // Always reset to current default template — no user-editable UI for this field
    this.settings.lessonNoteTemplate = DEFAULT_SETTINGS.lessonNoteTemplate;
    if (!this.settings.lessonNoteTitleTemplate) this.settings.lessonNoteTitleTemplate = DEFAULT_SETTINGS.lessonNoteTitleTemplate;
    if (!this.settings.eventNoteTitleTemplate) this.settings.eventNoteTitleTemplate = DEFAULT_SETTINGS.eventNoteTitleTemplate;
    if (!this.settings.preparedMarks) this.settings.preparedMarks = [];
    this.settings.academicYear = Object.assign({}, DEFAULT_SETTINGS.academicYear, this.settings.academicYear);
    // Day schedules (Option B): wrap the legacy flat period list into a
    // "Standard day" schedule on first load. Idempotent.
    try { ensureDaySchedules(this.settings.academicYear); }
    catch (err) { console.error("Teacher Planner: ensureDaySchedules failed.", err); }
    if (!this.settings.weekNotes) this.settings.weekNotes = {};
    // Re-key any week notes saved under the old UTC-shifted (Sunday) scheme to local Monday keys.
    {
      const fixed: Record<string, string> = {};
      for (const [k, v] of Object.entries(this.settings.weekNotes)) {
        const nk = normalizeLegacyWeekKey(k);
        if (!fixed[nk] || (!fixed[nk].trim() && String(v).trim())) fixed[nk] = v;
      }
      this.settings.weekNotes = fixed;
    }
    if (!this.settings.activities) this.settings.activities = [
      { id: "activity-ppt",     label: "PPT",     colour: "#b4befe" },
      { id: "activity-cover",   label: "Cover",   colour: "#fab387" },
      { id: "activity-meeting", label: "Meeting", colour: "#89dceb" },
      { id: "activity-duty",    label: "Duty",    colour: "#cba6f7" },
    ];
    if (!this.settings.activities.find(a => a.id === "activity-duty")) {
      this.settings.activities.push({ id: "activity-duty", label: "Duty", colour: "#cba6f7" });
    }
    if (!this.settings.periodTypes) this.settings.periodTypes = [
      { id: "lesson",         label: "Lesson",         colour: "theme:muted" },
      { id: "break",          label: "Break",          colour: "theme:accent" },
      { id: "registration",   label: "Registration",   colour: "theme:faint" },
      { id: "administration", label: "Administration", colour: "theme:surface" },
    ];
    this.settings.periodTypes = this.settings.periodTypes.filter(pt => pt.id !== "free");
    if (!this.settings.periodTypes.find(pt => pt.id === "administration")) {
      this.settings.periodTypes.push({ id: "administration", label: "Administration", colour: "theme:surface" });
    }
    const legacy = this.settings as TeacherPlannerSettings & LegacyArtifacts;
    if (!this.settings.gridLineColour)  this.settings.gridLineColour  = legacy.gridBorderColour ?? "theme:border";
    if (this.settings.gridLineWeight  === undefined) this.settings.gridLineWeight  = legacy.gridBorderWeight ?? 1;
    if (!this.settings.blockBorderColour) this.settings.blockBorderColour = "theme:border";
    if (this.settings.blockBorderWeight  === undefined) this.settings.blockBorderWeight = 1;
    if (!this.settings.dateEvents) this.settings.dateEvents = [];
    if (!this.settings.slotExclusions) this.settings.slotExclusions = [];
    if (!this.settings.directedTime) {
      this.settings.directedTime = {
        enabled: false, contractedHours: 1265, timetablePercentage: 100, defaultLessonDurationMinutes: 60,
      };
    }
    if (!this.settings.activities.find(a => a.id === "activity-tutor")) {
      this.settings.activities.push({ id: "activity-tutor", label: "Tutor", colour: "#f0956a", activityType: "directed", durationMinutes: 30 });
    }
    if (!this.settings.academicYear.abWeekStartsOn) {
      this.settings.academicYear.abWeekStartsOn = "A";
    }
    for (const o of this.settings.weekOverrides ?? []) {
      const legacyOverride = o as WeekOverride & { weekStart?: string };
      if (legacyOverride.weekStart && !o.startDate) {
        o.startDate = legacyOverride.weekStart;
        delete legacyOverride.weekStart;
      }
    }
    if (!this.settings.schoolDays) {
      this.settings.schoolDays = ["monday","tuesday","wednesday","thursday","friday"];
    }
    if (!this.settings.timetableTemplates || this.settings.timetableTemplates.length === 0) {
      const ay = this.settings.academicYear;
      this.settings.timetableTemplates = [{
        id: "template-default",
        name: "Default Timetable",
        startDate: ay.startDate,
        endDate:   ay.endDate,
        slots:     this.settings.timetable ?? [],
      }];
    }
    if (this.settings.academicYear.abWeekEnabled) {
      for (const tmpl of this.settings.timetableTemplates ?? []) {
        for (const slot of tmpl.slots) {
          if (!slot.weekType) slot.weekType = "both";
        }
      }
    }
    // Backfill stale period.type references — if a period points at a type ID
    // that no longer exists (e.g. legacy "free" before it was removed), the
    // dropdown silently renders empty. Default such periods to "lesson" if it
    // exists, otherwise the first available type.
    const validTypeIds = new Set((this.settings.periodTypes ?? []).map(pt => pt.id));
    const fallbackTypeId = validTypeIds.has("lesson")
      ? "lesson"
      : (this.settings.periodTypes?.[0]?.id ?? "lesson");
    for (const period of this.settings.academicYear.periods ?? []) {
      if (!validTypeIds.has(period.type)) {
        period.type = fallbackTypeId;
      }
    }
  }

  /**
   * Debounced save — coalesces rapid edits (per-keystroke `onChange`
   * handlers in the settings tab) into a single write. Safe to call from
   * hot paths. The trailing flushPendingSave() guarantees nothing is lost
   * when the settings tab closes or the plugin unloads.
   */
  private saveTimer: number | null = null;
  requestSave(): void {
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      this.saveSettings().catch(err => {
        console.error("Teacher Planner: debounced saveSettings failed.", err);
      });
    }, 400);
  }

  /** Flush any pending debounced save immediately. */
  async flushPendingSave(): Promise<void> {
    if (this.saveTimer) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      await this.saveSettings();
    }
  }

  async saveSettings() {
    // Keep the last timetable template's end date in sync with the academic year end date.
    // The final template always runs to the end of the year; if the user changes ay.endDate
    // in settings the template would otherwise be left pointing at the old date.
    // We do NOT auto-sync the first template's startDate: the onChange handler fires
    // on every keystroke, so partial date strings would corrupt the template start date.
    const templates = this.settings.timetableTemplates;
    if (templates && templates.length > 0 && isValidIsoDate(this.settings.academicYear.endDate)) {
      const lastTmpl = [...templates].sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
      lastTmpl.endDate = this.settings.academicYear.endDate;
    }
    // Keep the legacy union period list in lockstep with day schedules
    try { syncPeriodsUnion(this.settings.academicYear); } catch { /* non-fatal */ }
    this.syncSettingsToPlanner();
    await this.saveData(this.plannerData);
    this.refreshViews();
  }

  /** Find a timetable slot by ID across all templates in the active planner. */
  findSlotById(slotId: string): TimetableSlot | undefined {
    for (const tmpl of this.settings.timetableTemplates ?? []) {
      const slot = tmpl.slots.find(s => s.id === slotId);
      if (slot) return slot;
    }
    return undefined;
  }
}
