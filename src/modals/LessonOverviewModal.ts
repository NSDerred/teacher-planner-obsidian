import { App, Modal } from "obsidian";
import type TeacherPlannerPlugin from "../main";
import LessonOverviewComponent from "./LessonOverviewComponent.svelte";

export class LessonOverviewModal extends Modal {
  private plugin: TeacherPlannerPlugin;
  private component: LessonOverviewComponent | null = null;

  constructor(app: App, plugin: TeacherPlannerPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    this.modalEl.setCssStyles({ width: "min(94vw, 560px)", maxWidth: "94vw", maxHeight: "min(88vh, 820px)", boxSizing: "border-box" });
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-lesson-overview-modal");
    this.component = new LessonOverviewComponent({
      target: contentEl,
      props: { plugin: this.plugin },
    });
  }

  onClose() {
    this.component?.$destroy();
    this.contentEl.empty();
  }
}
