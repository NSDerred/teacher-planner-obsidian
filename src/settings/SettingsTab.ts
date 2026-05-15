import { App, PluginSettingTab, Setting, Notice, Modal, ButtonComponent, setIcon } from "obsidian";
import type TeacherPlannerPlugin from "../main";
import type { SchoolPeriod, PeriodTypeConfig, Subject, ClassGroup, WeekOverride, Activity } from "../types";
import { DEFAULT_SETTINGS, CLASS_COLOUR_PALETTE } from "../settings";
import ColourPickerComponent from "../modals/ColourPickerComponent.svelte";
import { AddPeriodModal } from "../modals/AddPeriodModal";
import { ExportModal } from "../modals/ExportModal";
import { DirectedTimeExportModal } from "../modals/DirectedTimeExportModal";
import { TFile } from "obsidian";

export class TeacherPlannerSettingTab extends PluginSettingTab {
  plugin: TeacherPlannerPlugin;
  /** JSON snapshot taken when the tab opens — used to detect unsaved changes on close. */
  private _snapshot = "";

  constructor(app: App, plugin: TeacherPlannerPlugin) { super(app, plugin); this.plugin = plugin; }

  /** Called by Obsidian when the settings tab is navigated away from or closed. */
  hide(): void {
    const snapshot = this._snapshot;
    this._snapshot = "";
    if (!snapshot || JSON.stringify(this.plugin.settings) === snapshot) return;
    new SettingsAppliedModal(this.app, this.plugin, snapshot).open();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    // Capture snapshot of current settings so hide() can detect changes
    this._snapshot = JSON.stringify(this.plugin.settings);
    containerEl.createEl("h2", { text: "Teacher Planner" });

    // ── Academic Year ──────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Academic Year" });
    new Setting(containerEl).setName("Planner name").setDesc('e.g. "2025-26 IB Science"')
      .addText(t => t.setPlaceholder("2025-26").setValue(this.plugin.settings.academicYear.name)
        .onChange(async v => { this.plugin.settings.academicYear.name = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Start date").setDesc("YYYY-MM-DD")
      .addText(t => t.setPlaceholder("2025-09-01").setValue(this.plugin.settings.academicYear.startDate)
        .onChange(async v => { this.plugin.settings.academicYear.startDate = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("End date").setDesc("YYYY-MM-DD")
      .addText(t => t.setPlaceholder("2026-07-15").setValue(this.plugin.settings.academicYear.endDate)
        .onChange(async v => { this.plugin.settings.academicYear.endDate = v; await this.plugin.saveSettings(); }));

    // ── School days ────────────────────────────────────────────────────────
    const schoolDayOptions: { key: string; label: string }[] = [
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
    const sdWrap = schoolDaysSetting.controlEl.createDiv("tp-school-days-wrap");
    for (const opt of schoolDayOptions) {
      const lbl = sdWrap.createEl("label", { cls: "tp-school-day-label" });
      const cb = lbl.createEl("input", { type: "checkbox" });
      cb.checked = (this.plugin.settings.schoolDays ?? ["monday","tuesday","wednesday","thursday","friday"]).includes(opt.key as any);
      lbl.appendText(opt.label);
      cb.addEventListener("change", async () => {
        const current = this.plugin.settings.schoolDays ?? ["monday","tuesday","wednesday","thursday","friday"];
        if (cb.checked) {
          if (!current.includes(opt.key as any)) current.push(opt.key as any);
        } else {
          const idx = current.indexOf(opt.key as any);
          if (idx !== -1) current.splice(idx, 1);
        }
        this.plugin.settings.schoolDays = [...current];
        await this.plugin.saveSettings();
      });
    }

    // ── Grid Visuals ───────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Grid Visuals" });
    const GREY_PALETTE = ["#dddddd", "#bbbbbb", "#999999", "#777777", "#555555", "#444444", "#333333"];

    const blockColourSetting = new Setting(containerEl)
      .setName("Period block border colour")
      .setDesc("Border on the top and bottom edge of each period band.");
    blockColourSetting.controlEl.style.display = "flex";
    blockColourSetting.controlEl.style.alignItems = "center";
    blockColourSetting.controlEl.style.gap = "8px";
    blockColourSetting.controlEl.style.flexWrap = "wrap";

    const currentBlockColour = this.plugin.settings.blockBorderColour ?? "#444444";
    const blockSwatchBtn = blockColourSetting.controlEl.createEl("button", { cls: "tp-colour-swatch-btn tp-colour-swatch-btn--small", title: "Custom colour" });
    blockSwatchBtn.style.background = currentBlockColour;

    const blockPresetRow = blockColourSetting.controlEl.createDiv("tp-preset-swatches");
    const blockPresetSwatches: HTMLElement[] = [];

    const updateBlockBorderColour = async (colour: string) => {
      this.plugin.settings.blockBorderColour = colour;
      await this.plugin.saveSettings();
      blockSwatchBtn.style.background = colour;
      blockPresetSwatches.forEach(s => s.classList.toggle("tp-preset-swatch--active", s.dataset.colour === colour));
    };

    blockSwatchBtn.addEventListener("click", () => {
      new ColourPickerModal(this.app, this.plugin.settings.blockBorderColour ?? "#444444", "Period block border", async colour => {
        await updateBlockBorderColour(colour);
      }).open();
    });

    for (const grey of GREY_PALETTE) {
      const chip = blockPresetRow.createEl("button", { cls: "tp-preset-swatch", title: grey });
      chip.style.background = grey;
      chip.dataset.colour = grey;
      if (grey === currentBlockColour) chip.classList.add("tp-preset-swatch--active");
      chip.addEventListener("click", async () => { await updateBlockBorderColour(grey); });
      blockPresetSwatches.push(chip);
    }

    new Setting(containerEl).setName("Period block border weight").setDesc("Thickness of period band borders in pixels (1-4).")
      .addSlider(s => s.setLimits(1, 4, 1).setValue(this.plugin.settings.blockBorderWeight ?? 1)
        .setDynamicTooltip()
        .onChange(async v => { this.plugin.settings.blockBorderWeight = v; await this.plugin.saveSettings(); }));

    const gridColourSetting = new Setting(containerEl)
      .setName("Time grid line colour")
      .setDesc("Colour of the day-column borders and row dividers.");
    gridColourSetting.controlEl.style.display = "flex";
    gridColourSetting.controlEl.style.alignItems = "center";
    gridColourSetting.controlEl.style.gap = "8px";
    gridColourSetting.controlEl.style.flexWrap = "wrap";

    const currentGridColour = this.plugin.settings.gridLineColour ?? "#555555";
    const gridSwatchBtn = gridColourSetting.controlEl.createEl("button", { cls: "tp-colour-swatch-btn tp-colour-swatch-btn--small", title: "Custom colour" });
    gridSwatchBtn.style.background = currentGridColour;

    const gridPresetRow = gridColourSetting.controlEl.createDiv("tp-preset-swatches");
    const gridPresetSwatches: HTMLElement[] = [];

    const updateGridLineColour = async (colour: string) => {
      this.plugin.settings.gridLineColour = colour;
      await this.plugin.saveSettings();
      gridSwatchBtn.style.background = colour;
      gridPresetSwatches.forEach(s => s.classList.toggle("tp-preset-swatch--active", s.dataset.colour === colour));
    };

    gridSwatchBtn.addEventListener("click", () => {
      new ColourPickerModal(this.app, this.plugin.settings.gridLineColour ?? "#555555", "Time grid line", async colour => {
        await updateGridLineColour(colour);
      }).open();
    });

    for (const grey of GREY_PALETTE) {
      const chip = gridPresetRow.createEl("button", { cls: "tp-preset-swatch", title: grey });
      chip.style.background = grey;
      chip.dataset.colour = grey;
      if (grey === currentGridColour) chip.classList.add("tp-preset-swatch--active");
      chip.addEventListener("click", async () => { await updateGridLineColour(grey); });
      gridPresetSwatches.push(chip);
    }

    new Setting(containerEl).setName("Time grid line weight").setDesc("Thickness of the grid dividers in pixels (1-4).")
      .addSlider(s => s.setLimits(1, 4, 1).setValue(this.plugin.settings.gridLineWeight ?? 1)
        .setDynamicTooltip()
        .onChange(async v => { this.plugin.settings.gridLineWeight = v; await this.plugin.saveSettings(); }));

    // ── Block Types ────────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Block Types" });
    containerEl.createEl("p", {
      text: "Define period types and their colours. These appear as shaded bands in the week view.",
      cls: "setting-item-description"
    });
    if (!this.plugin.settings.periodTypes) this.plugin.settings.periodTypes = [];
    const periodTypesContainer = containerEl.createDiv("tp-activities-list");
    this.renderPeriodTypesList(periodTypesContainer);
    new Setting(containerEl).addButton(btn => btn.setButtonText("+ Add block type").setCta()
      .onClick(async () => {
        this.plugin.settings.periodTypes.push({ id: "type-" + Date.now(), label: "New Type", colour: "#b4befe" });
        await this.plugin.saveSettings();
        periodTypesContainer.empty();
        this.renderPeriodTypesList(periodTypesContainer);
      }));

    // ── Periods ────────────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "School Timetable" });
    containerEl.createEl("p", {
      text: "All periods appear in the timetable editor. Colours and types are configured in Block Types above.",
      cls: "setting-item-description"
    });
    const periodsContainer = containerEl.createDiv("tp-periods-list");
    this.renderPeriodsList(periodsContainer);
    new Setting(containerEl).addButton(btn => btn.setButtonText("+ Add period").setCta()
      .onClick(() => {
        new AddPeriodModal(this.app, async (period) => {
          this.plugin.settings.academicYear.periods.push(period);
          this.sortPeriods();
          await this.plugin.saveSettings();
          periodsContainer.empty();
          this.renderPeriodsList(periodsContainer);
        }).open();
      }));

    // ── Lessons ────────────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Lessons" });
    containerEl.createEl("p", {
      text: "Define your subjects and class groups. Colours appear on lesson blocks in the week view.",
      cls: "setting-item-description"
    });
    const classesContainer = containerEl.createDiv("tp-classes-list");
    this.renderSubjectsList(classesContainer);
    new Setting(containerEl).addButton(btn => btn.setButtonText("+ Add subject").setCta()
      .onClick(async () => {
        const colour = CLASS_COLOUR_PALETTE[this.plugin.settings.subjects.length % CLASS_COLOUR_PALETTE.length];
        this.plugin.settings.subjects.push({ id: `subj-${Date.now()}`, name: "New Subject", colour });
        await this.plugin.saveSettings();
        classesContainer.empty();
        this.renderSubjectsList(classesContainer);
      }));

    // ── Directed Time Tracker ──────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Directed Time Tracker" });
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
          this.display();
        }));

    if (dt.enabled) {
      // Instructions callout
      const callout = containerEl.createDiv("tp-dt-callout");
      callout.createEl("p", { text: "ℹ️  How it works: Directed time is counted only from items placed in your planner. The tracker shows hours accrued to today and a projection based on future planned events. Keep your planner up to date for accurate figures." });
      callout.createEl("p", { text: "⚠️  This tracker is a guide only. Accuracy depends entirely on the information you enter. It does not constitute legal advice — always consult your union representative for formal disputes." });

      new Setting(containerEl)
        .setName("Contracted directed time (hours)")
        .setDesc("Maximum directed time for a full-time teacher. Default: 1265 (STPCD). Override for schools on different contracts.")
        .addText(t => t.setPlaceholder("1265").setValue(String(dt.contractedHours))
          .onChange(async v => {
            const n = parseFloat(v);
            if (!isNaN(n) && n > 0) { dt.contractedHours = n; await this.plugin.saveSettings(); }
          }));

      new Setting(containerEl)
        .setName("Timetable fraction (%)")
        .setDesc("For part-time teachers. Your directed time maximum = contracted hours × this %. Default: 100 (full-time).")
        .addText(t => t.setPlaceholder("100").setValue(String(dt.timetablePercentage))
          .onChange(async v => {
            const n = parseFloat(v);
            if (!isNaN(n) && n > 0 && n <= 100) { dt.timetablePercentage = n; await this.plugin.saveSettings(); }
          }));

      // Default lesson duration: preset dropdown + optional custom input
      const lessonDurOptions = ["45", "50", "60"];
      const lessonDurDropValue = lessonDurOptions.includes(String(dt.defaultLessonDurationMinutes))
        ? String(dt.defaultLessonDurationMinutes) : "custom";

      new Setting(containerEl)
        .setName("Default lesson duration")
        .setDesc("Applied to all timetable lessons unless overridden on individual slots.")
        .addDropdown(d => d
          .addOption("45", "45 minutes")
          .addOption("50", "50 minutes")
          .addOption("60", "60 minutes")
          .addOption("custom", "Custom…")
          .setValue(lessonDurDropValue)
          .onChange(async v => {
            if (v !== "custom") { dt.defaultLessonDurationMinutes = parseInt(v); await this.plugin.saveSettings(); }
            this.display();
          }));

      if (lessonDurDropValue === "custom") {
        new Setting(containerEl)
          .setName("Custom lesson duration (minutes)")
          .addText(t => t.setPlaceholder("e.g. 55").setValue(String(dt.defaultLessonDurationMinutes))
            .onChange(async v => {
              const n = parseInt(v);
              if (!isNaN(n) && n > 0) { dt.defaultLessonDurationMinutes = n; await this.plugin.saveSettings(); }
            }));
      }

      new Setting(containerEl)
        .setName("Export directed time")
        .setDesc("Download a weekly breakdown of directed hours as an Excel workbook, suitable for sharing with your union or school management.")
        .addButton(btn => btn.setButtonText("Export XLSX…").setCta()
          .onClick(() => new DirectedTimeExportModal(this.app, this.plugin).open()));

      new Setting(containerEl)
        .setName("Directed time guide")
        .setDesc("Open the guide note explaining how the tracker works and your statutory rights.")
        .addButton(btn => btn.setButtonText("Open guide")
          .onClick(async () => {
            await this.createDirectedTimeGuideNote();
            const path = (this.plugin.settings.plannerFolder || "Teacher Planner") + "/Directed Time — Guide.md";
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
          }));
    }

    // ── Directed time activities ───────────────────────────────────────────
    containerEl.createEl("h3", { text: "Directed time" });
    containerEl.createEl("p", {
      text: "Activities placed here count toward your directed time total when added to the planner.",
      cls: "setting-item-description"
    });
    if (!this.plugin.settings.activities) this.plugin.settings.activities = [];
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
    containerEl.createEl("h3", { text: "Other Events" });
    const otherDesc = containerEl.createEl("p", {
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

    // ── Holidays & INSET Days ──────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Holidays & INSET Days" });
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

    // ── Rotation ───────────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Timetable Rotation" });
    new Setting(containerEl).setName("Enable A/B week rotation").setDesc("Alternating fortnightly timetables.")
      .addToggle(t => t.setValue(this.plugin.settings.academicYear.abWeekEnabled)
        .onChange(async v => { this.plugin.settings.academicYear.abWeekEnabled = v; await this.plugin.saveSettings(); this.display(); }));
    if (this.plugin.settings.academicYear.abWeekEnabled) {
      new Setting(containerEl).setName("Academic year starts on")
        .addDropdown(d => d.addOption("A", "Week A").addOption("B", "Week B")
          .setValue(this.plugin.settings.academicYear.abWeekStartsOn)
          .onChange(async (v: string) => { this.plugin.settings.academicYear.abWeekStartsOn = v as "A" | "B"; await this.plugin.saveSettings(); }));
    }

    // ── Vault ──────────────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Vault" });
    new Setting(containerEl).setName("Planner folder").setDesc("Where lesson notes will be created")
      .addText(t => t.setPlaceholder("Teacher Planner").setValue(this.plugin.settings.plannerFolder)
        .onChange(async v => { this.plugin.settings.plannerFolder = v; await this.plugin.saveSettings(); }));

    // ── Export ────────────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Export" });
    new Setting(containerEl)
      .setName("Export planner data")
      .setDesc("Download timetable or date events as Excel or CSV into your Planner folder.")
      .addButton(btn => btn.setButtonText("Export data…").setCta()
        .onClick(() => new ExportModal(this.app, this.plugin).open()));

    // ── Reset ──────────────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Reset" });
    new Setting(containerEl).setName("Reset periods to defaults")
      .addButton(btn => btn.setButtonText("Reset periods").setWarning()
        .onClick(async () => {
          this.plugin.settings.academicYear.periods = [...DEFAULT_SETTINGS.academicYear.periods];
          await this.plugin.saveSettings();
          periodsContainer.empty();
          this.renderPeriodsList(periodsContainer);
          new Notice("Periods reset to defaults.");
        }));
  }

  private sortPeriods() {
    this.plugin.settings.academicYear.periods.sort((a, b) => a.start.localeCompare(b.start));
  }

  private renderPeriodsList(container: HTMLElement) {
    const periods = this.plugin.settings.academicYear.periods;
    if (periods.length === 0) {
      container.createEl("p", { text: "No periods defined.", cls: "setting-item-description" });
      return;
    }
    for (let i = 0; i < periods.length; i++) this.renderPeriodRow(container, periods[i], i);
  }

  private renderPeriodRow(container: HTMLElement, period: SchoolPeriod, index: number) {
    new Setting(container)
      .setName(period.name).setDesc(`${period.start} - ${period.end}`)
      .addText(t => {
        t.setPlaceholder("Name").setValue(period.name);
        t.inputEl.addEventListener("blur", async () => {
          period.name = t.inputEl.value;
          await this.plugin.saveSettings();
        });
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
        t.inputEl.addEventListener("blur", commitStart);
        t.inputEl.addEventListener("keydown", (e: KeyboardEvent) => { if (e.key === "Enter") t.inputEl.blur(); });
      })
      .addText(t => {
        t.setPlaceholder("HH:MM").setValue(period.end);
        t.inputEl.addEventListener("blur", async () => {
          period.end = t.inputEl.value;
          await this.plugin.saveSettings();
        });
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
        this.plugin.settings.academicYear.periods.splice(index, 1);
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

    const swatchBtn = header.createEl("button", { cls: "tp-colour-swatch-btn" });
    swatchBtn.style.background = subject.colour;
    swatchBtn.title = "Change subject colour";
    swatchBtn.addEventListener("click", () => {
      new ColourPickerModal(this.app, subject.colour, subject.name, async colour => {
        subject.colour = colour;
        for (const cls of this.plugin.settings.classes.filter(c => c.subjectId === subject.id && !c.colourOverridden)) {
          cls.colour = colour;
        }
        await this.plugin.saveSettings();
        container.empty();
        this.renderSubjectsList(container);
      }).open();
    });

    const nameInput = header.createEl("input", { type: "text", cls: "tp-subject-name-input" });
    nameInput.value = subject.name;
    nameInput.placeholder = "Subject name";
    nameInput.addEventListener("change", async () => { subject.name = nameInput.value; await this.plugin.saveSettings(); });

    const addClassBtn = header.createEl("button", { text: "+ Class", cls: "tp-btn-small tp-btn-small--cta" });
    addClassBtn.addEventListener("click", async () => {
      this.plugin.settings.classes.push({
        id: `cls-${Date.now()}`, year: "", code: "NEW 00",
        subjectId: subject.id, colour: subject.colour, colourOverridden: false, lessonCount: 0,
      });
      await this.plugin.saveSettings();
      container.empty(); this.renderSubjectsList(container);
    });

    const delSubjectBtn = header.createEl("button", { cls: "tp-icon-btn" });
    setIcon(delSubjectBtn, "trash-2");
    delSubjectBtn.title = "Delete subject and all its classes";
    delSubjectBtn.addEventListener("click", async () => {
      this.plugin.settings.subjects = this.plugin.settings.subjects.filter(s => s.id !== subject.id);
      this.plugin.settings.classes = this.plugin.settings.classes.filter(c => c.subjectId !== subject.id);
      this.plugin.settings.timetable = this.plugin.settings.timetable.filter(
        t => !subjectClasses.map(c => c.id).includes(t.classId)
      );
      await this.plugin.saveSettings();
      container.empty(); this.renderSubjectsList(container);
    });

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
      archivedList.style.display = "none";
      toggleBtn.addEventListener("click", () => {
        const hidden = archivedList.style.display === "none";
        archivedList.style.display = hidden ? "block" : "none";
        toggleBtn.textContent = hidden
          ? `↑ ${archivedClasses.length} archived`
          : `↓ ${archivedClasses.length} archived`;
      });
      for (const cls of archivedClasses) this.renderClassRow(archivedList, cls, subject, container, true);
    }
  }

  private renderClassRow(container: HTMLElement, cls: ClassGroup, subject: Subject, parentContainer: HTMLElement, isArchived: boolean = false) {
    const row = container.createDiv("tp-class-row");
    if (isArchived) row.style.opacity = "0.5";

    const swatchBtn = row.createEl("button", { cls: "tp-colour-swatch-btn tp-colour-swatch-btn--small" });
    swatchBtn.style.background = cls.colour;
    swatchBtn.title = "Override class colour";
    swatchBtn.addEventListener("click", () => {
      new ColourPickerModal(this.app, cls.colour, cls.code, async colour => {
        cls.colour = colour;
        cls.colourOverridden = colour !== subject.colour;
        await this.plugin.saveSettings();
        swatchBtn.style.background = colour;
      }).open();
    });

    const yearInput = row.createEl("input", { type: "text", cls: "tp-year-input" });
    yearInput.value = cls.year ?? "";
    yearInput.placeholder = "Year (e.g. Y12)";
    yearInput.addEventListener("change", async () => { cls.year = yearInput.value; await this.plugin.saveSettings(); });

    const codeInput = row.createEl("input", { type: "text", cls: "tp-class-code-input" });
    codeInput.value = cls.code;
    codeInput.placeholder = "Class code (e.g. IB DP1)";
    codeInput.addEventListener("change", async () => { cls.code = codeInput.value; await this.plugin.saveSettings(); });

    const classroomInput = row.createEl("input", { type: "text", cls: "tp-class-code-input" });
    classroomInput.value = cls.classroom ?? "";
    classroomInput.placeholder = "Classroom";
    classroomInput.style.opacity = "0.7";
    classroomInput.addEventListener("change", async () => { cls.classroom = classroomInput.value; await this.plugin.saveSettings(); });

    if (cls.colourOverridden && !isArchived) {
      const resetBtn = row.createEl("button", { cls: "tp-icon-btn", title: "Reset to subject colour" });
      setIcon(resetBtn, "rotate-ccw");
      resetBtn.addEventListener("click", async () => {
        cls.colour = subject.colour; cls.colourOverridden = false;
        await this.plugin.saveSettings();
        parentContainer.empty(); this.renderSubjectsList(parentContainer);
      });
    }

    const archiveBtn = row.createEl("button", {
      cls: "tp-icon-btn",
      title: isArchived ? "Restore class" : "Archive class (hides from timetable editor)",
    });
    setIcon(archiveBtn, isArchived ? "rotate-ccw" : "archive");
    archiveBtn.addEventListener("click", async () => {
      cls.archived = !isArchived;
      await this.plugin.saveSettings();
      parentContainer.empty(); this.renderSubjectsList(parentContainer);
    });

    const delBtn = row.createEl("button", { cls: "tp-icon-btn", title: "Delete class" });
    setIcon(delBtn, "trash-2");
    delBtn.addEventListener("click", async () => {
      this.plugin.settings.classes = this.plugin.settings.classes.filter(c => c.id !== cls.id);
      this.plugin.settings.timetable = this.plugin.settings.timetable.filter(t => t.classId !== cls.id);
      await this.plugin.saveSettings();
      parentContainer.empty(); this.renderSubjectsList(parentContainer);
    });
  }

  /**
   * Render a filtered list of activities.
   * typeFilter "directed" shows activities where activityType !== "other" (includes undefined).
   * typeFilter "other" shows activities where activityType === "other".
   */
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
      archivedSection.style.marginTop = "8px";
      const toggleBtn = archivedSection.createEl("button", {
        text: `↓ ${archived.length} archived`,
        cls: "tp-archived-toggle-small",
      });
      const archivedList = archivedSection.createDiv();
      archivedList.style.display = "none";
      toggleBtn.addEventListener("click", () => {
        const hidden = archivedList.style.display === "none";
        archivedList.style.display = hidden ? "block" : "none";
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
    const row = container.createDiv("tp-activity-row");
    if (isArchived) row.style.opacity = "0.5";

    const swatchBtn = row.createEl("button", { cls: "tp-colour-swatch-btn tp-colour-swatch-btn--small" });
    swatchBtn.style.background = activity.colour;
    swatchBtn.addEventListener("click", () => {
      new ColourPickerModal(this.app, activity.colour, activity.label, async colour => {
        activity.colour = colour;
        await this.plugin.saveSettings();
        swatchBtn.style.background = colour;
      }).open();
    });

    const labelInput = row.createEl("input", { type: "text", cls: "tp-class-code-input" });
    labelInput.value = activity.label;
    labelInput.placeholder = "Activity name";
    labelInput.addEventListener("change", async () => { activity.label = labelInput.value; await this.plugin.saveSettings(); });

    const infoInput = row.createEl("input", { type: "text", cls: "tp-class-code-input" });
    infoInput.value = activity.info ?? "";
    infoInput.placeholder = "Info";
    infoInput.style.opacity = "0.7";
    infoInput.addEventListener("change", async () => { activity.info = infoInput.value; await this.plugin.saveSettings(); });

    const classroomInputAct = row.createEl("input", { type: "text", cls: "tp-class-code-input" });
    classroomInputAct.value = activity.classroom ?? "";
    classroomInputAct.placeholder = "Classroom";
    classroomInputAct.style.opacity = "0.7";
    classroomInputAct.addEventListener("change", async () => { activity.classroom = classroomInputAct.value; await this.plugin.saveSettings(); });

    // Duration field — only for directed activities
    if (typeFilter === "directed") {
      const durInput = row.createEl("input", { type: "number", cls: "tp-class-code-input tp-dur-input" });
      durInput.value = activity.durationMinutes !== undefined ? String(activity.durationMinutes) : "";
      durInput.placeholder = "mins";
      durInput.min = "1";
      durInput.max = "480";
      durInput.title = "Default duration for this activity (minutes)";
      durInput.style.width = "54px";
      durInput.addEventListener("change", async () => {
        const n = parseInt(durInput.value);
        activity.durationMinutes = isNaN(n) || durInput.value === "" ? undefined : n;
        await this.plugin.saveSettings();
      });
    }

    const archiveBtn = row.createEl("button", {
      cls: "tp-icon-btn",
      title: isArchived ? "Restore" : "Archive (hides from timetable editor)",
    });
    setIcon(archiveBtn, isArchived ? "rotate-ccw" : "archive");
    archiveBtn.addEventListener("click", async () => {
      activity.archived = !isArchived;
      await this.plugin.saveSettings();
      outerContainer.empty(); this.renderActivitiesList(outerContainer, typeFilter);
    });

    const delBtn = row.createEl("button", { cls: "tp-icon-btn", title: "Delete" });
    setIcon(delBtn, "trash-2");
    delBtn.addEventListener("click", async () => {
      this.plugin.settings.activities = this.plugin.settings.activities.filter(a => a.id !== activity.id);
      await this.plugin.saveSettings();
      outerContainer.empty(); this.renderActivitiesList(outerContainer, typeFilter);
    });
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
    const row = container.createDiv("tp-activity-row");
    const swatchBtn = row.createEl("button", { cls: "tp-colour-swatch-btn tp-colour-swatch-btn--small" });
    swatchBtn.style.background = pt.colour;
    swatchBtn.addEventListener("click", () => {
      new ColourPickerModal(this.app, pt.colour, pt.label, async colour => {
        pt.colour = colour;
        await this.plugin.saveSettings();
        swatchBtn.style.background = colour;
      }).open();
    });
    const labelInput = row.createEl("input", { type: "text", cls: "tp-class-code-input" });
    labelInput.value = pt.label;
    labelInput.placeholder = "Type name";
    labelInput.addEventListener("change", async () => { pt.label = labelInput.value; await this.plugin.saveSettings(); });
    const delBtn = row.createEl("button", { cls: "tp-icon-btn", title: "Delete type" });
    setIcon(delBtn, "trash-2");
    delBtn.addEventListener("click", async () => {
      this.plugin.settings.periodTypes = this.plugin.settings.periodTypes.filter(t => t.id !== pt.id);
      await this.plugin.saveSettings();
      container.empty(); this.renderPeriodTypesList(container);
    });
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

  private renderWeekOverrideRow(container: HTMLElement, override: WeekOverride) {
    const row = new Setting(container).setName("").setDesc("");
    row.settingEl.addClass("tp-override-row");

    // ── From date ──────────────────────────────────────────────────────────
    const fromInput = row.controlEl.createEl("input", { type: "date", cls: "tp-override-date-input" });
    fromInput.value = override.startDate;
    fromInput.title = "First day of the holiday/INSET period";
    fromInput.addEventListener("change", async () => {
      override.startDate = fromInput.value;
      // Keep endDate ≥ startDate
      if (override.endDate && override.endDate < override.startDate) {
        override.endDate = override.startDate;
        toInput.value = override.startDate;
      }
      await this.plugin.saveSettings();
    });

    row.controlEl.createSpan({ text: "–", cls: "tp-override-sep" });

    // ── To date ────────────────────────────────────────────────────────────
    const toInput = row.controlEl.createEl("input", { type: "date", cls: "tp-override-date-input" });
    toInput.value = override.endDate ?? override.startDate;
    toInput.title = "Last day of the holiday/INSET period (same as start = single day)";
    toInput.addEventListener("change", async () => {
      const val = toInput.value;
      // If same as startDate, clear endDate (single-day override)
      override.endDate = val === override.startDate ? undefined : val;
      await this.plugin.saveSettings();
    });

    // ── Type ───────────────────────────────────────────────────────────────
    const typeSelect = row.controlEl.createEl("select", { cls: "tp-override-type-select" });
    for (const [val, label] of [["holiday", "Holiday"], ["inset", "INSET"]] as [string, string][]) {
      const opt = typeSelect.createEl("option", { text: label, value: val });
      if (override.type === val) opt.selected = true;
    }

    // ── INSET hours (shown only for INSET type) ────────────────────────────
    const hoursWrap = row.controlEl.createDiv("tp-override-hours-wrap");
    hoursWrap.style.display = override.type === "inset" ? "flex" : "none";
    const hoursInput = hoursWrap.createEl("input", { type: "number", cls: "tp-override-hours-input" });
    hoursInput.placeholder = "0";
    hoursInput.min = "0";
    hoursInput.max = "80";
    hoursInput.step = "0.5";
    hoursInput.title = "Total directed hours for this entire INSET period";
    hoursInput.value = override.insetHours != null ? String(override.insetHours) : "";
    hoursWrap.createSpan({ text: "h directed", cls: "tp-override-hours-label" });
    hoursInput.addEventListener("change", async () => {
      const n = parseFloat(hoursInput.value);
      override.insetHours = isNaN(n) || n <= 0 ? undefined : n;
      await this.plugin.saveSettings();
    });

    typeSelect.addEventListener("change", async () => {
      override.type = typeSelect.value as "holiday" | "inset" | "custom";
      hoursWrap.style.display = override.type === "inset" ? "flex" : "none";
      await this.plugin.saveSettings();
    });

    // ── Label ──────────────────────────────────────────────────────────────
    const labelInput = row.controlEl.createEl("input", { type: "text", cls: "tp-override-label-input" });
    labelInput.value = override.label ?? "";
    labelInput.placeholder = "Label (e.g. Christmas)";
    labelInput.addEventListener("change", async () => {
      override.label = labelInput.value;
      await this.plugin.saveSettings();
    });

    // ── Delete ─────────────────────────────────────────────────────────────
    new ButtonComponent(row.controlEl).setIcon("trash").setTooltip("Remove").onClick(async () => {
      this.plugin.settings.weekOverrides = this.plugin.settings.weekOverrides.filter(w => w !== override);
      await this.plugin.saveSettings();
      // Remove only this row — leave all other rows intact
      row.settingEl.remove();
      if (this.plugin.settings.weekOverrides.length === 0) {
        container.createEl("p", { text: "No holidays or INSET days marked.", cls: "setting-item-description" });
      }
    });
  }

  // ── Directed time guide note ───────────────────────────────────────────────
  private async createDirectedTimeGuideNote() {
    const folder = this.plugin.settings.plannerFolder || "Teacher Planner";
    const path = folder + "/Directed Time — Guide.md";

    // Don't overwrite if it already exists
    if (this.app.vault.getAbstractFileByPath(path)) return;

    // Ensure planner folder exists
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      try { await this.app.vault.createFolder(folder); } catch {}
    }

    const dt = this.plugin.settings.directedTime!;
    const effectiveHours = (dt.contractedHours * dt.timetablePercentage / 100).toFixed(1);

    const content = `# Directed Time Tracker — Guide

## What is directed time?

In England, under the **School Teachers' Pay and Conditions Document (STPCD)**, a full-time teacher may be directed to work for up to **1,265 hours per year** across a maximum of 195 days (190 teaching days + 5 INSET days). This is the statutory maximum — your school cannot lawfully direct you to exceed it.

> **Your current settings:** ${dt.contractedHours}h contracted × ${dt.timetablePercentage}% timetable fraction = **${effectiveHours}h effective maximum**

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

Set your **timetable fraction** in *Settings → Directed Time Tracker*. Your effective maximum = contracted hours × fraction.

*Example:* A 0.6 FTE teacher: 1,265 × 60% = **759 hours maximum**.

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
        .setWarning()
        .onClick(async () => {
          const original = JSON.parse(this.snapshot);
          Object.assign(this.plugin.settings, original);
          await this.plugin.saveSettings();
          this.close();
        }));
  }

  onClose() { this.contentEl.empty(); }
}

export class ColourPickerModal extends Modal {
  private component: any;
  private initialColour: string;
  private label: string;
  private onSave: (colour: string) => Promise<void>;

  constructor(app: App, initialColour: string, label: string, onSave: (colour: string) => Promise<void>) {
    super(app);
    this.initialColour = initialColour;
    this.label = label;
    this.onSave = onSave;
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
