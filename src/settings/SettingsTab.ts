
import { App, PluginSettingTab, Setting, Notice, Modal, ButtonComponent, setIcon, FuzzySuggestModal, Platform, Menu } from "obsidian";
import type TeacherPlannerPlugin from "../main";
import type { SchoolPeriod, PeriodTypeConfig, Subject, ClassGroup, WeekOverride, Activity, DaySchedule, SchoolDay, TeacherPlannerSettings } from "../types";
import { ensureDaySchedules, getScheduleForDay } from "../utils/scheduleUtils";
import { DEFAULT_SETTINGS, CLASS_COLOUR_PALETTE, DEFAULT_PERIOD_TYPE_COLOURS, FALLBACK_PERIOD_TYPE_COLOUR, DEFAULT_LESSON_NOTE_TITLE_TEMPLATE, DEFAULT_EVENT_NOTE_TITLE_TEMPLATE, randomClassColour } from "../settings";
import { buildNoteTitle } from "../utils/noteTitleUtils";
import { migrateWeekNotesToFiles } from "../utils/weekNoteFiles";
import { backupPlanner, parseBackup, importPlanners, buildBackupOf, listLibraryBackups, readBackupText, backupsLibraryFolder, writeBackupToDestination } from "../utils/plannerBackup";
import { renderDestinationPicker, openOSFilePicker, readSystemFile, type ExportDestination } from "../utils/exportDestination";
import { buildStructureTemplate, buildHolidayTemplate, writeTemplateFile, listTemplateFiles, readTemplateText, parseTemplate, applyStructureTemplate, applyHolidayTemplate, holidayCount, shiftOverrideDates, structureTemplatesFolder, holidayTemplatesFolder, type ParsedTemplate } from "../utils/schoolTemplates";
import type { LibFile } from "../utils/pluginLibrary";
import { resolveColour, isThemeToken, GRID_THEME_TOKEN } from "../utils/themeColours";
import { findOverlappingOverrides } from "../utils/weekUtils";
import ColourPickerComponent from "../modals/ColourPickerComponent.svelte";
import { AddPeriodModal } from "../modals/AddPeriodModal";
import { ExportModal } from "../modals/ExportModal";
import { DirectedTimeExportModal } from "../modals/DirectedTimeExportModal";
import { SetupWizardModal } from "../modals/SetupWizardModal";
import { EditPlannerModal } from "../modals/EditPlannerModal";

// ── Subject emoji picker ───────────────────────────────────────────────────────

export const SUBJECT_EMOJIS = [
  "🔬", "⚗️", "⚡", "🧮", "📚", "📖", "🌍", "🏛️", "🎨", "🎵",
  "💻", "🏃", "🌐", "💰", "🎭", "📐", "🧠", "⚖️", "🌱", "📸",
  "🎬", "🍳", "✝️", "🤝", "📊", "🔭", "🎸", "📝", "🌿", "🧬",
];

/** Cleanup for the currently open emoji popup (popup + document listeners). */
let _activeEmojiCleanup: (() => void) | null = null;

/** Close any open emoji popup and detach its document-level listeners. */
export function closeEmojiPicker() {
  _activeEmojiCleanup?.();
}

export function openEmojiPicker(
  anchor: HTMLElement,
  current: string,
  onSelect: (emoji: string) => void,
) {
  // Close any existing popup (and its listeners) before opening a new one
  closeEmojiPicker();

  const popup = activeDocument.body.createDiv("tp-emoji-popup");

  const cleanup = () => {
    activeDocument.removeEventListener("click", onDocClick, true);
    activeDocument.removeEventListener("keydown", onKeyDown, true);
    popup.remove();
    if (_activeEmojiCleanup === cleanup) _activeEmojiCleanup = null;
  };
  const onDocClick = (e: MouseEvent) => {
    if (!popup.contains(e.target as Node)) cleanup();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") cleanup();
  };

  for (const emoji of SUBJECT_EMOJIS) {
    const btn = popup.createEl("button", { text: emoji, cls: "tp-emoji-option" });
    if (emoji === current) btn.addClass("tp-emoji-option--active");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onSelect(emoji);
      cleanup();
    });
  }

  // Position: below anchor, flip up if near viewport bottom
  const rect = anchor.getBoundingClientRect();
  const popupWidth = 220;
  const popupHeight = 180;
  let top = rect.bottom + 4;
  let left = rect.left;
  if (top + popupHeight > window.innerHeight) top = rect.top - popupHeight - 4;
  if (left + popupWidth > window.innerWidth) left = window.innerWidth - popupWidth - 8;
  popup.setCssStyles({ top: top + "px" });
  popup.setCssStyles({ left: left + "px" });

  // Close on click outside / Escape
  window.setTimeout(() => {
    activeDocument.addEventListener("click", onDocClick, true);
    activeDocument.addEventListener("keydown", onKeyDown, true);
  }, 0);
  _activeEmojiCleanup = cleanup;
}

/** Minimal text-input modal — window.prompt() is disabled in Obsidian. */
export class TextPromptModal extends Modal {
  private title: string;
  private initial: string;
  private placeholder: string;
  private onSubmit: (value: string) => void;

  constructor(app: App, title: string, initial: string, placeholder: string, onSubmit: (value: string) => void) {
    super(app);
    this.title = title;
    this.initial = initial;
    this.placeholder = placeholder;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText(this.title);
    const input = contentEl.createEl("input", { type: "text", cls: "tp-prompt-input" });
    input.value = this.initial;
    input.placeholder = this.placeholder;
    const submit = () => {
      const v = input.value.trim();
      if (!v) { new Notice("Please enter a name."); return; }
      this.close();
      this.onSubmit(v);
    };
    input.addEventListener("keydown", (e: KeyboardEvent) => { if (e.key === "Enter") submit(); });
    const footer = contentEl.createDiv("tp-modal-footer");
    footer.createEl("button", { text: "Cancel", cls: "tp-btn" })
      .addEventListener("click", () => this.close());
    footer.createEl("button", { text: "Save", cls: "tp-btn tp-btn--primary" })
      .addEventListener("click", submit);
    window.setTimeout(() => { input.focus(); input.select(); }, 30);
  }

  onClose() { this.contentEl.empty(); }
}

/** Confirmation dialog — window.confirm() is discouraged in Obsidian plugins. */
export class ConfirmModal extends Modal {
  private message: string;
  private confirmLabel: string;
  private onConfirm: () => void | Promise<void>;

  constructor(app: App, message: string, onConfirm: () => void | Promise<void>, confirmLabel = "Confirm") {
    super(app);
    this.message = message;
    this.onConfirm = onConfirm;
    this.confirmLabel = confirmLabel;
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText("Are you sure?");
    contentEl.createEl("p", { text: this.message, cls: "setting-item-description" });
    const footer = contentEl.createDiv("tp-modal-footer");
    footer.createEl("button", { text: "Cancel", cls: "tp-btn" })
      .addEventListener("click", () => this.close());
    footer.createEl("button", { text: this.confirmLabel, cls: "tp-btn tp-btn--primary" })
      .addEventListener("click", () => {
        this.close();
        void this.onConfirm();
      });
  }

  onClose() { this.contentEl.empty(); }
}

/**
 * Run a destructive action, optionally behind a confirmation dialog. Honours the
 * global "Confirm before deleting" setting (default on): when on, shows a ConfirmModal
 * with a "Delete" button; when off, runs the action immediately.
 */
export function confirmDelete(
  plugin: TeacherPlannerPlugin,
  message: string,
  onConfirm: () => void | Promise<void>,
): void {
  if (plugin.settings.confirmBeforeDelete === false) { void onConfirm(); return; }
  new ConfirmModal(plugin.app, message, onConfirm, "Delete").open();
}

/** Live-updatable elements of a mobile accordion summary row (0.3.5). */
type MaccSummaryRefs = {
  dot: HTMLElement | null;
  nameEl: HTMLElement;
  subEl: HTMLElement;
  badgeEl: HTMLElement | null;
};

export class TeacherPlannerSettingTab extends PluginSettingTab {
  plugin: TeacherPlannerPlugin;
  /** JSON snapshot taken when the tab opens — used to detect unsaved changes on close. */
  private _snapshot = "";
  /** Day schedule currently being edited in the School Timetable section. */
  private selectedScheduleId: string | null = null;

  private getSelectedSchedule(): DaySchedule {
    const ay = this.plugin.settings.academicYear;
    ensureDaySchedules(ay);
    const found = ay.daySchedules!.find(s => s.id === this.selectedScheduleId);
    if (found) return found;
    this.selectedScheduleId = ay.daySchedules![0].id;
    return ay.daySchedules![0];
  }

  constructor(app: App, plugin: TeacherPlannerPlugin) { super(app, plugin); this.plugin = plugin; }

  /** Called by Obsidian when the settings tab is navigated away from or closed. */
  hide(): void {
    // Tear down any open emoji popup — it lives on activeDocument.body and would
    // otherwise outlive the tab along with its document-level listeners.
    closeEmojiPicker();
    // Flush any pending debounced save so in-flight edits land on disk
    // before the tab tears down. Fire-and-forget — Obsidian's hide() is sync.
    this.plugin.flushPendingSave().catch(err => {
      console.error("Teacher Planner: flushPendingSave on settings hide failed.", err);
    });
    const snapshot = this._snapshot;
    this._snapshot = "";
    if (!snapshot || JSON.stringify(this.plugin.settings) === snapshot) return;
    new SettingsAppliedModal(this.app, this.plugin, snapshot).open();
  }

  // PluginSettingTab requires display(); the new getSettingDefinitions() API
  // is 1.13.0+ while our minAppVersion is 1.7.2, so we keep an imperative
  // render() and have display() delegate to it.
  display(): void { this.render(); }

