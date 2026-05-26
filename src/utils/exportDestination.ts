import { Notice } from "obsidian";

/**
 * Where the user wants an export to land.
 * - "vault"  → relative path inside the Obsidian vault, written via vault.adapter
 * - "system" → absolute OS path on the user's computer, written via fs.writeFile
 *   (system mode is only available on desktop; mobile callers must stay in vault mode)
 */
export interface ExportDestination {
  mode: "vault" | "system";
  vaultPath: string;
  systemPath: string | null;
}

/**
 * Append a Destination section (label + vault input + Browse button + summary)
 * to a modal body. Mutates `state` in place as the user types/picks.
 * Returns nothing — read `state` at export time.
 */
export function renderDestinationPicker(
  container: HTMLElement,
  state: ExportDestination,
  isMobile: boolean,
) {
  container.createEl("p", { text: "Destination", cls: "tp-modal-label" });

  const wrap = container.createDiv("tp-export-destination");

  // Vault path row
  const vaultRow = wrap.createDiv("tp-export-dest-row");
  vaultRow.createEl("span", { text: "Vault folder", cls: "tp-export-dest-sublabel" });
  const vaultInput = vaultRow.createEl("input", { type: "text", cls: "tp-export-dest-input" });
  vaultInput.value = state.vaultPath;
  vaultInput.placeholder = "Teacher Planner/exports";
  vaultInput.addEventListener("input", () => {
    state.vaultPath = vaultInput.value;
    state.mode = "vault";
    state.systemPath = null;
    updateSummary();
  });

  // Browse-on-computer button — desktop only
  if (!isMobile) {
    const browseRow = wrap.createDiv("tp-export-dest-row");
    const browseBtn = browseRow.createEl("button", {
      text: "Browse on computer…",
      cls: "tp-btn",
    });
    browseBtn.addEventListener("click", async () => {
      const picked = await openOSFolderPicker();
      if (picked) {
        state.systemPath = picked;
        state.mode = "system";
        updateSummary();
      }
    });
  }

  const summary = wrap.createEl("p", { cls: "tp-export-dest-summary setting-item-description" });
  function updateSummary() {
    if (state.mode === "system" && state.systemPath) {
      summary.textContent = `Will save to: ${state.systemPath}  (on your computer)`;
    } else {
      summary.textContent = `Will save to: ${state.vaultPath}  (in your vault)`;
    }
  }
  updateSummary();
}

/**
 * Open an OS native folder picker via Electron's dialog API.
 * Tries the classic `electron.remote` first, then falls back to the
 * modern `@electron/remote` package. Returns null on cancel or error.
 */
export async function openOSFolderPicker(): Promise<string | null> {
  try {
    const electron = (window as any).require?.("electron");
    if (!electron) {
      new Notice("Folder picker is not available in this environment.");
      return null;
    }
    let remote: any = electron.remote;
    if (!remote) {
      try { remote = (window as any).require("@electron/remote"); }
      catch {
        new Notice("Folder picker is not available — please use a vault path.");
        return null;
      }
    }
    const result = await remote.dialog.showOpenDialog({
      title: "Choose export folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) return null;
    return result.filePaths[0] as string;
  } catch (err) {
    console.error("OS folder picker failed:", err);
    new Notice("Could not open folder picker — please use a vault path.");
    return null;
  }
}

/**
 * Write to an absolute OS path. Only works on desktop (Electron exposes Node's fs).
 * Accepts either a string (UTF-8) or an ArrayBuffer (binary).
 */
export async function writeSystemFile(
  absolutePath: string,
  data: ArrayBuffer | string,
): Promise<void> {
  const fs = (window as any).require?.("fs/promises");
  if (!fs) throw new Error("System filesystem not available on this platform.");
  if (typeof data === "string") {
    await fs.writeFile(absolutePath, data, "utf8");
  } else {
    await fs.writeFile(absolutePath, Buffer.from(data));
  }
}

/**
 * Join path parts using Node's path module on desktop, falling back to a
 * forward-slash join on mobile (where this path is never used in practice).
 */
export function joinSystemPath(...parts: string[]): string {
  try {
    const path = (window as any).require?.("path");
    if (path) return path.join(...parts);
  } catch { /* fall through */ }
  return parts.filter(Boolean).join("/");
}
