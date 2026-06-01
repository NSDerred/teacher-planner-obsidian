import { App, Modal, Setting, Notice } from "obsidian";
import type TeacherPlannerPlugin from "../main";

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Shift an ISO "YYYY-MM-DD" date by a whole number of days (noon-anchored to avoid DST drift). */
function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Whole-day difference between two ISO dates (b - a). */
function dayDiff(a: string, b: string): number {
  const da = new Date(a + "T12:00:00").getTime();
  const db = new Date(b + "T12:00:00").getTime();
  return Math.round((db - da) / 86400000);
}

/**
 * Edit the ACTIVE planner's name and academic-year date range.
 * Independent dated content (holidays, INSET, date events, slot exclusions,
 * week notes, lesson-note files) is left untouched. Timetable templates are
 * shifted by the same day-delta as the start date so the timetable — and its
 * A/B week rotation — realigns to the corrected range.
 */
export class EditPlannerModal extends Modal {
  private plugin: TeacherPlannerPlugin;
  private onSaved: () => void;

  constructor(app: App, plugin: TeacherPlannerPlugin, onSaved: () => void) {
    super(app);
    this.plugin = plugin;
    this.onSaved = onSaved;
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText("Edit planner");

    const ay = this.plugin.settings.academicYear;
    let name = ay.name;
    let startDate = ay.startDate;
    let endDate = ay.endDate;

    contentEl.createEl("p", {
      text: "Update this planner's name and date range. Holidays, INSET days, events and notes keep their own dates — only the planner window moves. The timetable and its A/B weeks realign to the new range.",
      cls: "setting-item-description",
    });

    new Setting(contentEl)
      .setName("Planner name")
      .addText(t => {
        t.setValue(name);
        t.inputEl.addEventListener("input", () => { name = t.inputEl.value; });
      });

    new Setting(contentEl)
      .setName("Start date")
      .addText(t => {
        t.inputEl.type = "date";
        t.setValue(startDate);
        t.inputEl.addEventListener("change", () => { startDate = t.inputEl.value; });
      });

    new Setting(contentEl)
      .setName("End date")
      .addText(t => {
        t.inputEl.type = "date";
        t.setValue(endDate);
        t.inputEl.addEventListener("change", () => { endDate = t.inputEl.value; });
      });

    new Setting(contentEl)
      .addButton(btn => btn.setButtonText("Cancel").onClick(() => this.close()))
      .addButton(btn => btn
        .setButtonText("Save changes")
        .setCta()
        .onClick(async () => {
          const trimmedName = name.trim();
          if (!trimmedName) { new Notice("Please enter a planner name."); return; }
          if (!ISO_RE.test(startDate) || !ISO_RE.test(endDate)) {
            new Notice("Dates must be in YYYY-MM-DD format."); return;
          }
          if (endDate <= startDate) {
            new Notice("End date must be after the start date."); return;
          }

          const oldStart = this.plugin.settings.academicYear.startDate;
          const delta = dayDiff(oldStart, startDate);

          this.plugin.settings.academicYear.name = trimmedName;
          this.plugin.settings.academicYear.startDate = startDate;
          this.plugin.settings.academicYear.endDate = endDate;

          // Realign timetable templates by the same day-delta so the timetable
          // (and A/B rotation) lands on the corrected calendar weeks.
          if (delta !== 0) {
            for (const tmpl of this.plugin.settings.timetableTemplates ?? []) {
              if (ISO_RE.test(tmpl.startDate)) tmpl.startDate = shiftIsoDate(tmpl.startDate, delta);
              if (ISO_RE.test(tmpl.endDate)) tmpl.endDate = shiftIsoDate(tmpl.endDate, delta);
            }
          }

          await this.plugin.saveSettings();
          new Notice("Planner updated.");
          this.close();
          this.onSaved();
        }));
  }

  onClose() {
    this.contentEl.empty();
  }
}
