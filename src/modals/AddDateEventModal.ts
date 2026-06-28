import { App, Modal, Notice, Platform, setIcon } from "obsidian";
import type TeacherPlannerPlugin from "../main";
import type { DateEvent, SchoolDay, SchoolPeriod } from "../types";
import { getPeriodsForDay } from "../utils/scheduleUtils";
import { eventPeriodIds, sumPeriodMinutes } from "../utils/eventUtils";
import { CLASS_COLOUR_PALETTE } from "../settings";
import { ColourPickerModal, ConfirmModal, confirmDelete } from "../settings/SettingsTab";
import { blockOccupants } from "../utils/clashUtils";

const DAY_OF_WEEK: Record<number, SchoolDay> = {
  0: "sunday", 1: "monday", 2: "tuesday", 3: "wednesday",
  4: "thursday", 5: "friday", 6: "saturday",
};

function randomPaletteColour(): string {
  return CLASS_COLOUR_PALETTE[Math.floor(Math.random() * CLASS_COLOUR_PALETTE.length)];
}

export class AddDateEventModal extends Modal {
  private plugin: TeacherPlannerPlugin;
  private existingEvent: DateEvent | null;
  private prefillDate: string | null;
  private prefillPeriodId: string | null;
  private onSaved: () => void;
  private _vvCleanup: (() => void) | null = null;

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

