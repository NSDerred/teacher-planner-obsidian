import { App, TFile, normalizePath } from "obsidian";
import type { TeacherPlannerSettings } from "../types";
import { localIso } from "./weekUtils";

/**
 * Lesson plan templates (0.3.5). Six templates ship as code constants so a
 * fresh install has them with zero vault clutter; user templates are ordinary
 * .md files under "<planner folder>/Plan templates/", created only on demand.
 * The picker merges both. Built-ins can't be deleted from code, so "deleting"
 * one hides it (id recorded in settings.hiddenBuiltinTemplateIds) with a
 * Restore always available.
 */

export interface PlanTemplate {
  /** Built-in id (e.g. "essentials") or, for user templates, the file path. */
  id: string;
  name: string;
  body: string;
  builtin: boolean;
  /** Set for user templates only — the vault path of the backing .md file. */
  path?: string;
}

// ── The six built-in templates (approved 2026-08-01) ────────────────────────
// Header line is shared; each body is the approved design, headings only (no
// descriptive hint text — those were annotations in the design mockup).

const HEADER = "# {{class}} — {{subject}} {{emoji}}\n{{lessonDate}} · {{period}} · {{room}}\n";

/** Essentials — everyday, workload-first (DfE workload guidance). The default. */
export const TEMPLATE_ESSENTIALS = `${HEADER}
## Learning objectives
- {{cursor}}

## How we'll get there


## Homework / next steps
`;

/** Review · Build · Apply — direct instruction (Rosenshine). */
const TEMPLATE_REVIEW_BUILD_APPLY = `${HEADER}
## Learning objective
{{cursor}}

## Retrieval starter


## New material


## Guided practice


## Check for understanding


## Independent practice


## Review / next lesson
`;

/** 5E Inquiry — inquiry science (BSCS 5E); practical/safety folded into Explore. */
const TEMPLATE_5E = `${HEADER}Syllabus point: {{cursor}}

## Engage


## Explore
Safety & equipment:

## Explain


## Elaborate


## Evaluate
`;

/** Cover lesson — absence; self-contained, written for a non-specialist. */
const TEMPLATE_COVER = `# COVER — {{class}} — {{subject}}
{{lessonDate}} · {{period}} · {{room}}

## For the cover teacher
{{cursor}}

## Do first (5 min)


## Main task


## Materials


## If they finish early


## Behaviour & seating notes


## Please leave for me
`;

/** Blank — no framework; header line + caret only. */
const TEMPLATE_BLANK = `${HEADER}
{{cursor}}
`;

/** Revision & feedback — exam-season; retrieval + past paper + DIRT. */
const TEMPLATE_REVISION = `${HEADER}Focus / topic: {{cursor}}

## Retrieval warm-up


## Exam question / past paper


## Mark scheme & common errors


## Improve (DIRT)


## Exam technique takeaway
`;

export const BUILTIN_PLAN_TEMPLATES: ReadonlyArray<Omit<PlanTemplate, "builtin">> = [
  { id: "essentials",         name: "Essentials",           body: TEMPLATE_ESSENTIALS },
  { id: "review-build-apply", name: "Review · Build · Apply", body: TEMPLATE_REVIEW_BUILD_APPLY },
  { id: "5e-inquiry",         name: "5E Inquiry",           body: TEMPLATE_5E },
  { id: "cover",              name: "Cover lesson",         body: TEMPLATE_COVER },
  { id: "blank",              name: "Blank",                body: TEMPLATE_BLANK },
  { id: "revision-feedback",  name: "Revision & feedback",  body: TEMPLATE_REVISION },
];

/** The default when the user hasn't chosen one. */
export const DEFAULT_PLAN_TEMPLATE_ID = "essentials";

// ── Token rendering ─────────────────────────────────────────────────────────
// A body renderer distinct from buildNoteTitle: that one sanitises for
// filenames and would mangle markdown. Same token vocabulary, no stripping.

export interface TemplateContext {
  classCode?: string;
  subjectName?: string;
  emoji?: string;
  year?: string;
  /** Planner name, surfaced as {{academicYear}}. */
  academicYear?: string;
  /** ISO date of the lesson being planned (not today). */
  lessonDate?: string;
  /** Period label of the slot, e.g. "Period 2". */
  period?: string;
  /** Classroom for the lesson (per-lesson override or the class's room). */
  room?: string;
}

