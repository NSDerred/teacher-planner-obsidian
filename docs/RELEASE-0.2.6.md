# Teacher Planner 0.2.6 — release notes (draft)

Work-in-progress changelog. Accumulated as items from
"Teacher Planner Updates and troubleshooting TO DO" are completed and approved.
Bump `manifest.json` + `package.json` to `0.2.6` when ready to publish.

## Added

- **External-resource indicator.** When a lesson or event has an external
  file/folder linked, a grey paperclip appears in the chip footer (rightmost,
  alongside the plan/prepared markers); click it to open the resource. Desktop
  only, since opening needs the OS. Scales and stacks with the other markers.

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

- **Taller week grid.** The time-axis scale increased from 1.8 to 2.0 px/minute
  (108 → 120 px per hour), so every period renders ~11% larger.

- **Lesson-plan chip indicator redesigned.** The link status is now drawn as
  proper shapes instead of text glyphs: a larger hollow ring when no plan is
  linked, and a clean green document icon (click to open the plan) when one is —
  no more boxed look.
  The plan icon and prepared tick live on the chip's bottom row: on wide cells
  they share the classroom line (room left, icons right); when the cell gets too
  narrow they drop to their own right-aligned line below it. The markers scale
  with the chip (shared --mark-size, stepped at the same breakpoints as the
  font), and the title/subject area clips first so the icons are never cut off.
  The hover period/time line stays on its own line, separate from the icons.
  Chip lines now pack to the top (no empty gap): code, year·subject, a single
  truncated notes line, then room+icons. On hover the order is period·time
  (notes size) first, then code, year·subject, full notes, room+icons.

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
