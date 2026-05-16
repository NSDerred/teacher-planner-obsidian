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
    (leaves[0].view as CalendarSidebarView).setWeek(monday);
  }

  navigateWeekView(monday: Date) {
    const leaves = this.app.workspace.getLeavesOfType(WEEK_VIEW_TYPE);
    if (leaves.length === 0) return;
    (leaves[0].view as WeekView).navigateToWeek(monday);
  }

  private sendWeekViewCommand(cmd: "prev" | "next" | "current") {
    const leaves = this.app.workspace.getLeavesOfType(WEEK_VIEW_TYPE);
    if (leaves.length === 0) { this.activateView(); return; }
    const view = leaves[0].view as WeekView;
    if (cmd === "current") view.goToCurrentWeek();
    if (cmd === "prev")    view.goToPrevWeek();
    if (cmd === "next")    view.goToNextWeek();
  }

  private refreshViews() {
    this.app.workspace.getLeavesOfType(WEEK_VIEW_TYPE).forEach(leaf => (leaf.view as WeekView).onSettingsChange());
    this.app.workspace.getLeavesOfType(CALENDAR_SIDEBAR_VIEW_TYPE).forEach(leaf => (leaf.view as CalendarSidebarView).onSettingsChange());
  }

  // ── Planner management ──────────────────────────────────────────────────────────────────────────

  getActivePlanner(): PlannerRecord | undefined {
    return this.plannerData.planners.find(p => p.id === this.plannerData.activePlannerId);
  }

  /** Populate plugin.settings from the active planner + global visual settings. */
  private populateSettings() {
    const planner = this.getActivePlanner();
    if (!planner) return;
    this.settings = {
      academicYear:       planner.academicYear,
      periodTypes:        planner.periodTypes,
      subjects:           planner.subjects,
      classes:            planner.classes,
      timetable:          planner.timetable,
      timetableTemplates: planner.timetableTemplates,
      weekOverrides:      planner.weekOverrides,
      activities:         planner.activities,
      dateEvents:         planner.dateEvents,
      slotExclusions:     planner.slotExclusions,
      weekNotes:          planner.weekNotes,
      notesHeight:        planner.notesHeight,
      lessonNoteTemplate: planner.lessonNoteTemplate,
      directedTime:       planner.directedTime,
      schoolDays:         planner.schoolDays,
      plannerFolder:      planner.plannerFolder,
      gridLineColour:     this.plannerData.gridLineColour,
      gridLineWeight:     this.plannerData.gridLineWeight,
      blockBorderColour:  this.plannerData.blockBorderColour,
      blockBorderWeight:  this.plannerData.blockBorderWeight,
      theme:              this.plannerData.theme,
      themeMode:          this.plannerData.themeMode,
    };
  }

  /** Write plugin.settings back to the active planner record and global visual settings. */
  private syncSettingsToPlanner() {
    const planner = this.getActivePlanner();
    if (planner) {
      planner.academicYear       = this.settings.academicYear;
      planner.periodTypes        = this.settings.periodTypes;
      planner.subjects           = this.settings.subjects;
      planner.classes            = this.settings.classes;
      planner.timetable          = this.settings.timetable;
      planner.timetableTemplates = this.settings.timetableTemplates;
      planner.weekOverrides      = this.settings.weekOverrides;
      planner.activities         = this.settings.activities;
      planner.dateEvents         = this.settings.dateEvents ?? [];
      planner.slotExclusions     = this.settings.slotExclusions ?? [];
      planner.weekNotes          = this.settings.weekNotes;
      planner.notesHeight        = this.settings.notesHeight ?? 120;
      planner.lessonNoteTemplate = this.settings.lessonNoteTemplate;
      if (this.settings.directedTime) planner.directedTime = this.settings.directedTime;
      if (this.settings.schoolDays)   planner.schoolDays   = this.settings.schoolDays;
      planner.plannerFolder      = this.settings.plannerFolder;
    }
    this.plannerData.gridLineColour   = this.settings.gridLineColour  ?? DEFAULT_GLOBAL_DATA.gridLineColour;
    this.plannerData.gridLineWeight   = this.settings.gridLineWeight  ?? DEFAULT_GLOBAL_DATA.gridLineWeight;
    this.plannerData.blockBorderColour = this.settings.blockBorderColour ?? DEFAULT_GLOBAL_DATA.blockBorderColour;
    this.plannerData.blockBorderWeight = this.settings.blockBorderWeight ?? DEFAULT_GLOBAL_DATA.blockBorderWeight;
    if (this.settings.theme     !== undefined) this.plannerData.theme     = this.settings.theme;
    if (this.settings.themeMode !== undefined) this.plannerData.themeMode = this.settings.themeMode;
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
    try { this.runPlannerMigrations(); }
    catch (err) { console.error("Teacher Planner: runPlannerMigrations() failed — some migrations may not have applied.", err); }
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
  }

  async saveSettings() {
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
