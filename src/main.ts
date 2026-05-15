import { Plugin, WorkspaceLeaf } from "obsidian";
import type { TeacherPlannerSettings, TimetableSlot } from "./types";
import { DEFAULT_SETTINGS } from "./settings";
import { WeekView, WEEK_VIEW_TYPE } from "./views/WeekView";
import { CalendarSidebarView, CALENDAR_SIDEBAR_VIEW_TYPE } from "./views/CalendarSidebarView";
import { TeacherPlannerSettingTab } from "./settings/SettingsTab";

export default class TeacherPlannerPlugin extends Plugin {
  settings: TeacherPlannerSettings;

  async onload() {
    await this.loadSettings();

    this.registerView(WEEK_VIEW_TYPE, (leaf) => new WeekView(leaf, this));
    this.registerView(CALENDAR_SIDEBAR_VIEW_TYPE, (leaf) => new CalendarSidebarView(leaf, this));

    this.addRibbonIcon("calendar-days", "Open Teacher Planner", () => {
      this.activateView();
    });

    this.addCommand({ id: "open-teacher-planner", name: "Open Teacher Planner", callback: () => this.activateView() });
    this.addCommand({ id: "go-to-current-week", name: "Go to current week", callback: () => this.sendWeekViewCommand("current") });
    this.addCommand({ id: "go-to-previous-week", name: "Go to previous week", callback: () => this.sendWeekViewCommand("prev") });
    this.addCommand({ id: "go-to-next-week", name: "Go to next week", callback: () => this.sendWeekViewCommand("next") });

    this.addSettingTab(new TeacherPlannerSettingTab(this.app, this));
    console.log("Teacher Planner loaded.");
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(WEEK_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(CALENDAR_SIDEBAR_VIEW_TYPE);
    console.log("Teacher Planner unloaded.");
  }

  async activateView() {
    const { workspace } = this.app;

    // Open main week view
    const leaves = workspace.getLeavesOfType(WEEK_VIEW_TYPE);
    if (leaves.length > 0) {
      workspace.revealLeaf(leaves[0]);
    } else {
      const leaf = workspace.getLeaf(false);
      await leaf.setViewState({ type: WEEK_VIEW_TYPE, active: true });
      workspace.revealLeaf(leaf);
    }

    // Open sidebar calendar (right panel)
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

  /** Called by WeekView.svelte when the user navigates to a new week -- syncs the sidebar. */
  notifySidebar(monday: Date) {
    const leaves = this.app.workspace.getLeavesOfType(CALENDAR_SIDEBAR_VIEW_TYPE);
    if (leaves.length === 0) return;
    (leaves[0].view as CalendarSidebarView).setWeek(monday);
  }

  /** Called by CalendarSidebarComponent when the user clicks a day -- syncs the week view. */
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
    if (cmd === "prev") view.goToPrevWeek();
    if (cmd === "next") view.goToNextWeek();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
    if (!this.settings.gridLineColour) this.settings.gridLineColour = (this.settings as any).gridBorderColour ?? "#555555";
    if (this.settings.gridLineWeight === undefined) this.settings.gridLineWeight = (this.settings as any).gridBorderWeight ?? 1;
    if (!this.settings.blockBorderColour) this.settings.blockBorderColour = "#444444";
    if (this.settings.blockBorderWeight === undefined) this.settings.blockBorderWeight = 1;
    if (!(this.settings as any).dateEvents) this.settings.dateEvents = [];
    if (!this.settings.slotExclusions) this.settings.slotExclusions = [];
    // Directed time tracker — initialise for existing installs
    if (!this.settings.directedTime) {
      this.settings.directedTime = {
        enabled: false,
        contractedHours: 1265,
        timetablePercentage: 100,
        defaultLessonDurationMinutes: 60,
      };
    }
    // Inject Tutor activity if not already present (new default in directed time feature)
    if (!this.settings.activities.find(a => a.id === "activity-tutor")) {
      this.settings.activities.push({ id: "activity-tutor", label: "Tutor", colour: "#f0956a", activityType: "directed", durationMinutes: 30 });
    }
    // Ensure abWeekStartsOn is always defined (avoids undefined return from getAbWeekType on even weeks)
    if (!this.settings.academicYear.abWeekStartsOn) {
      this.settings.academicYear.abWeekStartsOn = "A";
    }
    // Migrate weekOverrides: rename legacy weekStart → startDate (week-based → day-based ranges)
    for (const o of this.settings.weekOverrides ?? []) {
      if ((o as any).weekStart && !o.startDate) {
        o.startDate = (o as any).weekStart;
        delete (o as any).weekStart;
      }
    }
    // Initialise schoolDays for existing installs (default Mon–Fri)
    if (!this.settings.schoolDays) {
      this.settings.schoolDays = ["monday", "tuesday", "wednesday", "thursday", "friday"];
    }
    // Migrate legacy flat timetable -> timetableTemplates
    if (!this.settings.timetableTemplates || this.settings.timetableTemplates.length === 0) {
      const ay = this.settings.academicYear;
      this.settings.timetableTemplates = [{
        id: "template-default",
        name: "Default Timetable",
        startDate: ay.startDate,
        endDate: ay.endDate,
        slots: this.settings.timetable ?? [],
      }];
    }
    // Migrate slots without weekType -> "both" so they continue showing on every week
    // when A/B rotation is enabled. Prevents the null-weekType bug where all slots
    // appeared on all weeks but the A/B badge and filter were both broken.
    if (this.settings.academicYear.abWeekEnabled) {
      for (const tmpl of this.settings.timetableTemplates ?? []) {
        for (const slot of tmpl.slots) {
          if (!slot.weekType) slot.weekType = "both";
        }
      }
    }
  }

  /** Find a timetable slot by ID across all templates. */
  findSlotById(slotId: string): TimetableSlot | undefined {
    for (const tmpl of this.settings.timetableTemplates ?? []) {
      const slot = tmpl.slots.find(s => s.id === slotId);
      if (slot) return slot;
    }
    return undefined;
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.app.workspace.getLeavesOfType(WEEK_VIEW_TYPE).forEach((leaf) => {
      (leaf.view as WeekView).onSettingsChange();
    });
    this.app.workspace.getLeavesOfType(CALENDAR_SIDEBAR_VIEW_TYPE).forEach((leaf) => {
      (leaf.view as CalendarSidebarView).onSettingsChange();
    });
  }
}
