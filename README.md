# Teacher Planner — Obsidian Plugin

An academic year planner built for teachers, living inside your Obsidian vault. Manage your timetable, track lessons, log directed time, and plan your week — all without leaving your notes.

---

## Features

- **Week view** — a colour-coded weekly grid showing your timetable at a glance
- **Timetable management** — define periods, assign classes, and support A/B week rotation
- **Class & subject tracking** — configure subjects, classes, year groups, and classrooms
- **Lesson notes** — open per-lesson notes directly from the week view
- **Special events** — overlay cover lessons, duties, meetings, and other one-off events
- **Directed time log** — track non-teaching directed time (meetings, duties, cover) across the year
- **Export** — export timetable and planning data
- **Themes** — Carbon (dark) and Paper (light) themes, each with dark/light mode variants
- **Calendar sidebar** — quick-access calendar panel for date navigation

---

## Installation

### Manual install (from this repo)

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release (or clone this repo)
2. In your vault, create the folder `.obsidian/plugins/teacher-planner/`
3. Copy the three files into that folder
4. Open Obsidian → Settings → Community Plugins → enable **Teacher Planner**

### Requirements

- Obsidian v1.4.0 or later

---

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
git clone https://github.com/YOUR_USERNAME/teacher-planner-obsidian.git
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

Built output (`main.js`) is generated in the project root. Copy `main.js`, `manifest.json`, and `styles.css` into your vault's plugin folder to test.

### Tech stack

- TypeScript
- Svelte 4
- esbuild + esbuild-svelte
- Obsidian Plugin API

---

## Project structure

```
src/
├── main.ts                  # Plugin entry point
├── types.ts                 # Shared TypeScript types
├── settings.ts              # Default settings
├── views/                   # Main views (WeekView, CalendarSidebar)
├── modals/                  # All modal dialogs
├── settings/                # Settings tab
└── utils/                   # Utility functions
```

---

## Licence

MIT © Nick Smith
