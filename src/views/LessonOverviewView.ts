import { ItemView, WorkspaceLeaf } from "obsidian";
import type TeacherPlannerPlugin from "../main";
import LessonOverviewComponent from "../modals/LessonOverviewComponent.svelte";

export const LESSON_OVERVIEW_VIEW_TYPE = "teacher-planner-lesson-overview";

export class LessonOverviewView extends ItemView {
  private plugin: TeacherPlannerPlugin;
  private component: LessonOverviewComponent | null = null;
  private mountTarget: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: TeacherPlannerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return LESSON_OVERVIEW_VIEW_TYPE; }
  getDisplayText(): string { return "Lessons"; }
  getIcon(): string { return "list-checks"; }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.setCssStyles({ padding: "12px" });
    container.setCssStyles({ overflow: "hidden" });
    container.setCssStyles({ height: "100%" });
    container.setCssStyles({ display: "flex" });
    container.setCssStyles({ flexDirection: "column" });
    this.mountTarget = container;

    this.app.workspace.onLayoutReady(() => {
      window.requestAnimationFrame(() => this.ensureMounted());
    });

    this.resizeObserver = new ResizeObserver(() => this.ensureMounted());
    this.resizeObserver.observe(container);
  }

  /** Idempotent mount — gated on the container having real dimensions. */
  private ensureMounted() {
    if (this.component) return;
    const container = this.mountTarget ?? (this.containerEl.children[1] as HTMLElement | undefined);
    if (!container) return;
    if (container.offsetWidth === 0 || container.offsetHeight === 0) return;
    this.mountTarget = container;
    this.component = new LessonOverviewComponent({
      target: container,
      props: { plugin: this.plugin },
    });
  }

  /** Called after settings change so the list re-renders. */
  onSettingsChange() {
    this.ensureMounted();
    this.component?.$set({ plugin: this.plugin });
  }

  async onClose() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.component?.$destroy();
    this.component = null;
    this.mountTarget = null;
  }
}
