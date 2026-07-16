import { App, Modal, Platform, setIcon } from "obsidian";
import { localIso } from "../utils/weekUtils";

export interface DatePickerOptions {
  /** Initially-shown / selected date as an ISO yyyy-mm-dd string. */
  value?: string;
  /** Inclusive selectable bounds as ISO yyyy-mm-dd strings. */
  min?: string;
  max?: string;
  /** Called with the chosen ISO yyyy-mm-dd date. */
  onPick: (iso: string) => void;
}

const DOW = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * A single, shared month-grid date picker used across the plugin (week view on
 * mobile and desktop, and the lesson overview) so every calendar looks the same.
 *
 * Always renders a fixed six-week (42-cell) grid, filling the lead/trail with
 * adjacent-month days, so the grid height never changes between months (no
 * layout shift, no empty band) — the standard pattern used by mature pickers.
 */
export class DatePickerModal extends Modal {
  private opts: DatePickerOptions;
  private month: Date;
  private readonly selected: string;

  constructor(app: App, opts: DatePickerOptions) {
    super(app);
    this.opts = opts;
    const base = opts.value ? new Date(opts.value + "T12:00:00") : new Date();
    this.month = new Date(base.getFullYear(), base.getMonth(), 1);
    this.selected = opts.value ?? "";
  }

  onOpen() {
    this.modalEl.addClass("tp-datepicker-modal");
    if (Platform.isMobile) this.modalEl.addClass("tp-datepicker-modal--mobile");
    this.render();
  }

  private shift(n: number) {
    this.month = new Date(this.month.getFullYear(), this.month.getMonth() + n, 1);
    this.render();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-datepicker");

    const todayIso = localIso(new Date());
    const viewMonth = this.month.getMonth();

    // Header: month nav
    const head = contentEl.createDiv("tp-datepicker-head");
    const prev = head.createEl("button", { cls: "tp-datepicker-nav" });
    prev.setAttribute("aria-label", "Previous month");
    setIcon(prev, "arrow-left");
    prev.addEventListener("click", () => this.shift(-1));

    head.createEl("span", {
      cls: "tp-datepicker-title",
      text: this.month.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    });

    const next = head.createEl("button", { cls: "tp-datepicker-nav" });
    next.setAttribute("aria-label", "Next month");
    setIcon(next, "arrow-right");
    next.addEventListener("click", () => this.shift(1));

    // Weekday row
    const dow = contentEl.createDiv("tp-datepicker-dow");
    for (const d of DOW) dow.createEl("span", { text: d });

    // Day grid — always 6 weeks (42 cells), Monday-start, filled with adjacent days.
    const grid = contentEl.createDiv("tp-datepicker-grid");
    const lead = (this.month.getDay() + 6) % 7;
    const start = new Date(this.month.getFullYear(), this.month.getMonth(), 1 - lead);
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const iso = localIso(d);
      const inRange = (!this.opts.min || iso >= this.opts.min) && (!this.opts.max || iso <= this.opts.max);
      const cell = grid.createEl("button", { cls: "tp-datepicker-day", text: String(d.getDate()) });
      if (d.getMonth() !== viewMonth) cell.addClass("tp-datepicker-day--adjacent");
      if (iso === this.selected) cell.addClass("tp-datepicker-day--sel");
      if (iso === todayIso) cell.addClass("tp-datepicker-day--today");
      if (!inRange) { cell.disabled = true; }
      else cell.addEventListener("click", () => { this.opts.onPick(iso); this.close(); });
    }

    // Footer: selected-date context + Today shortcut
    const foot = contentEl.createDiv("tp-datepicker-foot");
    const label = foot.createEl("span", { cls: "tp-datepicker-selected" });
    if (this.selected) {
      const sd = new Date(this.selected + "T12:00:00");
      label.setText("Selected: " + sd.toLocaleDateString(undefined, { day: "numeric", month: "short" }));
    }
    const today = foot.createEl("button", { cls: "tp-btn tp-datepicker-today", text: "Today" });
    today.addEventListener("click", () => {
      const t = localIso(new Date());
      const clamped = this.opts.min && t < this.opts.min ? this.opts.min
        : this.opts.max && t > this.opts.max ? this.opts.max : t;
      this.opts.onPick(clamped);
      this.close();
    });
  }

  onClose() { this.contentEl.empty(); }
}
