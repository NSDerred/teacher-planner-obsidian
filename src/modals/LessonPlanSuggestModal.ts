import { App, FuzzySuggestModal, Notice, TFile, TFolder } from "obsidian";
import type TeacherPlannerPlugin from "../main";
import { DEFAULT_PLAN_TEMPLATE, defaultPlansFolder } from "../utils/planLinkUtils";
import { TextPromptModal } from "../settings/SettingsTab";

interface PlanChoice {
  label: string;
  file?: TFile;
  create?: boolean;
}

/**
 * Fuzzy picker for a lesson plan note. Lists every markdown file in the
 * vault (plans folder first), with "Create new plan…" pinned at the top.
 */
export class LessonPlanSuggestModal extends FuzzySuggestModal<PlanChoice> {
  private plugin: TeacherPlannerPlugin;
  private classCode: string;
  private subjectName: string;
  private onPick: (path: string) => void;

  constructor(app: App, plugin: TeacherPlannerPlugin, classCode: string, subjectName: string, onPick: (path: string) => void) {
    super(app);
    this.plugin = plugin;
    this.classCode = classCode;
    this.subjectName = subjectName;
    this.onPick = onPick;
    this.setPlaceholder("Pick a lesson plan note, or create a new one…");
  }

  getItems(): PlanChoice[] {
    const plansFolder = defaultPlansFolder(this.plugin.settings);
    // Lesson-plan picker: list the plans folder first, then the rest of the
    // vault so any note can be linked as a plan. Full markdown list is needed
    // because plans may live anywhere the user keeps them.
    const files = this.app.vault.getMarkdownFiles();
    const inPlans  = files.filter(f => f.path.startsWith(plansFolder + "/"));
    const therest  = files.filter(f => !f.path.startsWith(plansFolder + "/"));
    const sortByPath = (a: TFile, b: TFile) => a.path.localeCompare(b.path);
    return [
      { label: "＋ Create new plan…", create: true },
      ...inPlans.sort(sortByPath).map(f => ({ label: f.path, file: f })),
      ...therest.sort(sortByPath).map(f => ({ label: f.path, file: f })),
    ];
  }

  getItemText(item: PlanChoice): string { return item.label; }

  onChooseItem(item: PlanChoice): void {
    if (item.file) { this.onPick(item.file.path); return; }
    // Create new plan from template
    new TextPromptModal(this.app, "New lesson plan", `${this.classCode} — `, "Plan name", (name) => { void (async () => {
      const folder = defaultPlansFolder(this.plugin.settings);
      if (!(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
        try { await this.app.vault.createFolder(folder); } catch { /* non-fatal */ }
      }
      const safe = name.replace(/[\\/:*?"<>|]/g, "-");
      const path = `${folder}/${safe}.md`;
      if (this.app.vault.getAbstractFileByPath(path)) {
        new Notice("A note with that name already exists — linking it instead.");
        this.onPick(path);
        return;
      }
      const today = new Date().toISOString().slice(0, 10);
      const body = (this.plugin.settings.lessonPlanTemplate ?? DEFAULT_PLAN_TEMPLATE)
        .replace(/{{class}}/g, this.classCode)
        .replace(/{{subject}}/g, this.subjectName)
        .replace(/{{date}}/g, today);
      try {
        await this.app.vault.create(path, body);
        this.onPick(path);
        void this.app.workspace.openLinkText(path, "", false);
      } catch (err) {
        console.error("Teacher Planner: failed to create lesson plan.", err);
        new Notice("Could not create the plan note — see console.");
      }
    })(); }).open();
  }
}
