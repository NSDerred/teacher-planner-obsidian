import { ItemView, WorkspaceLeaf, ViewStateResult } from "obsidian";
import type TeacherPlannerPlugin from "../main";
import WeekViewComponent from "./WeekView.svelte";

export const WEEK_VIEW_TYPE = "teacher-planner-week-view";

export class WeekView extends ItemView {
  private plugin: TeacherPlannerPlugin;
  private component: WeekViewComponent | null = null;
  /** The element the Svelte component is mounted into. */
  private mountTarget: HTMLElement | null = null;
  /** Observes the container so we can mount/refresh when it gets dimensions. */
  private resizeObserver: ResizeObserver | null = null;

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
    this.mountTarget = container;

    // Defer the initial mount until after the workspace has finished laying
    // out the leaf. This is essential for restored leaves on Obsidian startup
    // — onOpen() can fire before the container has real dimensions, and Svelte
    // components that mount into a 0x0 container will render blank and stay
    // blank even after the container grows.
    this.app.workspace.onLayoutReady(() => {
      requestAnimationFrame(() => this.ensureMounted());
    });

    // ResizeObserver is the most reliable signal for "container became visible".
    // It fires when the container transitions from 0x0 to a real size, which
    // is exactly when we want to (re)mount or force a refresh.
    this.resizeObserver = new ResizeObserver(() => {
      const wasMounted = !!this.component;
      this.ensureMounted();
      if (wasMounted) this.component?.refreshEvents();
    });
    this.resizeObserver.observe(container);

    // Workspace events as additional backup signals — these cover cases
    // where the size doesn't change but the leaf becomes active/visible.
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      this.ensureMounted();
      this.component?.refreshEvents();
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      this.ensureMounted();
      this.component?.refreshEvents();
    }));
  }

  /**
   * Obsidian calls setState after placing a restored leaf in the workspace.
   * Defer one frame so the container is laid out before we measure.
   */
  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    requestAnimationFrame(() => {
      this.ensureMounted();
      this.component?.refreshEvents();
    });
  }

  /**
   * Idempotent mount — safe to call repeatedly. Mounts the Svelte component
   * if (and only if) it has not been mounted yet AND the container has
   * non-zero dimensions. Skipping the mount when the container is 0x0 is
   * deliberate: Svelte's first render captures layout, and a render into a
   * collapsed container never recovers to display content properly.
   */
  private ensureMounted() {
    if (this.component) return;
    const container = this.mountTarget ?? (this.containerEl.children[1] as HTMLElement | undefined);
    if (!container) return;
    // Wait for the container to have real dimensions before mounting.
    // ResizeObserver / layout-change will call ensureMounted again as soon
    // as dimensions become available.
    if (container.offsetWidth === 0 || container.offsetHeight === 0) return;
    if (!container.hasClass("tp-root")) {
      container.empty();
      container.addClass("tp-root");
    }
    this.mountTarget = container;
    this.component = new WeekViewComponent({
      target: container,
      props: { plugin: this.plugin, initialDate: new Date() },
    });
  }

  async onClose() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.component?.$destroy();
    this.component = null;
    this.mountTarget = null;
  }

  goToCurrentWeek()        { this.ensureMounted(); this.component?.$set({ initialDate: new Date() }); }
  goToPrevWeek()           { this.ensureMounted(); this.component?.prevWeek(); }
  goToNextWeek()           { this.ensureMounted(); this.component?.nextWeek(); }
  navigateToWeek(d: Date)  { this.ensureMounted(); this.component?.$set({ initialDate: d }); }
  onSettingsChange()       { this.ensureMounted(); this.component?.refreshEvents(); }
}
