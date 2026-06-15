# Changelog

All notable changes to Teacher Planner will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.8] — 2026-06-15

### Added

- **Custom one-off events.** The Add Event tool is now a full event creator. Give an event any name, or start typing to search your existing classes and activities and snapshot one. Pick one block or several from a searchable list, set a colour from a palette or a custom picker, choose whether it counts as directed time, and set a duration that auto-fills from the blocks you picked. New events open with a random colour so they stay easy to tell apart.
- **Spanning blocks for multi-period events.** When an event covers two or more adjacent blocks that are otherwise empty, those blocks merge into one continuous block holding the event. If a lesson or another event is in the way, the event falls back to a normal chip in each block instead, so nothing is ever hidden.
- **Double-booking warnings.** Any block holding two or more items shows a warning marker, shown in red when the directed-time tracker is on and the overlap would count that time twice. Adding an event onto a block that is already in use now warns you first and offers to add it anyway, add it without counting it as directed time, or remove what is already there.
- **Mobile views.** On a phone the week view now offers a Day, Agenda, or Grid layout. Day shows one readable day at a time with a day picker, Agenda lists the whole week, and Grid keeps the familiar timetable. Your choice is remembered per planner. The desktop view is unchanged.
- **Smarter A/B week rotation.** The rotation now counts teaching weeks and skips full holiday weeks, so it stays in step across half terms. The week badge is now a button for setting a one-off A or B override for a single week or from a week onward.
- **Planner backup and restore.** Export any planner, or all of them, to a JSON file in your vault, and import a backup as a new planner. Deleting a planner now saves a backup first, so a delete is always recoverable.
- **Jump to any week.** The week navigation now has clear previous and next arrows and a centre button that opens a date picker, so you can jump straight to any week or back to today.
- **Per-device grid zoom.** A new setting controls the height of the week grid in pixels per hour. It is stored per device, so your desktop and phone each keep their own zoom and it never syncs between them.
- **Drag to copy.** Hold Ctrl or Cmd while dragging a lesson or event in the week view to drop a copy instead of moving it.
- **Prepared marker on events.** The prepared tick now appears on one-off events as well as timetabled lessons.

### Changed

- **Timetable slot picker.** Class rows now show the subject emoji, and opening the picker on a filled cell highlights the item already assigned there.
- **Plugin description.** Reworded for clarity.

### Fixed

- **Dragging a one-off event now changes its period.** A single-period event moved to a different period now lands in that period, not just the new day. Multi-period events still move by day and keep their span.

## [0.2.6] — 2026-06-13

### Added