const CURSOR_SENTINEL = "\u0000";

function friendlyDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function ukDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}-${m}-${y}` : iso;
}

/** Friendly date of the Friday of the week containing `iso`. */
function fridayOfWeek(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  if (isNaN(d.getTime())) return "";
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day) + 4);
  return friendlyDate(localIso(d));
}

function mondayIso(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  if (isNaN(d.getTime())) return "";
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return friendlyDate(localIso(d));
}

/**
 * Fill template tokens. Unknown or empty tokens render empty — a template never
 * breaks a note. {{cursor}} renders empty; its character offset is returned so
 * the caller can park the caret there after opening the file. Returns -1 when
 * no cursor marker is present.
 */
export function renderTemplateBody(
  tpl: string,
  ctx: TemplateContext,
  today: string = localIso(new Date()),
): { body: string; cursorOffset: number } {
  const map: Record<string, string> = {
    class: ctx.classCode ?? "",
    subject: ctx.subjectName ?? "",
    emoji: ctx.emoji ?? "",
    year: ctx.year ?? "",
    academicYear: ctx.academicYear ?? "",
    date: today,
    dateUK: ukDate(today),
    lessonDate: friendlyDate(ctx.lessonDate),
    period: ctx.period ?? "",
    room: ctx.room ?? "",
    week: mondayIso(ctx.lessonDate),
    weekEnd: fridayOfWeek(ctx.lessonDate),
  };
  let body = tpl.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    if (key === "cursor") return CURSOR_SENTINEL;
    return key in map ? map[key] : "";
  });
  const cursorOffset = body.indexOf(CURSOR_SENTINEL);
  if (cursorOffset >= 0) body = body.split(CURSOR_SENTINEL).join(""); // strip all; first offset kept
  return { body, cursorOffset };
}

// ── Template store (built-ins + user .md files) ─────────────────────────────

/** Folder holding user plan templates. */
export function planTemplatesFolder(s: TeacherPlannerSettings): string {
  return `${s.plannerFolder || "Teacher Planner"}/Plan templates`;
}

/** Built-in templates minus any the user has hidden. */
export function visibleBuiltins(s: TeacherPlannerSettings): PlanTemplate[] {
  const hidden = new Set(s.hiddenBuiltinTemplateIds ?? []);
  return BUILTIN_PLAN_TEMPLATES.filter(t => !hidden.has(t.id)).map(t => ({ ...t, builtin: true }));
}

/** Hidden built-ins, for the "restore" list. */
export function hiddenBuiltins(s: TeacherPlannerSettings): PlanTemplate[] {
  const hidden = new Set(s.hiddenBuiltinTemplateIds ?? []);
  return BUILTIN_PLAN_TEMPLATES.filter(t => hidden.has(t.id)).map(t => ({ ...t, builtin: true }));
}

/** Read the user's saved plan templates from the Plan templates/ folder. */
export async function listUserTemplates(app: App, s: TeacherPlannerSettings): Promise<PlanTemplate[]> {
  const folder = planTemplatesFolder(s);
  const files = app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folder + "/"));
  const out: PlanTemplate[] = [];
  for (const f of files.sort((a, b) => a.basename.localeCompare(b.basename))) {
    let body = "";
    try { body = await app.vault.read(f); } catch { /* skip unreadable */ }
    out.push({ id: f.path, name: f.basename, body, builtin: false, path: f.path });
  }
  return out;
}

/**
 * Every visible template — built-ins (minus hidden) then user templates.
 * The default template's body reflects any in-place edit (settings.lessonPlanTemplate).
 */
export async function listPlanTemplates(app: App, s: TeacherPlannerSettings): Promise<PlanTemplate[]> {
  const defId = s.defaultPlanTemplateId ?? DEFAULT_PLAN_TEMPLATE_ID;
  const override = s.lessonPlanTemplate;
  const applyOverride = (t: PlanTemplate): PlanTemplate =>
    (t.id === defId && override != null) ? { ...t, body: override } : t;
  const builtins = visibleBuiltins(s).map(applyOverride);
  const users = (await listUserTemplates(app, s)).map(applyOverride);
  return [...builtins, ...users];
}

/** Canonical body of a built-in by id, or undefined. */
export function builtinBody(id: string): string | undefined {
  return BUILTIN_PLAN_TEMPLATES.find(t => t.id === id)?.body;
}

/**
 * The effective body of the default template, used by the fast-path
 * "＋ Create new plan…". An in-place edit (lessonPlanTemplate) wins; otherwise
 * the built-in constant; falling back to Essentials if the stored default id no
 * longer resolves (e.g. a user template file was deleted).
 */
export function defaultPlanBody(s: TeacherPlannerSettings, userBodyById?: (id: string) => string | undefined): string {
  if (s.lessonPlanTemplate != null) return s.lessonPlanTemplate;
  const id = s.defaultPlanTemplateId ?? DEFAULT_PLAN_TEMPLATE_ID;
  return builtinBody(id) ?? userBodyById?.(id) ?? builtinBody(DEFAULT_PLAN_TEMPLATE_ID) ?? TEMPLATE_ESSENTIALS;
}

/** Display name of the current default template. */
export function defaultTemplateName(s: TeacherPlannerSettings): string {
  const id = s.defaultPlanTemplateId ?? DEFAULT_PLAN_TEMPLATE_ID;
  const b = BUILTIN_PLAN_TEMPLATES.find(t => t.id === id);
  if (b) return b.name;
  // user template → basename of the path
  const slash = id.lastIndexOf("/");
  return (slash >= 0 ? id.slice(slash + 1) : id).replace(/\.md$/, "");
}

/** Write a user template file, returning its path. Name is sanitised. */
export async function saveUserTemplate(app: App, s: TeacherPlannerSettings, name: string, body: string): Promise<string> {
  const folder = planTemplatesFolder(s);
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

// ── Guide note (opened from the button at the top of Settings) ──────────────

/** Markdown for the "how to use lesson templates" guide note. */
export function buildTemplatesGuide(): string {
  return `---
