# Teacher Planner for Obsidian

> A customisable academic planner for teachers — not just a calendar. Track your timetable, monitor workload, and keep lesson notes, all inside your Obsidian vault.

![Screenshot placeholder — week view](docs/screenshot-week-view.png)

---

## Why Teacher Planner?

Most calendar tools are built for meetings. Teacher Planner is built for teachers.

It understands your world: periods, classes, A/B week rotations, cover lessons, directed time, and the difference between a duty and a meeting. Everything lives inside Obsidian alongside your notes — no extra apps, no subscriptions, no data leaving your vault.

---

## Features

### 📅 Week View
A colour-coded weekly grid showing your full timetable at a glance. Navigate by week, see your classes, duties, and events laid out clearly, and jump straight into lesson notes with a single click.

### 🗓️ Timetable Management
Define your periods, set your daily schedule, and assign classes to slots. Full support for **A/B week rotation** — the plugin tracks which week you're on automatically.

### 📚 Class & Subject Tracking
Configure your subjects, classes, year groups, and classrooms. Colour-code by subject so you can read your week at a glance.

### 📝 Lesson Notes
Open a per-lesson note directly from the week view. Each lesson gets its own note in your vault, built from a customisable template — keeping your planning and your notes in the same place.

### 📌 Special Events & Cover
Overlay one-off events on any slot: cover lessons, duties, meetings, trips, or anything else. Special events sit on top of your timetable without disrupting it.

### ⏱️ Directed Time Log
Track your non-teaching directed time — meetings, duties, cover — across the academic year. Know what your week looks like beyond just lessons.

### 📤 Export
Export your timetable and planning data when you need it.

### 🎨 Themes
Choose between **Carbon** (dark) and **Paper** (light), each with full dark/light mode support to match your Obsidian theme.

---

## Installation

### From the Obsidian Community Plugins list *(coming soon)*

1. Open Obsidian → **Settings → Community Plugins**
2. Search for **Teacher Planner**
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

*Screenshots coming soon. In the meantime, see the [Features](#features) section above.*

---

## Support

If Teacher Planner saves you time, consider buying me a coffee — it helps keep the project going.

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support%20this%20project-yellow?logo=buymeacoffee)](https://buymeacoffee.com/YOUR_USERNAME)

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

## Licence

MIT © Nick Smith
