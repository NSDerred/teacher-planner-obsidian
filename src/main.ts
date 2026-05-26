import { Plugin, WorkspaceLeaf } from "obsidian";
import type { TeacherPlannerSettings, TimetableSlot, GlobalPluginData, PlannerRecord } from "./types";
import { DEFAULT_SETTINGS, DEFAULT_PLANNER, DEFAULT_GLOBAL_DATA } from "./settings";
import { WeekView, WEEK_VIEW_TYPE } from "./views/WeekView";
import { CalendarSidebarView, CALENDAR_SIDEBAR_VIEW_TYPE } from "./views/CalendarSidebarView";
import { TeacherPlannerSettingTab } from "./settings/SettingsTab";

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

    this.addRibbonIcon("calendar-days", "Open Teacher Planner", () => { this.activateView(); });

    this.addCommand({ id: "open-teacher-planner",   name: "Open Teacher Planner",    callback: () => this.activateView() });
    this.addCommand({ id: "go-to-current-week",      name: "Go to current week",      callback: () => this.sendWeekViewCommand("current") });
    this.addCommand({ id: "go-to-previous-week",     name: "Go to previous week",     callback: () => this.sendWeekViewCommand("prev") });
    this.addCommand({ id: "go-to-next-week",         name: "Go to next week",         callback: () => this.sendWeekViewCommand("next") });

    this.addSettingTab(new TeacherPlannerSettingTab(this.app, this));

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

    console.log("Teacher Planner loaded.");
  }

  onunload() {
    // Make sure any pending debounced save lands before the plugin is gone.
    // Fire-and-forget — Obsidian doesn't await onunload, but the write itself
    // will still complete.
    this.flushPendingSave().catch(err => {
      console.error("Teacher Planner: flushPendingSave on unload failed.", err);
    });
    this.app.workspace.detachLeavesOfType(WEEK_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(CALENDAR_SIDEBAR_VIEW_TYPE);
    console.log("Teacher Planner unloaded.");
  }

  // ── View helpers ──────────────────────────────────────────────────────────────────────────

  async activateView() {
    const { workspace } = this.app;
    const leaves = workspace.getLeavesOfType(WEEK_VIEW_TYPE);
    if (leaves.length > 0) {
      workspace.revealLeaf(leaves[0]);
    } else {
      const leaf = workspace.getLeaf(false);
      await leaf.setViewState({ type: WEEK_VIEW_TYPE, active: true });
      workspace.revealLeaf(leaf);
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
    if (leaves.length === 0) { this.activateView(); return; }
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
    "directedTime", "schoolDays", "plannerFolder",
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
    const settings = { ...DEFAULT_SETTINGS } as TeacherPlannerSettings;
    for (const k of TeacherPlannerPlugin.PLANNER_FIELDS) {
      (settings as any)[k] = (planner as any)[k];
    }
    for (const k of TeacherPlannerPlugin.GLOBAL_FIELDS) {
      (settings as any)[k] = (this.plannerData as any)[k];
    }
    this.settings = settings;
  }

  /** Write plugin.settings back to the active planner record and global visual settings. */
  private syncSettingsToPlanner() {
    const planner = this.getActivePlanner();
    if (planner) {
      for (const k of TeacherPlannerPlugin.PLANNER_FIELDS) {
        const value = (this.settings as any)[k];
        // Don't clobber existing planner values with undefined — keeps
        // partially-loaded settings from wiping persisted data.
        if (value !== undefined) (planner as any)[k] = value;
      }
      // Defensive defaults for fields that have explicit fallbacks
      planner.dateEvents     = planner.dateEvents     ?? [];
      planner.slotExclusions = planner.slotExclusions ?? [];
      planner.notesHeight    = planner.notesHeight    ?? 120;
    }
    for (const k of TeacherPlannerPlugin.GLOBAL_FIELDS) {
      const value = (this.settings as any)[k];
      if (value !== undefined) (this.plannerData as any)[k] = value;
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
    this.plannerData.planners = this.plannerData.planners.filter(p => p.id !== id);
    await this.saveData(this.plannerData);
  }

  async ensurePlannerFolder(folderPath: string) {
    if (!this.app.vault.getAbstractFileByPath(folderPath)) {
      try { await this.app.vault.createFolder(folderPath); } catch {}
    }
  }

  // ── Settings persistence ──────────────────────────────────────────────────────────────────────────

  async loadSettings() {
    const raw = await this.loadData();

    if (raw?._version === 2) {
      // New multi-planner format — merge over defaults to fill any new fields
      this.plannerData = Object.assign({}, DEFAULT_GLOBAL_DATA, raw);
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
  private migrateFromLegacy(raw: any): GlobalPluginData {
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
    this.settings.academicYear = Object.assign({}, DEFAULT_SETTINGS.academicYear, this.settings.academicYear);
    if (!this.settings.weekNotes) this.settings.weekNotes = {};
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
      { id: "lesson",         label: "Lesson",         colour: "#b4befe" },
      { id: "break",          label: "Break",          colour: "#f9e2af" },
      { id: "registration",   label: "Registration",   colour: "#a6e3a1" },
      { id: "administration", label: "Administration", colour: "#89dceb" },
    ];
    this.settings.periodTypes = this.settings.periodTypes.filter(pt => pt.id !== "free");
    if (!this.settings.periodTypes.find(pt => pt.id === "administration")) {
      this.settings.periodTypes.push({ id: "administration", label: "Administration", colour: "#89dceb" });
    }
    if (!this.settings.gridLineColour)  this.settings.gridLineColour  = (this.settings as any).gridBorderColour ?? "#555555";
    if (this.settings.gridLineWeight  === undefined) this.settings.gridLineWeight  = (this.settings as any).gridBorderWeight ?? 1;
    if (!this.settings.blockBorderColour) this.settings.blockBorderColour = "#444444";
    if (this.settings.blockBorderWeight  === undefined) this.settings.blockBorderWeight = 1;
    if (!(this.settings as any).dateEvents) this.settings.dateEvents = [];
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
      if ((o as any).weekStart && !o.startDate) {
        o.startDate = (o as any).weekStart;
        delete (o as any).weekStart;
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
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  requestSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveSettings().catch(err => {
        console.error("Teacher Planner: debounced saveSettings failed.", err);
      });
    }, 400);
  }

  /** Flush any pending debounced save immediately. */
  async flushPendingSave(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
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
    const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (templates && templates.length > 0 && isValidDate(this.settings.academicYear.endDate)) {
      const lastTmpl = [...templates].sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
      lastTmpl.endDate = this.settings.academicYear.endDate;
    }
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
