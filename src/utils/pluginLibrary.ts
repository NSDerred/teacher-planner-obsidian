import { normalizePath } from "obsidian";
import type TeacherPlannerPlugin from "../main";

/**
 * A small "library" of .json files kept inside the plugin's own folder
 * (".obsidian/plugins/teacher-planner/…") rather than the vault, so they don't
 * clutter the file explorer and survive plugin updates like data.json. Read and
 * written through the file-system adapter (the only way to touch the hidden
 * config folder — the Vault API only indexes real vault files).
 */

export interface LibFile {
  path: string;      // adapter-relative path
  basename: string;  // file name without the .json extension
  mtime: number;     // last-modified (ms) for newest-first sorting
}

export function pluginDir(plugin: TeacherPlannerPlugin): string {
  const dir = plugin.manifest.dir;
  if (dir) return dir;
  return `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`;
}

export function libraryFolder(plugin: TeacherPlannerPlugin, sub: string): string {
  return normalizePath(`${pluginDir(plugin)}/${sub}`);
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, "-").replace(/\s{2,}/g, " ").trim() || "Untitled";
}

async function ensureFolder(plugin: TeacherPlannerPlugin, folder: string): Promise<void> {
  const adapter = plugin.app.vault.adapter;
  const parts = folder.split("/").filter(Boolean);
  let cur = "";
  for (const part of parts) {
    cur = cur ? `${cur}/${part}` : part;
    if (!(await adapter.exists(cur))) {
      try { await adapter.mkdir(cur); } catch { /* race / already exists — non-fatal */ }
    }
  }
}

/** Write JSON to a uniquely-named file in a library subfolder. Returns the path. */
export async function writeLibraryFile(plugin: TeacherPlannerPlugin, sub: string, baseName: string, json: string): Promise<string> {
  const adapter = plugin.app.vault.adapter;
  const folder = libraryFolder(plugin, sub);
  await ensureFolder(plugin, folder);
  const base = safeName(baseName);
  let path = `${folder}/${base}.json`;
  let i = 2;
  while (await adapter.exists(path)) path = `${folder}/${base} (${i++}).json`;
  await adapter.write(path, json);
  return path;
}

/** List .json files in a library subfolder, newest first. */
export async function listLibraryFiles(plugin: TeacherPlannerPlugin, sub: string): Promise<LibFile[]> {
  const adapter = plugin.app.vault.adapter;
  const folder = libraryFolder(plugin, sub);
  if (!(await adapter.exists(folder))) return [];
  let listed: { files: string[] };
  try { listed = await adapter.list(folder); } catch { return []; }
  const out: LibFile[] = [];
  for (const path of listed.files) {
    if (!path.toLowerCase().endsWith(".json")) continue;
    const basename = (path.split("/").pop() ?? path).replace(/\.json$/i, "");
    let mtime = 0;
    try { const st = await adapter.stat(path); mtime = st?.mtime ?? 0; } catch { /* ignore */ }
    out.push({ path, basename, mtime });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

export async function readLibraryFile(plugin: TeacherPlannerPlugin, path: string): Promise<string> {
  return plugin.app.vault.adapter.read(path);
}
