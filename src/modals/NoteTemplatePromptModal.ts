import { App, Modal, Notice, Setting } from "obsidian";
import type TeacherPlannerPlugin from "../main";
import { renderTemplateBody, type TemplateContext } from "../utils/planTemplates";
import { listNoteTemplates, DEFAULT_NOTE_TEMPLATE_ID, type NoteTemplate } from "../utils/noteTemplates";

export interface NotePromptOpts {
  /** Slot context for token rendering. */
  ctx: TemplateContext;
  /** Frontmatter (or any prefix) prepended to the rendered template. May be "". */
  fmPrefix: string;
  /** Pre-filled note title. */
  defaultTitle: string;
  /** Dialog heading. */
  promptTitle: string;
}

/**
 * "New lesson note" dialog with an inline template picker (0.3.6). Loads the
 * note templates, lets the user pick one (default preselected) and edit the
 * title, then hands back the final title, the full body (fmPrefix + rendered
 * template) and the caret offset within that body (-1 if none).
 */
export class NoteTemplatePromptModal extends Modal {
  private plugin: TeacherPlannerPlugin;
  private opts: NotePromptOpts;
  private onSubmit: (title: string, body: string, cursorOffset: number) => void;
  private templates: NoteTemplate[] = [];
  private selectedId: string;

  constructor(
    app: App,
    plugin: TeacherPlannerPlugin,
    opts: NotePromptOpts,
    onSubmit: (title: string, body: string, cursorOffset: number) => void,
  ) {
    super(app);
    this.plugin = plugin;
    this.opts = opts;
    this.onSubmit = onSubmit;
    this.selectedId = plugin.settings.defaultNoteTemplateId ?? DEFAULT_NOTE_TEMPLATE_ID;
  }

  onOpen() {
    this.titleEl.setText(this.opts.promptTitle);
    void this.build();
  }

  private async build() {
    const { contentEl } = this;
    contentEl.empty();
    this.templates = await listNoteTemplates(this.app, this.plugin.settings);
    if (!this.templates.some(t => t.id === this.selectedId)) {
      this.selectedId = this.templates[0]?.id ?? DEFAULT_NOTE_TEMPLATE_ID;
    }

    new Setting(contentEl)
      .setName("Template")
      .addDropdown(d => {
        for (const t of this.templates) d.addOption(t.id, t.builtin ? t.name : `${t.name} (yours)`);
        d.setValue(this.selectedId);
        d.onChange(v => { this.selectedId = v; });
      });

    const titleInput = contentEl.createEl("input", { type: "text", cls: "tp-prompt-input" });
    titleInput.value = this.opts.defaultTitle;
    titleInput.placeholder = "Note title";

    const submit = () => {
      const name = titleInput.value.trim();
      if (!name) { new Notice("Please enter a note title."); return; }
      const chosen = this.templates.find(t => t.id === this.selectedId);
      const { body: rendered, cursorOffset } = renderTemplateBody(chosen?.body ?? "", this.opts.ctx);
      const full = this.opts.fmPrefix + rendered;
      const off = cursorOffset < 0 ? -1 : this.opts.fmPrefix.length + cursorOffset;
      this.close();
      this.onSubmit(name, full, off);
    };
    titleInput.addEventListener("keydown", (e: KeyboardEvent) => { if (e.key === "Enter") submit(); });

    const footer = contentEl.createDiv("tp-modal-footer");
    footer.createEl("button", { text: "Cancel", cls: "tp-btn" })
      .addEventListener("click", () => this.close());
    footer.createEl("button", { text: "Save", cls: "tp-btn tp-btn--primary" })
      .addEventListener("click", submit);
    window.setTimeout(() => { titleInput.focus(); titleInput.select(); }, 30);
  }

  onClose() { this.contentEl.empty(); }
}
