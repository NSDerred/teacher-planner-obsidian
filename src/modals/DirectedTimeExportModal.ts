import { App, Modal, Notice, TFile } from "obsidian";
import type TeacherPlannerPlugin from "../main";
import * as XLSX from "xlsx";
import { calcDirectedTime, fmtMins, minsToDecimalHours } from "../utils/directedTimeUtils";

export class DirectedTimeExportModal extends Modal {
  private plugin: TeacherPlannerPlugin;

  constructor(app: App, plugin: TeacherPlannerPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-export-modal");

    contentEl.createEl("h3", { text: "Export Directed Time", cls: "tp-epm-title" });

    const body = contentEl.createDiv("tp-modal-form");
    body.createEl("p", {
      text: "Exports a detailed Excel workbook with a weekly breakdown and summary, suitable for sharing with your union or school management.",
    });

    const dt = this.plugin.settings.directedTime!;
    const effectiveHours = dt.contractedHours * (dt.timetablePercentage / 100);
    body.createEl("p", {
      text: `Effective contracted maximum: ${effectiveHours.toFixed(1)}h  (${dt.contractedHours}h × ${dt.timetablePercentage}%)`,
      cls: "tp-modal-label",
    });

    const footer = contentEl.createDiv("tp-modal-footer");
    footer.createEl("button", { text: "Cancel", cls: "tp-btn" })
      .addEventListener("click", () => this.close());

    const exportBtn = footer.createEl("button", { text: "Export XLSX…", cls: "tp-btn tp-btn--primary" });
    exportBtn.addEventListener("click", async () => {
      exportBtn.disabled = true;
      exportBtn.textContent = "Exporting…";
      try {
        await this.doExport();
        this.close();
      } catch (err) {
        console.error("Directed time export error:", err);
        new Notice("Export failed — see console for details.");
        exportBtn.disabled = false;
        exportBtn.textContent = "Export XLSX…";
      }
    });
  }

  private async doExport() {
    const s = this.plugin.settings;
    const calc = calcDirectedTime(s);
    const ayName = s.academicYear.name;
    const folder = (s.plannerFolder || "Teacher Planner") + "/exports";

    if (!this.app.vault.getAbstractFileByPath(folder)) {
      try { await this.app.vault.createFolder(folder); } catch {}
    }

    const wb = XLSX.utils.book_new();

    // ── Summary sheet ──────────────────────────────────────────────────────
    const diff = calc.predictedMins - calc.contractedMins;
    const summaryData: (string | number)[][] = [
      ["Directed Time Summary", ayName],
      [],
      ["Contracted hours", minsToDecimalHours(calc.contractedMins)],
      ["Timetable fraction (%)", s.directedTime!.timetablePercentage],
      ["Effective maximum (hours)", minsToDecimalHours(calc.contractedMins)],
      [],
      ["Accrued to date (hours)", minsToDecimalHours(calc.accruedMins)],
      ["Predicted total (hours)", minsToDecimalHours(calc.predictedMins)],
      [],
      ["Margin (hours)", minsToDecimalHours(Math.abs(diff))],
      ["Status", diff > 0
        ? `OVER by ${fmtMins(diff)} — consult your union`
        : diff < 0
          ? `Under by ${fmtMins(-diff)}`
          : "Exactly on contracted"],
      [],
      ["Generated", new Date().toLocaleDateString("en-GB")],
      ["Note", "This report is a guide only. Accuracy depends on planner data. Seek union advice for formal disputes."],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryData), "Summary");

    // ── Weekly breakdown sheet ─────────────────────────────────────────────
    const header: (string | number)[] = [
      "Week commencing", "Status",
      "Lessons", "Lesson mins",
      "Directed activities", "Activity mins",
      "Date events", "Event mins",
      "Total mins", "Total hours",
    ];
    const breakdownData: (string | number)[][] = [header];

    for (const w of calc.weeks) {
      const d = new Date(w.weekStart + "T12:00:00");
      const label = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      const statusLabel =
        w.status === "teaching"
          ? w.isPast ? "Teaching (past)" : "Teaching (future)"
          : w.status.charAt(0).toUpperCase() + w.status.slice(1);
      breakdownData.push([
        label, statusLabel,
        w.lessonCount, w.lessonMins,
        w.activityCount, w.activityMins,
        w.eventCount, w.eventMins,
        w.totalMins, minsToDecimalHours(w.totalMins),
      ]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(breakdownData), "Weekly Breakdown");

    // ── Write ──────────────────────────────────────────────────────────────
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
    const safeName = ayName.replace(/[^a-z0-9]/gi, "-");
    const path = `${folder}/directed-time-${safeName}.xlsx`;
    await (this.app.vault.adapter as any).writeBinary(path, buf.buffer);
    new Notice(`Directed time exported to ${path}`);
  }

  onClose() { this.contentEl.empty(); }
}
