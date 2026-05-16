import { ItemView, WorkspaceLeaf, ViewStateResult } from "obsidian";
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

    // Mount immediately — by the time onOpen() fires, loadSettings() has already
    // completed (registerView is called after await loadSettings() in main.ts).
    // We still defer one frame so the container is laid out before Svelte measures it,
    // which prevents zero-dimension rendering on mobile and narrow panes.
    if (!this.component) {
      requestAnimationFrame(() => {
        if (this.component) return; // guard against double-mount
        this.component = new WeekViewComponent({
          target: container,
          props: { plugin: this.plugin, initialDate: new Date() },
        });
      });
    }

    this.registerEvent(this.app.workspace.on("layout-change", () => { this.component?.updateSize(); }));
    this.registerEvent(this.app.workspace.on("resize", () => { this.component?.updateSize(); }));
  }

  /**
   * Obsidian calls setState after placing a restored leaf in the workspace.
   * By this point the container has real dimensions, so this is the safest
   * place to ensure the component has mounted — it acts as a guaranteed
   * fallback for any case where the requestAnimationFrame in onOpen() did not fire
   * (e.g. the view was hidden / off-screen on mobile when onOpen ran).
   */
  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    const container = this.containerEl.children[1] as HTMLElement;
    if (!this.component) {
      container.empty();
      container.addClass("tp-root");
      this.component = new WeekViewComponent({
        target: container,
        props: { plugin: this.plugin, initialDate: new Date() },
      });
    } else {
      // Already mounted — refresh so any stale reactive state updates
      this.component.refreshEvents();
    }
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
