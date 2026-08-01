import { App, FuzzySuggestModal, MarkdownView, Notice, TFile } from "obsidian";
import type TeacherPlannerPlugin from "../main";
import { defaultPlansFolder } from "../utils/planLinkUtils";
import {
  type PlanTemplate,
  type TemplateContext,
  renderTemplateBody,
  listPlanTemplates,
  defaultPlanBody,
} from "../utils/planTemplates";
import { TextPromptModal } from "../settings/SettingsTab";

interface PlanChoice {
  label: string;
  file?: TFile;
  /** Create using the default template silently. */
  createDefault?: boolean;
  /** Open the template chooser. */
  createFromTemplate?: boolean;
}

/** Open the note and, if a caret marker was present, park the cursor there. */
async function openPlanNote(app: App, path: string, cursorOffset: number): Promise<void> {
  try {
    await app.workspace.openLinkText(path, "", false);
    if (cursorOffset < 0) return;
    const view = app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.file?.path !== path) return;
    const editor = view.editor;
    editor.setCursor(editor.offsetToPos(cursorOffset));
    editor.focus();
  } catch (err) {
    console.error("Teacher Planner: could not place caret in new plan.", err);
  }
}

/**
 * Prompt for a name, then create a plan note from `body` (tokens rendered from
 * `ctx`). Shared by the default-template fast path and the chooser.
 */
export function createPlanFromBody(
  app: App,
  plugin: TeacherPlannerPlugin,
  ctx: TemplateContext,
  body: string,
  onPick: (path: string) => void,
): void {
  new TextPromptModal(app, "New lesson plan", `${ctx.classCode ?? ""} — `, "Plan name", (name) => { void (async () => {
    const folder = defaultPlansFolder(plugin.settings);
    if (!app.vault.getFolderByPath(folder)) {
      try { await app.vault.createFolder(folder); } catch { /* non-fatal */ }
    }
    const safe = name.replace(/[\\/:*?"<>|]/g, "-");
    const path = `${folder}/${safe}.md`;
    if (app.vault.getFileByPath(path)) {
      new Notice("A note with that name already exists — linking it instead.");
      onPick(path);
      return;
    }
    const { body: rendered, cursorOffset } = renderTemplateBody(body, ctx);
    try {
      await app.vault.create(path, rendered);
      onPick(path);
      await openPlanNote(app, path, cursorOffset);
    } catch (err) {
      console.error("Teacher Planner: failed to create lesson plan.", err);
      new Notice("Could not create the plan note — see console.");
    }
  })(); }).open();
}

/** Fuzzy chooser over every visible template (built-ins + user templates). */
class TemplateChooserModal extends FuzzySuggestModal<PlanTemplate> {
  constructor(
    app: App,
    private templates: PlanTemplate[],
    private defaultId: string,
    private onChoose: (t: PlanTemplate) => void,
  ) {
    super(app);
    this.setPlaceholder("Choose a template…");
  }
  getItems(): PlanTemplate[] { return this.templates; }
  getItemText(t: PlanTemplate): string {
    const marks = [t.id === this.defaultId ? "Default" : "", t.builtin ? "" : "Yours"].filter(Boolean).join(" · ");
    return marks ? `${t.name}   (${marks})` : t.name;
  }
  onChooseItem(t: PlanTemplate): void { this.onChoose(t); }
}

/**
 * Fuzzy picker for a lesson plan note. Lists every markdown file in the vault
 * (plans folder first), with "Create new plan…" (default template) and
 * "Create from template…" pinned at the top. `ctx` carries the lesson's slot
 * context so template tokens resolve to the actual lesson.
 */
export class LessonPlanSuggestModal extends FuzzySuggestModal<PlanChoice> {
  private plugin: TeacherPlannerPlugin;
  private ctx: TemplateContext;
  private onPick: (path: string) => void;

  constructor(app: App, plugin: TeacherPlannerPlugin, ctx: TemplateContext, onPick: (path: string) => void) {
    super(app);
    this.plugin = plugin;
    this.ctx = ctx;
    this.onPick = onPick;
    this.setPlaceholder("Pick a lesson plan note, or create a new one…");
  }

  getItems(): PlanChoice[] {
    const plansFolder = defaultPlansFolder(this.plugin.settings);
    const files = this.app.vault.getMarkdownFiles();
    const inPlans  = files.filter(f => f.path.startsWith(plansFolder + "/"));
    const therest  = files.filter(f => !f.path.startsWith(plansFolder + "/"));
    const sortByPath = (a: TFile, b: TFile) => a.path.localeCompare(b.path);
    return [
      { label: "＋ Create new plan…", createDefault: true },
      { label: "＋ Create from template…", createFromTemplate: true },
      ...inPlans.sort(sortByPath).map(f => ({ label: f.path, file: f })),
      ...therest.sort(sortByPath).map(f => ({ label: f.path, file: f })),
    ];
  }

  getItemText(item: PlanChoice): string { return item.label; }

  onChooseItem(item: PlanChoice): void {
    if (item.file) { this.onPick(item.file.path); return; }
    if (item.createFromTemplate) {
      void (async () => {
        const templates = await listPlanTemplates(this.app, this.plugin.settings);
        const defId = this.plugin.settings.defaultPlanTemplateId ?? "essentials";
        new TemplateChooserModal(this.app, templates, defId, (t) => {
          createPlanFromBody(this.app, this.plugin, this.ctx, t.body, this.onPick);
        }).open();
      })();
      return;
    }
    // createDefault — silent fast path
    const body = defaultPlanBody(this.plugin.settings);
    createPlanFromBody(this.app, this.plugin, this.ctx, body, this.onPick);
  }
}
