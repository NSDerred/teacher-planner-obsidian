import { TFile, normalizePath } from "obsidian";
import type TeacherPlannerPlugin from "../main";
import { teachingWeeks } from "./academicWeeks";
import { weekNotesFolder, weekNoteFilePath, weekNoteFileName } from "./weekNoteFiles";
import { getMondayOfWeek, weekKey } from "./weekUtils";

/**
 * Planner directory — a plugin-maintained note ("🏠 Planner Home.md") and canvas
 * ("🗺 Planner Map.canvas") at the top of the planner folder that index every
 * teaching week of the year, grouped by month.
 *
 * The note lists every teaching week (full skeleton) inside a managed block
 * between the markers; anything outside the markers is preserved. The canvas is
 * fully generated (regenerated wholesale each rebuild) and shows a card per week
 * that HAS a note, grouped into month boxes, plus a gateway card to the note.
 */
const MARK_START = "<!-- tp:week-directory:start -->";
const MARK_END = "<!-- tp:week-directory:end -->";

const HOME_FILE = "🏠 Planner Home.md";
const MAP_FILE = "🗺 Planner Map.canvas";
const LEGACY_HOME_FILES = ["Planner Home.md"];

function plannerFolder(plugin: TeacherPlannerPlugin): string {
  return (plugin.settings.plannerFolder || "Teacher Planner").trim();
}
function plannerHomePath(plugin: TeacherPlannerPlugin): string {
  return normalizePath(`${plannerFolder(plugin)}/${HOME_FILE}`);
}
function plannerMapPath(plugin: TeacherPlannerPlugin): string {
  return normalizePath(`${plannerFolder(plugin)}/${MAP_FILE}`);
}
async function ensurePlannerFolder(plugin: TeacherPlannerPlugin): Promise<void> {
  const app = plugin.app;
  const folder = plannerFolder(plugin);
  if (folder && !app.vault.getAbstractFileByPath(folder)) {
    try { await app.vault.createFolder(folder); } catch { /* exists / race — non-fatal */ }
  }
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

function weekHasNote(plugin: TeacherPlannerPlugin, mondayIso: string): boolean {
  return plugin.app.vault.getAbstractFileByPath(weekNoteFilePath(plugin, mondayIso)) instanceof TFile;
}
function fmtWc(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
function monthLabel(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

// ── Markdown note ──────────────────────────────────────────────────────────

/** The managed markdown body: every teaching week, grouped by month, as tables. */
function buildDirectoryMarkdown(plugin: TeacherPlannerPlugin): string {
  const weeks = teachingWeeks(plugin.settings);
  const curKey = weekKey(getMondayOfWeek(new Date()));
  const out: string[] = [
    "*Week directory — auto-updated by Teacher Planner. Edits between the markers are overwritten.*",
    "",
    `Visual map → [[${MAP_FILE}|🗺 Planner Map]]`,
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
    const link = weekHasNote(plugin, w.mondayIso) ? `[[${weekNoteFileName(w.mondayIso)}]]` : "*no note yet*";
    const wc = w.mondayIso === curKey ? `**${fmtWc(w.mondayIso)} · this week**` : fmtWc(w.mondayIso);
    out.push(`| ${wc} | ${link} |`);
  }
  return out.join("\n");
}

async function writeHomeNote(plugin: TeacherPlannerPlugin, createIfMissing: boolean): Promise<void> {
  const app = plugin.app;
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
  await ensurePlannerFolder(plugin);
  await app.vault.create(path, `# Planner Home\n\n${managed}\n`);
}

// ── Canvas map ─────────────────────────────────────────────────────────────

interface CanvasNode {
  id: string;
  type: "file" | "group";
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;      // JSON Canvas preset "1".."6"
  file?: string;       // file nodes
  label?: string;      // group nodes
}

const CARD_W = 260, CARD_H = 96, GAP = 24, PAD = 24, HEADER = 44;

/** Build the full JSON Canvas: gateway card + month groups of week-note cards. */
function buildCanvasJson(plugin: TeacherPlannerPlugin): string {
  const curKey = weekKey(getMondayOfWeek(new Date()));
  const nodes: CanvasNode[] = [];

  // Gateway card → the Planner Home note.
  nodes.push({ id: "home", type: "file", file: plannerHomePath(plugin), x: 0, y: 0, width: CARD_W, height: CARD_H, color: "6" });

  // Only weeks that actually have a note become cards (empty weeks are omitted).
  const weeks = teachingWeeks(plugin.settings).filter(w => weekHasNote(plugin, w.mondayIso));

  let gy = CARD_H + 60;
  let i = 0;
  while (i < weeks.length) {
    const monthKey = weeks[i].mondayIso.slice(0, 7);
    const group = weeks.filter(w => w.mondayIso.slice(0, 7) === monthKey);
    const groupW = PAD * 2 + group.length * CARD_W + (group.length - 1) * GAP;
    const groupH = HEADER + CARD_H + PAD;
    nodes.push({ id: `grp-${monthKey}`, type: "group", x: 0, y: gy, width: groupW, height: groupH, label: monthLabel(group[0].mondayIso) });
    group.forEach((w, j) => {
      nodes.push({
        id: `wk-${w.mondayIso}`,
        type: "file",
        file: weekNoteFilePath(plugin, w.mondayIso),
        x: PAD + j * (CARD_W + GAP),
        y: gy + HEADER,
        width: CARD_W,
        height: CARD_H,
        ...(w.mondayIso === curKey ? { color: "4" } : {}),
      });
    });
    gy += groupH + GAP;
    i += group.length;
  }

  return JSON.stringify({ nodes, edges: [] }, null, "\t");
}

async function writeCanvas(plugin: TeacherPlannerPlugin, createIfMissing: boolean): Promise<void> {
  const app = plugin.app;
  const path = plannerMapPath(plugin);
  const json = buildCanvasJson(plugin);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    const cur = await app.vault.read(existing);
    if (cur !== json) await app.vault.modify(existing, json);
    return;
  }
  if (!createIfMissing) return;
  await ensurePlannerFolder(plugin);
  await app.vault.create(path, json);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Regenerate both the directory note and the canvas map. Existing files are
 * updated in place; missing files are created only when `createIfMissing` is
 * true (the manual command / open helpers), so nothing is written unprompted.
 */
export async function rebuildPlannerDirectory(plugin: TeacherPlannerPlugin, createIfMissing = false): Promise<void> {
  await migrateLegacyHome(plugin);
  await writeHomeNote(plugin, createIfMissing);
  await writeCanvas(plugin, createIfMissing);
}

/** Open (creating if needed) the Planner Home note. */
export async function openPlannerHome(plugin: TeacherPlannerPlugin): Promise<void> {
  await rebuildPlannerDirectory(plugin, true);
  const f = plugin.app.vault.getAbstractFileByPath(plannerHomePath(plugin));
  if (f instanceof TFile) await plugin.app.workspace.getLeaf(false).openFile(f);
}

/** Open (creating if needed) the Planner Map canvas. */
export async function openPlannerMap(plugin: TeacherPlannerPlugin): Promise<void> {
  await rebuildPlannerDirectory(plugin, true);
  const f = plugin.app.vault.getAbstractFileByPath(plannerMapPath(plugin));
  if (f instanceof TFile) await plugin.app.workspace.getLeaf(false).openFile(f);
}

// Debounced auto-update (update-only; never creates the files unprompted).
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
