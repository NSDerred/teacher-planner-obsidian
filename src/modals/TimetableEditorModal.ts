import { App, Modal } from "obsidian";
import type TeacherPlannerPlugin from "../main";
import TimetableEditorComponent from "./TimetableEditorComponent.svelte";

export class TimetableEditorModal extends Modal {
  private plugin: TeacherPlannerPlugin;
  private component: TimetableEditorComponent | null = null;

  constructor(app: App, plugin: TeacherPlannerPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    this.modalEl.style.width = "min(95vw, 1100px)";
    this.modalEl.style.maxWidth = "95vw";
    this.modalEl.style.maxHeight = "min(90vh, 900px)";
    this.modalEl.style.minWidth = "600px";
    this.modalEl.style.boxSizing = "border-box";

    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-timetable-modal");
    this.component = new TimetableEditorComponent({
      target: contentEl,
      props: { plugin: this.plugin, modal: this },
    });
  }

  onClose() {
    this.component?.$destroy();
    this.contentEl.empty();
  }
}
