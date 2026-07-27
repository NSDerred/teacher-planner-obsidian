import { App, Modal, Notice, Platform } from "obsidian";
import type TeacherPlannerPlugin from "../main";
import { buildXlsx, type SheetRows } from "../utils/xlsxWriter";
import {
  ExportDestination,
  renderDestinationPicker,
  writeSystemFile,
  joinSystemPath,
} from "../utils/exportDestination";
import { generateIcal } from "../utils/icalUtils";
import { isValidIsoDate } from "../utils/weekUtils";
import type { SchoolDay } from "../types";

type ExportDataset = "timetable" | "events" | "both";
type ExportFormat  = "csv" | "xlsx" | "ical";

export class ExportModal extends Modal {
  private plugin: TeacherPlannerPlugin;
  private dataset: ExportDataset = "both";
  private format:  ExportFormat  = "xlsx";
  private destination: ExportDestination = { mode: "vault", vaultPath: "", systemPath: null };
  // iCal options (only used when format === "ical")
  private icalLessons    = true;
  private icalDateEvents = true;
  private icalOverrides  = true;
  private icalNonLessons = true;
  private icalFrom = "";
  private icalTo   = "";
  private icalDays: SchoolDay[] | null = null;

  constructor(app: App, plugin: TeacherPlannerPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-export-modal");

    this.setTitle("Export planner data");

    const form = contentEl.createDiv("tp-modal-form");

    // Dataset choice (hidden for iCal, which has its own content toggles)
    const datasetSection = form.createDiv();
    datasetSection.createEl("p", { text: "What to export", cls: "tp-modal-label" });
    const datasetGroup = datasetSection.createDiv("tp-export-option-group");
    for (const [val, label] of [
      ["timetable", "Timetable (recurring slots)"],
      ["events",    "Date Events (one-offs)"],
      ["both",      "Both"],
    ] as [ExportDataset, string][]) {
      const lbl = datasetGroup.createEl("label", { cls: "tp-export-option" });
      const inp = lbl.createEl("input", { type: "radio" });
      inp.name = "tp-dataset";
      inp.value = val;
      inp.checked = this.dataset === val;
      inp.addEventListener("change", () => { if (inp.checked) this.dataset = val; });
      lbl.createSpan({ text: label });
    }

    // Format choice
    form.createEl("p", { text: "Format", cls: "tp-modal-label" });
    const formatGroup = form.createDiv("tp-export-option-group");
    for (const [val, label] of [
      ["xlsx", "Excel (.xlsx)"],
      ["csv",  "CSV (.csv)"],
      ["ical", "Calendar (.ics)"],
    ] as [ExportFormat, string][]) {
      const lbl = formatGroup.createEl("label", { cls: "tp-export-option" });
      const inp = lbl.createEl("input", { type: "radio" });
      inp.name = "tp-format";
      inp.value = val;
      inp.checked = this.format === val;
      inp.addEventListener("change", () => {
        if (inp.checked) { this.format = val; updateSections(); }
      });
      lbl.createSpan({ text: label });
    }

    // iCal-only options: content toggles + date range
    const ay = this.plugin.settings.academicYear;
    const todayIso = new Date().toISOString().slice(0, 10);
    if (!this.icalFrom) {
      this.icalFrom = (todayIso >= ay.startDate && todayIso <= ay.endDate) ? todayIso : ay.startDate;
    }
    if (!this.icalTo) this.icalTo = ay.endDate;

    const icalSection = form.createDiv("tp-export-ical-options");
    icalSection.createEl("p", { text: "Include in calendar", cls: "tp-modal-label" });
    const toggleGroup = icalSection.createDiv("tp-export-option-group");
    const toggles: [string, () => boolean, (v: boolean) => void][] = [
      ["Lessons & activities",        () => this.icalLessons,    v => { this.icalLessons = v; }],
      ["Date events (cover, trips…)", () => this.icalDateEvents, v => { this.icalDateEvents = v; }],
      ["Holidays & INSET (all-day)",  () => this.icalOverrides,  v => { this.icalOverrides = v; }],
      ["Breaks & registration",       () => this.icalNonLessons, v => { this.icalNonLessons = v; }],
    ];
    for (const [label, get, set] of toggles) {
      const lbl = toggleGroup.createEl("label", { cls: "tp-export-option" });
      const inp = lbl.createEl("input", { type: "checkbox" });
      inp.checked = get();
      inp.addEventListener("change", () => set(inp.checked));
      lbl.createSpan({ text: label });
    }

    icalSection.createEl("p", { text: "Days to include", cls: "tp-modal-label" });
    if (!this.icalDays) {
      this.icalDays = [...(this.plugin.settings.schoolDays ?? ["monday", "tuesday", "wednesday", "thursday", "friday"])];
    }
    const dayRow = icalSection.createDiv("tp-export-ical-days");
    const allDays: [SchoolDay, string][] = [
      ["monday", "Mon"], ["tuesday", "Tue"], ["wednesday", "Wed"], ["thursday", "Thu"],
      ["friday", "Fri"], ["saturday", "Sat"], ["sunday", "Sun"],
    ];
    for (const [day, label] of allDays) {
      const lbl = dayRow.createEl("label", { cls: "tp-export-ical-day" });
      const inp = lbl.createEl("input", { type: "checkbox" });
      inp.checked = this.icalDays.includes(day);
      inp.addEventListener("change", () => {
        if (!this.icalDays) return;
        if (inp.checked) { if (!this.icalDays.includes(day)) this.icalDays.push(day); }
        else this.icalDays = this.icalDays.filter(d => d !== day);
      });
      lbl.createSpan({ text: label });
    }

    icalSection.createEl("p", { text: "Date range", cls: "tp-modal-label" });
    const rangeRow = icalSection.createDiv("tp-export-ical-range");
    const fromInput = rangeRow.createEl("input", { type: "date" });
    fromInput.value = this.icalFrom;
    fromInput.addEventListener("change", () => { this.icalFrom = fromInput.value; });
    rangeRow.createSpan({ text: " – ", cls: "tp-override-sep" });
    const toInput = rangeRow.createEl("input", { type: "date" });
    toInput.value = this.icalTo;
    toInput.addEventListener("change", () => { this.icalTo = toInput.value; });

    const updateSections = () => {
      const isIcal = this.format === "ical";
      datasetSection.toggleClass("tp-hidden", isIcal);
      icalSection.toggleClass("tp-hidden", !isIcal);
    };
    updateSections();

    // Destination (vault or computer)
    this.destination.vaultPath = (this.plugin.settings.plannerFolder || "Teacher Planner") + "/exports";
    renderDestinationPicker(form, this.destination, Platform.isMobile);

    // Footer
    const footer = contentEl.createDiv("tp-modal-footer");
    footer.createEl("button", { text: "Cancel", cls: "tp-btn" })
      .addEventListener("click", () => this.close());

    const exportBtn = footer.createEl("button", { text: "Export", cls: "tp-btn tp-btn--primary" });
    exportBtn.addEventListener("click", () => { void (async () => {
      exportBtn.disabled = true;
      exportBtn.textContent = "Exporting...";
      try {
        if (this.format === "csv") await this.exportCSV();
        else if (this.format === "ical") { if (!(await this.exportICal())) { exportBtn.disabled = false; exportBtn.textContent = "Export"; return; } }
        else await this.exportXLSX();
        this.close();
      } catch (err) {
        console.error("Export error:", err);
        new Notice("Export failed - see console for details.");
        exportBtn.disabled = false;
        exportBtn.textContent = "Export";
      }
    })(); });
  }

