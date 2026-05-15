import { App, Modal, Setting, Notice } from "obsidian";
import type { SchoolPeriod, PeriodType } from "../types";

type OnAddCallback = (period: SchoolPeriod) => Promise<void>;

export class AddPeriodModal extends Modal {
  private onAdd: OnAddCallback;

  constructor(app: App, onAdd: OnAddCallback) {
    super(app);
    this.onAdd = onAdd;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-add-period-modal");
    contentEl.createEl("h3", { text: "Add Period" });

    let name = "";
    let start = "";
    let end = "";
    let type: PeriodType = "lesson";

    new Setting(contentEl).setName("Period name").setDesc('e.g. Period 1, Break, Lunch')
      .addText(t => {
        t.setPlaceholder("Period 1");
        t.inputEl.addEventListener("input", () => { name = t.inputEl.value; });
        setTimeout(() => t.inputEl.focus(), 50);
      });

    new Setting(contentEl).setName("Start time").setDesc("HH:MM — 24-hour format")
      .addText(t => {
        t.setPlaceholder("08:50");
        t.inputEl.addEventListener("input", () => { start = t.inputEl.value; });
      });

    new Setting(contentEl).setName("End time").setDesc("HH:MM — 24-hour format")
      .addText(t => {
        t.setPlaceholder("10:05");
        t.inputEl.addEventListener("input", () => { end = t.inputEl.value; });
      });

    new Setting(contentEl).setName("Type")
      .addDropdown(d => {
        d.addOption("lesson", "Lesson").addOption("break", "Break")
          .addOption("registration", "Registration").addOption("free", "Free");
        d.setValue("lesson");
        d.onChange(v => { type = v as PeriodType; });
      });

    const footer = contentEl.createDiv("tp-modal-footer");
    const cancelBtn = footer.createEl("button", { text: "Cancel", cls: "tp-btn" });
    cancelBtn.addEventListener("click", () => this.close());
    const addBtn = footer.createEl("button", { text: "Add period", cls: "tp-btn tp-btn--primary" });
    addBtn.addEventListener("click", async () => {
      const trimmedName = name.trim();
      const trimmedStart = start.trim();
      const trimmedEnd = end.trim();
      if (!trimmedName) { new Notice("Please enter a period name."); return; }
      const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!timeRe.test(trimmedStart)) { new Notice("Start time must be HH:MM (e.g. 08:50)."); return; }
      if (!timeRe.test(trimmedEnd)) { new Notice("End time must be HH:MM (e.g. 10:05)."); return; }
      await this.onAdd({ id: `period-${Date.now()}`, name: trimmedName, start: trimmedStart, end: trimmedEnd, type });
      this.close();
    });
  }

  onClose() { this.contentEl.empty(); }
}
