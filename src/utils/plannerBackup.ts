import { TFile, TFolder } from "obsidian";
import type TeacherPlannerPlugin from "../main";
import type { PlannerRecord } from "../types";
import { writeLibraryFile, listLibraryFiles, readLibraryFile, libraryFolder, type LibFile } from "./pluginLibrary";
import { writeSystemFile, joinSystemPath, type ExportDestination } from "./exportDestination";

/**
 * Planner backup / restore. Planners are plain PlannerRecord objects, so they
 * serialise to JSON cleanly. Backups are written as .json files in a vault
 * "Backups" folder (cross-platform, syncs with the vault) and can be re-imported
 * as new planners — existing planners are never overwritten.
 */

const BACKUP_TYPE = "teacher-planner-backup";

export function backupsFolder(plugin: TeacherPlannerPlugin): string {
  const root = plugin.plannerData.rootPlannerFolder || "Teacher Planner";
  return `${root}/Backups`;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
}
function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, "-").replace(/\s{2,}/g, " ").trim();
}

export function buildPlannerBackup(planner: PlannerRecord): string {
  return JSON.stringify({ type: BACKUP_TYPE, version: 1, kind: "planner", exportedAt: new Date().toISOString(), planner }, null, 2);
}
export function buildFullBackup(plugin: TeacherPlannerPlugin): string {
  return JSON.stringify({ type: BACKUP_TYPE, version: 1, kind: "full", exportedAt: new Date().toISOString(), planners: plugin.plannerData.planners }, null, 2);
}

/** Write JSON to a uniquely-named file in the Backups folder. Returns the vault path. */
export async function writeBackupFile(plugin: TeacherPlannerPlugin, baseName: string, json: string): Promise<string> {
  const app = plugin.app;
  const folder = backupsFolder(plugin);
  if (!app.vault.getAbstractFileByPath(folder)) {
    try { await app.vault.createFolder(folder); } catch { /* exists / race — non-fatal */ }
  }
  const name = safeName(baseName);
  let path = `${folder}/${name}.json`;
  let i = 2;
  while (app.vault.getAbstractFileByPath(path)) path = `${folder}/${name} (${i++}).json`;
  await app.vault.create(path, json);
  return path;
}

/** Back up a single planner (auto-backup before delete) — into the hidden plugin library. */
export async function backupPlanner(plugin: TeacherPlannerPlugin, planner: PlannerRecord, prefix = "Teacher Planner backup"): Promise<string> {
  return backupPlannerToLibrary(plugin, planner, prefix);
}

/** Back up every planner into one full-vault backup file. */
export async function backupAll(plugin: TeacherPlannerPlugin): Promise<string> {
  return writeBackupFile(plugin, `Teacher Planner full backup - ${stamp()}`, buildFullBackup(plugin));
}

// ── Plugin-library backups (hidden in the plugin folder; no vault clutter) ──

const BACKUPS_SUB = "backups";
export function backupsLibraryFolder(plugin: TeacherPlannerPlugin): string {
  return libraryFolder(plugin, BACKUPS_SUB);
}
/** Build a backup of the given planners — "planner" kind for one, "full" for many. */
export function buildBackupOf(planners: PlannerRecord[]): string {
  if (planners.length === 1) return buildPlannerBackup(planners[0]);
  return JSON.stringify({ type: BACKUP_TYPE, version: 1, kind: "full", exportedAt: new Date().toISOString(), planners }, null, 2);
}
/** Auto-backup a single planner into the hidden library (used before delete). */
export function backupPlannerToLibrary(plugin: TeacherPlannerPlugin, planner: PlannerRecord, prefix = "Teacher Planner backup"): Promise<string> {
  return writeLibraryFile(plugin, BACKUPS_SUB, `${prefix} - ${planner.name} - ${stamp()}`, buildPlannerBackup(planner));
}
export function listLibraryBackups(plugin: TeacherPlannerPlugin): Promise<LibFile[]> {
  return listLibraryFiles(plugin, BACKUPS_SUB);
}
export function readBackupText(plugin: TeacherPlannerPlugin, path: string): Promise<string> {
  return readLibraryFile(plugin, path);
}
/** Write a backup to the user-chosen destination (vault folder via adapter, or a computer folder). Returns the path written. */
export async function writeBackupToDestination(plugin: TeacherPlannerPlugin, dest: ExportDestination, filename: string, content: string): Promise<string> {
  if (dest.mode === "system" && dest.systemPath) {
    const abs = joinSystemPath(dest.systemPath, filename);
    await writeSystemFile(abs, content);
    return abs;
  }
  const folder = (dest.vaultPath || backupsLibraryFolder(plugin)).replace(/\/+$/g, "");
  const adapter = plugin.app.vault.adapter;
  let cur = "";
  for (const part of folder.split("/").filter(Boolean)) {
    cur = cur ? `${cur}/${part}` : part;
    if (!(await adapter.exists(cur))) { try { await adapter.mkdir(cur); } catch { /* race */ } }
  }
  let path = `${folder}/${filename}`;
  let i = 2;
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";
  while (await adapter.exists(path)) path = `${folder}/${base} (${i++})${ext}`;
  await adapter.write(path, content);
  return path;
}

export interface ParsedBackup { planners: PlannerRecord[]; }

/** Parse + validate a backup file's text. Throws with a friendly message on failure. */
export function parseBackup(text: string): ParsedBackup {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("Not valid JSON."); }
  if (typeof parsed !== "object" || parsed === null) throw new Error("Not a Teacher Planner backup file.");
  const o = parsed as { type?: unknown; kind?: unknown; planner?: unknown; planners?: unknown };
  if (o.type !== BACKUP_TYPE) throw new Error("Not a Teacher Planner backup file.");
  const raw = o.kind === "full" ? o.planners : (o.planner ? [o.planner] : []);
  const planners = (Array.isArray(raw) ? raw : []) as PlannerRecord[];
  if (planners.length === 0) throw new Error("Backup contains no planners.");
  for (const p of planners) {
    const pr = p as Partial<PlannerRecord>;
    if (!pr || typeof pr !== "object" || !pr.academicYear || !Array.isArray(pr.timetableTemplates)) {
      throw new Error("Backup planner data is malformed.");
    }
  }
  return { planners };
}

/** List backup .json files in the Backups folder, newest first. */
export function listBackupFiles(plugin: TeacherPlannerPlugin): TFile[] {
  const folder = plugin.app.vault.getAbstractFileByPath(backupsFolder(plugin));
  if (!(folder instanceof TFolder)) return [];
  return folder.children
    .filter((c): c is TFile => c instanceof TFile && c.extension === "json")
    .sort((a, b) => b.stat.mtime - a.stat.mtime);
}

/** Import planners as NEW planners (fresh ids, de-duplicated names). Returns the new planner ids. */
export async function importPlanners(plugin: TeacherPlannerPlugin, planners: PlannerRecord[]): Promise<string[]> {
  const names = new Set(plugin.plannerData.planners.map(p => p.name));
  const newIds: string[] = [];
  let seq = 0;
  for (const src of planners) {
    const rec = JSON.parse(JSON.stringify(src)) as PlannerRecord;
    rec.id = `planner-${Date.now()}-${(seq++).toString(36)}`;
    let name = (rec.name || "Imported planner").trim();
    if (names.has(name)) {
      const base = `${name} (imported)`;
      name = base;
      let k = 2;
      while (names.has(name)) name = `${base} ${k++}`;
    }
    rec.name = name;
    names.add(name);
    plugin.plannerData.planners.push(rec);
    newIds.push(rec.id);
  }
  await plugin.saveData(plugin.plannerData);
  return newIds;
}
