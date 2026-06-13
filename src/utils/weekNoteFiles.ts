import { TFile } from "obsidian";
import type TeacherPlannerPlugin from "../main";
import { formatUkDate } from "./noteTitleUtils";

/**
 * Opt-in "week notes as vault files" mode. Each week's sidebar note is stored as
 * a markdown file named "Week note - <UK Monday date>.md" instead of inside
 * data.json, so the notes are searchable, linkable and don't bloat the plugin
 * data file. Keyed by the Monday's ISO date (the same key used by weekNotes).
 */

export function weekNotesFolder(plugin: TeacherPlannerPlugin): string {
  const s = plugin.settings;
  const f = s.weekNotesFolder?.trim();
  return f || ((s.plannerFolder || "Teacher Planner") + "/Week notes");
}

export function weekNoteFileName(mondayIso: string): string {
  return `Week note - ${formatUkDate(mondayIso)}`;
}

export function weekNoteFilePath(plugin: TeacherPlannerPlugin, mondayIso: string): string {
  return `${weekNotesFolder(plugin)}/${weekNoteFileName(mondayIso)}.md`;
}

function buildFrontmatter(mondayIso: string): string {
  return `---\ntype: week-note\nweek: ${mondayIso}\n---\n`;
}

/** Remove a leading YAML frontmatter block, returning just the note body. */
function stripFrontmatter(text: string): string {
  const m = text.match(/^---\n[\s\S]*?\n---\n?/);
  return (m ? text.slice(m[0].length) : text).replace(/^\n+/, "");
}

/** Read a week note's body from its file (empty string if none). */
export async function readWeekNote(plugin: TeacherPlannerPlugin, mondayIso: string): Promise<string> {
  const f = plugin.app.vault.getAbstractFileByPath(weekNoteFilePath(plugin, mondayIso));
  if (!(f instanceof TFile)) return "";
  try {
    return stripFrontmatter(await plugin.app.vault.read(f));
  } catch (e) {
    console.error("Teacher Planner: failed to read week note.", e);
    return "";
  }
}

/** Write a week note's body to its file (creating the folder/file as needed). */
export async function writeWeekNote(plugin: TeacherPlannerPlugin, mondayIso: string, body: string): Promise<void> {
  const app = plugin.app;
  const folder = weekNotesFolder(plugin);
  const path = weekNoteFilePath(plugin, mondayIso);
  const content = buildFrontmatter(mondayIso) + "\n" + body;
  if (!app.vault.getAbstractFileByPath(folder)) {
    try { await app.vault.createFolder(folder); } catch { /* exists / race — non-fatal */ }
  }
  const existing = app.vault.getAbstractFileByPath(path);
  try {
    if (existing instanceof TFile) await app.vault.modify(existing, content);
    else await app.vault.create(path, content);
  } catch (e) {
    console.error("Teacher Planner: failed to write week note.", e);
  }
}

/**
 * One-time migration when the user enables file mode: write every existing
 * in-data.json week note to its file (skipping any filename that already
 * exists, so nothing is clobbered), then clear weekNotes from data.json.
 * Returns the number of notes migrated.
 */
export async function migrateWeekNotesToFiles(plugin: TeacherPlannerPlugin): Promise<number> {
  const notes = plugin.settings.weekNotes ?? {};
  const remaining: Record<string, string> = {};
  let migrated = 0;
  for (const [mondayIso, raw] of Object.entries(notes)) {
    const body = String(raw ?? "");
    if (!body.trim()) continue; // empty source — nothing to preserve
    const path = weekNoteFilePath(plugin, mondayIso);
    const existing = plugin.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      // Never clobber a file that already holds real content; but DO overwrite
      // an accidentally-empty file (the cause of the 0.2.6 migration data loss).
      let existingBody = "";
      try { existingBody = stripFrontmatter(await plugin.app.vault.read(existing)); } catch { /* treat as empty */ }
      if (existingBody.trim()) continue; // content already safe in the file — drop from data.json
    }
    await writeWeekNote(plugin, mondayIso, body);
    // Verify the content actually landed before dropping it from data.json.
    let ok = false;
    const after = plugin.app.vault.getAbstractFileByPath(path);
    if (after instanceof TFile) {
      try { ok = stripFrontmatter(await plugin.app.vault.read(after)).trim().length > 0; } catch { ok = false; }
    }
    if (ok) migrated++;
    else remaining[mondayIso] = body; // write failed — keep it in data.json
  }
  plugin.settings.weekNotes = remaining;
  await plugin.saveSettings();
  return migrated;
}
