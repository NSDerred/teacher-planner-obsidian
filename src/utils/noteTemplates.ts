import { App, TFile, normalizePath } from "obsidian";
import type { TeacherPlannerSettings } from "../types";
import type { PlanTemplate } from "./planTemplates";
import { DEFAULT_LESSON_TEMPLATE } from "../settings";

/**
 * Lesson NOTE templates (0.3.6) — a separate set from plan templates. Built-ins
 * ship as code; user templates are .md files under "<planner>/Note templates/".
 * The "Standard" built-in is backed by the existing `lessonNoteTemplate` setting
 * so a user's current/edited note body is preserved and stays editable.
 * Default is Blank. Shares the token renderer (renderTemplateBody) with plans.
 */

export type NoteTemplate = PlanTemplate; // same shape: {id,name,body,builtin,path?}

const TEMPLATE_LESSON_RECORD = `## What we covered
{{cursor}}

## What worked / to change


## Follow-up


## Homework set
`;

const TEMPLATE_HOMEWORK_LOG = `## Homework set
{{cursor}}

## Due


## Resources
`;

const TEMPLATE_NOTE_BLANK = `{{cursor}}
`;

/** Default note template when the user hasn't chosen one. */
export const DEFAULT_NOTE_TEMPLATE_ID = "blank";

/** Fixed metadata for the code-backed built-ins (Standard's body is dynamic). */
const BUILTIN_NOTE_META: ReadonlyArray<{ id: string; name: string; body?: string }> = [
  { id: "blank",         name: "Blank",         body: TEMPLATE_NOTE_BLANK },
  { id: "standard",      name: "Standard" /* body from settings.lessonNoteTemplate */ },
  { id: "lesson-record", name: "Lesson record", body: TEMPLATE_LESSON_RECORD },
  { id: "homework-log",  name: "Homework log",  body: TEMPLATE_HOMEWORK_LOG },
];

/** The Standard note body — the user's editable house template. */
export function standardNoteBody(s: TeacherPlannerSettings): string {
  return s.lessonNoteTemplate ?? DEFAULT_LESSON_TEMPLATE;
}

/** All built-in note templates (Standard's body resolved from settings). */
export function builtinNoteTemplates(s: TeacherPlannerSettings): NoteTemplate[] {
  return BUILTIN_NOTE_META.map(m => ({
    id: m.id,
    name: m.name,
    body: m.id === "standard" ? standardNoteBody(s) : (m.body ?? ""),
    builtin: true,
  }));
}

export function noteTemplatesFolder(s: TeacherPlannerSettings): string {
  return `${s.plannerFolder || "Teacher Planner"}/Note templates`;
}

export function visibleNoteBuiltins(s: TeacherPlannerSettings): NoteTemplate[] {
  const hidden = new Set(s.hiddenNoteTemplateIds ?? []);
  return builtinNoteTemplates(s).filter(t => !hidden.has(t.id));
}

export function hiddenNoteBuiltins(s: TeacherPlannerSettings): NoteTemplate[] {
  const hidden = new Set(s.hiddenNoteTemplateIds ?? []);
  return builtinNoteTemplates(s).filter(t => hidden.has(t.id));
}

/** Read the user's saved note templates from the Note templates/ folder. */
export async function listUserNoteTemplates(app: App, s: TeacherPlannerSettings): Promise<NoteTemplate[]> {
  const folder = noteTemplatesFolder(s);
  const files = app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folder + "/"));
  const out: NoteTemplate[] = [];
  for (const f of files.sort((a, b) => a.basename.localeCompare(b.basename))) {
    let body = "";
    try { body = await app.vault.read(f); } catch { /* skip unreadable */ }
    out.push({ id: f.path, name: f.basename, body, builtin: false, path: f.path });
  }
  return out;
}

/** Every visible note template — built-ins (minus hidden) then user templates. */
export async function listNoteTemplates(app: App, s: TeacherPlannerSettings): Promise<NoteTemplate[]> {
  return [...visibleNoteBuiltins(s), ...(await listUserNoteTemplates(app, s))];
}

/** Canonical body of a built-in note template by id, or undefined. */
export function builtinNoteBody(s: TeacherPlannerSettings, id: string): string | undefined {
  return builtinNoteTemplates(s).find(t => t.id === id)?.body;
}

/**
 * Body of the default note template (the one the New-note dialog preselects).
 * Falls back to Blank if the stored default id no longer resolves.
 */
export function defaultNoteBody(s: TeacherPlannerSettings, userBodyById?: (id: string) => string | undefined): string {
  const id = s.defaultNoteTemplateId ?? DEFAULT_NOTE_TEMPLATE_ID;
  return builtinNoteBody(s, id) ?? userBodyById?.(id) ?? builtinNoteBody(s, DEFAULT_NOTE_TEMPLATE_ID) ?? TEMPLATE_NOTE_BLANK;
}

/** Write a user note template file, returning its path. */
export async function saveUserNoteTemplate(app: App, s: TeacherPlannerSettings, name: string, body: string): Promise<string> {
  const folder = noteTemplatesFolder(s);
  if (!app.vault.getFolderByPath(folder)) {
    try { await app.vault.createFolder(folder); } catch { /* race/exists */ }
  }
  const safe = name.replace(/[\\/:*?"<>|]/g, "-").replace(/\s{2,}/g, " ").trim() || "Template";
  const path = normalizePath(`${folder}/${safe}.md`);
  const existing = app.vault.getFileByPath(path);
  if (existing instanceof TFile) { await app.vault.modify(existing, body); return path; }
  await app.vault.create(path, body);
  return path;
}
