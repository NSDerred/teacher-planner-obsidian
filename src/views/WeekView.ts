import { ItemView, WorkspaceLeaf } from "obsidian";
import type TeacherPlannerPlugin from "../main";
import WeekViewComponent from "./WeekView.svelte";

export const WEEK_VIEW_TYPE = "teacher-planner-week-view";

export class WeekView extends ItemView {
  private plugin: TeacherPlannerPlugin;
  private component: WeekViewComponent | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: TeacherPlannerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return WEEK_VIEW_TYPE; }
  getDisplayText(): string { return "Teacher Planner"; }
  getIcon(): string { return "calendar-days"; }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("tp-root");

    const mount = () => {
      if (this.component) return;
      this.component = new WeekViewComponent({
        target: container,
        props: { plugin: this.plugin, initialDate: new Date() },
      });
    };

    // onLayoutReady fires immediately if the workspace is already ready,
    // otherwise queues until after Obsidian finishes restoring saved views.
    // This prevents the blank-on-startup race condition.
    this.app.workspace.onLayoutReady(mount);

    this.registerEvent(this.app.workspace.on("layout-change", () => { this.component?.updateSize(); }));
    this.registerEvent(this.app.workspace.on("resize", () => { this.component?.updateSize(); }));
  }

  async onClose() {
    this.component?.$destroy();
    this.component = null;
  }

  goToCurrentWeek()        { this.component?.$set({ initialDate: new Date() }); }
  goToPrevWeek()           { this.component?.prevWeek(); }
  goToNextWeek()           { this.component?.nextWeek(); }
  navigateToWeek(d: Date)  { this.component?.$set({ initialDate: d }); }
  onSettingsChange()       { this.component?.refreshEvents(); }
}
