import { App, Modal } from "obsidian";
import type TeacherPlannerPlugin from "../main";
import type { TimetableTemplate, TimetableSlot } from "../types";

function subtractOneDay(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
function addOneDay(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export class AddTimetableTemplateModal extends Modal {
  private plugin: TeacherPlannerPlugin;
  private onCreated: (newId: string) => void;

  constructor(app: App, plugin: TeacherPlannerPlugin, onCreated: (newId: string) => void) {
    super(app);
    this.plugin = plugin;
    this.onCreated = onCreated;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-modal");

    contentEl.createEl("h3", { text: "New Timetable Template" });
    contentEl.createEl("p", {
      text: "Create a new timetable from a chosen start date. The new template will run to the end of the academic year.",
      cls: "tp-modal-desc",
    });

    const form = contentEl.createDiv("tp-modal-form");

    // ── Name ──────────────────────────────────────────────────────────────────
    this.label(form, "Template Name");
    const nameInput = form.createEl("input", { type: "text", cls: "tp-modal-input" });
    nameInput.placeholder = "e.g. Spring Term, Post-Cover Timetable";
    nameInput.style.cssText = "width:100%;box-sizing:border-box;margin-bottom:14px;";
    setTimeout(() => nameInput.focus(), 50);

    // ── Start date ────────────────────────────────────────────────────────────
    this.label(form, "Start Date (YYYY-MM-DD)");
    const dateInput = form.createEl("input", { type: "date", cls: "tp-modal-input" });
    const today = new Date().toISOString().slice(0, 10);
    dateInput.value = today;
    dateInput.style.cssText = "width:100%;box-sizing:border-box;margin-bottom:14px;";

    // ── Copy from ─────────────────────────────────────────────────────────────
    this.label(form, "Copy slots from (optional)");
    const copySelect = form.createEl("select", { cls: "tp-modal-input" });
    copySelect.style.cssText = "width:100%;box-sizing:border-box;margin-bottom:14px;";
    copySelect.createEl("option", { value: "", text: "— Start blank —" });
    for (const tmpl of (this.plugin.settings.timetableTemplates ?? [])) {
      copySelect.createEl("option", { value: tmpl.id, text: `${tmpl.name} (${fmtDate(tmpl.startDate)} – ${fmtDate(tmpl.endDate)})` });
    }

    // ── Gap / impact info ─────────────────────────────────────────────────────
    const infoEl = form.createDiv();
    infoEl.style.cssText = "margin-bottom:14px;font-size:13px;";

    let gapStart = "";
    let gapEnd = "";
    let gapFillMode: "previous" | "blank" = "blank";

    const updateInfo = () => {
      infoEl.empty();
      const startDate = dateInput.value;
      if (!startDate) return;

      const templates = this.plugin.settings.timetableTemplates ?? [];
      const ay = this.plugin.settings.academicYear;

      if (startDate < ay.startDate || startDate > ay.endDate) {
        infoEl.createEl("p", { text: "⚠️ Start date is outside the academic year.", cls: "tp-modal-warn" });
        return;
      }

      // Find template currently covering startDate
      const covering = templates.find(t => t.startDate <= startDate && t.endDate >= startDate);
      if (covering) {
        const newEnd = subtractOneDay(startDate);
        if (newEnd >= covering.startDate) {
          infoEl.createEl("p", {
            text: `"${covering.name}" will be shortened to ${fmtDate(covering.startDate)} – ${fmtDate(newEnd)}.`,
            cls: "tp-modal-info",
          });
        }
        gapStart = "";
        gapEnd = "";
        return;
      }

      // No template covers startDate — check for a gap
      const prev = [...templates]
        .filter(t => t.endDate < startDate)
        .sort((a, b) => b.endDate.localeCompare(a.endDate))[0];

      if (prev) {
        gapStart = addOneDay(prev.endDate);
        gapEnd = subtractOneDay(startDate);
        if (gapStart <= gapEnd) {
          const gapBox = infoEl.createDiv();
          gapBox.style.cssText = "background:var(--background-modifier-error-hover,rgba(243,139,168,0.12));border:1px solid var(--color-red,#f38ba8);border-radius:6px;padding:10px 12px;";
          gapBox.createEl("p", {
            text: `⚠️ Gap detected: ${fmtDate(gapStart)} – ${fmtDate(gapEnd)} won't be covered by any template.`,
          }).style.cssText = "margin:0 0 8px;font-weight:600;";
          gapBox.createEl("p", { text: "How should this gap be handled?" }).style.cssText = "margin:0 0 6px;";

          const radio = (value: string, label: string) => {
            const row = gapBox.createDiv();
            row.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:4px;";
            const r = row.createEl("input", { type: "radio" }) as HTMLInputElement;
            r.name = "gap-mode";
            r.value = value;
            r.checked = gapFillMode === value;
            r.addEventListener("change", () => { gapFillMode = value as any; });
            row.createEl("label", { text: label });
          };
          radio("previous", `Apply "${prev.name}" to this gap`);
          radio("blank", "Leave blank (no timetable for those dates)");
        } else {
          gapStart = "";
          gapEnd = "";
        }
      }
    };

    dateInput.addEventListener("input", updateInfo);
    updateInfo();

    // ── Footer ────────────────────────────────────────────────────────────────
    const footer = form.createDiv("tp-modal-footer");
    const cancelBtn = footer.createEl("button", { text: "Cancel", cls: "tp-btn" });
    cancelBtn.addEventListener("click", () => this.close());

    const createBtn = footer.createEl("button", { text: "Create Template", cls: "tp-btn tp-btn--primary" });
    createBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      const startDate = dateInput.value;

      if (!name) { nameInput.focus(); return; }
      if (!startDate) { dateInput.focus(); return; }

      const ay = this.plugin.settings.academicYear;
      if (startDate < ay.startDate || startDate > ay.endDate) return;

      const templates = this.plugin.settings.timetableTemplates ?? [];
      const newEndDate = ay.endDate;

      // Truncate any template currently covering startDate
      const covering = templates.find(t => t.startDate <= startDate && t.endDate >= startDate);
      if (covering) {
        covering.endDate = subtractOneDay(startDate);
      }

      // Handle gap if needed
      if (gapStart && gapEnd && gapStart <= gapEnd) {
        if (gapFillMode === "previous") {
          const prev = [...templates]
            .filter(t => t.endDate < startDate)
            .sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
          if (prev) {
            prev.endDate = subtractOneDay(startDate);
          }
        }
        // "blank" mode: do nothing — gap stays uncovered
      }

      // Copy slots if requested
      let initialSlots: TimetableSlot[] = [];
      const copyFromId = copySelect.value;
      if (copyFromId) {
        const source = templates.find(t => t.id === copyFromId);
        if (source) {
          initialSlots = source.slots.map(s => ({
            ...s,
            id: "slot-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
          }));
        }
      }

      const newId = "template-" + Date.now();
      const newTemplate: TimetableTemplate = {
        id: newId,
        name,
        startDate,
        endDate: newEndDate,
        slots: initialSlots,
      };

      this.plugin.settings.timetableTemplates = [...templates, newTemplate]
        .sort((a, b) => a.startDate.localeCompare(b.startDate));

      await this.plugin.saveSettings();
      this.close();
      this.onCreated(newId);
    });
  }

  private label(parent: HTMLElement, text: string) {
    const el = parent.createEl("label");
    el.style.cssText = "font-size:13px;font-weight:600;color:var(--text-normal);display:block;margin-bottom:4px;";
    el.textContent = text;
  }

  onClose() { this.contentEl.empty(); }
}
