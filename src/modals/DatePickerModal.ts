import { App, Modal, setIcon } from "obsidian";

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

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * A single, shared month-grid date picker used across the plugin (week view on
 * mobile and desktop, and the lesson overview) so every calendar looks the same.
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

    const todayIso = isoOf(new Date());

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

    // Day grid
    const grid = contentEl.createDiv("tp-datepicker-grid");
    const y = this.month.getFullYear(), m = this.month.getMonth();
    const lead = (new Date(y, m, 1).getDay() + 6) % 7; // Monday-start offset
    const days = new Date(y, m + 1, 0).getDate();
    for (let i = 0; i < lead; i++) grid.createDiv("tp-datepicker-day tp-datepicker-day--blank");
    for (let d = 1; d <= days; d++) {
      const iso = isoOf(new Date(y, m, d));
      const inRange = (!this.opts.min || iso >= this.opts.min) && (!this.opts.max || iso <= this.opts.max);
      const cell = grid.createEl("button", { cls: "tp-datepicker-day", text: String(d) });
      if (iso === this.selected) cell.addClass("tp-datepicker-day--sel");
      if (iso === todayIso) cell.addClass("tp-datepicker-day--today");
      if (!inRange) { cell.disabled = true; }
      else cell.addEventListener("click", () => { this.opts.onPick(iso); this.close(); });
    }

    // Footer: Today
    const foot = contentEl.createDiv("tp-datepicker-foot");
    const today = foot.createEl("button", { cls: "tp-btn", text: "Today" });
    today.addEventListener("click", () => {
      const t = isoOf(new Date());
      const clamped = this.opts.min && t < this.opts.min ? this.opts.min
        : this.opts.max && t > this.opts.max ? this.opts.max : t;
      this.opts.onPick(clamped);
      this.close();
    });
  }

  onClose() { this.contentEl.empty(); }
}