type: teacher-planner-guide
---
# Lesson plan & note templates — guide

Teacher Planner can create lesson **plans** and lesson **notes** from templates,
so every new plan starts with the structure you actually use. This note explains
how. It was created on demand from Settings — delete it any time; you can reopen
it from the button at the top of the Teacher Planner settings tab.

## Creating a plan

Tap the plan-link icon on any lesson (in the week view or the lesson overview) to
open the plan picker. Two create options sit at the top:

- **＋ Create new plan…** — uses your **default template** silently. One step; this
  is the everyday path.
- **＋ Create from template…** — opens a chooser listing the six built-in templates
  plus any you have saved.

Either way, the new plan's tokens are filled in from the lesson you tapped.

## The six built-in templates

- **Essentials** — the everyday, low-friction plan (the default).
- **Review · Build · Apply** — direct instruction: retrieval, new material, guided
  and independent practice, review.
- **5E Inquiry** — inquiry science (Engage / Explore / Explain / Elaborate /
  Evaluate); safety & equipment sit inside Explore.
- **Cover lesson** — a self-contained plan for whoever covers your class.
- **Blank** — just the header line; no structure imposed.
- **Revision & feedback** — exam practice and whole-class feedback (DIRT).

## Managing templates

In **Settings → Teacher Planner → Lesson plans**:

- **Default plan template** — choose which template the fast path uses.
- **Edit template** — change the text; a live preview updates as you type. Editing
  here customises your default. **Save as template…** writes a named copy as a
  markdown file under \`Plan templates/\` in your planner folder.
- **Manage templates** — edit or remove any template. Your own templates are
  ordinary notes (edit or delete them like any file). Built-ins can't be deleted,
  so removing one **hides** it from the picker — a **Restore** button always brings
  it back.

## Tokens

Templates can include tokens that fill in automatically:

| Token | Fills with |
| --- | --- |
| \`{{class}}\` | Class code |
| \`{{subject}}\` | Subject name |
| \`{{emoji}}\` | Subject emoji |
| \`{{year}}\` | Year group |
| \`{{academicYear}}\` | Planner name |
| \`{{date}}\` | Today (YYYY-MM-DD) |
| \`{{dateUK}}\` | Today (DD-MM-YYYY) |
| \`{{lessonDate}}\` | The lesson's date |
| \`{{period}}\` | The lesson's period |
| \`{{room}}\` | The lesson's room |
| \`{{week}}\` | Monday of the lesson's week |
| \`{{cursor}}\` | Renders empty; parks your cursor there when the plan opens |

Any token with no value simply renders empty — a template never breaks a note.
`;
}
