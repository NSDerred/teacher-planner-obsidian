# Teacher Planner 0.2.6 — release notes (draft)

Work-in-progress changelog. Accumulated as items from
"Teacher Planner Updates and troubleshooting TO DO" are completed and approved.
Bump `manifest.json` + `package.json` to `0.2.6` when ready to publish.

## Added

- **Configurable note-title templates.** New **Settings → Note titles** section
  with two editable templates and a live preview:
  - *Lesson note title* — default `{{date}} - {{period}} - {{class}} - {{emoji}} {{subject}}`
    → e.g. `13-06-2026 - P1 - 10A - 🌱 Biology`
  - *Event note title* — default `{{date}} - {{period}} - {{event}}`
    → e.g. `13-06-2026 - Break - Bake sale`
  - Tokens: `{{date}}` (UK DD-MM-YYYY), `{{period}}` (P1 for numbered blocks,
    block name for Break/Lunch/Registration), `{{class}}`, `{{subject}}`,
    `{{emoji}}` (subject emoji), `{{event}}`.
  - Empty tokens collapse cleanly — a missing value never leaves a dangling
    `-` separator. Illegal filename characters are stripped automatically.
  - Clear a field to restore its default.

## Changed

- **Generated lesson/event note titles** now follow the templates above instead
  of the old `<ISO date> <class code>` scheme.
- Creating a lesson or event note now shows an **editable, pre-filled title
  prompt** (was silent auto-create). An already-existing note with the default
  title still opens directly without prompting.

## Internal

- New `src/utils/noteTitleUtils.ts` (`buildNoteTitle`, `formatUkDate`,
  `shortPeriodLabel`, `sanitiseNoteFileName`).
- `lessonNoteTitleTemplate` / `eventNoteTitleTemplate` added to settings types,
  defaults, per-planner field list, and migration guard.
