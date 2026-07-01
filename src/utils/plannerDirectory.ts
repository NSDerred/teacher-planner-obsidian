import { TFile, normalizePath } from "obsidian";
import type TeacherPlannerPlugin from "../main";
import { teachingWeeks } from "./academicWeeks";
import { weekNotesFolder, weekNoteFilePath, weekNoteFileName } from "./weekNoteFiles";
import { getMondayOfWeek, weekKey } from "./weekUtils";

/**
 * Planner Home directory — a plugin-maintained note (and, later, canvas) at the
 * top of the planner folder that indexes every teaching week of the year,
 * grouped by month, with a link to each week's note. Only the block between the
 * markers is managed; anything the user writes outside them is preserved.
 */
const MARK_START = "<!-- tp:week-directory:start -->";
const MARK_END = "<!-- tp:week-directory:end -->";

const HOME_FILE = "🏠 Planner Home.md";
const LEGACY_HOME_FILES = ["Planner Home.md"];

function plannerFolder(plugin: TeacherPlannerPlugin): string {
  return (plugin.settings.plannerFolder || "Teacher Planner").trim();
}
function plannerHomePath(plugin: TeacherPlannerPlugin): string {
  return normalizePath(`${plannerFolder(plugin)}/${HOME_FILE}`);
}

/** Rename a legacy "Planner Home.md" to the current emoji-prefixed name (once). */
async function migrateLegacyHome(plugin: TeacherPlannerPlugin): Promise<void> {
  const app = plugin.app;
  const target = plannerHomePath(plugin);
  if (app.vault.getAbstractFileByPath(target)) return;
  for (const legacy of LEGACY_HOME_FILES) {
    const f = app.vault.getAbstractFileByPath(normalizePath(`${plannerFolder(plugin)}/${legacy}`));
    if (f instanceof TFile) {
      try { await app.fileManager.renameFile(f, target); }
      catch (e) { console.error("Teacher Planner: could not rename legacy planner home.", e); }
      return;
    }
  }
}

/** True if `path` is (or was) a week-note markdown file for the active planner. */
export function isWeekNotePath(plugin: TeacherPlannerPlugin, path: string): boolean {
  if (!path.endsWith(".md")) return false;
  const folder = weekNotesFolder(plugin);
  if (path.startsWith(folder + "/")) return true;
  return (path.split("/").pop() ?? "").startsWith("Wn - ");
}

function fmtWc(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
function monthLabel(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

/** The managed markdown body: every teaching week, grouped by month, as tables. */
function buildDirectoryMarkdown(plugin: TeacherPlannerPlugin): string {
  const weeks = teachingWeeks(plugin.settings);
  const curKey = weekKey(getMondayOfWeek(new Date()));
  const out: string[] = [
    "*Week directory — auto-updated by Teacher Planner. Edits between the markers are overwritten.*",
    "",
  ];
  if (weeks.length === 0) {
    out.push("_No teaching weeks found. Check the academic-year dates in Teacher Planner settings._");
    return out.join("\n");
  }
  let curMonth = "";
  for (const w of weeks) {
    const ml = monthLabel(w.mondayIso);
    if (ml !== curMonth) {
      if (curMonth) out.push("");
      out.push(`## ${ml}`, "", "| Week commencing | Week note |", "| --- | --- |");
      curMonth = ml;
    }
    const hasNote = plugin.app.vault.getAbstractFileByPath(weekNoteFilePath(plugin, w.mondayIso)) instanceof TFile;
    const link = hasNote ? `[[${weekNoteFileName(w.mondayIso)}]]` : "*no note yet*";
    const wc = w.mondayIso === curKey ? `**${fmtWc(w.mondayIso)} · this week**` : fmtWc(w.mondayIso);
    out.push(`| ${wc} | ${link} |`);
  }
  return out.join("\n");
}

/**
 * Regenerate the managed directory block in `Planner Home.md`. Updates an
 * existing note in place (only the marked block); creates the note only when
 * `createIfMissing` is true (the manual command), so nothing is written to the
 * vault unprompted.
 */
export async function rebuildPlannerDirectory(plugin: TeacherPlannerPlugin, createIfMissing = false): Promise<void> {
  const app = plugin.app;
  await migrateLegacyHome(plugin);
  const path = plannerHomePath(plugin);
  const managed = `${MARK_START}\n${buildDirectoryMarkdown(plugin)}\n${MARK_END}`;
  const existing = app.vault.getAbstractFileByPath(path);

  if (existing instanceof TFile) {
    const cur = await app.vault.read(existing);
    const s = cur.indexOf(MARK_START);
    const e = cur.indexOf(MARK_END);
    const next = (s !== -1 && e !== -1 && e > s)
      ? cur.slice(0, s) + managed + cur.slice(e + MARK_END.length)
      : cur.trimEnd() + "\n\n" + managed + "\n";
    if (next !== cur) await app.vault.modify(existing, next);
    return;
  }

  if (!createIfMissing) return;

  const folder = plannerFolder(plugin);
  if (folder && !app.vault.getAbstractFileByPath(folder)) {
    try { await app.vault.createFolder(folder); } catch { /* exists / race — non-fatal */ }
  }
  await app.vault.create(path, `# Planner Home\n\n${managed}\n`);
}

/** Open (creating if needed) the Planner Home note in the workspace. */
export async function openPlannerHome(plugin: TeacherPlannerPlugin): Promise<void> {
  await rebuildPlannerDirectory(plugin, true);
  const f = plugin.app.vault.getAbstractFileByPath(plannerHomePath(plugin));
  if (f instanceof TFile) await plugin.app.workspace.getLeaf(false).openFile(f);
}

// Debounced auto-update (update-only; never creates the note unprompted).
let _timer: number | null = null;
export function schedulePlannerDirectoryRebuild(plugin: TeacherPlannerPlugin): void {
  if (_timer !== null) window.clearTimeout(_timer);
  _timer = window.setTimeout(() => {
    _timer = null;
    void rebuildPlannerDirectory(plugin, false).catch(err =>
      console.error("Teacher Planner: planner directory rebuild failed.", err));
  }, 800);
}
export function cancelPlannerDirectoryRebuild(): void {
  if (_timer !== null) { window.clearTimeout(_timer); _timer = null; }
}