  // ── Data builders ──────────────────────────────────────────────────────────

  private buildTimetableRows(): string[][] {
    const { timetable, academicYear, classes, subjects, activities } = this.plugin.settings;
    const dayOrder = ["monday","tuesday","wednesday","thursday","friday"];
    const dayLabel: Record<string, string> = {
      monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday",
      thursday: "Thursday", friday: "Friday",
    };
    const sorted = [...timetable].sort((a, b) => {
      const dd = dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day);
      if (dd !== 0) return dd;
      const pa = academicYear.periods.find(p => p.id === a.periodId);
      const pb = academicYear.periods.find(p => p.id === b.periodId);
      return (pa?.start ?? "").localeCompare(pb?.start ?? "");
    });
    const rows: string[][] = [
      ["Day","Period Name","Start","End","Class Code","Year Group","Subject","Classroom","Week Type","Notes"],
    ];
    for (const slot of sorted) {
      const period = academicYear.periods.find(p => p.id === slot.periodId);
      const cls    = classes.find(c => c.id === slot.classId);
      const act    = (activities ?? []).find(a => a.id === slot.classId);
      const subj   = cls ? subjects.find(s => s.id === cls.subjectId) : null;
      rows.push([
        dayLabel[slot.day] ?? slot.day,
        period?.name ?? "",
        period?.start ?? "",
        period?.end ?? "",
        cls?.code ?? act?.label ?? "",
        cls?.year ?? "",
        subj?.name ?? "",
        slot.classroom ?? cls?.classroom ?? act?.classroom ?? "",
        slot.weekType ?? "both",
        slot.notes ?? "",
      ]);
    }
    return rows;
  }

  private buildEventsRows(): string[][] {
    const { dateEvents, academicYear, classes, subjects, activities } = this.plugin.settings;
    const sorted = [...dateEvents].sort((a, b) => a.date.localeCompare(b.date));
    const rows: string[][] = [
      ["Date","Day","Period Name","Start","End","Class/Activity","Year Group","Subject","Classroom","Notes"],
    ];
    for (const ev of sorted) {
      const period = academicYear.periods.find(p => p.id === ev.periodId);
      const cls    = classes.find(c => c.id === ev.classId);
      const act    = (activities ?? []).find(a => a.id === ev.classId);
      const subj   = cls ? subjects.find(s => s.id === cls.subjectId) : null;
      const d      = new Date(ev.date + "T12:00:00");
      const day    = d.toLocaleDateString("en-GB", { weekday: "long" });
      rows.push([
        ev.date,
        day,
        period?.name ?? "",
        period?.start ?? "",
        period?.end ?? "",
        cls?.code ?? act?.label ?? "",
        cls?.year ?? "",
        subj?.name ?? act?.info ?? "",
        ev.classroom ?? cls?.classroom ?? act?.classroom ?? "",
        ev.notes ?? "",
      ]);
    }
    return rows;
  }

  // ── Export helpers ─────────────────────────────────────────────────────────

  private async ensureFolder(folderPath: string) {
    if (!this.app.vault.getFolderByPath(folderPath)) {
      try { await this.app.vault.createFolder(folderPath); } catch { /* non-fatal */ }
    }
  }

  private toCSV(rows: string[][]): string {
    return rows.map(row =>
      row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")
    ).join("\n");
  }

  private async writeText(path: string, content: string) {
    const existing = this.app.vault.getFileByPath(path);
    if (existing) {
      await this.app.vault.process(existing, () => content);
    } else {
      await this.app.vault.create(path, content);
    }
  }

  private async exportCSV() {
    const targets: [string, string][] = [];
    const filenames: string[] = [];
    if (this.dataset !== "events") {
      filenames.push("timetable.csv");
      targets.push(["timetable.csv", this.toCSV(this.buildTimetableRows())]);
    }
    if (this.dataset !== "timetable") {
      filenames.push("date-events.csv");
      targets.push(["date-events.csv", this.toCSV(this.buildEventsRows())]);
    }

    if (this.destination.mode === "system" && this.destination.systemPath) {
      for (const [name, content] of targets) {
        await writeSystemFile(joinSystemPath(this.destination.systemPath, name), content);
      }
      new Notice(`Exported ${targets.length} file(s) to ${this.destination.systemPath}`);
    } else {
      const folder = this.destination.vaultPath || (this.plugin.settings.plannerFolder || "Teacher Planner") + "/exports";
      await this.ensureFolder(folder);
      for (const [name, content] of targets) {
        await this.writeText(`${folder}/${name}`, content);
      }
      new Notice(`Exported ${targets.length} file(s) to ${folder}`);
    }
  }

  private async exportXLSX() {
    const sheets: { name: string; rows: SheetRows }[] = [];
    if (this.dataset !== "events") {
      sheets.push({ name: "Timetable", rows: this.buildTimetableRows() });
    }
    if (this.dataset !== "timetable") {
      sheets.push({ name: "Date Events", rows: this.buildEventsRows() });
    }
    const buf = await buildXlsx(sheets);
    const filename = "planner-export.xlsx";

    if (this.destination.mode === "system" && this.destination.systemPath) {
      const absPath = joinSystemPath(this.destination.systemPath, filename);
      await writeSystemFile(absPath, buf);
      new Notice(`Exported to ${absPath}`);
    } else {
      const folder = this.destination.vaultPath || (this.plugin.settings.plannerFolder || "Teacher Planner") + "/exports";
      await this.ensureFolder(folder);
      const path = `${folder}/${filename}`;
      const existing = this.app.vault.getFileByPath(path);
      if (existing) await this.app.vault.modifyBinary(existing, buf);
      else await this.app.vault.createBinary(path, buf);
      new Notice(`Exported to ${path}`);
    }
  }

  /** Returns false on validation failure (modal stays open). */
  private async exportICal(): Promise<boolean> {
    if (!isValidIsoDate(this.icalFrom) || !isValidIsoDate(this.icalTo)) {
      new Notice("Please enter valid from/to dates."); return false;
    }
    if (this.icalTo < this.icalFrom) {
      new Notice("The 'to' date must not be before the 'from' date."); return false;
    }
    if (!this.icalLessons && !this.icalDateEvents && !this.icalOverrides && !this.icalNonLessons) {
      new Notice("Select at least one thing to include."); return false;
    }
    if (this.icalDays && this.icalDays.length === 0) {
      new Notice("Select at least one day to include."); return false;
    }

    const s = this.plugin.settings;
    const content = generateIcal(s, {
      fromDate: this.icalFrom,
      toDate: this.icalTo,
      includeLessons: this.icalLessons,
      includeDateEvents: this.icalDateEvents,
      includeOverrides: this.icalOverrides,
      includeNonLessons: this.icalNonLessons,
      calendarName: s.academicYear.name || "Teacher Planner",
      days: this.icalDays ?? undefined,
    });

    const safeName = (s.academicYear.name || "planner").replace(/[^a-z0-9]/gi, "-").toLowerCase();
    const filename = `calendar-${safeName}.ics`;

    if (this.destination.mode === "system" && this.destination.systemPath) {
      const absPath = joinSystemPath(this.destination.systemPath, filename);
      await writeSystemFile(absPath, content);
      new Notice(`Exported to ${absPath}`);
    } else {
      const folder = this.destination.vaultPath || (this.plugin.settings.plannerFolder || "Teacher Planner") + "/exports";
      await this.ensureFolder(folder);
      await this.writeText(`${folder}/${filename}`, content);
      new Notice(`Exported to ${folder}/${filename}`);
    }
    return true;
  }

  onClose() { this.contentEl.empty(); }
}
