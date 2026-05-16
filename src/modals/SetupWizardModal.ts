import { App, Modal, Notice, Setting, setIcon } from "obsidian";
import type TeacherPlannerPlugin from "../main";
import type {
  PlannerRecord, SchoolPeriod, Subject, ClassGroup, SchoolDay,
  WeekOverride, PeriodTypeConfig, Activity,
} from "../types";
import { DEFAULT_PLANNER, DEFAULT_SETTINGS, CLASS_COLOUR_PALETTE } from "../settings";
import { TimetableEditorModal } from "./TimetableEditorModal";
import { openEmojiPicker, SUBJECT_EMOJIS } from "../settings/SettingsTab";

// ── Wizard state ───────────────────────────────────────────────────────────────

interface WizardState {
  name: string;
  directedTimeEnabled: boolean;
  contractedHours: number;
  timetablePercentage: number;
  defaultLessonDurationMinutes: number;
  activities: Activity[];
  startDate: string;
  endDate: string;
  weekOverrides: WeekOverride[];
  schoolDays: SchoolDay[];
  abWeekEnabled: boolean;
  abWeekStartsOn: "A" | "B";
  periodTypes: PeriodTypeConfig[];
  periods: SchoolPeriod[];
  subjects: Subject[];
  classes: ClassGroup[];
}

const DAYS: { key: SchoolDay; label: string }[] = [
  { key: "monday",    label: "Mon" },
  { key: "tuesday",   label: "Tue" },
  { key: "wednesday", label: "Wed" },
  { key: "thursday",  label: "Thu" },
  { key: "friday",    label: "Fri" },
  { key: "saturday",  label: "Sat" },
  { key: "sunday",    label: "Sun" },
];

const TOTAL_STEPS = 10;

export class SetupWizardModal extends Modal {
  private plugin: TeacherPlannerPlugin;
  private step = 1;
  private state: WizardState;
  private isNewPlanner: boolean;

  constructor(app: App, plugin: TeacherPlannerPlugin, isNewPlanner = false) {
    super(app);
    this.plugin = plugin;
    this.isNewPlanner = isNewPlanner;
    const ay = DEFAULT_PLANNER.academicYear;
    this.state = {
      name:                         ay.name,
      directedTimeEnabled:          false,
      contractedHours:              1265,
      timetablePercentage:          100,
      defaultLessonDurationMinutes: 60,
      activities:                   DEFAULT_SETTINGS.activities.map(a => ({ ...a })),
      startDate:                    ay.startDate,
      endDate:                      ay.endDate,
      weekOverrides:                [
        { startDate: "2025-10-27", endDate: "2025-10-31", type: "holiday", label: "Autumn Half Term" },
        { startDate: "2025-12-22", endDate: "2026-01-02", type: "holiday", label: "Christmas" },
        { startDate: "2026-02-16", endDate: "2026-02-20", type: "holiday", label: "Spring Half Term" },
        { startDate: "2026-04-01", endDate: "2026-04-17", type: "holiday", label: "Easter" },
        { startDate: "2026-05-25", endDate: "2026-05-29", type: "holiday", label: "May Half Term" },
      ],
      schoolDays:                   [...DEFAULT_PLANNER.schoolDays] as SchoolDay[],
      abWeekEnabled:                false,
      abWeekStartsOn:               "A",
      periodTypes:                  DEFAULT_SETTINGS.periodTypes.map(p => ({ ...p })),
      periods:                      ay.periods.map(p => ({ ...p })),
      subjects:                     [],
      classes:                      [],
    };
  }

  onOpen() {
    this.modalEl.addClass("tp-wizard-modal");
    this.render();
  }

  onClose() { this.contentEl.empty(); }

  /** Intercept all close attempts on steps 1\u20138 \u2014 planner not yet committed. */
  close() {
    if (this.step >= 9) { super.close(); return; }
    new WizardCloseConfirmModal(this.app, () => super.close()).open();
  }

  // ── Render dispatcher ───────────────────────────────────────────────────────

  private render() {
    const { contentEl } = this;
    contentEl.empty();

    // Progress bar
    const progress = contentEl.createDiv("tp-wizard-progress");
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      const dot = progress.createDiv("tp-wizard-dot");
      if (i < this.step)   dot.addClass("tp-wizard-dot--done");
      if (i === this.step) dot.addClass("tp-wizard-dot--active");
    }
    const pct = Math.round(((this.step - 1) / (TOTAL_STEPS - 1)) * 100);
    const bar = progress.createDiv("tp-wizard-bar-wrap");
    bar.createDiv("tp-wizard-bar-fill").style.width = pct + "%";

    const body = contentEl.createDiv("tp-wizard-body");

