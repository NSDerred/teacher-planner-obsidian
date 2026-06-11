# Changelog

All notable changes to Teacher Planner will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
