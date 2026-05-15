import { App, Modal } from "obsidian";
import type TeacherPlannerPlugin from "../main";

export class SlotNotesModal extends Modal {
  private plugin: TeacherPlannerPlugin;
  private slotId: string;
  private date: string;
  private notes: string;
  private classroom: string;
  private slotName: string;
  private formattedDate: string;
  private periodName: string;
  private timeRange: string;
  private onSaved: () => void;

  constructor(
    app: App,
    plugin: TeacherPlannerPlugin,
    slotId: string,
    date: string,
    notes: string,
    classroom: string,
    slotName: string,
    formattedDate: string,
    periodName: string,
    timeRange: string,
    onSaved: () => void,
  ) {
    super(app);
    this.plugin = plugin;
    this.slotId = slotId;
    this.date = date;
    this.notes = notes;
    this.classroom = classroom;
    this.slotName = slotName;
    this.formattedDate = formattedDate;
    this.periodName = periodName;
    this.timeRange = timeRange;
    this.onSaved = onSaved;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-slot-notes-modal");

    // Header: slot name (bold) + date / period / time each on their own muted line
    contentEl.createEl("h3", { text: this.slotName });
    const meta = contentEl.createDiv("tp-slot-notes-meta");
    if (this.formattedDate) meta.createEl("span", { text: this.formattedDate });
    if (this.periodName)    meta.createEl("span", { text: this.periodName });
    if (this.timeRange)     meta.createEl("span", { text: this.timeRange });

    const form = contentEl.createDiv("tp-modal-form");

    // Classroom field
    const classroomLabel = form.createEl("label");
    classroomLabel.style.cssText = "font-size:13px;font-weight:600;color:var(--text-normal);display:block;margin-bottom:4px;";
    classroomLabel.textContent = "Classroom";

    const classroomInput = form.createEl("input", { type: "text", cls: "tp-modal-input" });
    classroomInput.value = this.classroom;
    classroomInput.placeholder = "e.g. Lab 3, Room 204";
    classroomInput.style.cssText = "width:100%;box-sizing:border-box;margin-bottom:12px;";

    // Notes textarea
    const notesLabel = form.createEl("label");
    notesLabel.style.cssText = "font-size:13px;font-weight:600;color:var(--text-normal);display:block;margin-bottom:4px;";
    notesLabel.textContent = "Notes";

    const textarea = form.createEl("textarea", { cls: "tp-notes-textarea" });
    textarea.value = this.notes;
    textarea.rows = 5;
    textarea.placeholder = "e.g. Introduction to Cell Biology\nCourse: SL Core Unit 1";

    setTimeout(() => classroomInput.focus(), 50);

    // ── Inline confirm section (hidden until delete clicked) ────────────────
    const confirmSection = contentEl.createDiv();
    confirmSection.style.display = "none";

    const confirmMsg = confirmSection.createEl("p");
    confirmMsg.textContent =
      `Remove this lesson on ${this.date} from the planner? The timetable template will not change — use "+ Event" to re-add it if needed.`;
    confirmMsg.style.cssText = "font-size:13px;color:var(--text-normal);margin:0 0 16px;line-height:1.5;";

    const confirmFooter = confirmSection.createDiv("tp-modal-footer");
    confirmFooter.style.cssText = "display:flex;justify-content:flex-end;gap:8px;padding-top:0;";
    const keepBtn = confirmFooter.createEl("button", { text: "Keep", cls: "tp-btn" });
    const confirmDeleteBtn = confirmFooter.createEl("button", { text: "Remove", cls: "tp-btn tp-btn--danger" });

    keepBtn.addEventListener("click", () => {
      confirmSection.style.display = "none";
      form.style.display = "block";
      footer.style.display = "flex";
    });

    confirmDeleteBtn.addEventListener("click", async () => {
      if (!this.plugin.settings.slotExclusions) this.plugin.settings.slotExclusions = [];
      const already = this.plugin.settings.slotExclusions.some(
        ex => ex.slotId === this.slotId && ex.date === this.date
      );
      if (!already) {
        this.plugin.settings.slotExclusions.push({ slotId: this.slotId, date: this.date });
        await this.plugin.saveSettings();
      }
      this.onSaved();
      this.close();
    });

    // ── Footer ──────────────────────────────────────────────────────────────
    const footer = contentEl.createDiv("tp-modal-footer");
    footer.style.cssText = "display:flex;justify-content:space-between;align-items:center;";

    // Left: delete button
    const deleteBtn = footer.createEl("button", { text: "Remove from this date", cls: "tp-btn tp-btn--danger" });
    deleteBtn.addEventListener("click", () => {
      form.style.display = "none";
      footer.style.display = "none";
      confirmSection.style.display = "block";
    });

    // Right: cancel / clear / save
    const rightBtns = footer.createDiv();
    rightBtns.style.cssText = "display:flex;gap:8px;";
    const cancelBtn = rightBtns.createEl("button", { text: "Cancel", cls: "tp-btn" });
    cancelBtn.addEventListener("click", () => this.close());
    const clearBtn = rightBtns.createEl("button", { text: "Clear", cls: "tp-btn" });
    clearBtn.addEventListener("click", async () => {
      textarea.value = "";
      classroomInput.value = "";
      await this.saveSlot("", "");
    });
    const saveBtn = rightBtns.createEl("button", { text: "Save", cls: "tp-btn tp-btn--primary" });
    saveBtn.addEventListener("click", async () => {
      await this.saveSlot(textarea.value.trim(), classroomInput.value.trim());
    });
  }

  private async saveSlot(notes: string, classroom: string) {
    const slot = this.plugin.findSlotById(this.slotId);
    if (slot) {
      slot.notes = notes;
      slot.classroom = classroom;
      await this.plugin.saveSettings();
      this.onSaved();
    }
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}
