# Teacher Planner 0.2.6 — release notes (draft)

Work-in-progress changelog. Accumulated as items from
"Teacher Planner Updates and troubleshooting TO DO" are completed and approved.
Bump `manifest.json` + `package.json` to `0.2.6` when ready to publish.

## Added

- **Lesson-prepared marker.** A green badge tick (filled circle + white check) in
  each lesson chip that you click to mark a lesson prepared — independent of linking a plan, for teachers
  who don't use plan links. Saved per lesson-occurrence (slot + date) and per
  event; follows a lesson when dragged. Also on the right-click menu
  ("Mark prepared" / "Clear prepared mark"). New **Settings → "Show
  lesson-prepared marker"** toggle (default on) to hide it.

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

- **Lesson-plan chip indicator redesigned.** The link status is now drawn as
  proper shapes instead of text glyphs: a larger hollow ring when no plan is
  linked, and a clean green document icon (click to open the plan) when one is —
  no more boxed look.
  Both the plan icon and the prepared tick sit on the chip's bottom row (next to
  the classroom) so they never overlap or truncate the lesson title — the title
  row stays full-width and ellipsises if needed.

- **Generated lesson/event note titles** now follow the templates above instead
  of the old `<ISO date> <class code>` scheme.
- Creating a lesson or event note now shows an **editable, pre-filled title
  prompt** (was silent auto-create). An already-existing note with the default
  title still opens directly without prompting.

## Internal

- `PreparedMark` type + `preparedMarks` / `showPreparedMark` added to settings
  types, field list and migration; helpers (`isSlotPrepared`,
  `toggleSlotPrepared`, `migrateSlotPreparedToEvent`, event variants) in
  `planLinkUtils.ts`. Chip markup/CSS reworked (`tp-chip-marks`, `tp-plan-mark`,
  `tp-prep-tick`).

- New `src/utils/noteTitleUtils.ts` (`buildNoteTitle`, `formatUkDate`,
  `shortPeriodLabel`, `sanitiseNoteFileName`).
- `lessonNoteTitleTemplate` / `eventNoteTitleTemplate` added to settings types,
  defaults, per-planner field list, and migration guard.
