# Teacher Planner for Obsidian

> A customisable academic planner for teachers — not just a calendar. Track your timetable, monitor workload, and keep lesson notes, all inside your Obsidian vault.

![Week view](docs/screenshots/week-view.gif)

---

## Why Teacher Planner?

Teacher Planner is built for teachers.

It understands your world: periods, classes, A/B week rotations, cover lessons, directed time, and the difference between a duty and a meeting. Everything lives inside Obsidian alongside your notes — no extra apps, no subscriptions, no data leaving your vault.

---

## Features

### 🧙 Guided Setup Wizard
A 10-step wizard walks you through full planner configuration on first launch — name, academic year, school days, periods, block types, holidays, subjects, and classes. Pre-filled with sensible UK defaults (standard periods, England 2025–26 term dates) so you can be up and running in minutes. Each step is skippable and everything can be changed later in settings.

### 🗂️ Multiple Planners
Run more than one planner inside the same vault — useful if you teach across two schools, have a very different timetable each year, or want to keep a clean record of previous academic years. Switch between planners instantly; each has its own timetable, classes, and lesson notes in a separate subfolder.

### 📅 Week View
A colour-coded weekly grid showing your full timetable at a glance. Navigate forward and back by week, see classes, duties, and events laid out by period, and jump straight into a lesson note with a single click.

### 🗓️ Timetable Management
Build your timetable visually using the timetable editor. Define your periods, assign classes to slots, and set classrooms per slot. Full support for **A/B week rotation** — the plugin tracks which week you're on automatically based on your academic year start date.

### 📚 Subjects & Classes
Configure subjects with an emoji identifier and nest class groups beneath them. Each class group has its own colour, year group, class code, and default classroom. Colours can be overridden at the class level independently of the subject.

### 📌 Date Events
Overlay one-off events onto any period on any date — cover lessons, duties, trips, meetings, parents' evenings, or any other one-off. Date events sit on top of your timetable without disrupting it and can be added directly by clicking an empty cell in the week view.

### 📝 Lesson Notes
Each lesson in the week view has a dedicated note in your vault, built from a fully customisable template. Open, create, or edit a lesson note with a single click. Notes are stored in your planner folder and work with all standard Obsidian features — backlinks, search, graph view.

### ⏱️ Directed Time Tracker
Track your statutory directed time across the academic year against the STPCD 1,265-hour limit. The tracker counts timetabled lessons, directed-time activities, and date events, projects a year-end total, and excludes holidays and INSET days automatically. Supports part-time timetable fractions. Exports a detailed Excel report for union or management use. A plain-language guide note is created in your planner folder when the tracker is enabled.

### 📤 Export
Export your timetable and planning data to Excel (`.xlsx`) for sharing, reporting, or archiving.

### 🏫 School Day Blocks
Define the types of slot that make up your school day — Lesson, Break, Registration, Administration, or any custom type — and assign them to your periods. Each block type has its own colour used to shade the week view grid.

---

## Installation

### From the Obsidian Community Plugins list

1. Open Obsidian → **Settings → Community Plugins**
2. Click **Browse** and search for **Teacher Planner**
3. Click **Install**, then **Enable**

### Manual install

1. Go to the [latest release](https://github.com/NSDerred/teacher-planner-obsidian/releases/latest)
2. Download `main.js`, `manifest.json`, and `styles.css`
3. In your vault, create the folder `.obsidian/plugins/teacher-planner/`
4. Copy the three files into that folder
5. Open Obsidian → **Settings → Community Plugins** → enable **Teacher Planner**

**Requirements:** Obsidian v1.4.0 or later

---

## Screenshots

**Adding a special event:**
![Adding an event](docs/screenshots/add-event.gif)

**Timetable editor:**
![Timetable editor](docs/screenshots/timetable-editor.gif)

---

## Settings & Configuration

The plugin is fully configurable from **Settings → Teacher Planner**. A few of the most-used panels:

**Directed Time Tracker** — set your contracted hours, timetable fraction (for part-time staff), default lesson duration, and export a weekly Excel report:
![Directed time tracker settings](docs/screenshots/settings-directed-time.png)

**Events — Directed time** — define the activities that count toward directed time (cover, CPD, duty, meetings, tutor time, protected time, and so on). Each activity has a colour, optional default classroom, and default duration:
![Directed time events settings](docs/screenshots/settings-directed-time-events.png)

**School Timetable** — define the periods that make up your school day. Each period has a name, start/end time, and block type (Lesson, Break, Registration, Administration). Block colours shade the week view:
![School timetable settings](docs/screenshots/settings-school-timetable.png)

---

## Support

If Teacher Planner saves you time, consider buying me a coffee — it helps keep the project going.

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support%20this%20project-yellow?logo=buymeacoffee)](https://buymeacoffee.com/teacher.nsmith)

Found a bug or have a feature request? [Open an issue](https://github.com/NSDerred/teacher-planner-obsidian/issues).

---

## Development

<details>
<summary>For developers who want to contribute or build locally</summary>

### Prerequisites
- Node.js 18+
- npm

### Setup

```bash
git clone https://github.com/NSDerred/teacher-planner-obsidian.git
cd teacher-planner-obsidian
npm install
```

### Build

```bash
# Development (watch mode)
npm run dev

# Production build
npm run build

# Type checking
npm run typecheck
```

### Tech stack
- TypeScript · Svelte 4 · esbuild · Obsidian Plugin API

### Project structure

```
src/
├── main.ts          # Plugin entry point
├── types.ts         # Shared TypeScript types
├── settings.ts      # Default settings
├── views/           # Main views (WeekView, CalendarSidebar)
├── modals/          # All modal dialogs
├── settings/        # Settings tab
└── utils/           # Utility functions
```

</details>

---

## Security

Teacher Planner uses the `xlsx` (SheetJS) library to **generate** Excel
workbooks for the export features. It does not read or parse user-supplied
Excel files. Known vulnerabilities in `xlsx` (CVE-2023-30533 prototype
pollution and ReDoS issues) require maliciously crafted input to exploit,
which is not a vector here. If you need to import data into the plugin,
use the in-app UI rather than feeding it Excel files.

---

## Licence

**Teacher Planner is dual-licensed.** Pick whichever option suits you:

1. **[GPL-3.0](LICENSE)** © 2026 Nick Smith — free to use, fork, and modify.
   If you distribute a modified version, the source for your version must
   remain available under GPL-3.0 too. This is the right choice for individuals,
   schools, and contributors.

2. **[Commercial Licence](COMMERCIAL-LICENSE.md)** — for incorporating Teacher
   Planner into a commercial product without GPL's copyleft requirements.
   Contact [nicholas.f.smith@pm.me](mailto:nicholas.f.smith@pm.me) for terms.

Both options grant the right to *use* the plugin; the difference is in how you
can distribute modifications.
