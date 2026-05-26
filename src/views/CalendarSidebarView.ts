import { ItemView, WorkspaceLeaf } from "obsidian";
import type TeacherPlannerPlugin from "../main";
import CalendarSidebarComponent from "./CalendarSidebarComponent.svelte";

export const CALENDAR_SIDEBAR_VIEW_TYPE = "teacher-planner-calendar-sidebar";

export class CalendarSidebarView extends ItemView {
  private plugin: TeacherPlannerPlugin;
  private component: CalendarSidebarComponent | null = null;
  private mountTarget: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: TeacherPlannerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return CALENDAR_SIDEBAR_VIEW_TYPE; }
  getDisplayText(): string { return "Planner Calendar"; }
  getIcon(): string { return "calendar-days"; }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.style.padding = "0";
    container.style.overflow = "hidden";
    container.style.height = "100%";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    this.mountTarget = container;

    // Defer mount until workspace layout is ready and the container has
    // real dimensions. Sidebars are particularly prone to mounting into
    // a collapsed (0x0) container on Obsidian startup, which leaves the
    // view blank until the user closes and reopens it manually.
    this.app.workspace.onLayoutReady(() => {
      requestAnimationFrame(() => this.ensureMounted());
    });

    // ResizeObserver catches the moment the sidebar transitions from
    // hidden/collapsed to a real size, which is when we want to mount
    // or refresh.
    this.resizeObserver = new ResizeObserver(() => {
      const wasMounted = !!this.component;
      this.ensureMounted();
      if (wasMounted) this.component?.$set({ plugin: this.plugin });
    });
    this.resizeObserver.observe(container);

    this.registerEvent(this.app.workspace.on("layout-change", () => {
      this.ensureMounted();
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      this.ensureMounted();
    }));
  }

  /** Idempotent mount — gated on the container having real dimensions. */
  private ensureMounted() {
    if (this.component) return;
    const container = this.mountTarget ?? (this.containerEl.children[1] as HTMLElement | undefined);
    if (!container) return;
    if (container.offsetWidth === 0 || container.offsetHeight === 0) return;
    this.mountTarget = container;
    this.component = new CalendarSidebarComponent({
      target: container,
      props: { plugin: this.plugin },
    });
  }

  async onClose() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.component?.$destroy();
    this.component = null;
    this.mountTarget = null;
  }

  /** Called by the planner when the week changes — syncs the notes panel. */
  setWeek(monday: Date) {
    this.ensureMounted();
    this.component?.$set({ currentWeek: monday });
  }

  /** Called after settings change so weekNotes etc. re-render. */
  onSettingsChange() {
    this.ensureMounted();
    this.component?.$set({ plugin: this.plugin });
  }
}