    switch (this.step) {
      case  1: this.renderStep1(body);  break;
      case  2: this.renderStep2(body);  break;
      case  3: this.renderStep3(body);  break;
      case  4: this.renderStep4(body);  break;
      case  5: this.renderStep5(body);  break;
      case  6: this.renderStep6(body);  break;
      case  7: this.renderStep7(body);  break;
      case  8: this.renderStep8(body);  break;
      case  9: this.renderStep9(body);  break;
      case 10: this.renderStep10(body); break;
    }
  }

  // ── Navigation helpers ──────────────────────────────────────────────────────

  private footer(body: HTMLElement, onNext: () => boolean | void) {
    const footer = body.createDiv("tp-wizard-footer");
    if (this.step > 1) {
      const back = footer.createEl("button", { text: "\u2190 Back", cls: "tp-btn" });
      back.addEventListener("click", () => { this.step--; this.render(); });
    } else {
      footer.createDiv();
    }
    const next = footer.createEl("button", { text: "Next \u2192", cls: "tp-btn tp-btn--primary" });
    next.addEventListener("click", () => {
      const ok = onNext();
      if (ok !== false) { this.step++; this.render(); }
    });
  }

  private stepHeading(body: HTMLElement, step: number, title: string, desc: string) {
    const hdr = body.createDiv("tp-wizard-step-hdr");
    hdr.createEl("span", { text: `Step ${step} of ${TOTAL_STEPS}`, cls: "tp-wizard-step-label" });
    hdr.createEl("h2",   { text: title, cls: "tp-wizard-title" });
    hdr.createEl("p",    { text: desc,  cls: "tp-wizard-desc" });
  }

  // ── Step 1: Planner name ────────────────────────────────────────────────────

  private renderStep1(body: HTMLElement) {
    this.stepHeading(body, 1, "Name your planner",
      "Give this planner a name \u2014 usually the academic year. It will also be used as the vault subfolder.");

    let nameInput: HTMLInputElement;
    new Setting(body)
      .setName("Planner name")
      .setDesc('e.g. "2025-26 IB Science"')
      .addText(t => {
        t.setPlaceholder("2025-26").setValue(this.state.name);
        t.inputEl.maxLength = 60;
        nameInput = t.inputEl;
        setTimeout(() => t.inputEl.focus(), 50);
      });

    this.footer(body, () => {
      const v = nameInput!.value.trim();
      if (!v) { new Notice("Please enter a planner name."); return false; }
      this.state.name = v;
    });
  }

  // ── Step 2: Directed time ───────────────────────────────────────────────────

  private renderStep2(body: HTMLElement) {
    this.stepHeading(body, 2, "Directed time tracker",
      "Track your statutory directed time (STPCD). Enable this to configure your contract details and add directed time activity types.");

    let dtPanel: HTMLElement;
    new Setting(body)
      .setName("Enable directed time tracker")
      .setDesc("Track cumulative directed time based on events in your planner.")
      .addToggle(t => t.setValue(this.state.directedTimeEnabled).onChange(v => {
        this.state.directedTimeEnabled = v;
        dtPanel.style.display = v ? "" : "none";
      }));

    dtPanel = body.createDiv();
    dtPanel.style.display = this.state.directedTimeEnabled ? "" : "none";

    // ── Disclaimer callout ──────────────────────────────────────────────────
    const dtCallout = dtPanel.createDiv("tp-dt-callout");
    dtCallout.createEl("p", { text: "\u2139\ufe0f  How it works: Directed time is counted only from items placed in your planner. The tracker shows hours accrued to today and a projection based on future planned events. Keep your planner up to date for accurate figures." });
    dtCallout.createEl("p", { text: "\u26a0\ufe0f  This tracker is a guide only. Accuracy depends entirely on the information you enter. It does not constitute legal advice \u2014 always consult your union representative for formal disputes." });

    new Setting(dtPanel)
      .setName("Contracted directed time (hours)")
      .setDesc("Maximum directed time for a full-time teacher. Default: 1265 (STPCD).")
      .addText(t => {
        t.setPlaceholder("1265").setValue(String(this.state.contractedHours));
        t.onChange(v => { const n = parseFloat(v); if (!isNaN(n) && n > 0) this.state.contractedHours = n; });
      });

    new Setting(dtPanel)
      .setName("Timetable fraction (%)")
      .setDesc("For part-time teachers. Default: 100 (full-time).")
      .addText(t => {
        t.setPlaceholder("100").setValue(String(this.state.timetablePercentage));
        t.onChange(v => { const n = parseFloat(v); if (!isNaN(n) && n > 0 && n <= 100) this.state.timetablePercentage = n; });
      });

    const lessonDurOptions = ["45", "50", "60"];
    const lessonDurDropValue = lessonDurOptions.includes(String(this.state.defaultLessonDurationMinutes))
      ? String(this.state.defaultLessonDurationMinutes) : "custom";

    let customDurSetting: Setting;
    new Setting(dtPanel)
      .setName("Default lesson duration")
      .setDesc("Applied to all timetable lessons unless overridden.")
      .addDropdown(d => d
        .addOption("45", "45 minutes").addOption("50", "50 minutes")
        .addOption("60", "60 minutes").addOption("custom", "Custom\u2026")
        .setValue(lessonDurDropValue)
        .onChange(v => {
          if (v !== "custom") { this.state.defaultLessonDurationMinutes = parseInt(v); }
          customDurSetting.settingEl.style.display = v === "custom" ? "" : "none";
        }));

    customDurSetting = new Setting(dtPanel)
      .setName("Custom lesson duration (minutes)")
      .addText(t => {
        t.setPlaceholder("e.g. 55")
          .setValue(lessonDurDropValue === "custom" ? String(this.state.defaultLessonDurationMinutes) : "");
        t.onChange(v => { const n = parseInt(v); if (!isNaN(n) && n > 0) this.state.defaultLessonDurationMinutes = n; });
      });
    customDurSetting.settingEl.style.display = lessonDurDropValue === "custom" ? "" : "none";

    // ── Directed time activities ────────────────────────────────────────────
    dtPanel.createEl("p", { text: "Directed time activities", cls: "tp-wizard-sublabel" });

    const activityHeaders = dtPanel.createDiv("tp-activity-row tp-activity-headers");
    activityHeaders.createDiv().style.cssText = "width:28px;flex-shrink:0;";
    const makeH = (text: string, extra = "") => {
      const h = activityHeaders.createEl("span", { text, cls: "tp-activity-header-label" });
      if (extra) h.style.cssText = extra;
    };
    makeH("Name");
    makeH("Duration", "flex:0 0 54px;width:54px;");
    activityHeaders.createDiv().style.cssText = "width:28px;flex-shrink:0;";

    const actList = dtPanel.createDiv("tp-activities-list");

    const renderActs = () => {
      actList.empty();
      if (this.state.activities.length === 0) {
        actList.createEl("p", { text: "No activities yet \u2014 add one below.", cls: "tp-wizard-empty-note" });
      }
      for (const act of this.state.activities) {
        const row = actList.createDiv("tp-activity-row");

        const swatch = row.createEl("button", { cls: "tp-colour-swatch-btn tp-colour-swatch-btn--small" });
        swatch.style.background = act.colour;
        swatch.addEventListener("click", async () => {
          const { ColourPickerModal } = await import("../settings/SettingsTab");
          new ColourPickerModal(this.app, act.colour, act.label, async (colour: string) => {
            act.colour = colour; swatch.style.background = colour;
          }).open();
        });

        const labelIn = row.createEl("input", { type: "text", cls: "tp-class-code-input" });
        labelIn.value = act.label; labelIn.placeholder = "Activity name";
        labelIn.addEventListener("change", () => { act.label = labelIn.value; });

        const durIn = row.createEl("input", { type: "number", cls: "tp-class-code-input tp-dur-input" });
        durIn.value = act.durationMinutes !== undefined ? String(act.durationMinutes) : "";
        durIn.placeholder = "mins"; durIn.min = "1"; durIn.max = "480"; durIn.style.width = "54px";
        durIn.addEventListener("change", () => {
          const n = parseInt(durIn.value);
          act.durationMinutes = isNaN(n) || durIn.value === "" ? undefined : n;
        });

        const delBtn = row.createEl("button", { cls: "tp-icon-btn" });
        setIcon(delBtn, "trash-2");
        delBtn.addEventListener("click", () => {
          this.state.activities = this.state.activities.filter(a => a.id !== act.id);
          renderActs();
        });
      }

      new Setting(actList).addButton(btn => btn.setButtonText("+ Add activity").setCta()
        .onClick(() => {
          const colour = CLASS_COLOUR_PALETTE[this.state.activities.length % CLASS_COLOUR_PALETTE.length];
          this.state.activities.push({ id: "act-" + Date.now(), label: "New Activity", colour, activityType: "directed" });
          renderActs();
        }));
    };
    renderActs();

    this.footer(body, () => { /* optional */ });
  }

  // ── Step 3: Academic year dates ─────────────────────────────────────────────

  private renderStep3(body: HTMLElement) {
    this.stepHeading(body, 3, "Academic year dates",
      "Set the start and end dates for this planner.");

    let startInput: HTMLInputElement;
    let endInput: HTMLInputElement;

    const startSetting = new Setting(body).setName("Start date").setDesc("YYYY-MM-DD");
    startInput = startSetting.controlEl.createEl("input", { type: "date" });
    startInput.value = this.state.startDate;

    const endSetting = new Setting(body).setName("End date").setDesc("YYYY-MM-DD");
    endInput = endSetting.controlEl.createEl("input", { type: "date" });
    endInput.value = this.state.endDate;

    this.footer(body, () => {
      const s = startInput.value, e = endInput.value;
      if (!s || !e) { new Notice("Please enter both dates."); return false; }
      if (s >= e)   { new Notice("End date must be after start date."); return false; }
      this.state.startDate = s;
      this.state.endDate   = e;
    });
  }

  // ── Step 4: Holidays & INSET ────────────────────────────────────────────────

  private renderStep4(body: HTMLElement) {
    this.stepHeading(body, 4, "Holidays & INSET days",
      "Mark holidays and INSET days. These are excluded from your directed time count. You can add more in settings later.");

    const listEl = body.createDiv("tp-overrides-list");

    const renderOverrides = () => {
      listEl.empty();
      if (this.state.weekOverrides.length === 0) {
        listEl.createEl("p", { text: "No holidays or INSET days added yet.", cls: "tp-wizard-empty-note" });
      }

      for (const ov of this.state.weekOverrides) {
        // Wrapper stacks Setting row + optional INSET sub-row \u2014 mirrors SettingsTab.renderWeekOverrideRow
        const wrapper = listEl.createDiv("tp-override-entry");
        const row = new Setting(wrapper).setName("").setDesc("");
        row.settingEl.addClass("tp-override-row");

        const fromInput = row.controlEl.createEl("input", { type: "date", cls: "tp-override-date-input" });
        fromInput.value = ov.startDate;
        fromInput.addEventListener("change", () => {
          ov.startDate = fromInput.value;
          if (ov.endDate && ov.endDate < ov.startDate) {
            ov.endDate = ov.startDate;
            toInput.value = ov.startDate;
          }
        });

        row.controlEl.createSpan({ text: "\u2013", cls: "tp-override-sep" });

        const toInput = row.controlEl.createEl("input", { type: "date", cls: "tp-override-date-input" });
        toInput.value = ov.endDate ?? ov.startDate;
        toInput.addEventListener("change", () => {
          ov.endDate = toInput.value === ov.startDate ? undefined : toInput.value;
        });

        const typeSelect = row.controlEl.createEl("select", { cls: "tp-override-type-select" });
        for (const [val, label] of [["holiday","Holiday"],["inset","INSET"]] as [string,string][]) {
          const opt = typeSelect.createEl("option", { text: label, value: val });
          if (ov.type === val) opt.selected = true;
        }

        // Label always visible \u2014 used for both holidays and INSET
        const labelInput = row.controlEl.createEl("input", { type: "text", cls: "tp-override-label-input" });
        labelInput.value = ov.label ?? ""; labelInput.placeholder = "Label (e.g. Christmas)";
        labelInput.addEventListener("change", () => { ov.label = labelInput.value || undefined; });

        const delBtn = row.controlEl.createEl("button", { cls: "tp-icon-btn" });
        setIcon(delBtn, "trash");
        delBtn.addEventListener("click", () => {
          this.state.weekOverrides = this.state.weekOverrides.filter(w => w !== ov);
          renderOverrides();
        });

        // INSET hours sub-row \u2014 shown only when type = INSET
        const insetRow = wrapper.createDiv("tp-override-inset-row");
        insetRow.style.display = ov.type === "inset" ? "flex" : "none";

        insetRow.createSpan({ text: "Directed hours for this period:", cls: "tp-override-inset-label" });
        const hoursInput = insetRow.createEl("input", { type: "number", cls: "tp-override-hours-input" });
        hoursInput.placeholder = "0"; hoursInput.min = "0"; hoursInput.max = "80"; hoursInput.step = "0.5";
        hoursInput.title = "Total directed hours for this entire INSET period";
        hoursInput.value = ov.insetHours != null ? String(ov.insetHours) : "";
        insetRow.createSpan({ text: "h", cls: "tp-override-hours-label" });
        hoursInput.addEventListener("change", () => {
          const n = parseFloat(hoursInput.value);
          ov.insetHours = isNaN(n) || n <= 0 ? undefined : n;
        });

        typeSelect.addEventListener("change", () => {
          ov.type = typeSelect.value as "holiday" | "inset" | "custom";
          insetRow.style.display = ov.type === "inset" ? "flex" : "none";
        });
      }

      new Setting(listEl).addButton(btn => btn.setButtonText("+ Add holiday / INSET").setCta()
        .onClick(() => {
          const today = new Date().toISOString().slice(0, 10);
          this.state.weekOverrides.push({ startDate: today, type: "holiday" });
          renderOverrides();
        }));
    };
    renderOverrides();

    this.footer(body, () => { /* optional */ });
  }

  // ── Step 5: School days + A/B rotation ─────────────────────────────────────

  private renderStep5(body: HTMLElement) {
    this.stepHeading(body, 5, "School days & timetable rotation",
      "Choose which days are school days and optionally enable A/B week rotation.");

    body.createEl("p", { text: "School days", cls: "tp-wizard-sublabel" });
    const dayRow = body.createDiv("tp-school-days-wrap");
    for (const d of DAYS) {
      const lbl = dayRow.createEl("label", { cls: "tp-school-day-label" });
      const cb  = lbl.createEl("input", { type: "checkbox" });
      cb.checked = this.state.schoolDays.includes(d.key);
      lbl.appendText(d.label);
      cb.addEventListener("change", () => {
        if (cb.checked) { if (!this.state.schoolDays.includes(d.key)) this.state.schoolDays.push(d.key); }
        else { this.state.schoolDays = this.state.schoolDays.filter(k => k !== d.key); }
      });
    }

    let abPanel: HTMLElement;
    new Setting(body)
      .setName("Enable A/B week rotation")
      .setDesc("Alternating fortnightly timetables.")
      .addToggle(t => t.setValue(this.state.abWeekEnabled).onChange(v => {
        this.state.abWeekEnabled = v;
        abPanel.style.display = v ? "" : "none";
      }));

    abPanel = body.createDiv();
    abPanel.style.display = this.state.abWeekEnabled ? "" : "none";
    new Setting(abPanel)
      .setName("Academic year starts on")
      .addDropdown(d => d.addOption("A", "Week A").addOption("B", "Week B")
        .setValue(this.state.abWeekStartsOn)
        .onChange(v => { this.state.abWeekStartsOn = v as "A" | "B"; }));

    this.footer(body, () => {
      if (this.state.schoolDays.length === 0) { new Notice("Please select at least one school day."); return false; }
    });
  }

  // ── Step 6: School day blocks (period types) ────────────────────────────────

  private renderStep6(body: HTMLElement) {
    this.stepHeading(body, 6, "School day blocks",
      "Define the types of block that make up your school day \u2014 lessons, breaks, registration, etc. You can assign these to periods in settings later.");

    const listEl = body.createDiv("tp-activities-list");
    const renderList = () => {
      listEl.empty();
      if (this.state.periodTypes.length === 0) {
        listEl.createEl("p", { text: "No block types yet \u2014 add one below, or skip.", cls: "tp-wizard-empty-note" });
      }
      for (const pt of this.state.periodTypes) {
        const row = listEl.createDiv("tp-activity-row");

        const swatch = row.createEl("button", { cls: "tp-colour-swatch-btn tp-colour-swatch-btn--small" });
        swatch.style.background = pt.colour;
        swatch.addEventListener("click", async () => {
          const { ColourPickerModal } = await import("../settings/SettingsTab");
          new ColourPickerModal(this.app, pt.colour, pt.label, async (colour: string) => {
            pt.colour = colour; swatch.style.background = colour;
          }).open();
        });

        const labelIn = row.createEl("input", { type: "text", cls: "tp-class-code-input" });
        labelIn.value = pt.label; labelIn.placeholder = "Block type name";
        labelIn.addEventListener("change", () => { pt.label = labelIn.value; });

        const delBtn = row.createEl("button", { cls: "tp-icon-btn" });
        setIcon(delBtn, "trash-2");
        delBtn.addEventListener("click", () => {
          this.state.periodTypes = this.state.periodTypes.filter(t => t.id !== pt.id);
          renderList();
        });
      }

      new Setting(listEl).addButton(btn => btn.setButtonText("+ Add block type").setCta()
        .onClick(() => {
          this.state.periodTypes.push({ id: "type-" + Date.now(), label: "New Type", colour: "#b4befe" });
          renderList();
        }));
    };
    renderList();

    this.footer(body, () => { /* optional */ });
  }

  // ── Step 7: School periods ──────────────────────────────────────────────────

  private renderStep7(body: HTMLElement) {
    this.stepHeading(body, 7, "School periods",
      "Your default periods are pre-loaded. Add, edit or remove them now \u2014 you can always change these in settings later.");

    const listEl = body.createDiv("tp-wizard-period-list");

    const renderList = () => {
      listEl.empty();

      for (const p of this.state.periods) {
        // Match SettingsTab.renderPeriodRow \u2014 Setting with editable name/times
        const s = new Setting(listEl)
          .setName(p.name)
          .setDesc(`${p.start} \u2013 ${p.end}`);

        s.addText(t => {
          t.setPlaceholder("Name").setValue(p.name);
          t.inputEl.addEventListener("change", () => {
            p.name = t.inputEl.value;
            s.setName(p.name || "Period");
          });
        });
        s.addText(t => {
          t.setPlaceholder("HH:MM").setValue(p.start);
          t.inputEl.style.width = "70px";
          t.inputEl.addEventListener("change", () => {
            p.start = t.inputEl.value;
            s.setDesc(`${p.start} \u2013 ${p.end}`);
          });
        });
        s.addText(t => {
          t.setPlaceholder("HH:MM").setValue(p.end);
          t.inputEl.style.width = "70px";
          t.inputEl.addEventListener("change", () => {
            p.end = t.inputEl.value;
            s.setDesc(`${p.start} \u2013 ${p.end}`);
          });
        });
        s.addExtraButton(btn => btn.setIcon("trash").setTooltip("Remove").onClick(() => {
          this.state.periods = this.state.periods.filter(x => x.id !== p.id);
          renderList();
        }));
      }

      new Setting(listEl).addButton(btn => btn.setButtonText("+ Add period").setCta()
        .onClick(() => {
          this.state.periods.push({ id: "p-" + Date.now(), name: "New Period", start: "09:00", end: "10:00", type: "lesson" });
          renderList();
        }));
    };
    renderList();

    this.footer(body, () => {
      if (this.state.periods.length === 0) { new Notice("Add at least one period."); return false; }
    });
  }

  // ── Step 8: Subjects & classes ──────────────────────────────────────────────

  private renderStep8(body: HTMLElement) {
    this.stepHeading(body, 8, "Subjects & classes",
      "Add the subjects you teach and the class groups within each. You can add more in settings later.");

    const listEl = body.createDiv("tp-wizard-subject-list");
    const renderList = () => {
      listEl.empty();
      for (const subj of this.state.subjects) {
        // Match SettingsTab.renderSubjectBlock structure exactly
        const block = listEl.createDiv("tp-subject-block");
        const hdr   = block.createDiv("tp-subject-header");

        const emojiBtn = hdr.createEl("button", { cls: "tp-emoji-picker-btn", text: subj.emoji ?? "📚" });
        emojiBtn.title = "Change subject emoji";
        emojiBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          openEmojiPicker(emojiBtn, subj.emoji ?? "📚", (emoji: string) => {
            subj.emoji = emoji;
            emojiBtn.textContent = emoji;
          });
        });

        const nameIn = hdr.createEl("input", { type: "text", cls: "tp-subject-name-input" });
        nameIn.value = subj.name; nameIn.placeholder = "Subject name";
        nameIn.addEventListener("change", () => { subj.name = nameIn.value; });

        const addCls = hdr.createEl("button", { text: "+ Class", cls: "tp-btn-small tp-btn-small--cta" });
        addCls.addEventListener("click", () => {
          this.state.classes.push({
            id: "cls-" + Date.now(), year: "", code: "",
            subjectId: subj.id, colour: subj.colour, colourOverridden: false, lessonCount: 0,
          });
          renderList();
        });

        const delSubj = hdr.createEl("button", { cls: "tp-icon-btn" });
        setIcon(delSubj, "trash-2");
        delSubj.addEventListener("click", () => {
          this.state.subjects = this.state.subjects.filter(s => s.id !== subj.id);
          this.state.classes  = this.state.classes.filter(c => c.subjectId !== subj.id);
          renderList();
        });

        // Class rows \u2014 match SettingsTab.renderClassRow structure
        const clsOfSubj = this.state.classes.filter(c => c.subjectId === subj.id);
        if (clsOfSubj.length > 0) {
          const classesEl = block.createDiv("tp-class-rows");
          for (const cls of clsOfSubj) {
            const row = classesEl.createDiv("tp-class-row");

            const clsSwatch = row.createEl("button", { cls: "tp-colour-swatch-btn tp-colour-swatch-btn--small" });
            clsSwatch.style.background = cls.colour;
            clsSwatch.title = "Override class colour";
            clsSwatch.addEventListener("click", async () => {
              const { ColourPickerModal } = await import("../settings/SettingsTab");
              new ColourPickerModal(this.app, cls.colour, cls.code || "Class", async (colour: string) => {
                cls.colour = colour;
                cls.colourOverridden = colour !== subj.colour;
                clsSwatch.style.background = colour;
              }).open();
            });

            const yearIn = row.createEl("input", { type: "text", cls: "tp-year-input" });
            yearIn.value = cls.year ?? ""; yearIn.placeholder = "Year (e.g. Y12)";
            yearIn.addEventListener("change", () => { cls.year = yearIn.value; });

            const codeIn = row.createEl("input", { type: "text", cls: "tp-class-code-input" });
            codeIn.value = cls.code; codeIn.placeholder = "Class code";
            codeIn.addEventListener("change", () => { cls.code = codeIn.value; });

            const roomIn = row.createEl("input", { type: "text", cls: "tp-class-code-input" });
            roomIn.value = cls.classroom ?? ""; roomIn.placeholder = "Classroom";
            roomIn.addEventListener("change", () => { cls.classroom = roomIn.value; });

            const delCls = row.createEl("button", { cls: "tp-icon-btn" });
            setIcon(delCls, "trash-2");
            delCls.addEventListener("click", () => {
              this.state.classes = this.state.classes.filter(c => c.id !== cls.id);
              renderList();
            });
          }
        }
      }

      new Setting(listEl).addButton(btn => btn.setButtonText("+ Add subject").setCta()
        .onClick(() => {
          const colour = CLASS_COLOUR_PALETTE[this.state.subjects.length % CLASS_COLOUR_PALETTE.length];
          this.state.subjects.push({ id: "subj-" + Date.now(), name: "New Subject", colour, emoji: "📚" });
          renderList();
        }));
    };
    renderList();

    // Custom footer \u2014 back + save & continue
    const footer = body.createDiv("tp-wizard-footer");
    const back = footer.createEl("button", { text: "\u2190 Back", cls: "tp-btn" });
    back.addEventListener("click", () => { this.step--; this.render(); });
    const next = footer.createEl("button", { text: "Save & continue \u2192", cls: "tp-btn tp-btn--primary" });
    next.addEventListener("click", () => { this.step++; this.render(); });
  }

  // ── Step 9: Timetable editor ────────────────────────────────────────────────

  private renderStep9(body: HTMLElement) {
    this.stepHeading(body, 9, "Set up your timetable",
      "The planner has been saved. Use the timetable editor to assign classes to periods \u2014 you can also do this later from the main view.");

    void this.commitPlanner();

    const callout = body.createDiv("tp-wizard-callout");
    callout.createEl("p", { text: "\u2705  Your planner has been created and is now active. You can close this wizard at any time and finish configuring your timetable from the main view." });

    const editorBtn = body.createEl("button", {
      text: "Open timetable editor",
      cls: "tp-btn tp-btn--primary tp-wizard-editor-btn",
    });
    editorBtn.addEventListener("click", () => { new TimetableEditorModal(this.app, this.plugin).open(); });

    const footer = body.createDiv("tp-wizard-footer");
    footer.createDiv();
    const next = footer.createEl("button", { text: "Continue to summary \u2192", cls: "tp-btn tp-btn--primary" });
    next.addEventListener("click", () => { this.step++; this.render(); });
  }

  // ── Step 10: Summary ────────────────────────────────────────────────────────

  private renderStep10(body: HTMLElement) {
    this.stepHeading(body, 10, "All done!", "Your planner is ready. Here\u2019s a summary of what was set up.");

    const summary = body.createDiv("tp-wizard-summary");
    const row = (label: string, value: string) => {
      const r = summary.createDiv("tp-wizard-summary-row");
      r.createEl("span", { text: label + ":", cls: "tp-wizard-summary-label" });
      r.createEl("span", { text: value,       cls: "tp-wizard-summary-value" });
    };

    const s = this.plugin.settings;
    const dt = s.directedTime;
    row("Planner name",     s.academicYear.name);
    row("Academic year",    `${s.academicYear.startDate} \u2192 ${s.academicYear.endDate}`);
    row("School days",      s.schoolDays?.map(d => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(", ") ?? "Mon\u2013Fri");
    row("A/B rotation",     s.academicYear.abWeekEnabled ? `Enabled (starts Week ${s.academicYear.abWeekStartsOn})` : "Disabled");
    row("Directed time",    dt?.enabled ? `Enabled \u2014 ${(dt.contractedHours * dt.timetablePercentage / 100).toFixed(0)}h effective` : "Disabled");
    row("Holidays / INSET", `${s.weekOverrides.length} range${s.weekOverrides.length !== 1 ? "s" : ""} marked`);
    row("Block types",      `${(s.periodTypes ?? []).length} defined`);
    row("Periods",          `${s.academicYear.periods.length} periods defined`);
    row("Subjects",         `${s.subjects.length} subject${s.subjects.length !== 1 ? "s" : ""}`);
    row("Classes",          `${s.classes.length} class group${s.classes.length !== 1 ? "s" : ""}`);
    row("Planner folder",   s.plannerFolder);

    const footer = body.createDiv("tp-wizard-footer");
    footer.createDiv();
    const openBtn = footer.createEl("button", { text: "Open planner \u2192", cls: "tp-btn tp-btn--primary" });
    openBtn.addEventListener("click", async () => {
      this.close();
      await this.plugin.activateView();
    });
  }

  // ── Commit the planner to plugin data ───────────────────────────────────────

  private async commitPlanner() {
    const rootFolder   = this.plugin.plannerData.rootPlannerFolder;
    const plannerFolder = rootFolder + "/" + this.state.name;

    const record: PlannerRecord = {
      ...DEFAULT_PLANNER,
      id:           "planner-" + Date.now(),
      name:         this.state.name,
      plannerFolder,
      academicYear: {
        id:             "ay-" + Date.now(),
        name:           this.state.name,
        startDate:      this.state.startDate,
        endDate:        this.state.endDate,
        periods:        this.state.periods,
        abWeekEnabled:  this.state.abWeekEnabled,
        abWeekStartsOn: this.state.abWeekStartsOn,
      },
      schoolDays:         this.state.schoolDays,
      periodTypes:        this.state.periodTypes,
      subjects:           this.state.subjects,
      classes:            this.state.classes,
      activities:         this.state.activities,
      weekOverrides:      this.state.weekOverrides,
      directedTime: {
        enabled:                      this.state.directedTimeEnabled,
        contractedHours:              this.state.contractedHours,
        timetablePercentage:          this.state.timetablePercentage,
        defaultLessonDurationMinutes: this.state.defaultLessonDurationMinutes,
      },
      timetableTemplates: [{
        id:        "template-default",
        name:      "Default Timetable",
        startDate: this.state.startDate,
        endDate:   this.state.endDate,
        slots:     [],
      }],
    };

    await this.plugin.createPlanner(record);

    // Auto-create the directed time guide note if the tracker was enabled
    if (this.state.directedTimeEnabled) {
      await this.createDirectedTimeGuideNote(plannerFolder);
    }
  }

  /** Create the directed time guide note in the planner folder. */
  private async createDirectedTimeGuideNote(plannerFolder: string) {
    const path = plannerFolder + "/Directed Time \u2014 Guide.md";
    if (this.app.vault.getAbstractFileByPath(path)) return; // already exists

    const contractedHours   = this.state.contractedHours;
    const timetablePct      = this.state.timetablePercentage;
    const effectiveHours    = (contractedHours * timetablePct / 100).toFixed(1);

    const content = [
      "# Directed Time Tracker \u2014 Guide",
      "",
      "## What is directed time?",
      "",
      "In England, under the **School Teachers\u2019 Pay and Conditions Document (STPCD)**, a full-time teacher may be directed to work for up to **1,265 hours per year** across a maximum of 195 days (190 teaching days + 5 INSET days). This is the statutory maximum \u2014 your school cannot lawfully direct you to exceed it.",
      "",
      `> **Your current settings:** ${contractedHours}h contracted \u00d7 ${timetablePct}% timetable fraction = **${effectiveHours}h effective maximum**`,
      "",
      "---",
      "",
      "## How this tracker works",
      "",
      "The directed time tracker calculates your cumulative directed time from events recorded in your planner. It counts:",
      "",
      "- **Timetable lessons** \u2014 every class slot on your timetable, using the lesson duration you configure (default: 60 min, adjustable per slot in the timetable editor).",
      "- **Directed time activities** \u2014 items in the *Directed time* section of Settings added to your planner (e.g. Cover, Duty, Meetings, Tutor).",
      "- **Holiday/INSET weeks** \u2014 automatically excluded from the count.",
      "- **Other events** \u2014 items in the *Other events* section of Settings are excluded from the directed time total.",
      "",
      "The sidebar panel shows:",
      "",
      "| Field | Meaning |",
      "|---|---|",
      "| **Accrued to date** | Hours logged up to and including the current week |",
      "| **Predicted total** | Full-year projection if current timetable continues |",
      "| **Contracted max** | Your statutory ceiling (adjusted for part-time fraction) |",
      "",
      "---",
      "",
      "## Part-time teachers",
      "",
      "Set your **timetable fraction** in *Settings \u2192 Directed Time Tracker*. Your effective maximum = contracted hours \u00d7 fraction.",
      "",
      "*Example:* A 0.6 FTE teacher: 1,265 \u00d7 60% = **759 hours maximum**.",
      "",
      "---",
      "",
      "## Keeping your data accurate",
      "",
      "- Add one-off events (cover lessons, extra meetings, parents evenings) as **date events** in your planner using the **+ Event** button.",
      "- If a timetable lesson is cancelled, use the **Exclude** option in the lesson notes panel so it isn\u2019t counted.",
      "- Update slot durations if your lessons aren\u2019t exactly 60 minutes (click the duration badge in the timetable editor).",
      "",
      "---",
      "",
      "## Exporting your data",
      "",
      "Use **Settings \u2192 Directed Time Tracker \u2192 Export XLSX\u2026** to download a detailed Excel report with:",
      "",
      "- **Summary sheet** \u2014 contracted hours, accrued, predicted, and margin at a glance",
      "- **Weekly Breakdown sheet** \u2014 every week of the academic year with lesson, activity, and event counts",
      "",
      "This report is useful evidence to share with your union representative or school management.",
      "",
      "---",
      "",
      "## \u26a0\ufe0f Important disclaimer",
      "",
      "This tracker is a **guide only**. Accuracy depends entirely on the information you enter into your planner. It does not constitute legal advice. If you believe your directed time is being exceeded, **contact your union representative** for formal guidance.",
      "",
      "---",
      "",
      "## Useful contacts",
      "",
      "- **NEU** (National Education Union): [neu.org.uk](https://neu.org.uk)",
      "- **NASUWT**: [nasuwt.org.uk](https://www.nasuwt.org.uk)",
      "- **NAHT**: [naht.org.uk](https://www.naht.org.uk)",
      "- **ATL / Voice**: check your contract for the affiliated union",
    ].join("\n");

    try {
      await this.app.vault.create(path, content);
    } catch (e) {
      console.warn("Teacher Planner: could not create directed time guide note:", e);
    }
  }
}

// ── Exit confirmation modal ───────────────────────────────────────────────────

class WizardCloseConfirmModal extends Modal {
  private onConfirm: () => void;

  constructor(app: App, onConfirm: () => void) {
    super(app);
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText("Exit setup wizard?");
    contentEl.createEl("p", {
      text: "Your planner has not been saved yet. If you exit now, all progress will be lost and you will need to start the setup again.",
      cls: "setting-item-description",
    });
    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText("Continue setup")
        .setCta()
        .onClick(() => this.close()))
      .addButton(btn => btn
        .setButtonText("Exit without saving")
        .setWarning()
        .onClick(() => { this.close(); this.onConfirm(); }));
  }

  onClose() { this.contentEl.empty(); }
}
