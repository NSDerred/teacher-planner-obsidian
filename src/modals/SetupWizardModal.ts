import { App, Modal, Notice, Setting, setIcon, FuzzySuggestModal, TFile } from "obsidian";
import type TeacherPlannerPlugin from "../main";
import type {
  PlannerRecord, Subject, ClassGroup, SchoolDay,
  WeekOverride, PeriodTypeConfig, Activity, DaySchedule,
} from "../types";
import { DEFAULT_PLANNER, DEFAULT_SETTINGS, CLASS_COLOUR_PALETTE, FALLBACK_PERIOD_TYPE_COLOUR } from "../settings";
import { resolveColour } from "../utils/themeColours";
import { isValidIsoDate, findOverlappingOverrides } from "../utils/weekUtils";
import { syncPeriodsUnion } from "../utils/scheduleUtils";
import { listTemplateFiles, parseTemplate, structureTemplatesFolder } from "../utils/schoolTemplates";
import { TimetableEditorModal } from "./TimetableEditorModal";
import { openEmojiPicker, closeEmojiPicker, TextPromptModal, ConfirmModal } from "../settings/SettingsTab";

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
  daySchedules: DaySchedule[];
  dayScheduleMap: Partial<Record<SchoolDay, string>>;
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
        { startDate: "2025-12-22", endDate: "2026-01-02", type: "holiday", label: "Winter Break" },
        { startDate: "2026-02-16", endDate: "2026-02-20", type: "holiday", label: "Spring Half Term" },
        { startDate: "2026-04-01", endDate: "2026-04-17", type: "holiday", label: "Spring Break" },
        { startDate: "2026-05-25", endDate: "2026-05-29", type: "holiday", label: "May Half Term" },
      ],
      schoolDays:                   [...DEFAULT_PLANNER.schoolDays] as SchoolDay[],
      abWeekEnabled:                false,
      abWeekStartsOn:               "A",
      periodTypes:                  DEFAULT_SETTINGS.periodTypes.map(p => ({ ...p })),
      daySchedules:                 [{ id: "schedule-standard", name: "Standard day", periods: ay.periods.map(p => ({ ...p })) }],
      dayScheduleMap:               {},
      subjects:                     [],
      classes:                      [],
    };
  }

  onOpen() {
    this.modalEl.addClass("tp-wizard-modal");
    this.render();
  }

  onClose() { closeEmojiPicker(); this.contentEl.empty(); }

  /** Intercept all close attempts on steps 1–8 — planner not yet committed. */
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
    bar.createDiv("tp-wizard-bar-fill").setCssStyles({ width: pct + "%" });

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
      const back = footer.createEl("button", { text: "← Back", cls: "tp-btn" });
      back.addEventListener("click", () => { this.step--; this.render(); });
    } else {
      footer.createDiv();
    }
    const next = footer.createEl("button", { text: "Next →", cls: "tp-btn tp-btn--primary" });
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

  private loadStructureTemplate() {
    const files = listTemplateFiles(this.plugin, "structure");
    if (files.length === 0) { new Notice(`No structure templates in "${structureTemplatesFolder(this.plugin)}".`); return; }
    new WizardTemplatePickModal(this.app, files, (file) => { void (async () => {
      let tpl;
      try { tpl = parseTemplate(await this.app.vault.read(file)); }
      catch (e) { new Notice(e instanceof Error ? e.message : "Could not read template."); return; }
      if (tpl.kind !== "structure" || !tpl.structure) { new Notice("That file is not a school structure template."); return; }
      const st = tpl.structure;
      const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null));
      let daySchedules: DaySchedule[] = clone(st.daySchedules) ?? [];
      if (daySchedules.length === 0 && (st.periods?.length ?? 0) > 0) {
        daySchedules = [{ id: "sched-default", name: "Standard day", periods: clone(st.periods) }];
      }
      this.state.periodTypes = clone(st.periodTypes) ?? [];
      this.state.daySchedules = daySchedules;
      this.state.dayScheduleMap = clone(st.dayScheduleMap) ?? {};
      if (st.schoolDays) this.state.schoolDays = clone(st.schoolDays);
      this.state.abWeekEnabled = !!st.abWeekEnabled;
      this.state.abWeekStartsOn = st.abWeekStartsOn ?? "A";
      new Notice(`Loaded structure from "${tpl.name}".`);
      this.render();
    })(); }).open();
  }

  private renderStep1(body: HTMLElement) {
    this.stepHeading(body, 1, "Name your planner",
      "Give this planner a name — usually the academic year. It will also be used as the vault subfolder.");

    let nameInput: HTMLInputElement;
    new Setting(body)
      .setName("Planner name")
      .setDesc('e.g. "2025-26 IB Science"')
      .addText(t => {
        t.setPlaceholder("2025-26").setValue(this.state.name);
        t.inputEl.maxLength = 60;
        nameInput = t.inputEl;
        window.setTimeout(() => t.inputEl.focus(), 50);
      });

    new Setting(body)
      .setName("Start from a school structure template")
      .setDesc("Optional. Load a saved school shell (periods, blocks, A/B pattern, school days) so the next steps come pre-filled.")
      .addButton(btn => btn.setButtonText("Choose template…").onClick(() => this.loadStructureTemplate()));

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
        dtPanel.setCssStyles({ display: v ? "" : "none" });
      }));

    dtPanel = body.createDiv();
    dtPanel.setCssStyles({ display: this.state.directedTimeEnabled ? "" : "none" });

    // ── Disclaimer callout ──────────────────────────────────────────────────
    const dtCallout = dtPanel.createDiv("tp-dt-callout");
    dtCallout.createEl("p", { text: "ℹ️  How it works: Directed time is counted only from items placed in your planner. The tracker shows hours accrued to today and a projection based on future planned events. Keep your planner up to date for accurate figures." });
    dtCallout.createEl("p", { text: "⚠️  This tracker is a guide only. Accuracy depends entirely on the information you enter. It does not constitute legal advice — always consult your union representative for formal disputes." });

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

    dtPanel.createEl("p", {
      text: "Each lesson, activity, and event counts the length of the block it sits in. You can set a different duration on any block later by clicking its duration badge in the timetable editor.",
      cls: "setting-item-description",
    });

    // ── Directed time activities ────────────────────────────────────────────
    dtPanel.createEl("p", { text: "Directed time activities", cls: "tp-wizard-sublabel" });

    const activityHeaders = dtPanel.createDiv("tp-activity-row tp-activity-headers");
    activityHeaders.createDiv().setCssStyles({ width: "28px", flexShrink: "0" });
    const makeH = (text: string, extra?: Partial<CSSStyleDeclaration>) => {
      const h = activityHeaders.createEl("span", { text, cls: "tp-activity-header-label" });
      if (extra) h.setCssStyles(extra);
    };
    makeH("Name");
    activityHeaders.createDiv().setCssStyles({ width: "28px", flexShrink: "0" });

    const actList = dtPanel.createDiv("tp-activities-list");

    const renderActs = () => {
      actList.empty();
      if (this.state.activities.length === 0) {
        actList.createEl("p", { text: "No activities yet — add one below.", cls: "tp-wizard-empty-note" });
      }
      for (const act of this.state.activities) {
        const row = actList.createDiv("tp-activity-row");

        const swatch = row.createEl("button", { cls: "tp-colour-swatch-btn tp-colour-swatch-btn--small" });
        swatch.setCssStyles({ background: act.colour });
        swatch.addEventListener("click", () => { void (async () => {
          const { ColourPickerModal } = await import("../settings/SettingsTab");
          new ColourPickerModal(this.app, act.colour, act.label, async (colour: string) => {
            act.colour = colour; swatch.setCssStyles({ background: colour });
          }).open();
        })(); });

        const labelIn = row.createEl("input", { type: "text", cls: "tp-class-code-input" });
        labelIn.value = act.label; labelIn.placeholder = "Activity name";
        labelIn.addEventListener("change", () => { act.label = labelIn.value; });

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
      if (!isValidIsoDate(s) || !isValidIsoDate(e)) {
        new Notice("Please enter valid dates in YYYY-MM-DD format."); return false;
      }
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
        // Wrapper stacks Setting row + optional INSET sub-row — mirrors SettingsTab.renderWeekOverrideRow
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

        row.controlEl.createSpan({ text: "–", cls: "tp-override-sep" });

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

        // Label always visible — used for both holidays and INSET
        const labelInput = row.controlEl.createEl("input", { type: "text", cls: "tp-override-label-input" });
        labelInput.value = ov.label ?? ""; labelInput.placeholder = "Label (e.g. Christmas)";
        labelInput.addEventListener("change", () => { ov.label = labelInput.value || undefined; });

        const delBtn = row.controlEl.createEl("button", { cls: "tp-icon-btn" });
        setIcon(delBtn, "trash");
        delBtn.addEventListener("click", () => {
          this.state.weekOverrides = this.state.weekOverrides.filter(w => w !== ov);
          renderOverrides();
        });

        // INSET hours sub-row — shown only when type = INSET and directed time enabled
        const insetRow = wrapper.createDiv("tp-override-inset-row");
        insetRow.setCssStyles({ display: ov.type === "inset" && this.state.directedTimeEnabled ? "flex" : "none" });

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
          insetRow.setCssStyles({ display: ov.type === "inset" && this.state.directedTimeEnabled ? "flex" : "none" });
        });
      }

      new Setting(listEl)
        .addButton(btn => btn.setButtonText("+ Add holiday / INSET").setCta()
          .onClick(() => {
            const today = new Date().toISOString().slice(0, 10);
            this.state.weekOverrides.push({ startDate: today, type: "holiday" });
            renderOverrides();
          }))
        .addButton(btn => btn.setButtonText("Clear all").setClass("mod-warning")
          .onClick(() => {
            if (this.state.weekOverrides.length === 0) return;
            new ConfirmModal(this.app, "Remove all holidays and INSET days?", () => {
              this.state.weekOverrides = [];
              renderOverrides();
            }, "Remove all").open();
          }));
    };
    renderOverrides();

    this.footer(body, () => {
      const overlap = findOverlappingOverrides(this.state.weekOverrides);
      if (overlap) {
        const name = (o: WeekOverride) => o.label || (o.type === "inset" ? "INSET" : "Holiday");
        new Notice(
          `"${name(overlap[0])}" (from ${overlap[0].startDate}) and "${name(overlap[1])}" (from ${overlap[1].startDate}) overlap — please adjust the dates.`,
          6000
        );
        return false;
      }
    });
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
        abPanel.setCssStyles({ display: v ? "" : "none" });
      }));

    abPanel = body.createDiv();
    abPanel.setCssStyles({ display: this.state.abWeekEnabled ? "" : "none" });
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
      "Define the types of block that make up your school day — lessons, breaks, registration, etc. You can assign these to periods in settings later.");

    const listEl = body.createDiv("tp-activities-list");
    const renderList = () => {
      listEl.empty();
      if (this.state.periodTypes.length === 0) {
        listEl.createEl("p", { text: "No block types yet — add one below, or skip.", cls: "tp-wizard-empty-note" });
      }
      for (const pt of this.state.periodTypes) {
        const row = listEl.createDiv("tp-activity-row");

        const swatch = row.createEl("button", { cls: "tp-colour-swatch-btn tp-colour-swatch-btn--small" });
        swatch.setCssStyles({ background: resolveColour(pt.colour) });
        swatch.addEventListener("click", () => { void (async () => {
          const { ColourPickerModal } = await import("../settings/SettingsTab");
          new ColourPickerModal(this.app, pt.colour, pt.label, async (colour: string) => {
            pt.colour = colour; swatch.setCssStyles({ background: resolveColour(colour) });
          }, true).open();
        })(); });

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
          this.state.periodTypes.push({ id: "type-" + Date.now(), label: "New Type", colour: FALLBACK_PERIOD_TYPE_COLOUR });
          renderList();
        }));
    };
    renderList();

    this.footer(body, () => { /* optional */ });
  }

  // ── Step 7: School periods ──────────────────────────────────────────────────

  /** Schedule selected for editing in Step 7. */
  private wizScheduleId: string | null = null;

  private wizSelectedSchedule(): DaySchedule {
    const found = this.state.daySchedules.find(s => s.id === this.wizScheduleId);
    if (found) return found;
    this.wizScheduleId = this.state.daySchedules[0].id;
    return this.state.daySchedules[0];
  }

  private renderStep7(body: HTMLElement) {
    this.stepHeading(body, 7, "School periods",
      "Your default periods are pre-loaded into the Standard day. If some days are shaped differently — a sports afternoon, a half-day Saturday — add another day schedule and assign those days to it. Everything can be changed in settings later.");

    const barEl  = body.createDiv("tp-wizard-schedule-bar");
    const listEl = body.createDiv("tp-wizard-period-list");

    const renderBar = () => {
      barEl.empty();
      const sel = this.wizSelectedSchedule();

      const bar = new Setting(barEl)
        .setName("Day schedule")
        .setDesc("Choose a schedule to edit. Click a day below to make it use the selected schedule.");
      bar.addDropdown(d => {
        for (const sch of this.state.daySchedules) d.addOption(sch.id, sch.name);
        d.setValue(sel.id);
        d.onChange(v => { this.wizScheduleId = v; renderBar(); renderList(); });
      });
      bar.addExtraButton(b => b.setIcon("pencil").setTooltip("Rename schedule").onClick(() => {
        new TextPromptModal(this.app, "Rename day schedule", sel.name, "Schedule name", (name) => {
          sel.name = name;
          renderBar();
        }).open();
      }));
      bar.addExtraButton(b => b.setIcon("plus").setTooltip("New day schedule").onClick(() => {
        new TextPromptModal(this.app, "New day schedule", "", "e.g. Saturday, Sports day", (name) => {
          const sch: DaySchedule = { id: "schedule-" + Date.now(), name, periods: [] };
          this.state.daySchedules.push(sch);
          this.wizScheduleId = sch.id;
          renderBar();
          renderList();
        }).open();
      }));
      bar.addExtraButton(b => b.setIcon("trash").setTooltip("Delete schedule").onClick(() => {
        if (this.state.daySchedules.length <= 1) { new Notice("At least one day schedule is required."); return; }
        new ConfirmModal(this.app, `Delete schedule "${sel.name}"? Days using it fall back to the first schedule.`, () => {
          this.state.daySchedules = this.state.daySchedules.filter(s => s.id !== sel.id);
          for (const key of Object.keys(this.state.dayScheduleMap) as SchoolDay[]) {
            if (this.state.dayScheduleMap[key] === sel.id) delete this.state.dayScheduleMap[key];
          }
          this.wizScheduleId = this.state.daySchedules[0].id;
          renderBar();
          renderList();
        }, "Delete").open();
      }));

      const pillRow = barEl.createDiv("tp-schedule-days");
      for (const { key, label } of DAYS) {
        if (!this.state.schoolDays.includes(key)) continue;
        const mappedId = this.state.dayScheduleMap[key];
        const dayId = this.state.daySchedules.find(s => s.id === mappedId)?.id ?? this.state.daySchedules[0].id;
        const active = dayId === sel.id;
        const pill = pillRow.createEl("button", { text: label, cls: "tp-schedule-day-pill" });
        if (active) pill.addClass("tp-schedule-day-pill--active");
        pill.title = active ? `${label} uses "${sel.name}"` : `Click to use "${sel.name}" on ${label}`;
        pill.addEventListener("click", () => {
          if (this.state.daySchedules.length < 2) {
            new Notice("All days use the only schedule. Click + to create a second schedule first.");
            return;
          }
          if (active) { new Notice(`${label} already uses "${sel.name}". Select a different schedule to move it.`); return; }
          this.state.dayScheduleMap[key] = sel.id;
          renderBar();
        });
      }
      if (this.state.daySchedules.length < 2) {
        barEl.createEl("p", {
          text: "All days currently use this schedule. Click + above to add e.g. a Saturday schedule, then click a day pill to assign it.",
          cls: "setting-item-description",
        });
      }
    };

    const renderList = () => {
      listEl.empty();
      const sched = this.wizSelectedSchedule();

      for (const p of sched.periods) {
        // Match SettingsTab.renderPeriodRow — Setting with editable name/times
        const s = new Setting(listEl)
          .setName(p.name)
          .setDesc(`${p.start} – ${p.end}`);

        s.addText(t => {
          t.setPlaceholder("Name").setValue(p.name);
          t.inputEl.addEventListener("change", () => {
            p.name = t.inputEl.value;
            s.setName(p.name || "Period");
          });
        });
        s.addText(t => {
          t.setPlaceholder("HH:MM").setValue(p.start);
          t.inputEl.setCssStyles({ width: "70px" });
          t.inputEl.addEventListener("change", () => {
            p.start = t.inputEl.value;
            s.setDesc(`${p.start} – ${p.end}`);
          });
        });
        s.addText(t => {
          t.setPlaceholder("HH:MM").setValue(p.end);
          t.inputEl.setCssStyles({ width: "70px" });
          t.inputEl.addEventListener("change", () => {
            p.end = t.inputEl.value;
            s.setDesc(`${p.start} – ${p.end}`);
          });
        });
        s.addDropdown(d => {
          const types = this.state.periodTypes ?? [];
          if (types.length === 0) {
            d.addOption("lesson", "Lesson").addOption("break", "Break")
             .addOption("registration", "Registration").addOption("free", "Free");
          } else {
            for (const pt of types) d.addOption(pt.id, pt.label);
          }
          d.setValue(p.type).onChange(v => { p.type = v; });
        });
        s.addExtraButton(btn => btn.setIcon("trash").setTooltip("Remove").onClick(() => {
          sched.periods = sched.periods.filter(x => x.id !== p.id);
          renderList();
        }));
      }

      new Setting(listEl)
        .addButton(btn => btn.setButtonText("+ Add period").setCta()
          .onClick(() => {
            const defaultType = this.state.periodTypes?.[0]?.id ?? "lesson";
            sched.periods.push({ id: "p-" + Date.now(), name: "New Period", start: "09:00", end: "10:00", type: defaultType });
            renderList();
          }))
        .addButton(btn => btn.setButtonText("Clear all").setClass("mod-warning")
          .onClick(() => {
            if (sched.periods.length === 0) return;
            new ConfirmModal(this.app, `Remove all periods from "${sched.name}"?`, () => {
              sched.periods = [];
              renderList();
            }, "Remove all").open();
          }));
    };
    renderBar();
    renderList();

    this.footer(body, () => {
      const empty = this.state.daySchedules.find(s => s.periods.length === 0);
      if (empty) { new Notice(`Schedule "${empty.name}" has no periods — add at least one or delete the schedule.`); return false; }
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
            subjectId: subj.id, colour: subj.colour ?? CLASS_COLOUR_PALETTE[0], colourOverridden: false, lessonCount: 0,
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

        // Class rows — match SettingsTab.renderClassRow structure
        const clsOfSubj = this.state.classes.filter(c => c.subjectId === subj.id);
        if (clsOfSubj.length > 0) {
          const classesEl = block.createDiv("tp-class-rows");
          for (const cls of clsOfSubj) {
            const row = classesEl.createDiv("tp-class-row");

            const clsSwatch = row.createEl("button", { cls: "tp-colour-swatch-btn tp-colour-swatch-btn--small" });
            clsSwatch.setCssStyles({ background: cls.colour });
            clsSwatch.title = "Override class colour";
            clsSwatch.addEventListener("click", () => { void (async () => {
              const { ColourPickerModal } = await import("../settings/SettingsTab");
              new ColourPickerModal(this.app, cls.colour, cls.code || "Class", async (colour: string) => {
                cls.colour = colour;
                cls.colourOverridden = colour !== subj.colour;
                clsSwatch.setCssStyles({ background: colour });
              }).open();
            })(); });

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

    // Custom footer — back + save & continue
    const footer = body.createDiv("tp-wizard-footer");
    const back = footer.createEl("button", { text: "← Back", cls: "tp-btn" });
    back.addEventListener("click", () => { this.step--; this.render(); });
    const next = footer.createEl("button", { text: "Save & continue →", cls: "tp-btn tp-btn--primary" });
    next.addEventListener("click", () => { this.step++; this.render(); });
  }

  // ── Step 9: Timetable editor ────────────────────────────────────────────────

  private renderStep9(body: HTMLElement) {
    this.stepHeading(body, 9, "Set up your timetable",
      "The planner has been saved. Use the timetable editor to assign classes to periods — you can also do this later from the main view.");

    void this.commitPlanner();

    const callout = body.createDiv("tp-wizard-callout");
    callout.createEl("p", { text: "✅  Your planner has been created and is now active. You can close this wizard at any time and finish configuring your timetable from the main view." });

    const editorBtn = body.createEl("button", {
      text: "Open timetable editor",
      cls: "tp-btn tp-btn--primary tp-wizard-editor-btn",
    });
    editorBtn.addEventListener("click", () => { new TimetableEditorModal(this.app, this.plugin).open(); });

    const footer = body.createDiv("tp-wizard-footer");
    footer.createDiv();
    const next = footer.createEl("button", { text: "Continue to summary →", cls: "tp-btn tp-btn--primary" });
    next.addEventListener("click", () => { this.step++; this.render(); });
  }

  // ── Step 10: Summary ────────────────────────────────────────────────────────

  private renderStep10(body: HTMLElement) {
    this.stepHeading(body, 10, "All done!", "Your planner is ready. Here’s a summary of what was set up.");

    const summary = body.createDiv("tp-wizard-summary");
    const row = (label: string, value: string) => {
      const r = summary.createDiv("tp-wizard-summary-row");
      r.createEl("span", { text: label + ":", cls: "tp-wizard-summary-label" });
      r.createEl("span", { text: value,       cls: "tp-wizard-summary-value" });
    };

    const s = this.plugin.settings;
    const dt = s.directedTime;
    row("Planner name",     s.academicYear.name);
    row("Academic year",    `${s.academicYear.startDate} → ${s.academicYear.endDate}`);
    row("School days",      s.schoolDays?.map(d => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(", ") ?? "Mon–Fri");
    row("A/B rotation",     s.academicYear.abWeekEnabled ? `Enabled (starts Week ${s.academicYear.abWeekStartsOn})` : "Disabled");
    row("Directed time",    dt?.enabled ? `Enabled — ${(dt.contractedHours * dt.timetablePercentage / 100).toFixed(0)}h effective` : "Disabled");
    row("Holidays / INSET", `${s.weekOverrides.length} range${s.weekOverrides.length !== 1 ? "s" : ""} marked`);
    row("Block types",      `${(s.periodTypes ?? []).length} defined`);
    row("Day schedules",    (s.academicYear.daySchedules ?? []).map(d => `${d.name} (${d.periods.length})`).join(" · ") || `${s.academicYear.periods.length} periods`);
    row("Subjects",         `${s.subjects.length} subject${s.subjects.length !== 1 ? "s" : ""}`);
    row("Classes",          `${s.classes.length} class group${s.classes.length !== 1 ? "s" : ""}`);
    row("Planner folder",   s.plannerFolder);

    const footer = body.createDiv("tp-wizard-footer");
    footer.createDiv();
    const openBtn = footer.createEl("button", { text: "Open planner →", cls: "tp-btn tp-btn--primary" });
    openBtn.addEventListener("click", () => { void (async () => {
      this.close();
      await this.plugin.activateView();
    })(); });
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
        periods:        [],
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

    record.academicYear.daySchedules   = this.state.daySchedules;
    record.academicYear.dayScheduleMap = this.state.dayScheduleMap;
    syncPeriodsUnion(record.academicYear);

    await this.plugin.createPlanner(record);

    // Auto-create the directed time guide note if the tracker was enabled
    if (this.state.directedTimeEnabled) {
      await this.createDirectedTimeGuideNote(plannerFolder);
    }
  }

  /** Create the directed time guide note in the planner folder. */
  private async createDirectedTimeGuideNote(plannerFolder: string) {
    const path = plannerFolder + "/Directed Time — Guide.md";
    if (this.app.vault.getAbstractFileByPath(path)) return; // already exists

    const contractedHours   = this.state.contractedHours;
    const timetablePct      = this.state.timetablePercentage;
    const effectiveHours    = (contractedHours * timetablePct / 100).toFixed(1);

    const content = [
      "# Directed Time Tracker — Guide",
      "",
      "## What is directed time?",
      "",
      "In England, under the **School Teachers’ Pay and Conditions Document (STPCD)**, a full-time teacher may be directed to work for up to **1,265 hours per year** across a maximum of 195 days (190 teaching days + 5 INSET days). This is the statutory maximum — your school cannot lawfully direct you to exceed it.",
      "",
      `> **Your current settings:** ${contractedHours}h contracted × ${timetablePct}% timetable fraction = **${effectiveHours}h effective maximum**`,
      "",
      "---",
      "",
      "## How this tracker works",
      "",
      "The directed time tracker calculates your cumulative directed time from events recorded in your planner. It counts:",
      "",
      "- **Timetable lessons** — every class slot on your timetable, each counting the length of its block (adjustable per slot via the duration badge in the timetable editor).",
      "- **Directed time activities** — items in the *Directed time* section of Settings added to your planner (e.g. Cover, Duty, Meetings, Tutor).",
      "- **Holiday/INSET weeks** — automatically excluded from the count.",
      "- **Other events** — items in the *Other events* section of Settings are excluded from the directed time total.",
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
      "Set your **timetable fraction** in *Settings → Directed Time Tracker*. Your effective maximum = contracted hours × fraction.",
      "",
      "*Example:* A 0.6 FTE teacher: 1,265 × 60% = **759 hours maximum**.",
      "",
      "---",
      "",
      "## Keeping your data accurate",
      "",
      "- Add one-off events (cover lessons, extra meetings, parents evenings) as **date events** in your planner using the **+ Event** button.",
      "- If a timetable lesson is cancelled, use the **Exclude** option in the lesson notes panel so it isn’t counted.",
      "- Set a custom duration on any block whose directed time differs from its length (click the duration badge in the timetable editor).",
      "",
      "---",
      "",
      "## Exporting your data",
      "",
      "Use **Settings → Directed Time Tracker → Export XLSX…** to download a detailed Excel report with:",
      "",
      "- **Summary sheet** — contracted hours, accrued, predicted, and margin at a glance",
      "- **Weekly Breakdown sheet** — every week of the academic year with lesson, activity, and event counts",
      "",
      "This report is useful evidence to share with your union representative or school management.",
      "",
      "---",
      "",
      "## ⚠️ Important disclaimer",
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
        .setClass("mod-warning")
        .onClick(() => { this.close(); this.onConfirm(); }));
  }

  onClose() { this.contentEl.empty(); }
}


class WizardTemplatePickModal extends FuzzySuggestModal<TFile> {
  private files: TFile[];
  private onPick: (file: TFile) => void;
  constructor(app: App, files: TFile[], onPick: (file: TFile) => void) {
    super(app);
    this.files = files;
    this.onPick = onPick;
    this.setPlaceholder("Pick a school structure template…");
  }
  getItems(): TFile[] { return this.files; }
  getItemText(f: TFile): string { return f.basename; }
  onChooseItem(f: TFile): void { this.onPick(f); }
}
