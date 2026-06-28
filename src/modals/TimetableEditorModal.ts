import { App, Modal, Platform } from "obsidian";
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
    if (Platform.isMobile) {
      this.modalEl.addClass("tp-timetable-modal--mobile");
      this.modalEl.setCssStyles({
        width: "100vw", maxWidth: "100vw", height: "100dvh", maxHeight: "100dvh",
        minWidth: "0", borderRadius: "0", padding: "0", boxSizing: "border-box",
      });
    } else {
      this.modalEl.setCssStyles({ width: "min(95vw, 1100px)" });
      this.modalEl.setCssStyles({ maxWidth: "95vw" });
      this.modalEl.setCssStyles({ maxHeight: "min(90vh, 900px)" });
      this.modalEl.setCssStyles({ height: "min(90vh, 900px)" });
      this.modalEl.setCssStyles({ minWidth: "600px" });
      this.modalEl.setCssStyles({ boxSizing: "border-box" });
    }

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
