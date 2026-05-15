import { ItemView, WorkspaceLeaf } from "obsidian";
import type TeacherPlannerPlugin from "../main";
import CalendarSidebarComponent from "./CalendarSidebarComponent.svelte";

export const CALENDAR_SIDEBAR_VIEW_TYPE = "teacher-planner-calendar-sidebar";

export class CalendarSidebarView extends ItemView {
  private plugin: TeacherPlannerPlugin;
  private component: CalendarSidebarComponent | null = null;

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

    const mount = () => {
      if (this.component) return;
      this.component = new CalendarSidebarComponent({
        target: container,
        props: { plugin: this.plugin },
      });
    };

    this.app.workspace.onLayoutReady(mount);
  }

  async onClose() {
    this.component?.$destroy();
    this.component = null;
  }

  /** Called by the planner when the week changes — syncs the notes panel. */
  setWeek(monday: Date) {
    this.component?.$set({ currentWeek: monday });
  }

  /** Called after settings change so weekNotes etc. re-render. */
  onSettingsChange() {
    this.component?.$set({ plugin: this.plugin });
  }
}
