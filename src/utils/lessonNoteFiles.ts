import { App, TFile, normalizePath } from "obsidian";
import type { TeacherPlannerSettings } from "../types";
import type { NoteMove } from "./lessonShiftApply";
import { buildNoteTitle } from "./noteTitleUtils";
import { getMondayOfWeek, localIso } from "./weekUtils";
import { DEFAULT_LESSON_NOTE_TITLE_TEMPLATE, DEFAULT_LESSON_TEMPLATE } from "../settings";

interface ClassMeta { code: string; subjectName?: string; emoji?: string; }

function classMeta(s: TeacherPlannerSettings, classId: string): ClassMeta | null {
  const cls = (s.classes ?? []).find(c => c.id === classId);
  if (!cls) return null;
  const subj = (s.subjects ?? []).find(x => x.id === cls.subjectId);
  return { code: cls.code, subjectName: subj?.name, emoji: subj?.emoji };
}

function plannerFolder(s: TeacherPlannerSettings): string {
  return s.plannerFolder || "Teacher Planner";
}
/** Folder a lesson note for a date lives in (mirrors the week-grid's wcFolderFor). */
function noteFolder(s: TeacherPlannerSettings, dateIso: string): string {
  const base = plannerFolder(s);
  if (!(s.weeklyNoteFolders ?? true)) return base;
  const monday = getMondayOfWeek(new Date(dateIso + "T12:00:00"));
  const iso = localIso(monday);
  return `${base}/WC - ${iso}`;
}
function unplacedFolder(s: TeacherPlannerSettings): string {
  return `${plannerFolder(s)}/Unplaced lessons`;
}
function noteFileName(s: TeacherPlannerSettings, meta: ClassMeta, dateIso: string, periodName: string): string {
  const tpl = s.lessonNoteTitleTemplate ?? DEFAULT_LESSON_NOTE_TITLE_TEMPLATE;
  return buildNoteTitle(tpl, { dateIso, periodName, classCode: meta.code, subjectName: meta.subjectName, emoji: meta.emoji }) || `${dateIso} ${meta.code}`;
}

/** The frontmatter block stamped on a lesson note so it can be tracked through renames. */
export function lessonNoteFrontmatter(meta: ClassMeta, periodName: string, dateIso: string): string {
  return `---\nclass: "${meta.code}"\nperiod: "${periodName}"\ndate: "${dateIso}"\n---\n`;
}

async function ensureFolder(app: App, path: string): Promise<void> {
  if (!app.vault.getFolderByPath(path)) {
    try { await app.vault.createFolder(path); } catch { /* exists / race */ }
  }
}

/** Find the note file belonging to a lesson occurrence: by frontmatter first, then by computed name. */
function findNote(app: App, s: TeacherPlannerSettings, meta: ClassMeta, date: string, periodName: string): TFile | undefined {
  const base = plannerFolder(s);
  const within = app.vault.getMarkdownFiles().filter(f => f.path === base || f.path.startsWith(base + "/"));
  for (const f of within) {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    if (!fm) continue;
    const fmDate = String(fm.date ?? "").slice(0, 10);
    const fmPeriod = String(fm.period ?? "");
    const fmClass = String(fm.class ?? "");
    if (fmDate === date && fmPeriod === periodName && (!fmClass || fmClass === meta.code)) return f;
  }
  const computed = `${noteFolder(s, date)}/${noteFileName(s, meta, date, periodName)}.md`;
  return app.vault.getFileByPath(computed) ?? undefined;
}

export interface NoteUndoOp { fromPath: string; toPath: string; date: string; periodName: string; }

interface PlannedRename { file: TFile; targetPath: string; date: string; periodName: string; undo: NoteUndoOp; }

async function setFm(app: App, file: TFile, date: string, periodName: string, classCode: string): Promise<void> {
  try {
    await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      fm.class = classCode; fm.period = periodName; fm.date = date;
    });
  } catch (err) { console.error("Teacher Planner: note frontmatter update failed.", err); }
}

/**
 * Move the note files to match a shift. Two-phase rename (via temp names) so a
 * permutation of names never collides. Returns inverse ops for undo. Best-effort
 * and defensive: a missing/renamed note is skipped, never errors the shift.
 */
