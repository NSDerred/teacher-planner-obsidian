# Changelog

All notable changes to Teacher Planner will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
