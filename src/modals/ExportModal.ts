import { App, Modal, Notice, TFile } from "obsidian";
import type TeacherPlannerPlugin from "../main";
import * as XLSX from "xlsx";

type ExportDataset = "timetable" | "events" | "both";
type ExportFormat  = "csv" | "xlsx";

export class ExportModal extends Modal {
  private plugin: TeacherPlannerPlugin;
  private dataset: ExportDataset = "both";
  private format:  ExportFormat  = "xlsx";

  constructor(app: App, plugin: TeacherPlannerPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-export-modal");

    contentEl.createEl("h3", { text: "Export Planner Data", cls: "tp-epm-title" });

    const form = contentEl.createDiv("tp-modal-form");

    // Dataset choice
    form.createEl("p", { text: "What to export", cls: "tp-modal-label" });
    const datasetGroup = form.createDiv("tp-export-option-group");
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
    ] as [ExportFormat, string][]) {
      const lbl = formatGroup.createEl("label", { cls: "tp-export-option" });
      const inp = lbl.createEl("input", { type: "radio" });
      inp.name = "tp-format";
      inp.value = val;
      inp.checked = this.format === val;
      inp.addEventListener("change", () => { if (inp.checked) this.format = val; });
      lbl.createSpan({ text: label });
    }

    // Footer
    const footer = contentEl.createDiv("tp-modal-footer");
    footer.createEl("button", { text: "Cancel", cls: "tp-btn" })
      .addEventListener("click", () => this.close());

    const exportBtn = footer.createEl("button", { text: "Export", cls: "tp-btn tp-btn--primary" });
    exportBtn.addEventListener("click", async () => {
      exportBtn.disabled = true;
      exportBtn.textContent = "Exporting...";
      try {
        if (this.format === "csv") await this.exportCSV();
        else await this.exportXLSX();
        this.close();
      } catch (err) {
        console.error("Export error:", err);
        new Notice("Export failed - see console for details.");
        exportBtn.disabled = false;
        exportBtn.textContent = "Export";
      }
    });
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
    if (!this.app.vault.getAbstractFileByPath(folderPath)) {
      try { await this.app.vault.createFolder(folderPath); } catch {}
    }
  }

  private toCSV(rows: string[][]): string {
    return rows.map(row =>
      row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")
    ).join("\n");
  }

  private async writeText(path: string, content: string) {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(path, content);
    }
  }

  private async exportCSV() {
    const folder = (this.plugin.settings.plannerFolder || "Teacher Planner") + "/exports";
    await this.ensureFolder(folder);
    const files: [string, string][] = [];
    if (this.dataset !== "events") {
      files.push([`${folder}/timetable.csv`, this.toCSV(this.buildTimetableRows())]);
    }
    if (this.dataset !== "timetable") {
      files.push([`${folder}/date-events.csv`, this.toCSV(this.buildEventsRows())]);
    }
    for (const [path, content] of files) await this.writeText(path, content);
    new Notice(`Exported ${files.length} file(s) to ${folder}`);
  }

  private async exportXLSX() {
    const folder = (this.plugin.settings.plannerFolder || "Teacher Planner") + "/exports";
    await this.ensureFolder(folder);
    const wb = XLSX.utils.book_new();
    if (this.dataset !== "events") {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(this.buildTimetableRows()), "Timetable");
    }
    if (this.dataset !== "timetable") {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(this.buildEventsRows()), "Date Events");
    }
    const buf  = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
    const path = `${folder}/planner-export.xlsx`;
    await (this.app.vault.adapter as any).writeBinary(path, buf.buffer);
    new Notice(`Exported to ${path}`);
  }

  onClose() { this.contentEl.empty(); }
}