export async function applyNoteMoves(
  app: App, s: TeacherPlannerSettings, classId: string, moves: NoteMove[],
): Promise<NoteUndoOp[]> {
  const meta = classMeta(s, classId);
  if (!meta) return [];

  const planned: PlannedRename[] = [];
  for (const mv of moves) {
    if (mv.kind === "slot") {
      const file = findNote(app, s, meta, mv.from.date, mv.from.periodName);
      if (!file) continue;
      const targetPath = `${noteFolder(s, mv.to.date)}/${noteFileName(s, meta, mv.to.date, mv.to.periodName)}.md`;
      planned.push({ file, targetPath, date: mv.to.date, periodName: mv.to.periodName,
        undo: { fromPath: targetPath, toPath: file.path, date: mv.from.date, periodName: mv.from.periodName } });
    } else if (mv.kind === "toUnplaced") {
      const file = findNote(app, s, meta, mv.from.date, mv.from.periodName);
      if (!file) continue;
      await ensureFolder(app, unplacedFolder(s));
      const targetPath = `${unplacedFolder(s)}/${meta.code} - ${mv.from.date} - ${file.basename}`.slice(0, 200) + ".md";
      planned.push({ file, targetPath, date: mv.from.date, periodName: mv.from.periodName,
        undo: { fromPath: targetPath, toPath: file.path, date: mv.from.date, periodName: mv.from.periodName } });
      const entry = (s.unplacedLessons ?? []).find(u => u.id === mv.unplacedId);
      if (entry) entry.notePath = targetPath;
    } else {
      // fromUnplaced
      const entry = (s.unplacedLessons ?? []).find(u => u.id === mv.unplacedId);
      const src = entry?.notePath ? app.vault.getFileByPath(entry.notePath) : null;
      if (!src) continue;
      const targetPath = `${noteFolder(s, mv.to.date)}/${noteFileName(s, meta, mv.to.date, mv.to.periodName)}.md`;
      planned.push({ file: src, targetPath, date: mv.to.date, periodName: mv.to.periodName,
        undo: { fromPath: targetPath, toPath: src.path, date: mv.to.date, periodName: mv.to.periodName } });
    }
  }
  if (planned.length === 0) return [];

  // Phase 1: rename each source to a unique temp path so targets never collide.
  const base = plannerFolder(s);
  const temps: { file: TFile; plan: PlannedRename }[] = [];
  for (let i = 0; i < planned.length; i++) {
    const pl = planned[i];
    const tmp = normalizePath(`${base}/.tp-shift-tmp-${Date.now().toString(36)}-${i}.md`);
    try { await app.fileManager.renameFile(pl.file, tmp); temps.push({ file: pl.file, plan: pl }); }
    catch (err) { console.error("Teacher Planner: temp rename failed.", err); }
  }
  // Phase 2: temp -> final target, ensuring the folder exists and stamping frontmatter.
  const undo: NoteUndoOp[] = [];
  for (const t of temps) {
    const pl = t.plan;
    const folder = pl.targetPath.slice(0, pl.targetPath.lastIndexOf("/"));
    await ensureFolder(app, folder);
    try {
      await app.fileManager.renameFile(t.file, normalizePath(pl.targetPath));
      await setFm(app, t.file, pl.date, pl.periodName, meta.code);
      undo.push(pl.undo);
    } catch (err) { console.error("Teacher Planner: target rename failed.", err); }
  }
  return undo;
}

/** Reverse a set of note moves (used by the shift undo). */
export async function reverseNoteMoves(app: App, ops: NoteUndoOp[]): Promise<void> {
  const base = ops[0]?.toPath.split("/")[0] ?? "";
  const temps: { file: TFile; op: NoteUndoOp }[] = [];
  for (let i = 0; i < ops.length; i++) {
    const f = app.vault.getFileByPath(ops[i].fromPath);
    if (!f) continue;
    const tmp = normalizePath(`${base}/.tp-unshift-tmp-${Date.now().toString(36)}-${i}.md`);
    try { await app.fileManager.renameFile(f, tmp); temps.push({ file: f, op: ops[i] }); }
    catch (err) { console.error("Teacher Planner: undo temp rename failed.", err); }
  }
  for (const t of temps) {
    const folder = t.op.toPath.slice(0, t.op.toPath.lastIndexOf("/"));
    if (folder && !app.vault.getFolderByPath(folder)) { try { await app.vault.createFolder(folder); } catch { /* */ } }
    try {
      await app.fileManager.renameFile(t.file, normalizePath(t.op.toPath));
      await app.fileManager.processFrontMatter(t.file, (fm: Record<string, unknown>) => { fm.period = t.op.periodName; fm.date = t.op.date; });
    } catch (err) { console.error("Teacher Planner: undo restore rename failed.", err); }
  }
}

/** Default generated title for a lesson note (same template the week grid uses). */
export function lessonNoteDefaultTitle(s: TeacherPlannerSettings, classId: string, periodName: string, dateIso: string): string {
  const meta = classMeta(s, classId) ?? { code: "Lesson" };
  return noteFileName(s, meta, dateIso, periodName);
}

/** Existing lesson note path matching a title for a date, or null. */
export function findLessonNoteByTitle(app: App, s: TeacherPlannerSettings, dateIso: string, fileName: string): string | null {
  const base = plannerFolder(s);
  for (const p of [`${noteFolder(s, dateIso)}/${fileName}.md`, `${base}/${fileName}.md`]) {
    if (app.vault.getFileByPath(p)) return p;
  }
  return null;
}

/** Create (or open an existing) lesson note with tracking frontmatter, then open it. */
export async function createLessonNoteFile(app: App, s: TeacherPlannerSettings, classId: string, periodName: string, dateIso: string, rawName: string): Promise<void> {
  const meta = classMeta(s, classId) ?? { code: "Lesson" };
  const fallback = noteFileName(s, meta, dateIso, periodName);
  const fileName = rawName.replace(/[\\/:*?"<>|]/g, "-").replace(/\s{2,}/g, " ").trim() || fallback;
  const existing = findLessonNoteByTitle(app, s, dateIso, fileName);
  if (existing) { void app.workspace.openLinkText(existing, "", false); return; }
  const base = plannerFolder(s);
  const folder = noteFolder(s, dateIso);
  await ensureFolder(app, base);
  if (folder !== base) await ensureFolder(app, folder);
  const body = lessonNoteFrontmatter(meta, periodName, dateIso) + (s.lessonNoteTemplate ?? DEFAULT_LESSON_TEMPLATE);
  try {
    await app.vault.create(`${folder}/${fileName}.md`, body);
    void app.workspace.openLinkText(`${folder}/${fileName}.md`, "", false);
  } catch (e) { console.error("Teacher Planner: lesson note create failed", e); }
}