  /** Derive title/colour/directed/classroom from a legacy class/activity event. */
  private resolveLegacy(ev: DateEvent): { title: string; colour: string; directed: boolean; classroom: string } {
    const s = this.plugin.settings;
    const cls = s.classes.find(c => c.id === ev.classId);
    if (cls) return { title: cls.code, colour: cls.colour, directed: true, classroom: ev.classroom ?? cls.classroom ?? "" };
    const act = s.activities.find(a => a.id === ev.classId);
    if (act) return { title: act.label, colour: act.colour, directed: act.activityType !== "other", classroom: ev.classroom ?? act.classroom ?? "" };
    return { title: "", colour: randomPaletteColour(), directed: false, classroom: ev.classroom ?? "" };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-date-event-modal");
    if (Platform.isMobile) {
      this.modalEl.addClass("tp-date-event-modal--mobile");
      contentEl.addClass("tp-date-event-modal--mobile");
      // Size the sheet to the *visible* viewport so the on-screen keyboard never
      // covers the form: the visible area shrinks above the keyboard, the sheet
      // shrinks with it, and the content then overflows and scrolls.
      const vv = window.visualViewport;
      if (vv) {
        const apply = () => {
          this.modalEl.style.height = vv.height + "px";
          this.modalEl.style.top = vv.offsetTop + "px";
        };
        apply();
        vv.addEventListener("resize", apply);
        vv.addEventListener("scroll", apply);
        this._vvCleanup = () => {
          vv.removeEventListener("resize", apply);
          vv.removeEventListener("scroll", apply);
        };
        // Keep a focused field in view above the keyboard.
        contentEl.addEventListener("focusin", (e) => {
          const t = e.target as HTMLElement | null;
          if (t) window.setTimeout(() => t.scrollIntoView({ block: "center" }), 60);
        });
      }
    }

    const isEdit = !!this.existingEvent;
    const directedTimeEnabled = this.plugin.settings.directedTime?.enabled ?? false;

    contentEl.createEl("h3", { text: isEdit ? "Edit event" : "Add event" });
    contentEl.createEl("p", {
      text: "A one-off on your timetable — a meeting, cover, trip, duty or anything else. Name it, pick the block(s) it covers, add details.",
      cls: "tp-modal-desc",
    });

    // ── State ────────────────────────────────────────────────────────────
    let date: string;
    let title: string;
    let colour: string;
    let directed: boolean;
    let classroom: string;
    let notes: string;
    const selected = new Set<string>();
    let durationTouched = false;
    let durationMinutes = 0;
    let start = "";

    if (isEdit && this.existingEvent) {
      const ev = this.existingEvent;
      date = ev.date;
      eventPeriodIds(ev).forEach(id => selected.add(id));
      if (ev.title && ev.title.trim()) {
        title = ev.title; colour = ev.colour ?? randomPaletteColour();
        directed = !!ev.isDirected; classroom = ev.classroom ?? "";
      } else {
        const leg = this.resolveLegacy(ev);
        title = leg.title; colour = leg.colour; directed = leg.directed; classroom = leg.classroom;
      }
      notes = ev.notes ?? "";
      durationTouched = ev.durationMinutes != null;
      durationMinutes = ev.durationMinutes ?? 0;
      start = ev.startTime ?? "";
    } else {
      date = this.prefillDate ?? new Date().toISOString().split("T")[0];
      title = ""; colour = randomPaletteColour(); directed = directedTimeEnabled;
      classroom = ""; notes = "";
      if (this.prefillPeriodId) selected.add(this.prefillPeriodId);
    }

    const periodsForDate = (iso: string): SchoolPeriod[] => {
      const d = new Date(iso + "T12:00:00");
      const day = DAY_OF_WEEK[d.getDay()];
      return day ? getPeriodsForDay(this.plugin.settings.academicYear, day) : [];
    };
    const timeToMin = (t: string): number => { const [h, m] = (t || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
    const selectedBlocks = (): SchoolPeriod[] => periodsForDate(date).filter(p => selected.has(p.id));
    const firstBlockStart = (): string => { const b = selectedBlocks(); return b.length ? b[0].start : ""; };
    const effStart = (): string => start || firstBlockStart();
    const recalcDuration = () => {
      if (durationTouched) return;
      const full = sumPeriodMinutes(periodsForDate(date), [...selected]);
      const blocks = selectedBlocks();
      if (start && blocks.length) {
        const lead = Math.max(0, timeToMin(start) - timeToMin(blocks[0].start));
        durationMinutes = Math.max(0, full - lead);
      } else {
        durationMinutes = full;
      }
    };
    if (!durationTouched) recalcDuration();

    const form = contentEl.createDiv("tp-modal-form");

    // ── Event name (search combobox) + colour swatch ─────────────────────
    const nameRow = form.createDiv("tp-modal-row tp-modal-row--col");
    const nameHead = nameRow.createDiv("tp-modal-label-row");
    nameHead.createEl("label", { text: "Event name", cls: "tp-modal-label" });

    const colourField = nameHead.createDiv("tp-colour-field");
    colourField.createEl("span", { text: "colour", cls: "tp-colour-cap" });
    const colourSwatch = colourField.createEl("button", { cls: "tp-colour-swatch" });
    colourSwatch.setAttribute("aria-label", "Choose colour");
    const colourPop = colourField.createDiv("tp-colour-pop");
    colourPop.setCssStyles({ display: "none" });

    const comboWrap = nameRow.createDiv("tp-combo-wrap");
    const titleInput = comboWrap.createEl("input", { type: "text", cls: "tp-modal-input" });
    titleInput.value = title;
    titleInput.placeholder = "Department meeting";
    const comboPanel = comboWrap.createDiv("tp-combo-panel");
    comboPanel.setCssStyles({ display: "none" });

    // Build the existing-item list once
    interface CItem { primary: string; secondary: string; colour: string; directed: boolean; classroom: string; group: string; }
    const cItems: CItem[] = [];
    for (const c of [...this.plugin.settings.classes].filter(c => !c.archived).sort((a, b) => a.code.localeCompare(b.code))) {
      const subj = this.plugin.settings.subjects.find(s => s.id === c.subjectId);
      cItems.push({ primary: c.code, secondary: [c.year, subj?.name].filter(Boolean).join(" · "), colour: c.colour, directed: true, classroom: c.classroom ?? "", group: "Classes" });
    }
    for (const a of [...this.plugin.settings.activities].filter(a => !a.archived).sort((a, b) => a.label.localeCompare(b.label))) {
      cItems.push({ primary: a.label, secondary: a.activityType !== "other" ? "Directed time" : "Other event", colour: a.colour, directed: a.activityType !== "other", classroom: a.classroom ?? "", group: "Activities" });
    }

    const renderCombo = (q: string) => {
      comboPanel.empty();
      const raw = q.trim();
      if (!raw) { comboPanel.setCssStyles({ display: "none" }); return; }
      const ql = raw.toLowerCase();

      // "Create new event" pinned to the top, visible from the first character.
      const useRow = comboPanel.createDiv("tp-combo-item tp-combo-new");
      useRow.createEl("span", { cls: "tp-combo-plus", text: "+" });
      useRow.createEl("span", { text: `Create new event “${raw}”` });
      useRow.addEventListener("mousedown", (e) => {
        e.preventDefault();
        title = raw; titleInput.value = raw;
        comboPanel.setCssStyles({ display: "none" });
      });

      const matches = cItems.filter(it => it.primary.toLowerCase().includes(ql) || it.secondary.toLowerCase().includes(ql));
      let lastGroup = "";
      for (const it of matches) {
        if (it.group !== lastGroup) { comboPanel.createEl("div", { text: it.group, cls: "tp-combo-group" }); lastGroup = it.group; }
        const row = comboPanel.createDiv("tp-combo-item");
        const sw = row.createEl("span", { cls: "tp-combo-swatch" }); sw.setCssStyles({ background: it.colour });
        row.createEl("span", { text: it.primary, cls: "tp-combo-item-primary" });
        if (it.secondary) row.createEl("span", { text: it.secondary, cls: "tp-combo-item-secondary" });
        row.addEventListener("mousedown", (e) => {
          e.preventDefault();
          title = it.primary; titleInput.value = title;
          colour = it.colour; paintColour();
          directed = directedTimeEnabled ? it.directed : false; if (directedToggle) directedToggle.checked = directed;
          if (!classroom.trim() && it.classroom) { classroom = it.classroom; classroomInput.value = classroom; }
          comboPanel.setCssStyles({ display: "none" });
        });
      }
      comboPanel.setCssStyles({ display: "block" });
    };
    titleInput.addEventListener("input", () => { title = titleInput.value; renderCombo(titleInput.value); });
    titleInput.addEventListener("focus", () => { if (titleInput.value.trim()) renderCombo(titleInput.value); });
    titleInput.addEventListener("blur", () => { window.setTimeout(() => { comboPanel.setCssStyles({ display: "none" }); }, 120); });

    // Colour popover (palette + custom)
    for (const c of CLASS_COLOUR_PALETTE) {
      const sw = colourPop.createEl("button", { cls: "tp-swatch" });
      sw.dataset.colour = c; sw.setCssStyles({ background: c });
      sw.addEventListener("click", () => { colour = c; paintColour(); colourPop.setCssStyles({ display: "none" }); });
    }
    const customSw = colourPop.createEl("button", { cls: "tp-colour-custom" });
    customSw.setText("+"); customSw.title = "Custom colour";
    customSw.addEventListener("click", () => {
      colourPop.setCssStyles({ display: "none" });
      new ColourPickerModal(this.plugin.app, colour, "Event colour", async (picked: string) => {
        colour = picked; paintColour();
      }).open();
    });
    colourSwatch.addEventListener("click", (e) => {
      e.stopPropagation();
      colourPop.setCssStyles({ display: colourPop.style.display === "none" ? "flex" : "none" });
    });

    function paintColour() {
      colourSwatch.setCssStyles({ background: colour });
      colourPop.querySelectorAll<HTMLElement>(".tp-swatch").forEach(el => el.toggleClass("tp-swatch--on", el.dataset.colour === colour));
      renderTags();
    }

    // ── Date + Duration ──────────────────────────────────────────────────
    const dateRow = form.createDiv("tp-modal-row");
    const dateCol = dateRow.createDiv("tp-modal-field");
    dateCol.createEl("label", { text: "Date", cls: "tp-modal-label" });
    const dateInput = dateCol.createEl("input", { type: "date", cls: "tp-modal-input" });
    dateInput.value = date;

    const startCol = dateRow.createDiv("tp-modal-field");
    startCol.createEl("label", { text: "Start time", cls: "tp-modal-label" });
    const startInput = startCol.createEl("input", { type: "time", cls: "tp-modal-input" });
    const paintStart = () => { startInput.value = effStart(); };
    startInput.addEventListener("input", () => { start = startInput.value; recalcDuration(); paintDuration(); });

    const durCol = dateRow.createDiv("tp-modal-field tp-modal-field--dur");
    durCol.createEl("label", { text: "Duration", cls: "tp-modal-label" });
    const durLine = durCol.createDiv("tp-modal-input-inline");
    const durInput = durLine.createEl("input", { type: "number", cls: "tp-modal-input tp-modal-input--short" });
    durInput.min = "0"; durInput.max = "600"; durInput.placeholder = "mins";
    durLine.createEl("span", { text: "min", cls: "tp-modal-input-unit" });
    const durAuto = durLine.createEl("button", { text: "Auto", cls: "tp-dur-reset" });
    durAuto.title = "Reset to the total length of the selected blocks";
    const paintDuration = () => { durInput.value = String(durationMinutes); };
    durInput.addEventListener("input", () => { const n = parseInt(durInput.value); durationMinutes = isNaN(n) ? 0 : n; durationTouched = true; });
    durAuto.addEventListener("click", () => { durationTouched = false; recalcDuration(); paintDuration(); });

    dateInput.addEventListener("change", () => { date = dateInput.value; refreshPeriods(); recalcDuration(); paintDuration(); paintStart(); });

    // ── Period blocks (multi-select dropdown) ────────────────────────────
    const periodRow = form.createDiv("tp-modal-row tp-modal-row--col");
    periodRow.createEl("label", { text: "Period block(s)", cls: "tp-modal-label" });
    const periodWrap = periodRow.createDiv("tp-combo-wrap");
    const periodField = periodWrap.createDiv("tp-period-field");
    const periodPanel = periodWrap.createDiv("tp-combo-panel tp-period-panel");
    periodPanel.setCssStyles({ display: "none" });

    const filterInput = periodPanel.createEl("input", { type: "text", cls: "tp-period-filter" });
    filterInput.placeholder = "Filter blocks…";
    const optionList = periodPanel.createDiv("tp-period-options");

    periodField.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".tp-period-tag-x")) return;
      const open = periodPanel.style.display === "none";
      periodPanel.setCssStyles({ display: open ? "block" : "none" });
      if (open) { filterInput.value = ""; renderOptions(""); window.setTimeout(() => filterInput.focus(), 0); }
    });
    filterInput.addEventListener("input", () => renderOptions(filterInput.value));

    function renderTags() {
      periodField.empty();
      const ordered = periodsForDate(date).filter(p => selected.has(p.id));
      if (ordered.length === 0) {
        periodField.createEl("span", { text: "Choose one or more blocks", cls: "tp-period-placeholder" });
      } else {
        for (const p of ordered) {
          const tag = periodField.createEl("span", { cls: "tp-period-tag" });
          tag.setCssStyles({ background: hexToRgba(colour, 0.18), border: `1px solid ${colour}` });
          tag.createEl("span", { text: p.name });
          const x = tag.createEl("span", { cls: "tp-period-tag-x" }); x.setText("✕");
          x.addEventListener("click", (e) => { e.stopPropagation(); selected.delete(p.id); renderTags(); renderOptions(filterInput.value); recalcDuration(); paintDuration(); paintStart(); });
        }
      }
      const add = periodField.createEl("span", { cls: "tp-period-add" });
      add.createEl("span", { text: ordered.length ? "Add block" : "Select" });
      add.createEl("span", { cls: "tp-period-caret", text: "▾" });
    }

    function renderOptions(q: string) {
      optionList.empty();
      const ql = q.trim().toLowerCase();
      const periods = periodsForDate(date).filter(p => !ql || p.name.toLowerCase().includes(ql));
      if (periods.length === 0) { optionList.createEl("div", { text: "No blocks", cls: "tp-picker-empty" }); return; }
      for (const p of periods) {
        const opt = optionList.createDiv("tp-period-option");
        if (p.type !== "lesson") opt.addClass("tp-period-option--nonlesson");
        const on = selected.has(p.id);
        if (on) opt.addClass("tp-period-option--on");
        const box = opt.createEl("span", { cls: "tp-period-check" });
        if (on) { box.addClass("tp-period-check--on"); box.setText("✓"); }
        opt.createEl("span", { text: p.name, cls: "tp-period-opt-name" });
        opt.createEl("span", { text: `${p.start}–${p.end}`, cls: "tp-period-opt-time" });
        opt.addEventListener("click", () => {
          if (selected.has(p.id)) selected.delete(p.id); else selected.add(p.id);
          renderTags(); renderOptions(filterInput.value); recalcDuration(); paintDuration(); paintStart();
        });
      }
    }

    function refreshPeriods() {
      const valid = new Set(periodsForDate(date).map(p => p.id));
      for (const id of [...selected]) if (!valid.has(id)) selected.delete(id);
      renderTags();
      if (periodPanel.style.display !== "none") renderOptions(filterInput.value);
    }

    // ── Directed time toggle ─────────────────────────────────────────────
    let directedToggle: HTMLInputElement | null = null;
    if (directedTimeEnabled) {
      const dirRow = form.createDiv("tp-modal-row tp-modal-row--toggle");
      const lab = dirRow.createEl("label", { cls: "tp-modal-label" });
      lab.setText("Counts as directed time");
      directedToggle = dirRow.createEl("input", { type: "checkbox", cls: "tp-modal-checkbox" });
      directedToggle.checked = directed;
      directedToggle.addEventListener("change", () => { directed = !!directedToggle!.checked; });
    }

    // ── Location + Notes (always visible) ────────────────────────────────
    const locRow = form.createDiv("tp-modal-row tp-modal-row--col");
    locRow.createEl("label", { text: "Location", cls: "tp-modal-label" });
    const classroomInput = locRow.createEl("input", { type: "text", cls: "tp-modal-input" });
    classroomInput.value = classroom; classroomInput.placeholder = "e.g. Room 303, Lab 3";
    classroomInput.addEventListener("input", () => { classroom = classroomInput.value; });

    const notesRow = form.createDiv("tp-modal-row tp-modal-row--col");
    notesRow.createEl("label", { text: "Notes", cls: "tp-modal-label" });
    const notesInput = notesRow.createEl("textarea", { cls: "tp-modal-textarea" });
    notesInput.value = notes; notesInput.rows = 3; notesInput.placeholder = "Optional details for this event";
    notesInput.addEventListener("input", () => { notes = notesInput.value; });

    // Close popovers when clicking elsewhere in the modal
    contentEl.addEventListener("mousedown", (e) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".tp-period-field") && !t.closest(".tp-period-panel")) periodPanel.setCssStyles({ display: "none" });
      if (!t.closest(".tp-colour-field")) colourPop.setCssStyles({ display: "none" });
    });

    // Initial paint
    paintColour();
    renderTags();
    paintDuration();
    paintStart();

    // ── Footer ───────────────────────────────────────────────────────────
    const footer = contentEl.createDiv("tp-modal-footer");
    if (isEdit) {
      const delBtn = footer.createEl("button", { text: "Delete event", cls: "tp-btn tp-btn--danger" });
      delBtn.setCssStyles({ marginRight: "auto" });
      delBtn.addEventListener("click", () => confirmDelete(this.plugin, `Delete this event${title.trim() ? ` “${title.trim()}”` : ""}?`, async () => {
        if (!this.existingEvent) return;
        this.plugin.settings.dateEvents = (this.plugin.settings.dateEvents ?? []).filter(e => e.id !== this.existingEvent!.id);
        await this.plugin.saveSettings();
        this.onSaved(); this.close();
      }));
    }
    footer.createEl("button", { text: "Cancel", cls: "tp-btn" }).addEventListener("click", () => this.close());

    const orderedSelected = () => periodsForDate(date).filter(p => selected.has(p.id)).map(p => p.id);

    const performSave = async (opts?: { directed?: boolean }) => {
      const ordered = orderedSelected();
      const ay = this.plugin.settings.academicYear;
      if (ay?.startDate && ay?.endDate && (date < ay.startDate || date > ay.endDate)) {
        new Notice(`Note: ${date} is outside the academic year (${ay.startDate} – ${ay.endDate}). The event was saved but won't count towards directed time.`, 6000);
      }
      if (!this.plugin.settings.dateEvents) this.plugin.settings.dateEvents = [];
      if (start) {
        const b = selectedBlocks();
        if (b.length) {
          const fs = timeToMin(b[0].start), fe = timeToMin(b[0].end), sv = timeToMin(start);
          if (sv < fs || sv >= fe) { new Notice("Start time must be within the first period block — reset to the block start."); start = ""; }
        }
      }
      const fields = {
        date,
        periodId: ordered[0],
        periodIds: ordered,
        classId: "",
        title: title.trim(),
        colour,
        isDirected: directedTimeEnabled ? (opts?.directed ?? directed) : false,
        notes,
        classroom: classroom.trim() || undefined,
        durationMinutes: durationMinutes > 0 ? durationMinutes : undefined,
        startTime: (start && start !== firstBlockStart()) ? start : undefined,
      };
      if (isEdit && this.existingEvent) {
        const ev = this.plugin.settings.dateEvents.find(e => e.id === this.existingEvent!.id);
        if (ev) Object.assign(ev, fields);
      } else {
        this.plugin.settings.dateEvents.push({ id: "devevent-" + Date.now(), ...fields });
      }
      await this.plugin.saveSettings();
      this.onSaved(); this.close();
    };

    // Remove the clashing occupants: delete conflicting events; exclude
    // conflicting lessons for this date only (template untouched).
    const removeOccupants = (clashes: Array<{ name: string; occ: ReturnType<typeof blockOccupants> }>) => {
      const evIds = new Set<string>();
      const slotIds = new Set<string>();
      for (const c of clashes) for (const o of c.occ) {
        if (o.kind === "event") evIds.add(o.id); else slotIds.add(o.id);
      }
      if (evIds.size) {
        this.plugin.settings.dateEvents = (this.plugin.settings.dateEvents ?? []).filter(e => !evIds.has(e.id));
      }
      if (slotIds.size) {
        if (!this.plugin.settings.slotExclusions) this.plugin.settings.slotExclusions = [];
        for (const slotId of slotIds) {
          if (!this.plugin.settings.slotExclusions.some(ex => ex.slotId === slotId && ex.date === date)) {
            this.plugin.settings.slotExclusions.push({ slotId, date });
          }
        }
      }
    };

    const showClashWarning = (clashes: Array<{ name: string; occ: ReturnType<typeof blockOccupants> }>) => {
      const overlay = contentEl.createDiv("tp-clash-overlay");
      const card = overlay.createDiv("tp-clash-card");

      const head = card.createDiv("tp-clash-head");
      const hIcon = head.createSpan("tp-clash-head-icon"); setIcon(hIcon, "alert-triangle");
      head.createSpan({ text: "Block already in use" });

      const list = card.createDiv("tp-clash-list");
      for (const c of clashes) {
        const row = list.createDiv("tp-clash-row");
        row.createEl("span", { text: c.name, cls: "tp-clash-period" });
        row.createEl("span", { text: c.occ.map(o => `${o.label} (${o.kind})`).join(", "), cls: "tp-clash-items" });
      }

      if (directedTimeEnabled && directed && clashes.some(c => c.occ.some(o => o.directed))) {
        card.createEl("p", { cls: "tp-clash-warn",
          text: "Directed-time tracker is on — keeping both counts this period's time twice." });
      }

      const occAll = clashes.flatMap(c => c.occ);
      const occSummary = occAll.map(o => `${o.label} (${o.kind})`).join(", ");

      const acts = card.createDiv("tp-clash-actions");
      const makeAction = (iconName: string, title2: string, desc: string, danger: boolean): HTMLButtonElement => {
        const b = acts.createEl("button", { cls: "tp-clash-action" + (danger ? " tp-clash-action--danger" : "") });
        const ic = b.createSpan("tp-clash-action-icon"); setIcon(ic, iconName);
        const txt = b.createDiv("tp-clash-action-text");
        txt.createEl("span", { text: title2, cls: "tp-clash-action-title" });
        txt.createEl("span", { text: desc, cls: "tp-clash-action-desc" });
        return b;
      };

      makeAction("copy", "Add anyway", "Keep both in this period", false)
        .addEventListener("click", () => { void performSave(); });
      if (directedTimeEnabled && directed) {
        makeAction("ban", "Add, don't count as directed", "Adds it without inflating your hours", false)
          .addEventListener("click", () => { void performSave({ directed: false }); });
      }
      makeAction("trash", "Remove existing & add", `Removes ${occSummary} first`, true)
        .addEventListener("click", () => {
          new ConfirmModal(
            this.plugin.app,
            `Remove ${occSummary} from this block, then add "${title.trim()}"? Lessons are only removed for ${date}; the timetable is unchanged.`,
            async () => { removeOccupants(clashes); await performSave(); },
            "Remove & add",
          ).open();
        });

      const back = card.createEl("button", { cls: "tp-clash-back" });
      const bIcon = back.createSpan("tp-clash-back-icon"); setIcon(bIcon, "arrow-left");
      back.createSpan({ text: "Back" });
      back.addEventListener("click", () => overlay.remove());
    };

    const saveBtn = footer.createEl("button", { text: isEdit ? "Save changes" : "Add event", cls: "tp-btn tp-btn--primary" });
    saveBtn.addEventListener("click", () => { void (async () => {
      if (!title.trim()) { new Notice("Please give the event a name."); return; }
      if (!date) { new Notice("Please choose a date."); return; }
      if (selected.size === 0) { new Notice("Please select at least one period block."); return; }

      const periodsList = periodsForDate(date);
      const clashes = orderedSelected()
        .map(pid => ({
          name: periodsList.find(p => p.id === pid)?.name ?? pid,
          occ: blockOccupants(this.plugin.settings, date, pid, { excludeEventId: isEdit ? this.existingEvent!.id : undefined }),
        }))
        .filter(c => c.occ.length > 0);

      if (clashes.length === 0) { await performSave(); return; }
      showClashWarning(clashes);
    })(); });

    // Auto-focus the title only when ADDING a new event. In edit mode the field is
    // pre-filled, so focusing it would immediately fire the focus handler and pop the
    // suggestion / "create new event" combo over a form the user may only want to glance
    // at (or tweak elsewhere). Opening edit mode unfocused keeps it a clean filled form.
    if (!isEdit) window.setTimeout(() => titleInput.focus(), 50);
  }

  onClose() { this._vvCleanup?.(); this._vvCleanup = null; this.contentEl.empty(); }
}

/** Local hex→rgba (modal-scoped). */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