  private render(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("tp-settings");
    // Capture snapshot of current settings so hide() can detect changes
    this._snapshot = JSON.stringify(this.plugin.settings);

    // ── Planners ───────────────────────────────────────────────────────────
    this.renderPlannersSection(containerEl);

    // ── Academic Year ──────────────────────────────────────────────────────
    new Setting(containerEl).setName("Academic year").setHeading();
    new Setting(containerEl).setName("Planner name").setDesc('e.g. "2025-26 IB Science"')
      .addText(t => t.setPlaceholder("2025-26").setValue(this.plugin.settings.academicYear.name)
        .onChange(v => { this.plugin.settings.academicYear.name = v; this.plugin.requestSave(); }));
    new Setting(containerEl).setName("Start date").setDesc("YYYY-MM-DD")
      .addText(t => t.setPlaceholder("2025-09-01").setValue(this.plugin.settings.academicYear.startDate)
        .onChange(v => { this.plugin.settings.academicYear.startDate = v; this.plugin.requestSave(); }));
    new Setting(containerEl).setName("End date").setDesc("YYYY-MM-DD")
      .addText(t => t.setPlaceholder("2026-07-15").setValue(this.plugin.settings.academicYear.endDate)
        .onChange(v => { this.plugin.settings.academicYear.endDate = v; this.plugin.requestSave(); }));

    // ── School days ────────────────────────────────────────────────────────
    const schoolDayOptions: { key: SchoolDay; label: string }[] = [
      { key: "monday",    label: "Mon" },
      { key: "tuesday",  label: "Tue" },
      { key: "wednesday",label: "Wed" },
      { key: "thursday", label: "Thu" },
      { key: "friday",   label: "Fri" },
      { key: "saturday", label: "Sat" },
      { key: "sunday",   label: "Sun" },
    ];
    const schoolDaysSetting = new Setting(containerEl)
      .setName("School days")
      .setDesc("Enable Saturday or Sunday for boarding or Saturday schools.");
    if (Platform.isMobile) {
      // 0.3.5: toggle chips — same pattern as the timetable day pills, no
      // checkboxes, no truncated labels.
      const chipWrap = schoolDaysSetting.controlEl.createDiv("tp-day-chips");
      for (const opt of schoolDayOptions) {
        const isOn = () => (this.plugin.settings.schoolDays ?? ["monday","tuesday","wednesday","thursday","friday"]).includes(opt.key);
        const chip = chipWrap.createEl("button", { text: opt.label, cls: "tp-day-chip" });
        chip.toggleClass("tp-day-chip--on", isOn());
        chip.addEventListener("click", () => { void (async () => {
          const current = this.plugin.settings.schoolDays ?? ["monday","tuesday","wednesday","thursday","friday"];
          const idx = current.indexOf(opt.key);
          if (idx === -1) current.push(opt.key); else current.splice(idx, 1);
          this.plugin.settings.schoolDays = [...current];
          chip.toggleClass("tp-day-chip--on", isOn());
          await this.plugin.saveSettings();
        })(); });
      }
    } else {
      const sdWrap = schoolDaysSetting.controlEl.createDiv("tp-school-days-wrap");
      for (const opt of schoolDayOptions) {
        const lbl = sdWrap.createEl("label", { cls: "tp-school-day-label" });
        const cb = lbl.createEl("input", { type: "checkbox" });
        cb.checked = (this.plugin.settings.schoolDays ?? ["monday","tuesday","wednesday","thursday","friday"]).includes(opt.key);
        lbl.appendText(opt.label);
        cb.addEventListener("change", () => { void (async () => {
          const current = this.plugin.settings.schoolDays ?? ["monday","tuesday","wednesday","thursday","friday"];
          if (cb.checked) {
            if (!current.includes(opt.key)) current.push(opt.key);
          } else {
            const idx = current.indexOf(opt.key);
            if (idx !== -1) current.splice(idx, 1);
          }
          this.plugin.settings.schoolDays = [...current];
          await this.plugin.saveSettings();
        })(); });
      }
    }

    // ── Directed Time Tracker ──────────────────────────────────────────────
    new Setting(containerEl).setName("Directed time tracker").setHeading();
    if (!this.plugin.settings.directedTime) {
      this.plugin.settings.directedTime = { enabled: false, contractedHours: 1265, timetablePercentage: 100, defaultLessonDurationMinutes: 60 };
    }
    const dt = this.plugin.settings.directedTime;

    new Setting(containerEl)
      .setName("Enable directed time tracker")
      .setDesc("Track cumulative directed time based on events in your planner.")
      .addToggle(t => t.setValue(dt.enabled)
        .onChange(async v => {
          dt.enabled = v;
          await this.plugin.saveSettings();
          if (v) await this.createDirectedTimeGuideNote();
          // Show/hide the sub-settings panel in place — no full re-render
          dtPanel.setCssStyles({ display: v ? "" : "none" });
        }));

    // Sub-settings panel — always in DOM, visibility controlled by toggle
    const dtPanel = containerEl.createDiv();
    dtPanel.setCssStyles({ display: dt.enabled ? "" : "none" });

    {
      // Instructions callout
      const callout = dtPanel.createDiv("tp-dt-callout");
      callout.createEl("p", { text: "ℹ️  How it works: Directed time is counted only from items placed in your planner. The tracker shows hours accrued to today and a projection based on future planned events. Keep your planner up to date for accurate figures." });
      callout.createEl("p", { text: "⚠️  This tracker is a guide only. Accuracy depends entirely on the information you enter. It does not constitute legal advice — always consult your union representative for formal disputes." });

      new Setting(dtPanel)
        .setName("Contracted directed time (hours)")
        .setDesc("Maximum directed time for a full-time teacher. Default: 1265 (STPCD). Override for schools on different contracts.")
        .addText(t => t.setPlaceholder("1265").setValue(String(dt.contractedHours))
          .onChange(v => {
            const n = parseFloat(v);
            if (!isNaN(n) && n > 0) { dt.contractedHours = n; this.plugin.requestSave(); }
          }));

      new Setting(dtPanel)
        .setName("Timetable fraction (%)")
        .setDesc("For part-time teachers. Your directed time maximum = contracted hours × this %. Default: 100 (full-time).")
        .addText(t => t.setPlaceholder("100").setValue(String(dt.timetablePercentage))
          .onChange(v => {
            const n = parseFloat(v);
            if (!isNaN(n) && n > 0 && n <= 100) { dt.timetablePercentage = n; this.plugin.requestSave(); }
          }));

      new Setting(dtPanel)
        .setName("Lesson and activity duration")
        .setDesc("Each lesson, activity, or event counts the length of the block it sits in. To count a different amount (a half period, say), click the duration badge on that block in the timetable editor.");

      new Setting(dtPanel)
        .setName("Export directed time")
        .setDesc("Download a weekly breakdown of directed hours as an Excel workbook, suitable for sharing with your union or school management.")
        .addButton(btn => btn.setButtonText("Export XLSX…").setCta()
          .onClick(() => new DirectedTimeExportModal(this.app, this.plugin).open()));

      new Setting(dtPanel)
        .setName("Directed time guide")
        .setDesc("Open the guide note explaining how the tracker works and your statutory rights.")
        .addButton(btn => btn.setButtonText("Open guide")
          .onClick(async () => {
            await this.createDirectedTimeGuideNote();
            const path = (this.plugin.settings.plannerFolder || "Teacher Planner") + "/Directed Time — Guide.md";
            const file = this.app.vault.getFileByPath(path);
            if (file) await this.app.workspace.getLeaf(false).openFile(file);
          }));
    }

    // ── Holidays & INSET Days ──────────────────────────────────────────────
    new Setting(containerEl).setName("Holidays and INSET days").setHeading();
    containerEl.createEl("p", {
      text: "Mark date ranges as holidays or INSET training days. Individual day columns are greyed out in the planner.",
      cls: "setting-item-description"
    });
    const overridesContainer = containerEl.createDiv("tp-overrides-list");
    this.renderWeekOverridesList(overridesContainer);
    new Setting(containerEl).addButton(btn => btn.setButtonText("+ Add holiday / INSET range").setCta()
      .onClick(async () => {
        const today = new Date().toISOString().slice(0, 10);
        const newOverride: WeekOverride = { startDate: today, type: "holiday", label: "" };
        this.plugin.settings.weekOverrides.push(newOverride);
        await this.plugin.saveSettings();
        // Remove the "no overrides" empty state paragraph if present, then append only the new row
        overridesContainer.querySelector("p")?.remove();
        this.renderWeekOverrideRow(overridesContainer, newOverride);
      }));

    // ── Block Types ────────────────────────────────────────────────────────
    new Setting(containerEl).setName("School day blocks").setHeading();
    containerEl.createEl("p", {
      text: "Define the types of block that make up your school day — lessons, breaks, registration, admin time, and so on. Each block type has a colour that appears as a shaded band in the week view, making it easy to see your day structure at a glance. Assign block types to individual periods in School Timetable.",
      cls: "setting-item-description"
    });
    if (!this.plugin.settings.periodTypes) this.plugin.settings.periodTypes = [];
    const periodTypesContainer = containerEl.createDiv("tp-activities-list");
    this.renderPeriodTypesList(periodTypesContainer);
    new Setting(containerEl).addButton(btn => btn.setButtonText("+ Add block type").setCta()
      .onClick(async () => {
        this.plugin.settings.periodTypes.push({ id: "type-" + Date.now(), label: "New Type", colour: FALLBACK_PERIOD_TYPE_COLOUR });
        await this.plugin.saveSettings();
        periodTypesContainer.empty();
        this.renderPeriodTypesList(periodTypesContainer);
      }))
      .addButton(btn => btn.setButtonText("Reset all colours to theme")
        .setTooltip("Discard custom block colours and follow your Obsidian theme")
        .onClick(() => {
          new ConfirmModal(this.app, "Reset all block type colours to your Obsidian theme defaults? Custom colours will be discarded.", async () => {
          for (const pt of this.plugin.settings.periodTypes) {
            pt.colour = DEFAULT_PERIOD_TYPE_COLOURS[pt.id] ?? FALLBACK_PERIOD_TYPE_COLOUR;
          }
          await this.plugin.saveSettings();
          periodTypesContainer.empty();
          this.renderPeriodTypesList(periodTypesContainer);
          new Notice("Block colours reset to theme defaults.");
          }).open();
        }));

    // ── Periods / day schedules ────────────────────────────────────────────
    new Setting(containerEl).setName("School timetable").setHeading();
    containerEl.createEl("p", {
      text: "Periods are grouped into day schedules. Most schools only need the Standard day. Add another schedule for days shaped differently — a sports afternoon, a half-day Saturday — and assign it to those days. Colours and types are configured in School Day Blocks above.",
      cls: "setting-item-description"
    });

    // ── Timetable Rotation (within School Timetable section) ────────────
    new Setting(containerEl).setName("Enable A/B week rotation").setDesc("Alternating fortnightly timetables.")
      .addToggle(t => t.setValue(this.plugin.settings.academicYear.abWeekEnabled)
        .onChange(async v => {
          this.plugin.settings.academicYear.abWeekEnabled = v;
          await this.plugin.saveSettings();
          // Show/hide the week-selector in place — no full re-render
          abPanel.setCssStyles({ display: v ? "" : "none" });
        }));
    // A/B start week — always in DOM, visibility controlled by toggle
    const abPanel = containerEl.createDiv();
    abPanel.setCssStyles({ display: this.plugin.settings.academicYear.abWeekEnabled ? "" : "none" });
    new Setting(abPanel).setName("Academic year starts on")
      .addDropdown(d => d.addOption("A", "Week A").addOption("B", "Week B")
        .setValue(this.plugin.settings.academicYear.abWeekStartsOn)
        .onChange(async (v: string) => { this.plugin.settings.academicYear.abWeekStartsOn = v as "A" | "B"; await this.plugin.saveSettings(); }));
    new Setting(abPanel).setName("Continue rotation across holidays")
      .setDesc("Skip fully-holiday weeks so the A/B pattern carries on seamlessly after a break. Recomputes automatically when holidays change.")
      .addToggle(t => t.setValue(this.plugin.settings.academicYear.abWeekHolidayAware !== false)
        .onChange(async v => { this.plugin.settings.academicYear.abWeekHolidayAware = v; await this.plugin.saveSettings(); }));

    ensureDaySchedules(this.plugin.settings.academicYear);
    const scheduleBar = containerEl.createDiv("tp-schedule-bar");
    const periodsContainer = containerEl.createDiv("tp-periods-list");

    const refreshPeriods = () => { periodsContainer.empty(); this.renderPeriodsList(periodsContainer); };

    const renderScheduleBar = () => {
      scheduleBar.empty();
      const ay = this.plugin.settings.academicYear;
      const sel = this.getSelectedSchedule();

      const bar = new Setting(scheduleBar)
        .setName("Day schedule")
        .setDesc("Choose which schedule to edit. Click a day below to make it use the selected schedule.");
      bar.addDropdown(d => {
        for (const sch of ay.daySchedules!) d.addOption(sch.id, sch.name);
        d.setValue(sel.id);
        d.onChange(v => { this.selectedScheduleId = v; renderScheduleBar(); refreshPeriods(); });
      });
      bar.addExtraButton(b => b.setIcon("pencil").setTooltip("Rename schedule").onClick(() => {
        new TextPromptModal(this.app, "Rename day schedule", sel.name, "Schedule name", (name) => { void (async () => {
          sel.name = name;
          await this.plugin.saveSettings();
          renderScheduleBar();
        })(); }).open();
      }));
      bar.addExtraButton(b => b.setIcon("plus").setTooltip("New day schedule").onClick(() => {
        new TextPromptModal(this.app, "New day schedule", "", "e.g. Saturday, Sports day", (name) => { void (async () => {
          const sch: DaySchedule = { id: "schedule-" + Date.now(), name, periods: [] };
          ay.daySchedules!.push(sch);
          this.selectedScheduleId = sch.id;
          await this.plugin.saveSettings();
          renderScheduleBar();
          refreshPeriods();
        })(); }).open();
      }));
      bar.addExtraButton(b => b.setIcon("trash").setTooltip("Delete schedule").onClick(() => {
        if (ay.daySchedules!.length <= 1) { new Notice("At least one day schedule is required."); return; }
        const fallbackName = ay.daySchedules![0].id === sel.id ? ay.daySchedules![1].name : ay.daySchedules![0].name;
        new ConfirmModal(this.app, `Delete schedule "${sel.name}"? Days using it fall back to "${fallbackName}". Periods unique to it disappear from the timetable (assigned lessons are kept but hidden).`, async () => {
          ay.daySchedules = ay.daySchedules!.filter(s => s.id !== sel.id);
          for (const key of Object.keys(ay.dayScheduleMap ?? {}) as SchoolDay[]) {
            if (ay.dayScheduleMap?.[key] === sel.id) delete ay.dayScheduleMap?.[key];
          }
          this.selectedScheduleId = ay.daySchedules[0].id;
          await this.plugin.saveSettings();
          renderScheduleBar();
          refreshPeriods();
        }, "Delete").open();
      }));

      const pillRow = scheduleBar.createDiv("tp-schedule-days");
      const dayDefs: [SchoolDay, string][] = [
        ["monday","Mon"], ["tuesday","Tue"], ["wednesday","Wed"], ["thursday","Thu"],
        ["friday","Fri"], ["saturday","Sat"], ["sunday","Sun"],
      ];
      const schoolDays = this.plugin.settings.schoolDays ?? ["monday","tuesday","wednesday","thursday","friday"];
      for (const [day, label] of dayDefs) {
        if (!schoolDays.includes(day)) continue;
        const daySched = getScheduleForDay(ay, day);
        const active = daySched?.id === sel.id;
        const pill = pillRow.createEl("button", { text: label, cls: "tp-schedule-day-pill" });
        if (active) pill.addClass("tp-schedule-day-pill--active");
        pill.title = active
          ? `${label} uses "${sel.name}"`
          : `${label} uses "${daySched?.name ?? "?"}" — click to switch it to "${sel.name}"`;
        pill.addEventListener("click", () => { void (async () => {
          if (ay.daySchedules!.length < 2) {
            new Notice("All days use the only schedule. Click + to create a second schedule, then assign days to it.");
            return;
          }
          if (active) {
            new Notice(`${label} already uses "${sel.name}". Select a different schedule above to move ${label} to it.`);
            return;
          }
          if (!ay.dayScheduleMap) ay.dayScheduleMap = {};
          ay.dayScheduleMap[day] = sel.id;
          await this.plugin.saveSettings();
          renderScheduleBar();
        })(); });
      }
      if (ay.daySchedules!.length < 2) {
        scheduleBar.createEl("p", {
          text: "All days currently use this schedule. Click + above to create a second schedule (e.g. Saturday), then click a day pill to assign it.",
          cls: "setting-item-description",
        });
      }
    };
    renderScheduleBar();

    this.renderPeriodsList(periodsContainer);
    new Setting(containerEl).addButton(btn => btn.setButtonText("+ Add period").setCta()
      .onClick(() => {
        new AddPeriodModal(this.app, async (period) => {
          this.getSelectedSchedule().periods.push(period);
          this.sortPeriods();
          await this.plugin.saveSettings();
          refreshPeriods();
        }).open();
      }));

    // ── Lessons ────────────────────────────────────────────────────────────
    new Setting(containerEl).setName("My classes").setHeading();
    containerEl.createEl("p", {
      text: "Define your subjects and class groups. Colours appear on lesson blocks in the week view.",
      cls: "setting-item-description"
    });
    const classesContainer = containerEl.createDiv("tp-classes-list");
    this.renderSubjectsList(classesContainer);
    new Setting(containerEl).addButton(btn => btn.setButtonText("+ Add subject").setCta()
      .onClick(async () => {
        const colour = randomClassColour(this.plugin.settings.subjects.map(s => s.colour));
        this.plugin.settings.subjects.push({ id: `subj-${Date.now()}`, name: "New Subject", colour, emoji: "📚" });
        await this.plugin.saveSettings();
        classesContainer.empty();
        this.renderSubjectsList(classesContainer);
      }));

    // ── Directed time activities ───────────────────────────────────────────
    new Setting(containerEl).setName("Recurring events: directed time").setHeading();
    containerEl.createEl("p", {
      text: "These activities count toward your directed time total. Add them to the planner by clicking any empty slot. Each one counts the length of the block you put it in; to count a different amount, click the duration badge on that block in the timetable editor.",
      cls: "setting-item-description"
    });
    if (!this.plugin.settings.activities) this.plugin.settings.activities = [];

    // Column headers (desktop only — the mobile accordion rows have no columns)
    if (!Platform.isMobile) {
      const activityHeaders = containerEl.createDiv("tp-activity-row tp-activity-headers");
      activityHeaders.createDiv("tp-activity-header-spacer"); // colour swatch placeholder
      const makeHeader = (text: string, extraCls = "") => {
        const cls = "tp-activity-header-label" + (extraCls ? " " + extraCls : "");
        return activityHeaders.createSpan({ text, cls });
      };
      makeHeader("Name");
      makeHeader("Info");
      makeHeader("Classroom");
      activityHeaders.createDiv("tp-activity-header-spacer"); // archive btn placeholder
      activityHeaders.createDiv("tp-activity-header-spacer"); // delete btn placeholder
    }

    const activitiesContainer = containerEl.createDiv("tp-activities-list");
    this.renderActivitiesList(activitiesContainer, "directed");
    new Setting(containerEl).addButton(btn => btn.setButtonText("+ Add activity").setCta()
      .onClick(async () => {
        this.plugin.settings.activities.push({ id: `activity-${Date.now()}`, label: "New Activity", colour: "#cba6f7", activityType: "directed" });
        await this.plugin.saveSettings();
        activitiesContainer.empty();
        this.renderActivitiesList(activitiesContainer, "directed");
      }));

    // ── Other Events ───────────────────────────────────────────────────────
    new Setting(containerEl).setName("Recurring events: non-directed time").setHeading();
    containerEl.createEl("p", {
      text: "⚠️  Items in this section appear in the planner but are excluded from the directed time count. Use these for personal appointments, reminders, or any non-directed activity.",
      cls: "setting-item-description"
    });
    const otherContainer = containerEl.createDiv("tp-activities-list");
    this.renderActivitiesList(otherContainer, "other");
    new Setting(containerEl).addButton(btn => btn.setButtonText("+ Add other event").setCta()
      .onClick(async () => {
        this.plugin.settings.activities.push({ id: `activity-${Date.now()}`, label: "New Other Event", colour: "#888888", activityType: "other" });
        await this.plugin.saveSettings();
        otherContainer.empty();
        this.renderActivitiesList(otherContainer, "other");
      }));

    // ── Vault ──────────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Vault").setHeading();
    new Setting(containerEl).setName("Planner folder").setDesc("Where lesson notes will be created")
      .addText(t => t.setPlaceholder("Teacher Planner").setValue(this.plugin.settings.plannerFolder)
        .onChange(v => { this.plugin.settings.plannerFolder = v; this.plugin.requestSave(); }));

    // -- Note titles ---------------------------------------------------------
    new Setting(containerEl).setName("Note titles").setHeading();
    containerEl.createEl("p", {
      text: "Templates for generated lesson- and event-note titles. Tokens: {{date}} {{period}} {{class}} {{subject}} {{emoji}} {{event}}. Empty tokens are dropped, so a missing value never leaves a dangling separator. Clear a field to restore its default.",
      cls: "setting-item-description",
    });

    const _sampleSubj = this.plugin.settings.subjects?.[0];
    const _sampleCls = this.plugin.settings.classes?.[0];
    const _sampleDate = new Date().toISOString().slice(0, 10);

    const renderLessonTitle = (tpl: string) => buildNoteTitle(tpl, {
      dateIso: _sampleDate,
      periodName: "Period 1",
      classCode: _sampleCls?.code ?? "10A",
      subjectName: _sampleSubj?.name ?? "Biology",
      emoji: _sampleSubj?.emoji ?? "🌱",
    });
    const renderEventTitle = (tpl: string) => buildNoteTitle(tpl, {
      dateIso: _sampleDate,
      periodName: "Break",
      eventName: "Bake sale",
    });

    let lessonTitlePreview: HTMLElement;
    let eventTitlePreview: HTMLElement;

    const lessonTitleSetting = new Setting(containerEl)
      .setName("Lesson note title")
      .addText(t => {
        t.setPlaceholder(DEFAULT_LESSON_NOTE_TITLE_TEMPLATE);
        t.setValue(this.plugin.settings.lessonNoteTitleTemplate ?? DEFAULT_LESSON_NOTE_TITLE_TEMPLATE);
        t.inputEl.addClass("tp-title-template-input");
        t.onChange(v => {
          this.plugin.settings.lessonNoteTitleTemplate = v.trim() || undefined;
          lessonTitlePreview.setText("Preview:  " + renderLessonTitle(v.trim() || DEFAULT_LESSON_NOTE_TITLE_TEMPLATE));
          this.plugin.requestSave();
        });
      });
    lessonTitlePreview = lessonTitleSetting.descEl.createDiv({ cls: "setting-item-description tp-title-template-preview" });
    lessonTitlePreview.setText("Preview:  " + renderLessonTitle(this.plugin.settings.lessonNoteTitleTemplate ?? DEFAULT_LESSON_NOTE_TITLE_TEMPLATE));

    const eventTitleSetting = new Setting(containerEl)
      .setName("Event note title")
      .addText(t => {
        t.setPlaceholder(DEFAULT_EVENT_NOTE_TITLE_TEMPLATE);
        t.setValue(this.plugin.settings.eventNoteTitleTemplate ?? DEFAULT_EVENT_NOTE_TITLE_TEMPLATE);
        t.inputEl.addClass("tp-title-template-input");
        t.onChange(v => {
          this.plugin.settings.eventNoteTitleTemplate = v.trim() || undefined;
          eventTitlePreview.setText("Preview:  " + renderEventTitle(v.trim() || DEFAULT_EVENT_NOTE_TITLE_TEMPLATE));
          this.plugin.requestSave();
        });
      });
    eventTitlePreview = eventTitleSetting.descEl.createDiv({ cls: "setting-item-description tp-title-template-preview" });
    eventTitlePreview.setText("Preview:  " + renderEventTitle(this.plugin.settings.eventNoteTitleTemplate ?? DEFAULT_EVENT_NOTE_TITLE_TEMPLATE));

    // ── Lesson overview ────────────────────────────────────────────────────
    new Setting(containerEl).setName("Lesson overview").setHeading();
    new Setting(containerEl)
      .setName("Main line shows")
      .setDesc("What to show on each lesson row in the overview. Notes are the per-lesson note field; plan title is the linked lesson-plan filename.")
      .addDropdown(d => d
        .addOption("notes-plan", "Notes, then plan title")
        .addOption("notes", "Notes only")
        .addOption("plan", "Plan title")
        .setValue(this.plugin.settings.lessonOverviewMainLine ?? "notes-plan")
        .onChange(async (v: string) => {
          this.plugin.settings.lessonOverviewMainLine = v as "notes-plan" | "notes" | "plan";
          await this.plugin.saveSettings();
        }));

    // ── Grid Visuals ───────────────────────────────────────────────────────
    new Setting(containerEl).setName("Grid visuals").setHeading();
    const GREY_PALETTE = ["#dddddd", "#bbbbbb", "#999999", "#777777", "#555555", "#444444", "#333333"];

    const blockColourSetting = new Setting(containerEl)
      .setName("Period block border colour")
      .setDesc("Border on the top and bottom edge of each period band.");
    blockColourSetting.controlEl.setCssStyles({ display: "flex" });
    blockColourSetting.controlEl.setCssStyles({ alignItems: "center" });
    blockColourSetting.controlEl.setCssStyles({ gap: "8px" });
    blockColourSetting.controlEl.setCssStyles({ flexWrap: "wrap" });

    const currentBlockColour = this.plugin.settings.blockBorderColour ?? GRID_THEME_TOKEN;
    const blockSwatchBtn = blockColourSetting.controlEl.createEl("button", { cls: "tp-colour-swatch-btn tp-colour-swatch-btn--small", title: "Custom colour" });
    blockSwatchBtn.setCssStyles({ background: resolveColour(currentBlockColour) });

    const blockPresetRow = blockColourSetting.controlEl.createDiv("tp-preset-swatches");
    const blockPresetSwatches: HTMLElement[] = [];

    const updateBlockBorderColour = async (colour: string) => {
      this.plugin.settings.blockBorderColour = colour;
      await this.plugin.saveSettings();
      blockSwatchBtn.setCssStyles({ background: resolveColour(colour) });
      blockPresetSwatches.forEach(s => s.classList.toggle("tp-preset-swatch--active", s.dataset.colour === colour));
    };

    blockSwatchBtn.addEventListener("click", () => {
      new ColourPickerModal(this.app, this.plugin.settings.blockBorderColour ?? GRID_THEME_TOKEN, "Period block border", async colour => {
        await updateBlockBorderColour(colour);
      }).open();
    });

    {
      const chip = blockPresetRow.createEl("button", { cls: "tp-preset-swatch tp-preset-swatch--theme", title: "Follow Obsidian theme (default)" });
      chip.setCssStyles({ background: resolveColour(GRID_THEME_TOKEN) });
      chip.dataset.colour = GRID_THEME_TOKEN;
      if (currentBlockColour === GRID_THEME_TOKEN) chip.classList.add("tp-preset-swatch--active");
      chip.addEventListener("click", () => { void (async () => { await updateBlockBorderColour(GRID_THEME_TOKEN); })(); });
      blockPresetSwatches.push(chip);
    }

    for (const grey of GREY_PALETTE) {
      const chip = blockPresetRow.createEl("button", { cls: "tp-preset-swatch", title: grey });
      chip.setCssStyles({ background: grey });
      chip.dataset.colour = grey;
      if (grey === currentBlockColour) chip.classList.add("tp-preset-swatch--active");
      chip.addEventListener("click", () => { void (async () => { await updateBlockBorderColour(grey); })(); });
      blockPresetSwatches.push(chip);
    }

    new Setting(containerEl).setName("Period block border weight").setDesc("Thickness of period band borders in pixels (1-4).")
      .addSlider(s => {
        const valueLabel = createSpan({ cls: "tp-slider-value", text: `${this.plugin.settings.blockBorderWeight ?? 1}px` });
        s.setLimits(1, 4, 1).setValue(this.plugin.settings.blockBorderWeight ?? 1)
          .onChange(v => { this.plugin.settings.blockBorderWeight = v; this.plugin.requestSave(); valueLabel.setText(`${v}px`); });
        s.sliderEl.after(valueLabel);
      });

    const gridColourSetting = new Setting(containerEl)
      .setName("Time grid line colour")
      .setDesc("Colour of the day-column borders and row dividers.");
    gridColourSetting.controlEl.setCssStyles({ display: "flex" });
    gridColourSetting.controlEl.setCssStyles({ alignItems: "center" });
    gridColourSetting.controlEl.setCssStyles({ gap: "8px" });
    gridColourSetting.controlEl.setCssStyles({ flexWrap: "wrap" });

    const currentGridColour = this.plugin.settings.gridLineColour ?? GRID_THEME_TOKEN;
    const gridSwatchBtn = gridColourSetting.controlEl.createEl("button", { cls: "tp-colour-swatch-btn tp-colour-swatch-btn--small", title: "Custom colour" });
    gridSwatchBtn.setCssStyles({ background: resolveColour(currentGridColour) });

    const gridPresetRow = gridColourSetting.controlEl.createDiv("tp-preset-swatches");
    const gridPresetSwatches: HTMLElement[] = [];

    const updateGridLineColour = async (colour: string) => {
      this.plugin.settings.gridLineColour = colour;
      await this.plugin.saveSettings();
      gridSwatchBtn.setCssStyles({ background: resolveColour(colour) });
      gridPresetSwatches.forEach(s => s.classList.toggle("tp-preset-swatch--active", s.dataset.colour === colour));
    };

    gridSwatchBtn.addEventListener("click", () => {
      new ColourPickerModal(this.app, this.plugin.settings.gridLineColour ?? GRID_THEME_TOKEN, "Time grid line", async colour => {
        await updateGridLineColour(colour);
      }).open();
    });

    {
      const chip = gridPresetRow.createEl("button", { cls: "tp-preset-swatch tp-preset-swatch--theme", title: "Follow Obsidian theme (default)" });
      chip.setCssStyles({ background: resolveColour(GRID_THEME_TOKEN) });
      chip.dataset.colour = GRID_THEME_TOKEN;
      if (currentGridColour === GRID_THEME_TOKEN) chip.classList.add("tp-preset-swatch--active");
      chip.addEventListener("click", () => { void (async () => { await updateGridLineColour(GRID_THEME_TOKEN); })(); });
      gridPresetSwatches.push(chip);
    }

    for (const grey of GREY_PALETTE) {
      const chip = gridPresetRow.createEl("button", { cls: "tp-preset-swatch", title: grey });
      chip.setCssStyles({ background: grey });
      chip.dataset.colour = grey;
      if (grey === currentGridColour) chip.classList.add("tp-preset-swatch--active");
      chip.addEventListener("click", () => { void (async () => { await updateGridLineColour(grey); })(); });
      gridPresetSwatches.push(chip);
    }

    const todayColourSetting = new Setting(containerEl)
      .setName("Today's column colour")
      .setDesc("Tint used to highlight today's column in the week grid.");
    todayColourSetting.controlEl.setCssStyles({ display: "flex" });
    todayColourSetting.controlEl.setCssStyles({ alignItems: "center" });
    todayColourSetting.controlEl.setCssStyles({ gap: "8px" });
    todayColourSetting.controlEl.setCssStyles({ flexWrap: "wrap" });

    const TODAY_THEME_TOKEN = "theme:accent";
    const currentTodayColour = this.plugin.settings.todayHighlightColour ?? TODAY_THEME_TOKEN;
    const todaySwatchBtn = todayColourSetting.controlEl.createEl("button", { cls: "tp-colour-swatch-btn tp-colour-swatch-btn--small", title: "Custom colour" });
    todaySwatchBtn.setCssStyles({ background: resolveColour(currentTodayColour) });

    const todayPresetRow = todayColourSetting.controlEl.createDiv("tp-preset-swatches");
    const todayPresetSwatches: HTMLElement[] = [];

    const updateTodayColour = async (colour: string) => {
      this.plugin.settings.todayHighlightColour = colour;
      await this.plugin.saveSettings();
      todaySwatchBtn.setCssStyles({ background: resolveColour(colour) });
      todayPresetSwatches.forEach(sw => sw.classList.toggle("tp-preset-swatch--active", sw.dataset.colour === colour));
    };

    todaySwatchBtn.addEventListener("click", () => {
      new ColourPickerModal(this.app, this.plugin.settings.todayHighlightColour ?? TODAY_THEME_TOKEN, "Today's column", async colour => {
        await updateTodayColour(colour);
      }).open();
    });

    {
      const chip = todayPresetRow.createEl("button", { cls: "tp-preset-swatch tp-preset-swatch--theme", title: "Follow Obsidian accent (default)" });
      chip.setCssStyles({ background: resolveColour(TODAY_THEME_TOKEN) });
      chip.dataset.colour = TODAY_THEME_TOKEN;
      if (currentTodayColour === TODAY_THEME_TOKEN) chip.classList.add("tp-preset-swatch--active");
      chip.addEventListener("click", () => { void (async () => { await updateTodayColour(TODAY_THEME_TOKEN); })(); });
      todayPresetSwatches.push(chip);
    }

    for (const grey of GREY_PALETTE) {
      const chip = todayPresetRow.createEl("button", { cls: "tp-preset-swatch", title: grey });
      chip.setCssStyles({ background: grey });
      chip.dataset.colour = grey;
      if (grey === currentTodayColour) chip.classList.add("tp-preset-swatch--active");
      chip.addEventListener("click", () => { void (async () => { await updateTodayColour(grey); })(); });
      todayPresetSwatches.push(chip);
    }

    new Setting(containerEl).setName("Time grid line weight").setDesc("Thickness of the grid dividers in pixels (1-4).")
      .addSlider(s => {
        const valueLabel = createSpan({ cls: "tp-slider-value", text: `${this.plugin.settings.gridLineWeight ?? 1}px` });
        s.setLimits(1, 4, 1).setValue(this.plugin.settings.gridLineWeight ?? 1)
          .onChange(v => { this.plugin.settings.gridLineWeight = v; this.plugin.requestSave(); valueLabel.setText(`${v}px`); });
        s.sliderEl.after(valueLabel);
      });

    new Setting(containerEl).setName("Grid zoom (this device)")
      .setDesc("Height of the week grid, in pixels per hour. Stored per device — not synced, so each device keeps its own zoom.")
      .addSlider(s => {
        const valueLabel = createSpan({ cls: "tp-slider-value", text: `${this.plugin.getGridScale()} px/hr` });
        s.setLimits(60, 240, 10).setValue(this.plugin.getGridScale())
          .onChange(v => { this.plugin.setGridScale(v); valueLabel.setText(`${v} px/hr`); });
        s.sliderEl.after(valueLabel);
      });

    new Setting(containerEl).setName("Timetable editor zoom (this device)")
      .setDesc("Vertical zoom of the timetable editor, in pixels per hour. Stored per device — not synced. Also adjustable from the editor's own zoom control.")
      .addSlider(s => {
        const valueLabel = createSpan({ cls: "tp-slider-value", text: `${this.plugin.getEditorScale()} px/hr` });
        s.setLimits(60, 240, 6).setValue(this.plugin.getEditorScale())
          .onChange(v => { this.plugin.setEditorScale(v); valueLabel.setText(`${v} px/hr`); });
        s.sliderEl.after(valueLabel);
      });

    new Setting(containerEl).setName("Reset grid visuals")
      .setDesc("Restore both colours to your Obsidian theme and weights to 1px.")
      .addButton(btn => btn.setButtonText("Reset to theme defaults").setClass("mod-warning")
        .onClick(async () => {
          this.plugin.settings.blockBorderColour = GRID_THEME_TOKEN;
          this.plugin.settings.gridLineColour = GRID_THEME_TOKEN;
          this.plugin.settings.blockBorderWeight = 1;
          this.plugin.settings.gridLineWeight = 1;
          this.plugin.settings.todayHighlightColour = "theme:accent";
          await this.plugin.saveSettings();
          new Notice("Grid visuals reset to theme defaults.");
          this.render();
        }));

    // ── Export ────────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Lesson plans").setHeading();
    new Setting(containerEl)
      .setName("Plans folder")
      .setDesc("Where new lesson plans are created and listed first in the picker. Leave empty for \"<planner folder>/Plans\".")
      .addText(t => {
        t.setPlaceholder((this.plugin.settings.plannerFolder || "Teacher Planner") + "/Plans");
        t.setValue(this.plugin.settings.lessonPlansFolder ?? "");
        t.inputEl.addEventListener("blur", () => { void (async () => {
          this.plugin.settings.lessonPlansFolder = t.inputEl.value.trim() || undefined;
          await this.plugin.saveSettings();
        })(); });
      });
    new Setting(containerEl)
      .setName("Show lesson-prepared marker")
      .setDesc("Adds a green tick you can click on each lesson to mark it prepared — independent of linking a plan. Turn off if you only use plan links.")
      .addToggle(t => t.setValue(this.plugin.settings.showPreparedMark ?? true)
        .onChange(async v => {
          this.plugin.settings.showPreparedMark = v;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl).setName("Notes").setHeading();
    new Setting(containerEl)
      .setName("Organise notes into weekly folders")
      .setDesc("Create lesson and event notes inside \"WC - <Monday date>\" folders under the planner folder. Existing notes stay where they are and keep opening.")
      .addToggle(t => t.setValue(this.plugin.settings.weeklyNoteFolders ?? true)
        .onChange(async v => {
          this.plugin.settings.weeklyNoteFolders = v;
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName("Store week notes as vault files")
      .setDesc("Save each week's sidebar note as a markdown file (\"Week note - <Monday date>\") so it's searchable and linkable, and enables the live (formatted) editor in the sidebar. Enabling moves existing week notes out of the plugin data file.")
      .addToggle(t => t.setValue(this.plugin.settings.weekNoteFiles ?? false)
        .onChange(async v => {
          this.plugin.settings.weekNoteFiles = v;
          if (v) {
            // Migrate first (writes files from data.json, then saves once) so the
            // sidebar never switches to file-mode against not-yet-written files.
            const n = await migrateWeekNotesToFiles(this.plugin);
            new Notice(n > 0 ? `Moved ${n} week note${n === 1 ? "" : "s"} to files.` : "Week notes will now be saved as files.");
          } else {
            await this.plugin.saveSettings();
          }
          this.render();
        }));
    if (this.plugin.settings.weekNoteFiles) {
      new Setting(containerEl)
        .setName("Week notes folder")
        .setDesc("Folder for week-note files. Leave empty for \"<planner folder>/Week notes\".")
        .addText(t => {
          t.setPlaceholder((this.plugin.settings.plannerFolder || "Teacher Planner") + "/Week notes");
          t.setValue(this.plugin.settings.weekNotesFolder ?? "");
          t.inputEl.addEventListener("blur", () => { void (async () => {
            this.plugin.settings.weekNotesFolder = t.inputEl.value.trim() || undefined;
            await this.plugin.saveSettings();
          })(); });
        });
      new Setting(containerEl)
        .setName("Open week note in")
        .setDesc("Where the open-in-pane button opens the full week note.")
        .addDropdown(d => d
          .addOption("tab", "New tab")
          .addOption("split", "Split right")
          .addOption("current", "Current pane")
          .setValue(this.plugin.settings.weekNoteOpenIn ?? "tab")
          .onChange(v => { this.plugin.settings.weekNoteOpenIn = v as "tab" | "split" | "current"; this.plugin.requestSave(); }));
    }

    new Setting(containerEl).setName("Export").setHeading();
    new Setting(containerEl)
      .setName("Export planner data")
      .setDesc("Export timetable and events as Excel or CSV, or as an iCal calendar (.ics) for Google, Apple or Outlook calendar — to your Planner folder or anywhere on your computer.")
      .addButton(btn => btn.setButtonText("Export data…").setCta()
        .onClick(() => new ExportModal(this.app, this.plugin).open()));

    // ── Reset ──────────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Reset").setHeading();
    new Setting(containerEl).setName("Confirm before deleting")
      .setDesc("Ask for confirmation before destructive actions — removing an event or lesson, or deleting a subject, class, activity or block type. Applies across all planners.")
      .addToggle(t => t.setValue(this.plugin.settings.confirmBeforeDelete !== false)
        .onChange(v => { this.plugin.settings.confirmBeforeDelete = v; this.plugin.requestSave(); }));
    new Setting(containerEl).setName("Reset periods to defaults")
      .addButton(btn => btn.setButtonText("Reset periods").setClass("mod-warning")
        .onClick(async () => {
          this.getSelectedSchedule().periods = DEFAULT_SETTINGS.academicYear.periods.map(p => ({ ...p }));
          await this.plugin.saveSettings();
          periodsContainer.empty();
          this.renderPeriodsList(periodsContainer);
          new Notice("Periods reset to defaults.");
        }));
    this.wrapSectionsCollapsible(containerEl);

    // ── Support development (always visible, below the collapsible sections) ──
    const TP_REPO_URL = "https://github.com/NSDerred/teacher-planner-obsidian";
    const fundingRaw = (this.plugin.manifest as { fundingUrl?: string | Record<string, string> }).fundingUrl;
    const TP_FUNDING_URL = typeof fundingRaw === "string" ? fundingRaw : "https://buymeacoffee.com/teacher.nsmith";
    const support = containerEl.createDiv("tp-support-section");
    new Setting(support)
      .setName(`What's new in Teacher Planner ${this.plugin.manifest.version}`)
      .setDesc("See recent updates and improvements.")
      .addButton(b => b.setButtonText("View recent updates")
        .onClick(() => window.open(`${TP_REPO_URL}/releases`, "_blank")));
    new Setting(support)
      .setName("Support development")
      .setDesc("If you find Teacher Planner useful, please consider supporting its continued development.")
      .addButton(b => b.setButtonText("⭐ Star on GitHub")
        .onClick(() => window.open(TP_REPO_URL, "_blank")))
      .addButton(b => b.setButtonText("☕ Buy me a coffee").setCta()
        .onClick(() => window.open(TP_FUNDING_URL, "_blank")));
  }

  // ── Planners section ──────────────────────────────────────────────────────

  private renderPlannersSection(container: HTMLElement) {
    new Setting(container).setName("Planners").setHeading();
    container.createEl("p", {
      text: "Each planner has its own timetable, classes and academic year. Switch between planners here or create a new one.",
      cls: "setting-item-description",
    });

    const { planners, activePlannerId } = this.plugin.plannerData;
    const plannerList = container.createDiv("tp-planner-list");

    for (const p of planners) {
      const isActive = p.id === activePlannerId;
      const card = plannerList.createDiv(
        "tp-planner-card" + (isActive ? " tp-planner-card--active" : "") + (Platform.isMobile ? " tp-planner-card--stack" : ""),
      );

      // Left accent strip — colour handled by CSS .tp-planner-card--active .tp-planner-card-accent
      card.createDiv("tp-planner-card-accent");

      // Centre: name row (name + active badge inline) + dates below
      const info = card.createDiv("tp-planner-card-info");
      const nameRow = info.createDiv("tp-planner-card-name-row");
      nameRow.createSpan({ text: p.name, cls: "tp-planner-card-name" });
      if (isActive) nameRow.createSpan({ text: "Active", cls: "tp-planner-badge" });
      info.createSpan({
        text: Platform.isMobile
          ? this.mFmtDate(p.academicYear.startDate) + " → " + this.mFmtDate(p.academicYear.endDate)
          : p.academicYear.startDate + " → " + p.academicYear.endDate,
        cls: "tp-planner-card-dates",
      });

      const actions = card.createDiv("tp-planner-card-actions");

      const doExport = () => { void (async () => {
        try { const path = await backupPlanner(this.plugin, p); new Notice(`Backed up to ${path}`); }
        catch (e) { console.error("Teacher Planner: export failed.", e); new Notice("Backup failed — see console."); }
      })(); };
      const doSwitch = () => { void (async () => {
        await this.plugin.switchPlanner(p.id);
        this.render();
      })(); };
      const doEdit = () => new EditPlannerModal(this.app, this.plugin, () => this.render()).open();
      const doDelete = () => {
        const isLast = planners.length === 1;
        new DeletePlannerModal(this.app, this.plugin, p.id, p.name, isLast, () => this.render()).open();
      };

      if (Platform.isMobile) {
        // 0.3.5: stacked card — name gets the full width, actions on their own
        // row beneath, delete tucked into an overflow menu so it can never be
        // mis-tapped next to Switch/Edit.
        const primary = actions.createEl("button", { text: isActive ? "Edit" : "Switch", cls: "tp-btn tp-btn--primary" });
        primary.addEventListener("click", isActive ? doEdit : doSwitch);
        const exportBtn = actions.createEl("button", { text: "Export", cls: "tp-btn" });
        exportBtn.addEventListener("click", doExport);
        const moreBtn = actions.createEl("button", { cls: "tp-btn tp-btn--icon", attr: { "aria-label": "More options" } });
        setIcon(moreBtn, "more-horizontal");
        moreBtn.addEventListener("click", (e) => {
          const menu = new Menu();
          menu.addItem(i => {
            i.setTitle(isActive ? "Delete planner (switch to another planner first)" : "Delete planner")
              .setIcon("trash-2");
            if (isActive) i.setDisabled(true);
            else { i.setWarning(true); i.onClick(doDelete); }
          });
          menu.showAtMouseEvent(e);
        });
      } else {
        const exportBtn = actions.createEl("button", { text: "Export", cls: "tp-btn" });
        exportBtn.addEventListener("click", doExport);

        if (!isActive) {
          const switchBtn = actions.createEl("button", { text: "Switch", cls: "tp-btn tp-btn--primary" });
          switchBtn.addEventListener("click", doSwitch);
          const delBtn = actions.createEl("button", { text: "Delete", cls: "tp-btn tp-btn--danger" });
          delBtn.addEventListener("click", doDelete);
        } else {
          const editBtn = actions.createEl("button", { text: "Edit", cls: "tp-btn tp-btn--primary" });
          editBtn.addEventListener("click", doEdit);
          // Active planner — delete disabled with tooltip
          const disabledDel = actions.createEl("button", {
            text: "Delete",
            cls: "tp-btn tp-btn--danger",
            attr: { disabled: "true", title: "Switch to another planner before deleting this one" },
          });
          disabledDel.setCssStyles({ opacity: "0.35" });
          disabledDel.setCssStyles({ cursor: "not-allowed" });
        }
      }
    }

    // "+ New planner" button — primary action, directly under the planner list
    new Setting(container).addButton(btn => btn.setButtonText("+ New planner").setCta()
      .onClick(() => {
        new SetupWizardModal(this.app, this.plugin, true).open();
        (this.app as unknown as { setting?: { close(): void } }).setting?.close();
      }));

    // Backups: export (select + destination) / import (library or file)
    const backupSetting = new Setting(container)
      .setName("Backups")
      .setDesc("Saved as .json in the plugin folder (hidden, no vault clutter); the auto-backup taken before deleting a planner goes here too. Export lets you also save a copy to a vault folder or your computer.")
      .addButton(btn => btn.setButtonText("Export…").onClick(() => new BackupExportModal(this.app, this.plugin, () => this.render()).open()))
      .addButton(btn => btn.setButtonText("Import from library…").onClick(() => this.importBackupFromLibrary()));
    if (!Platform.isMobile) {
      backupSetting.addButton(btn => btn.setButtonText("Import from file…").onClick(() => this.importBackupFromFile()));
    }

    // School templates: reusable shell + holiday calendar (shareable .json files)
    new Setting(container).setName("Templates").setHeading();
    container.createEl("p", {
      text: `Reusable setups saved as .json under "${this.plugin.plannerData.rootPlannerFolder || "Teacher Planner"}/Templates". A template holds the school shell only (including the year start/end dates as a starting point), never your classes, timetable, or notes. Share one by dropping its file into the matching folder.`,
      cls: "setting-item-description",
    });
    new Setting(container)
      .setName("School structure")
      .setDesc("Periods, block types, A/B pattern, school days and year dates.")
      .addButton(btn => btn.setButtonText("Save current…").onClick(() => this.saveStructureTemplate()))
      .addButton(btn => btn.setButtonText("Apply template…").onClick(() => this.applyStructureTemplateFlow()));
    new Setting(container)
      .setName("Holiday calendar")
      .setDesc("Holiday and INSET dates to drop in and nudge each year.")
      .addButton(btn => btn.setButtonText("Save current…").onClick(() => this.saveHolidayTemplate()))
      .addButton(btn => btn.setButtonText("Load template…").onClick(() => this.loadHolidayTemplateFlow()));

  }

  private wrapSectionsCollapsible(container: HTMLElement): void {
    const headings = Array.from(container.querySelectorAll<HTMLElement>(":scope > .setting-item-heading"));
    for (const heading of headings) {
      // Collect all direct siblings until the next heading
      const siblings: Element[] = [];
      let next = heading.nextElementSibling;
      while (next && !next.classList.contains("setting-item-heading")) {
        siblings.push(next);
        next = next.nextElementSibling;
      }

      // Wrap siblings in a collapsible content div (hidden by default)
      const content = container.createDiv("tp-collapsible-content");
      content.addClass("tp-section-collapsed");
      heading.after(content);
      for (const s of siblings) content.appendChild(s);

      // Add an SVG chevron at the start of the heading (crisp, scales, no clipping)
      const chevron = createSpan({ cls: "tp-collapsible-chevron" });
      setIcon(chevron, "chevron-right");
      heading.insertBefore(chevron, heading.firstChild);
      heading.addClass("tp-collapsible-header");

      heading.addEventListener("click", () => {
        const isOpen = !content.hasClass("tp-section-collapsed");
        content.toggleClass("tp-section-collapsed", isOpen);
        chevron.toggleClass("tp-collapsible-chevron--open", !isOpen);
      });
    }
  }

  // ── Mobile settings redesign (0.3.5) ──────────────────────────────────────
  // List sections collapse to compact summary rows that expand into labelled
  // editors when tapped. Mobile only — desktop keeps the always-visible rows.
  // Presentation-layer only: the same settings objects and save paths are used.

  /** The list item whose accordion editor is currently open. Object references
   *  survive in-place list rebuilds, so a row can be re-opened after its list
   *  re-renders (e.g. after a period start-time change re-sorts the list). */
  private _openAccItem: unknown = null;

  private renderMobileAccordion(
    container: HTMLElement,
    opts: {
      /** List item backing this row — used to restore open state across rebuilds. */
      item?: unknown;
      /** Builds the compact summary (dot / name / sub / badge). */
      summary: (el: HTMLElement) => void;
      /** Builds icon actions shown in the header only while open. */
      actions?: (el: HTMLElement) => void;
      /** Builds the labelled editor fields. */
      body: (el: HTMLElement) => void;
    },
  ): HTMLElement {
    const root = container.createDiv("tp-macc");
    const head = root.createDiv("tp-macc-head");
    const summaryEl = head.createDiv("tp-macc-summary");
    opts.summary(summaryEl);
    const actionsEl = head.createDiv("tp-macc-actions");
    if (opts.actions) opts.actions(actionsEl);
    const chev = head.createSpan({ cls: "tp-macc-chev" });
    setIcon(chev, "chevron-right");
    const bodyEl = root.createDiv("tp-macc-body");
    opts.body(bodyEl);
    if (opts.item != null && this._openAccItem === opts.item) root.addClass("tp-macc--open");
    head.addEventListener("click", (e) => {
      // Taps on the action buttons (or any control that ends up in the head)
      // must not toggle the row.
      if ((e.target as HTMLElement).closest(".tp-macc-actions, button, input, select")) return;
      const open = !root.hasClass("tp-macc--open");
      root.toggleClass("tp-macc--open", open);
      this._openAccItem = open ? (opts.item ?? null) : null;
    });
    return root;
  }

  private maccSummary(
    el: HTMLElement,
    o: { colour?: string; name: string; sub?: string; badge?: { text: string; cls: string } },
  ): MaccSummaryRefs {
    let dot: HTMLElement | null = null;
    if (o.colour !== undefined) {
      dot = el.createSpan("tp-macc-dot");
      dot.setCssStyles({ background: o.colour });
    }
    const text = el.createDiv("tp-macc-text");
    const nameEl = text.createDiv({ cls: "tp-macc-name", text: o.name });
    const subEl = text.createDiv({ cls: "tp-macc-sub", text: o.sub ?? "" });
    let badgeEl: HTMLElement | null = null;
    if (o.badge) badgeEl = el.createSpan({ cls: "tp-macc-badge " + o.badge.cls, text: o.badge.text });
    return { dot, nameEl, subEl, badgeEl };
  }

  /** Labelled field wrapper: small caps label above a full-width control. */
  private mField(host: HTMLElement, label: string): HTMLElement {
    const wrap = host.createDiv("tp-mfield");
    wrap.createDiv({ cls: "tp-mfield-label", text: label });
    return wrap;
  }

  /** Two labelled fields side by side (e.g. start/end times, from/to dates). */
  private mPair(host: HTMLElement): HTMLElement {
    return host.createDiv("tp-mpair");
  }

  private mIconBtn(host: HTMLElement, icon: string, title: string, onClick: () => void, danger = false): HTMLElement {
    const b = host.createEl("button", { cls: "tp-icon-btn" + (danger ? " tp-icon-btn--danger" : ""), title });
    setIcon(b, icon);
    b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  /** "12 Oct 2026" — human-readable date for summaries. Falls back to the raw ISO string. */
  private mFmtDate(iso: string): string {
    if (!iso) return "?";
    const d = new Date(iso + "T12:00:00");
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  /** "12–16 Oct 2026 · 5 days" — compact range with an inclusive day count. */
  private mFmtRange(fromIso: string, toIso?: string): string {
    const to = toIso ?? fromIso;
    const df = new Date(fromIso + "T12:00:00");
    const dt = new Date(to + "T12:00:00");
    if (isNaN(df.getTime()) || isNaN(dt.getTime())) return `${fromIso} – ${to}`;
    if (fromIso === to) return `${this.mFmtDate(fromIso)} · 1 day`;
    const days = Math.round((dt.getTime() - df.getTime()) / 86400000) + 1;
    let range: string;
    if (df.getFullYear() === dt.getFullYear() && df.getMonth() === dt.getMonth()) {
      range = `${df.getDate()}–${dt.getDate()} ${dt.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
    } else if (df.getFullYear() === dt.getFullYear()) {
      range = `${df.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${this.mFmtDate(to)}`;
    } else {
      range = `${this.mFmtDate(fromIso)} – ${this.mFmtDate(to)}`;
    }
    return `${range} · ${days} days`;
  }

  private renderPeriodRowMobile(container: HTMLElement, period: SchoolPeriod, index: number) {
    const types = this.plugin.settings.periodTypes ?? [];
    const typeLabel = () => types.find(t => t.id === period.type)?.label ?? period.type;
    const subOf = () => `${period.start} – ${period.end} · ${typeLabel()}`;
    let refs!: MaccSummaryRefs;
    this.renderMobileAccordion(container, {
      item: period,
      summary: el => { refs = this.maccSummary(el, { name: period.name, sub: subOf() }); },
      actions: el => {
        this.mIconBtn(el, "trash", "Remove", () => { void (async () => {
          this.getSelectedSchedule().periods.splice(index, 1);
          await this.plugin.saveSettings();
          container.empty(); this.renderPeriodsList(container);
        })(); }, true);
      },
      body: el => {
        const nameInput = this.mField(el, "Name").createEl("input", { type: "text" });
        nameInput.value = period.name;
        nameInput.placeholder = "Name";
        nameInput.addEventListener("blur", () => { void (async () => {
          period.name = nameInput.value;
          refs.nameEl.setText(period.name);
          await this.plugin.saveSettings();
        })(); });
        const pair = this.mPair(el);
        const startInput = this.mField(pair, "Starts").createEl("input", { type: "text" });
        startInput.value = period.start;
        startInput.placeholder = "HH:MM";
        const commitStart = async () => {
          if (startInput.value === period.start) return;
          period.start = startInput.value;
          this.sortPeriods();
          await this.plugin.saveSettings();
          // Re-render so the row moves to its sorted position; _openAccItem
          // keeps this period's editor open across the rebuild.
          container.empty();
          this.renderPeriodsList(container);
        };
        startInput.addEventListener("blur", () => { void commitStart(); });
        startInput.addEventListener("keydown", (e: KeyboardEvent) => { if (e.key === "Enter") startInput.blur(); });
        const endInput = this.mField(pair, "Ends").createEl("input", { type: "text" });
        endInput.value = period.end;
        endInput.placeholder = "HH:MM";
        endInput.addEventListener("blur", () => { void (async () => {
          period.end = endInput.value;
          refs.subEl.setText(subOf());
          await this.plugin.saveSettings();
        })(); });
        const typeSel = this.mField(el, "Block type").createEl("select");
        if (types.length === 0) {
          for (const [v, l] of [["lesson", "Lesson"], ["break", "Break"], ["registration", "Registration"], ["free", "Free"]] as [string, string][]) {
            const opt = typeSel.createEl("option", { text: l, value: v });
            if (period.type === v) opt.selected = true;
          }
        } else {
          for (const pt of types) {
            const opt = typeSel.createEl("option", { text: pt.label, value: pt.id });
            if (period.type === pt.id) opt.selected = true;
          }
        }
        typeSel.addEventListener("change", () => { void (async () => {
          period.type = typeSel.value;
          refs.subEl.setText(subOf());
          await this.plugin.saveSettings();
        })(); });
      },
    });
  }

  private renderClassRowMobile(container: HTMLElement, cls: ClassGroup, subject: Subject, parentContainer: HTMLElement, isArchived: boolean) {
    const subOf = () => [cls.year, cls.classroom].filter(s => s && s.trim()).join(" · ");
    let refs!: MaccSummaryRefs;
    const row = this.renderMobileAccordion(container, {
      item: cls,
      summary: el => { refs = this.maccSummary(el, { colour: cls.colour, name: cls.code, sub: subOf() }); },
      actions: el => {
        this.mIconBtn(el, isArchived ? "rotate-ccw" : "archive", isArchived ? "Restore class" : "Archive class (hides from timetable editor)", () => { void (async () => {
          cls.archived = !isArchived;
          await this.plugin.saveSettings();
          parentContainer.empty(); this.renderSubjectsList(parentContainer);
        })(); });
        this.mIconBtn(el, "trash-2", "Delete class", () => confirmDelete(this.plugin, `Delete class "${cls.code}"? It is removed from the timetable too.`, async () => {
          this.plugin.settings.classes = this.plugin.settings.classes.filter(c => c.id !== cls.id);
          this.plugin.settings.timetable = this.plugin.settings.timetable.filter(t => t.classId !== cls.id);
          await this.plugin.saveSettings();
          parentContainer.empty(); this.renderSubjectsList(parentContainer);
        }), true);
      },
      body: el => {
        const pair = this.mPair(el);
        const yearInput = this.mField(pair, "Year").createEl("input", { type: "text" });
        yearInput.value = cls.year ?? "";
        yearInput.placeholder = "e.g. Y12";
        yearInput.addEventListener("change", () => { void (async () => {
          cls.year = yearInput.value;
          refs.subEl.setText(subOf());
          await this.plugin.saveSettings();
        })(); });
        const codeInput = this.mField(pair, "Class code").createEl("input", { type: "text" });
        codeInput.value = cls.code;
        codeInput.placeholder = "e.g. IB DP1";
        codeInput.addEventListener("change", () => { void (async () => {
          cls.code = codeInput.value;
          refs.nameEl.setText(cls.code);
          await this.plugin.saveSettings();
        })(); });
        const roomInput = this.mField(el, "Classroom").createEl("input", { type: "text" });
        roomInput.value = cls.classroom ?? "";
        roomInput.placeholder = "Optional";
        roomInput.addEventListener("change", () => { void (async () => {
          cls.classroom = roomInput.value;
          refs.subEl.setText(subOf());
          await this.plugin.saveSettings();
        })(); });
        const crow = this.mField(el, "Colour").createDiv("tp-mcolour-row");
        const swatch = crow.createEl("button", { cls: "tp-colour-swatch-btn tp-colour-swatch-btn--small" });
        swatch.setCssStyles({ background: cls.colour });
        swatch.title = "Override class colour";
        const resetBtn = crow.createEl("button", { cls: "tp-btn", text: "Use subject colour" });
        resetBtn.setCssStyles({ display: cls.colourOverridden && !isArchived ? "" : "none" });
        swatch.addEventListener("click", () => {
          new ColourPickerModal(this.app, cls.colour, cls.code, async colour => {
            cls.colour = colour;
            cls.colourOverridden = colour !== subject.colour;
            await this.plugin.saveSettings();
            swatch.setCssStyles({ background: colour });
            refs.dot?.setCssStyles({ background: colour });
            resetBtn.setCssStyles({ display: cls.colourOverridden && !isArchived ? "" : "none" });
          }).open();
        });
        resetBtn.addEventListener("click", () => { void (async () => {
          cls.colour = subject.colour ?? CLASS_COLOUR_PALETTE[0];
          cls.colourOverridden = false;
          await this.plugin.saveSettings();
          swatch.setCssStyles({ background: cls.colour });
          refs.dot?.setCssStyles({ background: cls.colour });
          resetBtn.setCssStyles({ display: "none" });
        })(); });
      },
    });
    if (isArchived) row.setCssStyles({ opacity: "0.5" });
  }

  private renderActivityRowMobile(
    container: HTMLElement,
    activity: Activity,
    isArchived: boolean,
    outerContainer: HTMLElement,
    typeFilter: "directed" | "other",
  ) {
    const subOf = () => [activity.info, activity.classroom].filter(s => s && s.trim()).join(" · ");
    let refs!: MaccSummaryRefs;
    const row = this.renderMobileAccordion(container, {
      item: activity,
      summary: el => { refs = this.maccSummary(el, { colour: activity.colour, name: activity.label, sub: subOf() }); },
      actions: el => {
        this.mIconBtn(el, isArchived ? "rotate-ccw" : "archive", isArchived ? "Restore" : "Archive (hides from timetable editor)", () => { void (async () => {
          activity.archived = !isArchived;
          await this.plugin.saveSettings();
          outerContainer.empty(); this.renderActivitiesList(outerContainer, typeFilter);
        })(); });
        this.mIconBtn(el, "trash-2", "Delete", () => confirmDelete(this.plugin, `Delete "${activity.label}"?`, async () => {
          this.plugin.settings.activities = this.plugin.settings.activities.filter(a => a.id !== activity.id);
          await this.plugin.saveSettings();
          outerContainer.empty(); this.renderActivitiesList(outerContainer, typeFilter);
        }), true);
      },
      body: el => {
        const nameInput = this.mField(el, "Name").createEl("input", { type: "text" });
        nameInput.value = activity.label;
        nameInput.placeholder = "Activity name";
        nameInput.addEventListener("change", () => { void (async () => {
          activity.label = nameInput.value;
          refs.nameEl.setText(activity.label);
          await this.plugin.saveSettings();
        })(); });
        const pair = this.mPair(el);
        const infoInput = this.mField(pair, "Info").createEl("input", { type: "text" });
        infoInput.value = activity.info ?? "";
        infoInput.placeholder = "Optional";
        infoInput.addEventListener("change", () => { void (async () => {
          activity.info = infoInput.value;
          refs.subEl.setText(subOf());
          await this.plugin.saveSettings();
        })(); });
        const roomInput = this.mField(pair, "Classroom").createEl("input", { type: "text" });
        roomInput.value = activity.classroom ?? "";
        roomInput.placeholder = "Optional";
        roomInput.addEventListener("change", () => { void (async () => {
          activity.classroom = roomInput.value;
          refs.subEl.setText(subOf());
          await this.plugin.saveSettings();
        })(); });
        const crow = this.mField(el, "Colour").createDiv("tp-mcolour-row");
        const swatch = crow.createEl("button", { cls: "tp-colour-swatch-btn tp-colour-swatch-btn--small" });
        swatch.setCssStyles({ background: activity.colour });
        swatch.addEventListener("click", () => {
          new ColourPickerModal(this.app, activity.colour, activity.label, async colour => {
            activity.colour = colour;
            await this.plugin.saveSettings();
            swatch.setCssStyles({ background: colour });
            refs.dot?.setCssStyles({ background: colour });
          }).open();
        });
      },
    });
    if (isArchived) row.setCssStyles({ opacity: "0.5" });
  }

  private renderPeriodTypeRowMobile(container: HTMLElement, pt: PeriodTypeConfig) {
    let refs!: MaccSummaryRefs;
    this.renderMobileAccordion(container, {
      item: pt,
      summary: el => { refs = this.maccSummary(el, { colour: resolveColour(pt.colour), name: pt.label }); },
      actions: el => {
        this.mIconBtn(el, "trash-2", "Delete type", () => confirmDelete(this.plugin, `Delete block type "${pt.label}"?`, async () => {
          this.plugin.settings.periodTypes = this.plugin.settings.periodTypes.filter(t => t.id !== pt.id);
          await this.plugin.saveSettings();
          container.empty(); this.renderPeriodTypesList(container);
        }), true);
      },
      body: el => {
        const nameInput = this.mField(el, "Name").createEl("input", { type: "text" });
        nameInput.value = pt.label;
        nameInput.placeholder = "Type name";
        nameInput.addEventListener("change", () => { void (async () => {
          pt.label = nameInput.value;
          refs.nameEl.setText(pt.label);
          await this.plugin.saveSettings();
        })(); });
        const crow = this.mField(el, "Colour").createDiv("tp-mcolour-row");
        const swatch = crow.createEl("button", { cls: "tp-colour-swatch-btn tp-colour-swatch-btn--small" });
        swatch.setCssStyles({ background: resolveColour(pt.colour) });
        swatch.title = isThemeToken(pt.colour) ? "Following your Obsidian theme" : "Custom colour";
        const resetBtn = crow.createEl("button", { cls: "tp-btn", text: "Reset to theme" });
        swatch.addEventListener("click", () => {
          new ColourPickerModal(this.app, pt.colour, pt.label, async colour => {
            pt.colour = colour;
            await this.plugin.saveSettings();
            swatch.setCssStyles({ background: resolveColour(colour) });
            swatch.title = isThemeToken(colour) ? "Following your Obsidian theme" : "Custom colour";
            refs.dot?.setCssStyles({ background: resolveColour(colour) });
          }, true).open();
        });
        resetBtn.addEventListener("click", () => { void (async () => {
          pt.colour = DEFAULT_PERIOD_TYPE_COLOURS[pt.id] ?? FALLBACK_PERIOD_TYPE_COLOUR;
          await this.plugin.saveSettings();
          swatch.setCssStyles({ background: resolveColour(pt.colour) });
          swatch.title = "Following your Obsidian theme";
          refs.dot?.setCssStyles({ background: resolveColour(pt.colour) });
        })(); });
      },
    });
  }

  private renderWeekOverrideRowMobile(container: HTMLElement, override: WeekOverride) {
    const isInset = () => override.type === "inset";
    const nameOf = () => (override.label ?? "").trim() || (isInset() ? "INSET" : "Holiday");
    let refs!: MaccSummaryRefs;
    const setBadge = () => {
      if (!refs.badgeEl) return;
      refs.badgeEl.setText(isInset() ? "INSET" : "Holiday");
      refs.badgeEl.className = "tp-macc-badge " + (isInset() ? "tp-macc-badge--inset" : "tp-macc-badge--holiday");
    };
    this.renderMobileAccordion(container, {
      item: override,
      summary: el => {
        refs = this.maccSummary(el, {
          name: nameOf(),
          sub: this.mFmtRange(override.startDate, override.endDate),
          badge: {
            text: isInset() ? "INSET" : "Holiday",
            cls: isInset() ? "tp-macc-badge--inset" : "tp-macc-badge--holiday",
          },
        });
      },
      actions: el => {
        this.mIconBtn(el, "trash", "Remove", () => { void (async () => {
          this.plugin.settings.weekOverrides = this.plugin.settings.weekOverrides.filter(w => w !== override);
          await this.plugin.saveSettings();
          el.closest(".tp-macc")?.remove();
          if (this.plugin.settings.weekOverrides.length === 0) {
            container.createEl("p", { text: "No holidays or INSET days marked.", cls: "setting-item-description" });
          }
        })(); }, true);
      },
      body: el => {
        const pair = this.mPair(el);
        const fromInput = this.mField(pair, "From").createEl("input", { type: "date" });
        fromInput.value = override.startDate;
        const toInput = this.mField(pair, "To").createEl("input", { type: "date" });
        toInput.value = override.endDate ?? override.startDate;
        fromInput.addEventListener("change", () => { void (async () => {
          override.startDate = fromInput.value;
          if (override.endDate && override.endDate < override.startDate) {
            override.endDate = override.startDate;
            toInput.value = override.startDate;
          }
          refs.subEl.setText(this.mFmtRange(override.startDate, override.endDate));
          await this.plugin.saveSettings();
          this.warnIfOverridesOverlap();
        })(); });
        toInput.addEventListener("change", () => { void (async () => {
          const val = toInput.value;
          override.endDate = val === override.startDate ? undefined : val;
          refs.subEl.setText(this.mFmtRange(override.startDate, override.endDate));
          await this.plugin.saveSettings();
          this.warnIfOverridesOverlap();
        })(); });

        const seg = this.mField(el, "Type").createDiv("tp-mseg");
        const holBtn = seg.createEl("button", { text: "Holiday" });
        const insBtn = seg.createEl("button", { text: "INSET" });
        const dtEnabled = () => this.plugin.settings.directedTime?.enabled ?? false;
        const syncType = () => {
          holBtn.toggleClass("tp-mseg--on", !isInset());
          insBtn.toggleClass("tp-mseg--on", isInset());
          hoursField.setCssStyles({ display: isInset() && dtEnabled() ? "" : "none" });
          refs.nameEl.setText(nameOf());
          setBadge();
        };
        const setType = (t: "holiday" | "inset") => { void (async () => {
          if (override.type === t) return;
          override.type = t;
          syncType();
          await this.plugin.saveSettings();
        })(); };
        holBtn.addEventListener("click", () => setType("holiday"));
        insBtn.addEventListener("click", () => setType("inset"));

        const nameInput = this.mField(el, "Name").createEl("input", { type: "text" });
        nameInput.value = override.label ?? "";
        nameInput.placeholder = "e.g. Christmas";
        nameInput.addEventListener("change", () => { void (async () => {
          override.label = nameInput.value;
          refs.nameEl.setText(nameOf());
          await this.plugin.saveSettings();
        })(); });

        const hoursField = this.mField(el, "Directed hours for this period");
        const hoursInput = hoursField.createEl("input", { type: "number" });
        hoursInput.placeholder = "0"; hoursInput.min = "0"; hoursInput.max = "80"; hoursInput.step = "0.5";
        hoursInput.title = "Total directed hours for this entire INSET period";
        hoursInput.value = override.insetHours != null ? String(override.insetHours) : "";
        hoursInput.addEventListener("change", () => { void (async () => {
          const n = parseFloat(hoursInput.value);
          override.insetHours = isNaN(n) || n <= 0 ? undefined : n;
          await this.plugin.saveSettings();
        })(); });
        syncType();
      },
    });
  }

  private sortPeriods() {
    this.getSelectedSchedule().periods.sort((a, b) => a.start.localeCompare(b.start));
  }

  private renderPeriodsList(container: HTMLElement) {
    const periods = this.getSelectedSchedule().periods;
    if (periods.length === 0) {
      container.createEl("p", { text: "No periods defined.", cls: "setting-item-description" });
      return;
    }
    this.sortPeriods();
    for (let i = 0; i < periods.length; i++) this.renderPeriodRow(container, periods[i], i);
  }

  private renderPeriodRow(container: HTMLElement, period: SchoolPeriod, index: number) {
    if (Platform.isMobile) { this.renderPeriodRowMobile(container, period, index); return; }
    new Setting(container)
      .setName(period.name).setDesc(`${period.start} - ${period.end}`)
      .addText(t => {
        t.setPlaceholder("Name").setValue(period.name);
        t.inputEl.addEventListener("blur", () => { void (async () => {
          period.name = t.inputEl.value;
          await this.plugin.saveSettings();
        })(); });
      })
      .addText(t => {
        t.setPlaceholder("HH:MM").setValue(period.start);
        const commitStart = async () => {
          period.start = t.inputEl.value;
          this.sortPeriods();
          await this.plugin.saveSettings();
          container.empty();
          this.renderPeriodsList(container);
        };
        t.inputEl.addEventListener("blur", () => { void commitStart(); });
        t.inputEl.addEventListener("keydown", (e: KeyboardEvent) => { if (e.key === "Enter") t.inputEl.blur(); });
      })
      .addText(t => {
        t.setPlaceholder("HH:MM").setValue(period.end);
        t.inputEl.addEventListener("blur", () => { void (async () => {
          period.end = t.inputEl.value;
          await this.plugin.saveSettings();
        })(); });
      })
      .addDropdown(d => {
        const types = this.plugin.settings.periodTypes ?? [];
        if (types.length === 0) {
          d.addOption("lesson","Lesson").addOption("break","Break").addOption("registration","Registration").addOption("free","Free");
        } else {
          for (const pt of types) d.addOption(pt.id, pt.label);
        }
        d.setValue(period.type).onChange(async (v: string) => { period.type = v; await this.plugin.saveSettings(); });
      })
      .addExtraButton(btn => btn.setIcon("trash").setTooltip("Remove").onClick(async () => {
        this.getSelectedSchedule().periods.splice(index, 1);
        await this.plugin.saveSettings();
        container.empty(); this.renderPeriodsList(container);
      }));
  }

  private renderSubjectsList(container: HTMLElement) {
    const { subjects, classes } = this.plugin.settings;
    if (subjects.length === 0) {
      container.createEl("p", { text: "No subjects yet. Click '+ Add subject' to start.", cls: "setting-item-description" });
      return;
    }
    const sorted = [...subjects].sort((a, b) => a.name.localeCompare(b.name));
    for (const subject of sorted) {
      const subjectClasses = classes.filter(c => c.subjectId === subject.id);
      this.renderSubjectBlock(container, subject, subjectClasses);
    }
  }

  private renderSubjectBlock(container: HTMLElement, subject: Subject, subjectClasses: ClassGroup[]) {
    const activeClasses   = subjectClasses.filter(c => !c.archived);
    const archivedClasses = subjectClasses.filter(c => !!c.archived);

    const block = container.createDiv("tp-subject-block");
    const header = block.createDiv("tp-subject-header");

    const emojiBtn = header.createEl("button", { cls: "tp-emoji-picker-btn", text: subject.emoji ?? "📚" });
    emojiBtn.title = "Change subject emoji";
    emojiBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openEmojiPicker(emojiBtn, subject.emoji ?? "📚", (emoji) => { void (async () => {
        subject.emoji = emoji;
        await this.plugin.saveSettings();
        emojiBtn.textContent = emoji;
      })(); });
    });

    const nameInput = header.createEl("input", { type: "text", cls: "tp-subject-name-input" });
    nameInput.value = subject.name;
    nameInput.placeholder = "Subject name";
    nameInput.addEventListener("change", () => { void (async () => { subject.name = nameInput.value; await this.plugin.saveSettings(); })(); });

    const addClassBtn = header.createEl("button", { text: "+ Class", cls: "tp-btn-small tp-btn-small--cta" });
    addClassBtn.addEventListener("click", () => { void (async () => {
      this.plugin.settings.classes.push({
        id: `cls-${Date.now()}`, year: "", code: "NEW 00",
        subjectId: subject.id, colour: subject.colour ?? CLASS_COLOUR_PALETTE[0], colourOverridden: false, lessonCount: 0,
      });
      await this.plugin.saveSettings();
      container.empty(); this.renderSubjectsList(container);
    })(); });

    const delSubjectBtn = header.createEl("button", { cls: "tp-icon-btn" });
    setIcon(delSubjectBtn, "trash-2");
    delSubjectBtn.title = "Delete subject and all its classes";
    delSubjectBtn.addEventListener("click", () => confirmDelete(this.plugin, `Delete subject "${subject.name}" and all its classes? Lessons for those classes are removed from the timetable.`, async () => {
      this.plugin.settings.subjects = this.plugin.settings.subjects.filter(s => s.id !== subject.id);
      this.plugin.settings.classes = this.plugin.settings.classes.filter(c => c.subjectId !== subject.id);
      this.plugin.settings.timetable = this.plugin.settings.timetable.filter(
        t => !subjectClasses.map(c => c.id).includes(t.classId)
      );
      await this.plugin.saveSettings();
      container.empty(); this.renderSubjectsList(container);
    }));

    if (activeClasses.length > 0) {
      const classesEl = block.createDiv("tp-class-rows");
      for (const cls of activeClasses) this.renderClassRow(classesEl, cls, subject, container, false);
    }

    if (archivedClasses.length > 0) {
      const archivedSection = block.createDiv("tp-archived-mini");
      const toggleBtn = archivedSection.createEl("button", {
        text: `↓ ${archivedClasses.length} archived`,
        cls: "tp-archived-toggle-small",
      });
      const archivedList = archivedSection.createDiv("tp-class-rows");
      archivedList.setCssStyles({ display: "none" });
      toggleBtn.addEventListener("click", () => {
        const hidden = archivedList.style.display === "none";
        archivedList.setCssStyles({ display: hidden ? "block" : "none" });
        toggleBtn.textContent = hidden
          ? `↑ ${archivedClasses.length} archived`
          : `↓ ${archivedClasses.length} archived`;
      });
      for (const cls of archivedClasses) this.renderClassRow(archivedList, cls, subject, container, true);
    }
  }

  private renderClassRow(container: HTMLElement, cls: ClassGroup, subject: Subject, parentContainer: HTMLElement, isArchived: boolean = false) {
    if (Platform.isMobile) { this.renderClassRowMobile(container, cls, subject, parentContainer, isArchived); return; }
    const row = container.createDiv("tp-class-row");
    if (isArchived) row.setCssStyles({ opacity: "0.5" });

    const swatchBtn = row.createEl("button", { cls: "tp-colour-swatch-btn tp-colour-swatch-btn--small" });
    swatchBtn.setCssStyles({ background: cls.colour });
    swatchBtn.title = "Override class colour";
    swatchBtn.addEventListener("click", () => {
      new ColourPickerModal(this.app, cls.colour, cls.code, async colour => {
        cls.colour = colour;
        cls.colourOverridden = colour !== subject.colour;
        await this.plugin.saveSettings();
        swatchBtn.setCssStyles({ background: colour });
      }).open();
    });

    const yearInput = row.createEl("input", { type: "text", cls: "tp-year-input" });
    yearInput.value = cls.year ?? "";
    yearInput.placeholder = "Year (e.g. Y12)";
    yearInput.addEventListener("change", () => { void (async () => { cls.year = yearInput.value; await this.plugin.saveSettings(); })(); });

    const codeInput = row.createEl("input", { type: "text", cls: "tp-class-code-input" });
    codeInput.value = cls.code;
    codeInput.placeholder = "Class code (e.g. IB DP1)";
    codeInput.addEventListener("change", () => { void (async () => { cls.code = codeInput.value; await this.plugin.saveSettings(); })(); });

    const classroomInput = row.createEl("input", { type: "text", cls: "tp-class-code-input" });
    classroomInput.value = cls.classroom ?? "";
    classroomInput.placeholder = "Classroom";
    classroomInput.setCssStyles({ opacity: "0.7" });
    classroomInput.addEventListener("change", () => { void (async () => { cls.classroom = classroomInput.value; await this.plugin.saveSettings(); })(); });

    if (cls.colourOverridden && !isArchived) {
      const resetBtn = row.createEl("button", { cls: "tp-icon-btn", title: "Reset to subject colour" });
      setIcon(resetBtn, "rotate-ccw");
      resetBtn.addEventListener("click", () => { void (async () => {
        cls.colour = subject.colour ?? CLASS_COLOUR_PALETTE[0]; cls.colourOverridden = false;
        await this.plugin.saveSettings();
        parentContainer.empty(); this.renderSubjectsList(parentContainer);
      })(); });
    }

    const archiveBtn = row.createEl("button", {
      cls: "tp-icon-btn",
      title: isArchived ? "Restore class" : "Archive class (hides from timetable editor)",
    });
    setIcon(archiveBtn, isArchived ? "rotate-ccw" : "archive");
    archiveBtn.addEventListener("click", () => { void (async () => {
      cls.archived = !isArchived;
      await this.plugin.saveSettings();
      parentContainer.empty(); this.renderSubjectsList(parentContainer);
    })(); });

    const delBtn = row.createEl("button", { cls: "tp-icon-btn", title: "Delete class" });
    setIcon(delBtn, "trash-2");
    delBtn.addEventListener("click", () => confirmDelete(this.plugin, `Delete class "${cls.code}"? It is removed from the timetable too.`, async () => {
      this.plugin.settings.classes = this.plugin.settings.classes.filter(c => c.id !== cls.id);
      this.plugin.settings.timetable = this.plugin.settings.timetable.filter(t => t.classId !== cls.id);
      await this.plugin.saveSettings();
      parentContainer.empty(); this.renderSubjectsList(parentContainer);
    }));
  }

  /**
   * Render a filtered list of activities.
   * typeFilter "directed" shows activities where activityType !== "other" (includes undefined).
   * typeFilter "other" shows activities where activityType === "other".
   */
  private saveStructureTemplate() {
    new TextPromptModal(this.app, "Save school structure template", "", "Template name (e.g. School main)", (name) => { void (async () => {
      const n = name.trim(); if (!n) return;
      try { const path = await writeTemplateFile(this.plugin, "structure", n, buildStructureTemplate(this.plugin, n)); new Notice(`Saved structure template to ${path}`); }
      catch (e) { console.error("Teacher Planner: save structure template failed.", e); new Notice("Could not save template — see console."); }
    })(); }).open();
  }

  private saveHolidayTemplate() {
    if (holidayCount(this.plugin) === 0) { new Notice("No holidays or INSET days to save yet."); return; }
    new TextPromptModal(this.app, "Save holiday calendar template", "", "Template name (e.g. 2026-27 holidays)", (name) => { void (async () => {
      const n = name.trim(); if (!n) return;
      try { const path = await writeTemplateFile(this.plugin, "holidays", n, buildHolidayTemplate(this.plugin, n)); new Notice(`Saved holiday template to ${path}`); }
      catch (e) { console.error("Teacher Planner: save holiday template failed.", e); new Notice("Could not save template — see console."); }
    })(); }).open();
  }

  private applyStructureTemplateFlow() {
    void (async () => {
    const files = await listTemplateFiles(this.plugin, "structure");
    if (files.length === 0) { new Notice(`No structure templates in "${structureTemplatesFolder(this.plugin)}".`); return; }
    new TemplatePickModal(this.app, files, "Pick a school structure template…", (file) => { void (async () => {
      let tpl: ParsedTemplate;
      try { tpl = parseTemplate(await readTemplateText(this.plugin, file.path)); }
      catch (e) { new Notice(e instanceof Error ? e.message : "Could not read template."); return; }
      if (tpl.kind !== "structure" || !tpl.structure) { new Notice("That file is not a school structure template."); return; }
      const structure = tpl.structure;
      new ConfirmModal(this.app,
        "Apply this school structure to the current planner? It replaces your periods, block types, A/B pattern and school days. It also sets the year start/end dates from the template (nudge them afterwards). Any classes already placed on the timetable will be detached, since their slots point at the old periods. Your classes and notes are kept.",
        () => { void (async () => {
          try { await applyStructureTemplate(this.plugin, structure); new Notice("School structure applied."); this.render(); }
          catch (e) { console.error("Teacher Planner: apply structure failed.", e); new Notice("Could not apply template — see console."); }
        })(); },
        "Apply structure").open();
    })(); }).open();
    })();
  }

  private loadHolidayTemplateFlow() {
    void (async () => {
    const files = await listTemplateFiles(this.plugin, "holidays");
    if (files.length === 0) { new Notice(`No holiday templates in "${holidayTemplatesFolder(this.plugin)}".`); return; }
    new TemplatePickModal(this.app, files, "Pick a holiday calendar template…", (file) => { void (async () => {
      let tpl: ParsedTemplate;
      try { tpl = parseTemplate(await readTemplateText(this.plugin, file.path)); }
      catch (e) { new Notice(e instanceof Error ? e.message : "Could not read template."); return; }
      if (tpl.kind !== "holidays" || !tpl.holidays) { new Notice("That file is not a holiday calendar template."); return; }
      const holidays = tpl.holidays;
      new TextPromptModal(this.app, "Shift dates (optional)", "0", "Days to shift (364 ≈ next year, 0 to keep as saved)", (val) => { void (async () => {
        const days = parseInt(val); const d = isNaN(days) ? 0 : days;
        const overrides = d !== 0 ? shiftOverrideDates(holidays.overrides, d) : holidays.overrides;
        const n = await applyHolidayTemplate(this.plugin, { overrides });
        new Notice(`Added ${n} holiday/INSET ${n === 1 ? "entry" : "entries"}. Fine-tune dates in the Academic year settings.`);
        this.render();
      })(); }).open();
    })(); }).open();
    })();
  }

  private importBackupFromLibrary() {
    void (async () => {
      const files = await listLibraryBackups(this.plugin);
      if (files.length === 0) { new Notice("No saved backups in the plugin library yet."); return; }
      new BackupPickModal(this.app, this.plugin, files, () => this.render()).open();
    })();
  }

  private importBackupFromFile() {
    void (async () => {
      const path = await openOSFilePicker("Choose a backup .json");
      if (!path) return;
      try {
        const { planners } = parseBackup(await readSystemFile(path));
        const ids = await importPlanners(this.plugin, planners);
        new Notice(`Imported ${planners.length} planner${planners.length === 1 ? "" : "s"}.`);
        if (ids[0]) await this.plugin.switchPlanner(ids[0]);
        this.render();
      } catch (e) { new Notice(`Import failed: ${(e as Error).message ?? "see console"}`); }
    })();
  }

  private renderActivitiesList(container: HTMLElement, typeFilter: "directed" | "other" = "directed") {
    const activities = this.plugin.settings.activities ?? [];
    const matchType = (a: Activity) =>
      typeFilter === "other" ? a.activityType === "other" : a.activityType !== "other";

    const filtered = activities.filter(matchType);
    const active   = filtered.filter(a => !a.archived);
    const archived = filtered.filter(a => !!a.archived);

    if (active.length === 0 && archived.length === 0) {
      container.createEl("p", {
        text: typeFilter === "other" ? "No other events defined." : "No directed time activities defined.",
        cls: "setting-item-description"
      });
      return;
    }

    const activeSorted = [...active].sort((a, b) => a.label.localeCompare(b.label));
    for (const activity of activeSorted) this.renderActivityRow(container, activity, false, container, typeFilter);

    if (archived.length > 0) {
      const archivedSection = container.createDiv("tp-archived-mini");
      archivedSection.setCssStyles({ marginTop: "8px" });
      const toggleBtn = archivedSection.createEl("button", {
        text: `↓ ${archived.length} archived`,
        cls: "tp-archived-toggle-small",
      });
      const archivedList = archivedSection.createDiv();
      archivedList.setCssStyles({ display: "none" });
      toggleBtn.addEventListener("click", () => {
        const hidden = archivedList.style.display === "none";
        archivedList.setCssStyles({ display: hidden ? "block" : "none" });
        toggleBtn.textContent = hidden
          ? `↑ ${archived.length} archived`
          : `↓ ${archived.length} archived`;
      });
      const archivedSorted = [...archived].sort((a, b) => a.label.localeCompare(b.label));
      for (const activity of archivedSorted) this.renderActivityRow(archivedList, activity, true, container, typeFilter);
    }
  }

  private renderActivityRow(
    container: HTMLElement,
    activity: Activity,
    isArchived: boolean = false,
    outerContainer: HTMLElement = container,
    typeFilter: "directed" | "other" = "directed",
  ) {
    if (Platform.isMobile) { this.renderActivityRowMobile(container, activity, isArchived, outerContainer, typeFilter); return; }
    const row = container.createDiv("tp-activity-row");
    if (isArchived) row.setCssStyles({ opacity: "0.5" });

    const swatchBtn = row.createEl("button", { cls: "tp-colour-swatch-btn tp-colour-swatch-btn--small" });
    swatchBtn.setCssStyles({ background: activity.colour });
    swatchBtn.addEventListener("click", () => {
      new ColourPickerModal(this.app, activity.colour, activity.label, async colour => {
        activity.colour = colour;
        await this.plugin.saveSettings();
        swatchBtn.setCssStyles({ background: colour });
      }).open();
    });

    const labelInput = row.createEl("input", { type: "text", cls: "tp-class-code-input" });
    labelInput.value = activity.label;
    labelInput.placeholder = "Activity name";
    labelInput.addEventListener("change", () => { void (async () => { activity.label = labelInput.value; await this.plugin.saveSettings(); })(); });

    const infoInput = row.createEl("input", { type: "text", cls: "tp-class-code-input" });
    infoInput.value = activity.info ?? "";
    infoInput.placeholder = "Info";
    infoInput.setCssStyles({ opacity: "0.7" });
    infoInput.addEventListener("change", () => { void (async () => { activity.info = infoInput.value; await this.plugin.saveSettings(); })(); });

    const classroomInputAct = row.createEl("input", { type: "text", cls: "tp-class-code-input" });
    classroomInputAct.value = activity.classroom ?? "";
    classroomInputAct.placeholder = "Classroom";
    classroomInputAct.setCssStyles({ opacity: "0.7" });
    classroomInputAct.addEventListener("change", () => { void (async () => { activity.classroom = classroomInputAct.value; await this.plugin.saveSettings(); })(); });

    const archiveBtn = row.createEl("button", {
      cls: "tp-icon-btn",
      title: isArchived ? "Restore" : "Archive (hides from timetable editor)",
    });
    setIcon(archiveBtn, isArchived ? "rotate-ccw" : "archive");
    archiveBtn.addEventListener("click", () => { void (async () => {
      activity.archived = !isArchived;
      await this.plugin.saveSettings();
      outerContainer.empty(); this.renderActivitiesList(outerContainer, typeFilter);
    })(); });

    const delBtn = row.createEl("button", { cls: "tp-icon-btn", title: "Delete" });
    setIcon(delBtn, "trash-2");
    delBtn.addEventListener("click", () => confirmDelete(this.plugin, `Delete "${activity.label}"?`, async () => {
      this.plugin.settings.activities = this.plugin.settings.activities.filter(a => a.id !== activity.id);
      await this.plugin.saveSettings();
      outerContainer.empty(); this.renderActivitiesList(outerContainer, typeFilter);
    }));
  }

  private renderPeriodTypesList(container: HTMLElement) {
    const types = this.plugin.settings.periodTypes ?? [];
    if (types.length === 0) {
      container.createEl("p", { text: "No block types defined.", cls: "setting-item-description" });
      return;
    }
    for (const pt of types) this.renderPeriodTypeRow(container, pt);
  }

  private renderPeriodTypeRow(container: HTMLElement, pt: PeriodTypeConfig) {
    if (Platform.isMobile) { this.renderPeriodTypeRowMobile(container, pt); return; }
    const row = container.createDiv("tp-activity-row");
    const swatchBtn = row.createEl("button", { cls: "tp-colour-swatch-btn tp-colour-swatch-btn--small" });
    swatchBtn.setCssStyles({ background: resolveColour(pt.colour) });
    swatchBtn.title = isThemeToken(pt.colour) ? "Following your Obsidian theme" : "Custom colour";
    swatchBtn.addEventListener("click", () => {
      new ColourPickerModal(this.app, pt.colour, pt.label, async colour => {
        pt.colour = colour;
        await this.plugin.saveSettings();
        swatchBtn.setCssStyles({ background: resolveColour(colour) });
        swatchBtn.title = isThemeToken(colour) ? "Following your Obsidian theme" : "Custom colour";
      }, true).open();
    });
    const labelInput = row.createEl("input", { type: "text", cls: "tp-class-code-input" });
    labelInput.value = pt.label;
    labelInput.placeholder = "Type name";
    labelInput.addEventListener("change", () => { void (async () => { pt.label = labelInput.value; await this.plugin.saveSettings(); })(); });
    const resetBtn = row.createEl("button", { cls: "tp-icon-btn", title: "Reset colour to theme default" });
    setIcon(resetBtn, "rotate-ccw");
    resetBtn.addEventListener("click", () => { void (async () => {
      pt.colour = DEFAULT_PERIOD_TYPE_COLOURS[pt.id] ?? FALLBACK_PERIOD_TYPE_COLOUR;
      await this.plugin.saveSettings();
      swatchBtn.setCssStyles({ background: resolveColour(pt.colour) });
      swatchBtn.title = "Following your Obsidian theme";
    })(); });
    const delBtn = row.createEl("button", { cls: "tp-icon-btn", title: "Delete type" });
    setIcon(delBtn, "trash-2");
    delBtn.addEventListener("click", () => confirmDelete(this.plugin, `Delete block type "${pt.label}"?`, async () => {
      this.plugin.settings.periodTypes = this.plugin.settings.periodTypes.filter(t => t.id !== pt.id);
      await this.plugin.saveSettings();
      container.empty(); this.renderPeriodTypesList(container);
    }));
  }

  private getMondayStr(date: Date): string {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d.toISOString().split("T")[0];
  }

  private renderWeekOverridesList(container: HTMLElement) {
    const { weekOverrides } = this.plugin.settings;
    if (weekOverrides.length === 0) {
      container.createEl("p", { text: "No holidays or INSET days marked.", cls: "setting-item-description" });
      return;
    }
    const sorted = [...weekOverrides].sort((a, b) => a.startDate.localeCompare(b.startDate));
    for (const override of sorted) this.renderWeekOverrideRow(container, override);
  }

  /** Warn (non-blocking) if any holiday/INSET ranges overlap — overlaps skew directed time. */
  private warnIfOverridesOverlap() {
    const overlap = findOverlappingOverrides(this.plugin.settings.weekOverrides);
    if (overlap) {
      const name = (o: WeekOverride) => o.label || (o.type === "inset" ? "INSET" : "Holiday");
      new Notice(
        `Warning: "${name(overlap[0])}" (from ${overlap[0].startDate}) and "${name(overlap[1])}" (from ${overlap[1].startDate}) overlap. Directed time may be miscounted.`,
        6000
      );
    }
  }

  private renderWeekOverrideRow(container: HTMLElement, override: WeekOverride) {
    if (Platform.isMobile) { this.renderWeekOverrideRowMobile(container, override); return; }
    // Wrapper div stacks the Setting row + optional INSET sub-row
    const wrapper = container.createDiv("tp-override-entry");
    const row = new Setting(wrapper).setName("").setDesc("");
    row.settingEl.addClass("tp-override-row");

    // ── From date ──────────────────────────────────────────────────────────
    const fromInput = row.controlEl.createEl("input", { type: "date", cls: "tp-override-date-input" });
    fromInput.value = override.startDate;
    fromInput.title = "First day of the holiday/INSET period";
    fromInput.addEventListener("change", () => { void (async () => {
      override.startDate = fromInput.value;
      // Keep endDate >= startDate
      if (override.endDate && override.endDate < override.startDate) {
        override.endDate = override.startDate;
        toInput.value = override.startDate;
      }
      await this.plugin.saveSettings();
      this.warnIfOverridesOverlap();
    })(); });

    row.controlEl.createSpan({ text: "–", cls: "tp-override-sep" });

    // ── To date ────────────────────────────────────────────────────────────
    const toInput = row.controlEl.createEl("input", { type: "date", cls: "tp-override-date-input" });
    toInput.value = override.endDate ?? override.startDate;
    toInput.title = "Last day of the holiday/INSET period (same as start = single day)";
    toInput.addEventListener("change", () => { void (async () => {
      const val = toInput.value;
      // If same as startDate, clear endDate (single-day override)
      override.endDate = val === override.startDate ? undefined : val;
      await this.plugin.saveSettings();
      this.warnIfOverridesOverlap();
    })(); });

    // ── Type ───────────────────────────────────────────────────────────────
    const typeSelect = row.controlEl.createEl("select", { cls: "tp-override-type-select" });
    for (const [val, label] of [["holiday", "Holiday"], ["inset", "INSET"]] as [string, string][]) {
      const opt = typeSelect.createEl("option", { text: label, value: val });
      if (override.type === val) opt.selected = true;
    }

    // ── Label (always visible — used for both holidays and INSET) ──────────
    const labelInput = row.controlEl.createEl("input", { type: "text", cls: "tp-override-label-input" });
    labelInput.value = override.label ?? "";
    labelInput.placeholder = "Label (e.g. Christmas)";
    labelInput.addEventListener("change", () => { void (async () => {
      override.label = labelInput.value;
      await this.plugin.saveSettings();
    })(); });

    // ── Delete ─────────────────────────────────────────────────────────────
    new ButtonComponent(row.controlEl).setIcon("trash").setTooltip("Remove").onClick(async () => {
      this.plugin.settings.weekOverrides = this.plugin.settings.weekOverrides.filter(w => w !== override);
      await this.plugin.saveSettings();
      // Remove the entire wrapper (Setting row + INSET sub-row)
      wrapper.remove();
      if (this.plugin.settings.weekOverrides.length === 0) {
        container.createEl("p", { text: "No holidays or INSET days marked.", cls: "setting-item-description" });
      }
    });

    // ── INSET hours sub-row (shown only when type = INSET and directed time enabled) ─
    const insetRow = wrapper.createDiv("tp-override-inset-row");
    const dtEnabled = () => this.plugin.settings.directedTime?.enabled ?? false;
    insetRow.setCssStyles({ display: override.type === "inset" && dtEnabled() ? "flex" : "none" });

    insetRow.createSpan({ text: "Directed hours for this period:", cls: "tp-override-inset-label" });
    const hoursInput = insetRow.createEl("input", { type: "number", cls: "tp-override-hours-input" });
    hoursInput.placeholder = "0"; hoursInput.min = "0"; hoursInput.max = "80"; hoursInput.step = "0.5";
    hoursInput.title = "Total directed hours for this entire INSET period";
    hoursInput.value = override.insetHours != null ? String(override.insetHours) : "";
    insetRow.createSpan({ text: "h", cls: "tp-override-hours-label" });
    hoursInput.addEventListener("change", () => { void (async () => {
      const n = parseFloat(hoursInput.value);
      override.insetHours = isNaN(n) || n <= 0 ? undefined : n;
      await this.plugin.saveSettings();
    })(); });

    typeSelect.addEventListener("change", () => { void (async () => {
      override.type = typeSelect.value as "holiday" | "inset" | "custom";
      insetRow.setCssStyles({ display: override.type === "inset" && dtEnabled() ? "flex" : "none" });
      await this.plugin.saveSettings();
    })(); });
  }

  // ── Directed time guide note ───────────────────────────────────────────────
  private async createDirectedTimeGuideNote() {
    const folder = this.plugin.settings.plannerFolder || "Teacher Planner";
    const path = folder + "/Directed Time — Guide.md";

    // Don't overwrite if it already exists
    if (this.app.vault.getFileByPath(path)) return;

    // Ensure planner folder exists
    if (!this.app.vault.getFolderByPath(folder)) {
      try { await this.app.vault.createFolder(folder); } catch { /* non-fatal */ }
    }

    const dt = this.plugin.settings.directedTime!;
    const effectiveHours = (dt.contractedHours * dt.timetablePercentage / 100).toFixed(1);

    const content = `# Directed Time Tracker — Guide

## What is directed time?

In England, under the **School Teachers' Pay and Conditions Document (STPCD)**, a full-time teacher may be directed to work for up to **1,265 hours per year** across a maximum of 195 days (190 teaching days + 5 INSET days). This is the statutory maximum — your school cannot lawfully direct you to exceed it.

> **Your current settings:** ${dt.contractedHours}h contracted \xd7 ${dt.timetablePercentage}% timetable fraction = **${effectiveHours}h effective maximum**

---

## How this tracker works

The directed time tracker calculates your cumulative directed time from events recorded in your planner. It counts:

- **Timetable lessons** — every class slot on your timetable, using the lesson duration you configure (default: 60 min, adjustable per slot in the timetable editor).
- **Directed time activities** — items in the *Directed time* section of Settings added to your planner (e.g. Cover, Duty, Meetings, Tutor).
- **Holiday/INSET weeks** — automatically excluded from the count.
- **Other events** — items in the *Other events* section of Settings are excluded from the directed time total.

The sidebar panel shows:

| Field | Meaning |
|---|---|
| **Accrued to date** | Hours logged up to and including the current week |
| **Predicted total** | Full-year projection if current timetable continues |
| **Contracted max** | Your statutory ceiling (adjusted for part-time fraction) |

---

## Part-time teachers

Set your **timetable fraction** in *Settings → Directed Time Tracker*. Your effective maximum = contracted hours \xd7 fraction.

*Example:* A 0.6 FTE teacher: 1,265 \xd7 60% = **759 hours maximum**.

---

## Keeping your data accurate

- Add one-off events (cover lessons, extra meetings, parents evenings) as **date events** in your planner using the **+ Event** button.
- If a timetable lesson is cancelled, use the **Exclude** option in the lesson notes panel so it isn't counted.
- Update slot durations if your lessons aren't exactly 60 minutes (click the duration badge in the timetable editor).

---

## Exporting your data

Use **Settings → Directed Time Tracker → Export XLSX…** to download a detailed Excel report with:

- **Summary sheet** — contracted hours, accrued, predicted, and margin at a glance
- **Weekly Breakdown sheet** — every week of the academic year with lesson, activity, and event counts

This report is useful evidence to share with your union representative or school management.

---

## ⚠️ Important disclaimer

This tracker is a **guide only**. Accuracy depends entirely on the information you enter into your planner. It does not constitute legal advice. If you believe your directed time is being exceeded, **contact your union representative** for formal guidance.

---

## Useful contacts

- **NEU** (National Education Union): [neu.org.uk](https://neu.org.uk)
- **NASUWT**: [nasuwt.org.uk](https://www.nasuwt.org.uk)
- **NAHT**: [naht.org.uk](https://www.naht.org.uk)
- **ATL / Voice**: check your contract for the affiliated union
`;

    try {
      await this.app.vault.create(path, content);
    } catch (e) {
      console.warn("Teacher Planner: could not create directed time guide note:", e);
    }
  }
}

// ── Colour picker modal ───────────────────────────────────────────────────────
// ── Settings-applied confirmation modal ────────────────────────────────────────
class SettingsAppliedModal extends Modal {
  private plugin: TeacherPlannerPlugin;
  private snapshot: string;

  constructor(app: App, plugin: TeacherPlannerPlugin, snapshot: string) {
    super(app);
    this.plugin = plugin;
    this.snapshot = snapshot;
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText("Settings saved");
    contentEl.createEl("p", {
      text: "Your changes have been saved and the planner has been updated.",
      cls: "setting-item-description",
    });

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText("Got it")
        .setCta()
        .onClick(() => this.close()))
      .addButton(btn => btn
        .setButtonText("Revert changes")
        .setClass("mod-warning")
        .onClick(async () => {
          const original = JSON.parse(this.snapshot) as Partial<TeacherPlannerSettings>;
          Object.assign(this.plugin.settings, original);
          await this.plugin.saveSettings();
          this.close();
        }));
  }

  onClose() { this.contentEl.empty(); }
}

export class ColourPickerModal extends Modal {
  private component: ColourPickerComponent | null = null;
  private initialColour: string;
  private label: string;
  private onSave: (colour: string) => Promise<void>;
  private showThemeRow: boolean;

  constructor(app: App, initialColour: string, label: string, onSave: (colour: string) => Promise<void>, showThemeRow = false) {
    super(app);
    this.initialColour = initialColour;
    this.label = label;
    this.onSave = onSave;
    this.showThemeRow = showThemeRow;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-colour-picker-modal");
    this.component = new ColourPickerComponent({
      target: contentEl,
      props: {
        initialColour: this.initialColour,
        label: this.label,
        showThemeRow: this.showThemeRow,
        onSave: async (colour: string) => {
          await this.onSave(colour);
          this.close();
        },
        onCancel: () => { this.close(); },
      },
    });
  }

  onClose() {
    if (this.component) {
      this.component.$destroy();
      this.component = null;
    }
    this.contentEl.empty();
  }
}


// ── Delete planner confirmation modal ─────────────────────────────────────────
class DeletePlannerModal extends Modal {
  private plugin: TeacherPlannerPlugin;
  private plannerId: string;
  private plannerName: string;
  private isLast: boolean;
  private onDeleted: () => void;

  constructor(app: App, plugin: TeacherPlannerPlugin, plannerId: string, plannerName: string, isLast: boolean, onDeleted: () => void) {
    super(app);
    this.plugin      = plugin;
    this.plannerId   = plannerId;
    this.plannerName = plannerName;
    this.isLast      = isLast;
    this.onDeleted   = onDeleted;
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText(this.isLast ? "Delete last planner" : "Delete planner");

    contentEl.createEl("p", {
      text: this.isLast
        ? `"${this.plannerName}" is your only planner. Deleting it will remove all planner data and relaunch the setup wizard. A re-importable backup is saved to "${backupsLibraryFolder(this.plugin)}" first. Lesson notes already created in your vault will not be affected.`
        : `Delete "${this.plannerName}"? All planner data (timetable, classes, events) will be removed — but a re-importable backup is saved to "${backupsLibraryFolder(this.plugin)}" first. Lesson notes already created in your vault will not be affected.`,
      cls: "setting-item-description",
    });

    new Setting(contentEl)
      .addButton(btn => btn.setButtonText("Cancel").onClick(() => this.close()))
      .addButton(btn => btn
        .setButtonText(this.isLast ? "Delete & restart wizard" : "Delete planner")
        .setClass("mod-warning")
        .onClick(async () => {
          await this.plugin.deletePlanner(this.plannerId);
          this.close();
          if (this.isLast) {
            const { SetupWizardModal } = await import("../modals/SetupWizardModal");
            new SetupWizardModal(this.app, this.plugin).open();
          } else {
            this.onDeleted();
          }
        }));
  }

  onClose() {
    this.contentEl.empty();
  }
}

class BackupPickModal extends FuzzySuggestModal<LibFile> {
  private plugin: TeacherPlannerPlugin;
  private files: LibFile[];
  private onDone: () => void;
  constructor(app: App, plugin: TeacherPlannerPlugin, files: LibFile[], onDone: () => void) {
    super(app);
    this.plugin = plugin;
    this.files = files;
    this.onDone = onDone;
    this.setPlaceholder("Pick a backup to import…");
  }
  getItems(): LibFile[] { return this.files; }
  getItemText(f: LibFile): string { return f.basename; }
  onChooseItem(f: LibFile): void {
    void (async () => {
      try {
        const { planners } = parseBackup(await readBackupText(this.plugin, f.path));
        const ids = await importPlanners(this.plugin, planners);
        new Notice(`Imported ${planners.length} planner${planners.length === 1 ? "" : "s"}.`);
        if (ids[0]) await this.plugin.switchPlanner(ids[0]);
        this.onDone();
      } catch (e) {
        console.error("Teacher Planner: import failed.", e);
        new Notice(`Import failed: ${(e as Error).message ?? "see console"}`);
      }
    })();
  }
}

class BackupExportModal extends Modal {
  private plugin: TeacherPlannerPlugin;
  private onDone: () => void;
  private selected: Set<string>;
  private destination: ExportDestination;
  constructor(app: App, plugin: TeacherPlannerPlugin, onDone: () => void) {
    super(app);
    this.plugin = plugin;
    this.onDone = onDone;
    this.selected = new Set(plugin.plannerData.planners.map(p => p.id));
    this.destination = { mode: "vault", vaultPath: backupsLibraryFolder(plugin), systemPath: null };
  }
  private stamp(): string {
    const d = new Date(); const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-modal-form");
    this.setTitle("Export backup");
    contentEl.createEl("p", { text: "Choose which planners to back up and where to save. The default plugin folder keeps it out of your vault and listed under Import.", cls: "setting-item-description" });
    const list = contentEl.createDiv();
    for (const pl of this.plugin.plannerData.planners) {
      new Setting(list).setName(pl.name)
        .addToggle(t => t.setValue(this.selected.has(pl.id)).onChange(v => { if (v) this.selected.add(pl.id); else this.selected.delete(pl.id); }));
    }
    renderDestinationPicker(contentEl, this.destination, Platform.isMobile);
    const footer = contentEl.createDiv("tp-modal-footer");
    footer.setCssStyles({ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" });
    footer.createEl("button", { text: "Cancel", cls: "tp-btn" }).addEventListener("click", () => this.close());
    footer.createEl("button", { text: "Export", cls: "tp-btn tp-btn--primary" }).addEventListener("click", () => { void (async () => {
      const chosen = this.plugin.plannerData.planners.filter(pl => this.selected.has(pl.id));
      if (chosen.length === 0) { new Notice("Select at least one planner."); return; }
      try {
        const label = chosen.length === 1 ? chosen[0].name : `${chosen.length} planners`;
        const filename = `Teacher Planner backup - ${label} - ${this.stamp()}.json`;
        const path = await writeBackupToDestination(this.plugin, this.destination, filename, buildBackupOf(chosen));
        new Notice(`Backed up ${chosen.length} planner${chosen.length === 1 ? "" : "s"} to ${path}`);
        this.onDone();
        this.close();
      } catch (e) { console.error("Teacher Planner: backup export failed.", e); new Notice("Backup failed — see console."); }
    })(); });
  }
  onClose() { this.contentEl.empty(); }
}

class TemplatePickModal extends FuzzySuggestModal<LibFile> {
  private files: LibFile[];
  private onPick: (file: LibFile) => void;
  constructor(app: App, files: LibFile[], placeholder: string, onPick: (file: LibFile) => void) {
    super(app);
    this.files = files;
    this.onPick = onPick;
    this.setPlaceholder(placeholder);
  }
  getItems(): LibFile[] { return this.files; }
  getItemText(f: LibFile): string { return f.basename; }
  onChooseItem(f: LibFile): void { this.onPick(f); }
}
