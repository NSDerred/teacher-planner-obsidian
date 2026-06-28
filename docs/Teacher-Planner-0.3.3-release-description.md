# Teacher Planner 0.3.3: Your planner, now on your phone

*Released 28 June 2026*

![Teacher Planner 0.3.3, your planner now on your phone](https://raw.githubusercontent.com/NSDerred/teacher-planner-obsidian/main/docs/teacher-planner-0.3.3-feature.png)

This release is all about mobile. Teacher Planner was built for the desktop, and on a phone it showed. 0.3.3 rebuilds the planner, the timetable editor, the add event screen, and the date picker for a small touchscreen, so you can check your day, tick a lesson as prepared, or drop in a cover from your pocket. Everything you do on mobile still syncs with the same planner you use on your computer, because it is the same planner.

---

## ✨ What's new

### A planner made for your phone

On mobile the week grid is replaced by two views you switch between with tabs. **Day** shows the selected day as a clean list of cards, one per period, each with the class, room, and notes, and the same prepared tick and lesson plan link you have on the desktop, tap them straight from the card. **Week** lays the whole week out as a grouped list under day headers. A day strip across the top lets you jump between days, and the date and view controls sit on one tidy row with proper arrows, so nothing shifts around as you move through the week.

Tapping a lesson opens the same menu as the desktop, so prepared marks, plans, notes, and rescheduling are all there. Breaks and lunch show as slim rows, and a duty or meeting dropped into a free slot shows as a full card.

### Edit your timetable on mobile

The timetable editor is no longer a desktop grid squeezed onto a phone. On mobile it opens full screen as a day at a time list: pick a day, pick a week (A or B), and tap any period to assign, change, or clear a class. The class picker slides up from the bottom with search and the same custom start time, length, and room options as the desktop. Switch between your timetable templates with a dropdown, and create, rename, or delete them from a menu. On the desktop the drag and drop grid is unchanged.

### One calendar, everywhere

There is now a single date picker shared across the whole plugin, on both desktop and mobile. Tap the date in the planner, or the jump button in the Lessons overview, or the date in the add event screen, and the same clean month calendar opens. It always shows six full weeks with the surrounding days greyed in, so the buttons never jump around as you change month, today and your current selection are clearly marked, and dates outside your school year are greyed out. On the desktop it is now a compact, centred box rather than a large empty panel.

### Add event, rebuilt for mobile

The add event screen opens as a full screen sheet on a phone, with every field on its own row, large tap targets, and a Cancel and Add event bar pinned to the bottom. When the on screen keyboard opens, the sheet now shrinks to fit above it and scrolls, so the keyboard no longer hides the field you are typing into. The date field opens the shared calendar instead of the operating system's date popup.

---

## 🔧 Smaller improvements

- **Lessons on mobile.** The Lessons overview now uses a dropdown to pick a class, giving the lesson list the full height of the screen instead of a wall of tiles.
- **Tidier controls.** Form fields across the mobile add event sheet and settings now share a single rounded rectangle shape, and the collapsible section headings in Settings keep their arrow on the same line as the title.
- **Clear of the system bars.** Lists, sheets, and buttons now leave room for Obsidian's floating navigation bar and your phone's status and navigation bars, so nothing hides behind them.

---

## 🐞 Fixed

- **The keyboard no longer covers the add event form.** On Android the editing area now resizes around the keyboard so you can always see and scroll to the field you are filling in.
- **The calendar no longer jumps or leaves empty space.** Because it always draws six weeks, the month grid is a fixed height and the Today button stays put.
- **The week and day lists clear the bottom bar.** The last lesson of the day is no longer tucked behind Obsidian's floating toolbar.

---

## ⬆️ Updating

Update from Settings, then Community plugins, in Obsidian, or download `main.js`, `manifest.json`, and `styles.css` from the release and drop them into `.obsidian/plugins/teacher-planner/`.

Teacher Planner requires Obsidian v1.7.2 or later. Your existing planners, timetables, and notes carry over automatically, so there is nothing you need to do.

---

If Teacher Planner saves you time, you can [buy me a coffee](https://buymeacoffee.com/teacher.nsmith). It genuinely helps keep the project going. Found a bug or have an idea? [Open an issue on GitHub](https://github.com/NSDerred/teacher-planner-obsidian/issues).

Happy planning! 📚
