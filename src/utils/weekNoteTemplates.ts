import { App, TFile, normalizePath } from "obsidian";
import type { TeacherPlannerSettings } from "../types";
import type { PlanTemplate } from "./planTemplates";
import { renderTemplateBody } from "./planTemplates";

/**
 * Week NOTE templates (0.3.7) — a third, deliberately empty-handed template set.
 *
 * Unlike plan templates (0.3.5) and lesson-note templates (0.3.6), nothing
 * opinionated ships here: the only built-in is Blank, and Blank is the default,
 * so a week note behaves exactly as it always has until the user saves a layout
 * of their own. User templates are ordinary markdown files under
 * "<planner folder>/Week note templates/", created only on demand.
 *
 * Token rendering is shared with plans and lesson notes (renderTemplateBody);
 * the week context supplies {{week}} / {{weekEnd}} / {{date}} / {{dateUK}} /
 * {{academicYear}} / {{cursor}}. Class-scoped tokens collapse to empty, as they
 * do everywhere else.
 */

export type WeekNoteTemplate = PlanTemplate; // {id,name,body,builtin,path?}

const TEMPLATE_WEEK_BLANK = `{{cursor}}
`;

/** The only built-in, and the default. */
export const BLANK_WEEK_TEMPLATE_ID = "blank";

export function builtinWeekNoteTemplates(): WeekNoteTemplate[] {
  return [{ id: BLANK_WEEK_TEMPLATE_ID, name: "Blank", body: TEMPLATE_WEEK_BLANK, builtin: true }];
}

export function weekNoteTemplatesFolder(s: TeacherPlannerSettings): string {
  return `${s.plannerFolder || "Teacher Planner"}/Week note templates`;
}

/**
 * Cheap existence check for the sidebar button — counts files by path only,
 * reading none of them, so it is safe to call from a reactive statement.
 */
export function hasUserWeekNoteTemplates(app: App, s: TeacherPlannerSettings): boolean {
  const prefix = weekNoteTemplatesFolder(s) + "/";
  return app.vault.getMarkdownFiles().some(f => f.path.startsWith(prefix));
}

/** Read the user's saved week-note templates from the Week note templates/ folder. */
export async function listUserWeekNoteTemplates(app: App, s: TeacherPlannerSettings): Promise<WeekNoteTemplate[]> {
  const prefix = weekNoteTemplatesFolder(s) + "/";
  const files = app.vault.getMarkdownFiles().filter(f => f.path.startsWith(prefix));
  const out: WeekNoteTemplate[] = [];
  for (const f of files.sort((a, b) => a.basename.localeCompare(b.basename))) {
    let body = "";
    try { body = await app.vault.read(f); } catch { /* skip unreadable */ }
    out.push({ id: f.path, name: f.basename, body, builtin: false, path: f.path });
  }
  return out;
}

/** Every week-note template — Blank first, then the user's own. */
export async function listWeekNoteTemplates(app: App, s: TeacherPlannerSettings): Promise<WeekNoteTemplate[]> {
  return [...builtinWeekNoteTemplates(), ...(await listUserWeekNoteTemplates(app, s))];
}

/** Body of a template by id (built-in id or user file path), or undefined. */
export async function weekNoteTemplateBody(
  app: App, s: TeacherPlannerSettings, id: string,
): Promise<string | undefined> {
  const builtin = builtinWeekNoteTemplates().find(t => t.id === id);
  if (builtin) return builtin.body;
  const f = app.vault.getFileByPath(id);
  if (!f) return undefined;
  try { return await app.vault.read(f); } catch { return undefined; }
}

/**
 * Body of the default week-note template. Falls back to Blank whenever the
 * stored id no longer resolves (template deleted, folder renamed).
 */
export async function defaultWeekNoteBody(app: App, s: TeacherPlannerSettings): Promise<string> {
  const id = s.defaultWeekNoteTemplateId ?? BLANK_WEEK_TEMPLATE_ID;
  return (await weekNoteTemplateBody(app, s, id)) ?? TEMPLATE_WEEK_BLANK;
}

/**
 * Fill a week-note template for the week beginning `mondayIso`.
 * Returns the body with every token resolved and the cursor marker stripped.
 */
export function renderWeekNoteBody(
  tpl: string, s: TeacherPlannerSettings, mondayIso: string,
): string {
  const { body } = renderTemplateBody(tpl, {
    academicYear: s.academicYear?.name,
    lessonDate: mondayIso,
  });
  return body;
}

/** Write a user week-note template file, returning its path. */
export async function saveUserWeekNoteTemplate(
  app: App, s: TeacherPlannerSettings, name: string, body: string,
): Promise<string> {
  const folder = weekNoteTemplatesFolder(s);
  if (!app.vault.getFolderByPath(folder)) {
    try { await app.vault.createFolder(folder); } catch { /* race/exists — non-fatal */ }
  }
  const safe = name.replace(/[\\/:*?"<>|]/g, "-").replace(/\s{2,}/g, " ").trim() || "Template";
  const path = normalizePath(`${folder}/${safe}.md`);
  const existing = app.vault.getFileByPath(path);
  if (existing instanceof TFile) { await app.vault.modify(existing, body); return path; }
  await app.vault.create(path, body);
  return path;
}
