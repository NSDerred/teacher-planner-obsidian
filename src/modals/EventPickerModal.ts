import { App, Modal } from "obsidian";
import type TeacherPlannerPlugin from "../main";

export class EventPickerModal extends Modal {
  private plugin: TeacherPlannerPlugin;
  private onPick: (classOrActivityId: string) => void;

  constructor(
    app: App,
    plugin: TeacherPlannerPlugin,
    onPick: (classOrActivityId: string) => void,
  ) {
    super(app);
    this.plugin = plugin;
    this.onPick = onPick;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-event-picker-modal");

    contentEl.createEl("h3", { text: "Add Event", cls: "tp-epm-title" });

    const classes    = this.plugin.settings.classes    ?? [];
    const activities = this.plugin.settings.activities ?? [];
    const subjects   = this.plugin.settings.subjects   ?? [];

    const list = contentEl.createDiv("tp-epm-list");

    // Lessons
    if (classes.length > 0) {
      list.createEl("div", { text: "LESSONS", cls: "tp-epm-group-label" });
      const sortedSubjects = [...subjects].sort((a, b) => a.name.localeCompare(b.name));
      for (const subj of sortedSubjects) {
        const subjClasses = classes
          .filter(c => c.subjectId === subj.id)
          .sort((a, b) => a.code.localeCompare(b.code));
        for (const cls of subjClasses) {
          const btn = list.createEl("button", { cls: "tp-epm-item" });
          btn.style.borderLeft = `3px solid ${cls.colour}`;
          btn.createEl("span", { text: cls.code, cls: "tp-epm-code" });
          if (cls.classroom) {
            btn.createEl("span", { text: cls.classroom, cls: "tp-epm-room" });
          }
          btn.addEventListener("click", () => { this.onPick(cls.id); this.close(); });
        }
      }
    }

    // Activities
    if (activities.length > 0) {
      if (classes.length > 0) list.createEl("div", { cls: "tp-epm-divider" });
      list.createEl("div", { text: "DIRECTED TIME", cls: "tp-epm-group-label" });
      const sortedActs = [...activities].sort((a, b) => a.label.localeCompare(b.label));
      for (const act of sortedActs) {
        const btn = list.createEl("button", { cls: "tp-epm-item" });
        btn.style.borderLeft = `3px solid ${act.colour}`;
        btn.createEl("span", { text: act.label, cls: "tp-epm-code" });
        if (act.classroom) {
          btn.createEl("span", { text: act.classroom, cls: "tp-epm-room" });
        }
        btn.addEventListener("click", () => { this.onPick(act.id); this.close(); });
      }
    }

    const footer = contentEl.createDiv("tp-epm-footer");
    footer.createEl("button", { text: "Cancel", cls: "tp-btn" })
      .addEventListener("click", () => this.close());
  }

  onClose() { this.contentEl.empty(); }
}
