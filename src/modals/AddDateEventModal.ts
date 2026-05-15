import { App, Modal, Notice } from "obsidian";
import type TeacherPlannerPlugin from "../main";
import type { DateEvent } from "../types";

export class AddDateEventModal extends Modal {
  private plugin: TeacherPlannerPlugin;
  private existingEvent: DateEvent | null;
  private prefillDate: string | null;
  private prefillPeriodId: string | null;
  private onSaved: () => void;

  constructor(
    app: App,
    plugin: TeacherPlannerPlugin,
    existingEvent: DateEvent | null,
    onSaved: () => void,
    prefillDate?: string,
    prefillPeriodId?: string,
  ) {
    super(app);
    this.plugin = plugin;
    this.existingEvent = existingEvent;
    this.onSaved = onSaved;
    this.prefillDate = prefillDate ?? null;
    this.prefillPeriodId = prefillPeriodId ?? null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-date-event-modal");

    const isEdit = !!this.existingEvent;
    contentEl.createEl("h3", { text: isEdit ? "Edit Event" : "Add Event" });
    contentEl.createEl("p", {
      text: "Add a one-off class or activity into a specific period on a specific date.",
      cls: "tp-modal-desc",
    });

    // Mutable state
    let date            = this.existingEvent?.date             ?? this.prefillDate  ?? new Date().toISOString().split("T")[0];
    let periodId        = this.existingEvent?.periodId         ?? this.prefillPeriodId ?? (this.plugin.settings.academicYear.periods[0]?.id ?? "");
    let classId         = this.existingEvent?.classId          ?? "";
    let notes           = this.existingEvent?.notes            ?? "";
    let classroom       = this.existingEvent?.classroom        ?? "";
    let durationMinutes = this.existingEvent?.durationMinutes  ?? undefined as number | undefined;

    const directedTimeEnabled = this.plugin.settings.directedTime?.enabled ?? false;

    const form = contentEl.createDiv("tp-modal-form");

    // Date
    const dateRow = form.createDiv("tp-modal-row");
    dateRow.createEl("label", { text: "Date", cls: "tp-modal-label" });
    const dateInput = dateRow.createEl("input", { type: "date", cls: "tp-modal-input" });
    dateInput.value = date;
    dateInput.addEventListener("change", () => { date = dateInput.value; });

    // Period
    const periodRow = form.createDiv("tp-modal-row");
    periodRow.createEl("label", { text: "Period", cls: "tp-modal-label" });
    const periodSel = periodRow.createEl("select", { cls: "tp-modal-input" });
    for (const p of this.plugin.settings.academicYear.periods) {
      const opt = periodSel.createEl("option", { text: p.name + " (" + p.start + "–" + p.end + ")", value: p.id });
      if (p.id === periodId) opt.selected = true;
    }
    periodSel.addEventListener("change", () => { periodId = periodSel.value; });

    // Item picker (searchable flat alphabetical list)
    const itemRow = form.createDiv("tp-modal-row tp-modal-row--col");
    itemRow.createEl("label", { text: "Item", cls: "tp-modal-label" });

    const pickerWrap = itemRow.createDiv("tp-picker-wrap");
    const searchInput = pickerWrap.createEl("input", { type: "text", cls: "tp-picker-search", placeholder: "Search…" });
    const pickerList  = pickerWrap.createDiv("tp-picker-list");

    // Build flat sorted item list
    interface PickerItem { id: string; primary: string; secondary: string; }
    const allPickerItems: PickerItem[] = [];

    const sortedClasses = [...this.plugin.settings.classes]
      .filter(c => !c.archived)
      .sort((a, b) => a.code.localeCompare(b.code));
    for (const cls of sortedClasses) {
      const subj = this.plugin.settings.subjects.find(s => s.id === cls.subjectId);
      const parts = [cls.year, subj?.name].filter(Boolean).join(" · ");
      allPickerItems.push({ id: cls.id, primary: cls.code, secondary: parts });
    }

    const sortedActs = [...this.plugin.settings.activities]
      .filter(a => !a.archived)
      .sort((a, b) => a.label.localeCompare(b.label));
    for (const act of sortedActs) {
      const tag = act.activityType !== "other" ? "Directed time" : "Other event";
      allPickerItems.push({ id: act.id, primary: act.label, secondary: tag });
    }

    const renderPickerItems = (query: string) => {
      pickerList.empty();
      const q = query.toLowerCase();
      const filtered = allPickerItems.filter(it =>
        it.primary.toLowerCase().includes(q) || it.secondary.toLowerCase().includes(q)
      );
      if (filtered.length === 0) {
        pickerList.createEl("div", { text: "No results", cls: "tp-picker-empty" });
        return;
      }
      for (const item of filtered) {
        const row = pickerList.createDiv("tp-picker-item");
        if (item.id === classId) row.addClass("tp-picker-item--active");
        row.createEl("span", { text: item.primary, cls: "tp-picker-item-primary" });
        if (item.secondary) row.createEl("span", { text: item.secondary, cls: "tp-picker-item-secondary" });
        row.addEventListener("click", () => {
          classId = item.id;
          pickerList.querySelectorAll(".tp-picker-item").forEach(el => el.removeClass("tp-picker-item--active"));
          row.addClass("tp-picker-item--active");
          durationMinutes = undefined;
          durationInput.value = "";
          updateDurationRow();
        });
      }
      const active = pickerList.querySelector(".tp-picker-item--active") as HTMLElement | null;
      if (active) active.scrollIntoView({ block: "nearest" });
    };

    searchInput.addEventListener("input", () => renderPickerItems(searchInput.value));

    // Duration (shown only for directed-time activities)
    const durationRow = form.createDiv("tp-modal-row");
    durationRow.createEl("label", { text: "Duration", cls: "tp-modal-label" });
    const durationWrap = durationRow.createDiv({ cls: "tp-modal-input-inline" });
    const durationInput = durationWrap.createEl("input", { type: "number", cls: "tp-modal-input tp-modal-input--short" });
    durationInput.min = "1";
    durationInput.max = "480";
    durationInput.placeholder = "mins";
    if (durationMinutes !== undefined) durationInput.value = String(durationMinutes);
    durationWrap.createEl("span", { text: "minutes", cls: "tp-modal-input-unit" });
    durationInput.addEventListener("input", () => {
      const n = parseInt(durationInput.value);
      durationMinutes = isNaN(n) ? undefined : n;
    });
    durationRow.style.display = "none";

    const updateDurationRow = () => {
      if (!directedTimeEnabled) { durationRow.style.display = "none"; return; }
      const activity = this.plugin.settings.activities.find(a => a.id === classId);
      const isDirectedActivity = !!activity && activity.activityType !== "other";
      durationRow.style.display = isDirectedActivity ? "flex" : "none";
      if (isDirectedActivity && durationMinutes === undefined) {
        durationMinutes = activity.durationMinutes ?? (this.plugin.settings.directedTime?.defaultLessonDurationMinutes ?? 60);
        durationInput.value = String(durationMinutes);
      }
    };

    renderPickerItems("");
    updateDurationRow();

    // Classroom
    const classroomRow = form.createDiv("tp-modal-row");
    classroomRow.createEl("label", { text: "Classroom", cls: "tp-modal-label" });
    const classroomInput = classroomRow.createEl("input", { type: "text", cls: "tp-modal-input" });
    classroomInput.value = classroom;
    classroomInput.placeholder = "e.g. Lab 3, Room 204";
    classroomInput.addEventListener("input", () => { classroom = classroomInput.value; });

    // Notes
    const notesRow = form.createDiv("tp-modal-row");
    notesRow.createEl("label", { text: "Notes", cls: "tp-modal-label" });
    const notesInput = notesRow.createEl("textarea", { cls: "tp-modal-textarea" });
    notesInput.value = notes;
    notesInput.rows = 3;
    notesInput.placeholder = "Optional notes for this event";
    notesInput.addEventListener("input", () => { notes = notesInput.value; });

    // Footer
    const footer = contentEl.createDiv("tp-modal-footer");

    if (isEdit) {
      const delBtn = footer.createEl("button", { text: "Delete event", cls: "tp-btn tp-btn--danger" });
      delBtn.style.marginRight = "auto";
      delBtn.addEventListener("click", async () => {
        if (!this.existingEvent) return;
        this.plugin.settings.dateEvents = (this.plugin.settings.dateEvents ?? [])
          .filter(e => e.id !== this.existingEvent!.id);
        await this.plugin.saveSettings();
        this.onSaved();
        this.close();
      });
    }

    const cancelBtn = footer.createEl("button", { text: "Cancel", cls: "tp-btn" });
    cancelBtn.addEventListener("click", () => this.close());

    const saveBtn = footer.createEl("button", {
      text: isEdit ? "Save changes" : "Add event",
      cls: "tp-btn tp-btn--primary",
    });
    saveBtn.addEventListener("click", async () => {
      if (!date || !periodId || !classId) {
        new Notice("Please select a date, period, and item.");
        return;
      }
      if (!this.plugin.settings.dateEvents) this.plugin.settings.dateEvents = [];

      if (isEdit && this.existingEvent) {
        const ev = this.plugin.settings.dateEvents.find(e => e.id === this.existingEvent!.id);
        if (ev) {
          ev.date      = date;
          ev.periodId  = periodId;
          ev.classId   = classId;
          ev.notes     = notes;
          ev.classroom = classroom.trim() || undefined;
          ev.durationMinutes = durationMinutes;
        }
      } else {
        this.plugin.settings.dateEvents.push({
          id:             "devevent-" + Date.now(),
          date,
          periodId,
          classId,
          notes,
          classroom:      classroom.trim() || undefined,
          durationMinutes,
        });
      }

      await this.plugin.saveSettings();
      this.onSaved();
      this.close();
    });

    setTimeout(() => dateInput.focus(), 50);
  }

  onClose() { this.contentEl.empty(); }
}