- **Configurable note-title templates** — a new **Settings → Note titles** section lets you set the filename pattern for generated lesson and event notes from editable templates with a live preview. Tokens: `{{date}}` (UK), `{{period}}` (e.g. `P1`, or `Break`/`Lunch`), `{{class}}`, `{{subject}}`, `{{emoji}}` (the subject emoji), and `{{event}}`. Empty tokens collapse cleanly and illegal filename characters are stripped. Defaults: lessons `13-06-2026 - P1 - 10A - 🌱 Biology`, events `13-06-2026 - Break - Bake sale`.
- **Lesson-prepared marker** — a green tick on each lesson chip you can click to mark a lesson "prepared", independent of linking a plan (for teachers who don't use plan links). Saved per lesson occurrence, follows a lesson when dragged, and available from the right-click menu. Toggle it off in settings if you don't want it.
- **External-resource indicators** — when a lesson has an external file or folder linked, a marker now appears on the chip: a paperclip for a file, a folder icon for a folder. Click to open (desktop only).
- **Week notes as vault files (opt-in)** — a new setting saves each week's sidebar note as a real markdown file (`Week note - <Monday date>`) in a configurable folder, so week notes are searchable, linkable, and no longer grow the plugin data file. Enabling migrates your existing week notes to files.

### Changed

- **Redesigned the lesson-plan chip indicator** — the linked state is now a clean green document icon (click to open the plan) instead of a boxed dot; the faint "no plan linked" ring has been removed so the marker only shows when a plan is linked.
- **Chip footer layout** — the classroom and the plan/prepared/external markers now share a single responsive bottom line (classroom left, icons right), dropping the icons to their own line on very narrow cells. Lines pack to the top with no gap, the notes line is shown truncated (full on hover), and the period/time appears on hover.
- **Taller week grid** — the time-axis scale increased from 1.8 to 2.0 px per minute (120 px per hour), so every period renders slightly larger.
- Note-storage options ("Organise notes into weekly folders", "Store week notes as vault files", "Week notes folder") moved into a dedicated **Notes** settings section.
- Removed the now-redundant "Show unplanned indicator" setting.

### Fixed

- **Week-note dates were off by a day and file mode could lose a note's content.** Week keys were computed in UTC (`toISOString`), so in British Summer Time a Monday resolved to the Sunday date. Keys now use the local Monday date, with a migration that re-keys existing notes. The data-file-to-markdown migration is now safe: it overwrites an accidentally-empty file rather than skipping it, verifies each write before clearing the source, runs before the sidebar switches to file mode, and the sidebar won't overwrite a saved note with an empty save.

## [0.2.5] — 2026-06-12

### Fixed

- **Current-time line now spans the whole week** — the dashed "now" line previously rendered only inside today's column, so on busy days it read as hidden behind the blocks. It's now a single continuous line from the time gutter across all day columns (and their gaps), always drawn above blocks and chips, shown only when viewing the current week.
- **Settings sections wouldn't expand** — a leftover CSS rule from the 0.2.2 collapsible rework hid section content unconditionally, so clicking a header toggled the state but nothing ever became visible. Sections now open and close as intended.

## [0.2.4] — 2026-06-12

### Changed

- **`xlsx` dependency replaced with `write-excel-file`** — clears the dependency security advisory flagged by the community review bot (the advisory concerned parsing untrusted files, which the plugin never did) and shrinks the plugin bundle by ~420 KB. Excel exports are equivalent: same sheets, same data.
- Fixed the review bot's two remaining source warnings: an unnecessary type assertion in the period dialog and an untyped `JSON.parse` in the settings revert button.

## [0.2.3] — 2026-06-12

### Fixed

- **Event chips were unclickable** — clicking a one-off event in the week view threw `getEventPlan is not defined` (a missing import) before its menu could open. Events can be clicked, edited and removed again.
- **Bulk-apply and undo confirmations now use the in-app dialog** — "Apply plan to future lessons", "Undo last bulk apply" and timetable template deletion relied on `window.confirm()`, which Obsidian can suppress; they now use the same themed confirmation modal as the rest of the plugin.
- **"Save Timetable" no longer bypasses the past-week warning** — the click event was accidentally passed as the `force` flag, skipping the "you are editing a past week" confirmation.

### Changed

- **Adaptive hover cards** — hovering a block with a lesson or event now shows a card that fits its content exactly: the blank space below short chips (e.g. a Cover in a long period) is gone, while clipped chips still expand to reveal hidden lines. The block quietly keeps its original footprint as the hover area, so nothing flickers.
- New `npm run check:svelte` (svelte-check) and `npm run verify` pipeline — Svelte components are now fully type-checked, so a missing import like the one above can never reach a release again; all 40 latent type errors in the Svelte components fixed in the process
- Internal typing pass to clear review-bot warnings: typed Svelte component imports, Electron export-dialog access, settings sync helpers and legacy-data migration — no `any` casts remain in flagged areas
- `window.confirm()` replaced with a proper in-app confirmation dialog (reset block colours, delete day schedule, clear holidays, clear periods) — keyboard- and theme-friendly
- All 51 "Promise returned where void expected" review-bot warnings cleared: async callbacks are now explicitly void-wrapped; an `npm run lint` script (typescript-eslint) guards against regressions
- Deprecated API swept: `setWarning()` → `setClass("mod-warning")` (same styling, works on every Obsidian version), `setDynamicTooltip()` replaced by an inline px value label next to the weight sliders
- New GitHub Actions release workflow: tag a version and CI builds the plugin, verifies the tag matches manifest.json, attests build provenance, and drafts the release with main.js / manifest.json / styles.css attached
- Accessibility: colour-picker sliders expose aria-valuenow/min/max, highlight swatch row is a labelled toolbar — the build is now completely warning-free

## [0.2.2] — 2026-06-11

Compliance release addressing the Obsidian community plugin review bot.

### Changed

- Raised `minAppVersion` to 1.7.2 (`workspace.revealLeaf` is async there; both calls now awaited)
- Plugin no longer detaches its leaves on unload, so panes keep the position you moved them to across plugin reloads
- All direct element style assignments (113 across ten files) replaced with Obsidian's `setCssStyles`
- Settings section headings now use `Setting().setHeading()`; the collapsible sections work identically via classes
- Timers and animation frames are window-scoped and `document` swapped for `activeDocument` where flagged, for popout-window compatibility
- Command `open-teacher-planner` renamed to `open` ("Open planner") per guidelines — re-bind your hotkey if you had one
- Removed the one `!important` in styles.css and various unused imports

## [0.2.1] — 2026-06-11

### Added

- **Calmer week view with hover detail** — empty period blocks show just the period name; hovering reveals the time range beneath it. Clipped or narrow blocks (short registrations, busy slivers) expand on hover into an opaque overlay floating above their neighbours, showing the full chip with room, period times and un-clamped notes. Lesson/event chips carry a "Period · time" tooltip, and the chip right-click menu opens with a period-and-time header row — so timing is always one tap away on mobile, where hover doesn't exist.
- **Bulk apply safety** — "Apply plan to future lessons" now shows a count and asks for confirmation first, and can be undone: the toast carries an Undo button (also in the lesson menu), restoring any plans the bulk apply overwrote.
- **Plans on activities** — Cover, duties, meetings and other activities can take lesson plans too; the "unplanned" hollow dot remains lessons-only.
- **External resources** — link one file or folder from outside the vault to any lesson or event (desktop only): Link external file/folder in the chip menu, opened with the system default app. Paths are machine-specific and don't sync to mobile.
- **Event notes** — activity events get an "Event note" menu item creating a blank dated note (e.g. "2026-06-16 Duty note.md").
- **Weekly note folders** — lesson and event notes are now created inside "WC - <Monday date>" folders under the planner folder instead of piling up in its root. Existing notes stay where they are and keep opening; toggle off in Settings → Lesson plans to restore the flat layout.
- **Lesson plans** (#community request) — link any markdown note in your vault to a lesson as its reusable plan. Right-click a lesson chip → "Link lesson plan…" opens a fuzzy picker (your plans folder listed first) with "Create new plan…" from a template. Chips show a coloured dot when a plan is linked (click to open) and a faint hollow dot when unplanned (toggleable in settings). "Apply plan to future lessons" links the same note to every remaining lesson of that class this year — A/B weeks, day schedules, holidays and exclusions respected. Plans follow lessons when dragged, paths auto-update on note rename/move, and the note itself is never modified — so the same plan can serve a class this year and next.

## [0.2.0] — 2026-06-11

### Added

- **Time-axis week view** — the week view now renders as a continuous time axis: a time gutter with hour lines, and each day column independently shaped by its day schedule. Period blocks are positioned and sized by their real start/end times; lesson and event chips live inside the blocks; holidays/INSET shade the whole column; the current-time line and badge track the time axis. All interactions carry over: drag-drop between blocks (with invalid-drop rejection), chip menus, lesson notes, A/B badges, and responsive narrow-pane behaviour.
- **Setup wizard: day schedules** — Step 7 now offers the same schedule controls as settings: create/rename/delete day schedules, assign days with the day pills, and edit each schedule's periods. New planners are created with day schedules from the start.
- **Day schedules (per-day timetable structure)** — days can now have different period structures: a sports afternoon on Wednesdays, a half-day Saturday with its own times, and so on. The School Timetable settings section gains a schedule selector (create, rename, delete) and day pills to assign days to schedules; existing planners are migrated automatically into a single "Standard day" schedule with no visible change. The week view and timetable editor grey out periods that don't apply on a given day (drops are rejected there); the iCal export and directed-time tracker resolve periods per day. The time-axis week view (Phase 2) will follow.

- **Calendar (iCal) export** — new `.ics` format in the export modal alongside Excel and CSV. Import your timetable into Google Calendar, Apple Calendar, or Outlook. Content toggles (lessons & activities, date events, holidays & INSET as all-day events, breaks & registration), a day-of-week selector, and a from/to date range defaulting to today → end of the academic year. A/B rotation, timetable template changes, holidays/INSET, slot exclusions, and moved lessons are resolved exactly as in the week view. No new dependencies — the generator is hand-rolled RFC 5545.

### Fixed

- Invalid drops onto holiday/INSET cells in the week view now flash red and are rejected instead of silently hiding the dropped item
- Deleting a planner now flushes pending saves first, preventing stale data resurrecting the deleted planner
- Dates are validated as real calendar dates (e.g. `2025-02-30` is rejected) in settings, the setup wizard, and Edit Planner
- Periods must end after they start; date events outside the academic year warn that they won't count towards directed time
- Overlapping holiday/INSET ranges are blocked in the wizard and warned about in settings — overlaps silently skewed directed-time counts
- Emoji picker no longer leaks document-level event listeners; Escape now closes it
- Removed a stray brace in `main.ts` that was silently disabling TypeScript checking

## [0.1.2] — 2026-05-30

Documentation-only release addressing remaining scorecard warnings.

### Changed

- Removed the "(coming soon)" placeholder from the README's install section now that the plugin is live in the Community Plugins browser
- Updated install steps to include the **Browse** click that's actually required
- Added a **Security** section to the README explaining that the plugin uses `xlsx` (SheetJS) only to generate export files — it never parses user-supplied Excel input, so the library's known prototype-pollution and ReDoS vulnerabilities are not exposed as a vector

## [0.1.1] — 2026-05-26

Polish release addressing automated review warnings.

### Changed

- Replaced `!important` CSS rules with specificity-based selectors
- Restructured LICENSE so the canonical GPL-3.0 text appears first for accurate license detection (dual-licensing notice moved to a footer)
- esbuild config now imports `builtinModules` from Node's built-in `module` package; the `builtin-modules` dependency has been removed
- Fixed placeholder URL in the generated bundle banner

### Removed

- `builtin-modules` from `package.json` dependencies (no behaviour change)

## [0.1.0] — 2026-05-26

Initial public release.

### Features

- **Setup wizard** — 10-step guided configuration with sensible UK defaults (standard school day, England 2025–26 term dates) for a fast first-run experience
- **Multiple planners** — run more than one planner in the same vault, each with its own timetable, subjects, classes, and lesson-note folder
- **Week view** — colour-coded weekly grid with A/B week rotation, holiday and INSET shading, and one-click access to lesson notes
- **Timetable editor** — drag-and-drop period assignment, classroom-per-slot overrides, mid-year template support
- **Lesson notes** — per-lesson notes built from a customisable template; counter tracks lesson number per class
- **Date events** — one-off overlays on the timetable for cover, duties, meetings, trips, parents' evenings
- **Directed time tracker** — counts directed time against the STPCD 1,265-hour limit with part-time fraction support, excludes holidays, exports a weekly XLSX report
- **Export** — timetable and events to CSV or XLSX; choose a vault folder or any folder on your computer via the OS file dialog
- **Subjects & classes** — emoji-identified subjects with nested class groups, colour overrides per class, archived-class support
- **School day blocks** — define Lesson, Break, Registration, Administration (or custom) block types with their own colour shading
- **Responsive UI** — settings and wizard reflow cleanly on narrow panes and mobile
- **Versioned schema** — automatic migrations on plugin update; debounced settings saves
