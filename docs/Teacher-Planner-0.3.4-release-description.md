# Teacher Planner 0.3.4: Know exactly where every class stands

*Released 27 July 2026*

Open the Lessons tab, pick a class, and you now get a straight answer to the questions you actually ask yourself in a free period: how far through the year am I, is next week ready, and what have I not planned yet. 0.3.4 adds a class overview panel above the lesson list, and reshapes the tab around it so the list still gets the room it needs.

---

## ✨ What's new

### A class overview, above your lesson list

Select a class and a compact overview appears at the top of the Lessons tab.

**How far through the year you are.** A single line and a progress bar: taught, total, and how many are left. It counts by the clock, not just the date, so a lesson moves into "taught" the moment its period ends. Sit and watch it tick over at the end of period 3 if you like.

**Whether this week and next week are ready.** Two boxes show the percentage of that week's lessons you have marked prepared, with the week-commencing date underneath so there is never any doubt which week you are looking at. Both count every lesson in the week, past ones included, so it reads as a proper review rather than a countdown. Get to 100% and the box turns green and gives you a 🎉. A week with no lessons for that class says so, and still shows its date.

**What is coming.** Your next lesson, with date and period. And a "Before break" count: how many lessons of this class are left before the next holiday or INSET day, and the date of the last one. Useful when you are working out whether a topic really fits before half term.

**What needs attention.** A short list of the next three upcoming lessons you have not marked prepared, each showing its date, period, and note. Click one and the lesson list below jumps straight to it, ready to edit. When there is nothing left to flag, it simply says all your upcoming lessons are prepared.

The panel reads from what is already in your planner, so there is nothing new to fill in. Holidays and INSET days are left out, exactly as they are everywhere else.

### Room for the list, when you want it

Adding a panel above a list is only useful if the list survives it, so the Classes and Overview sections are now both collapsible, on desktop and on mobile. Each header carries its own summary, so collapsing costs you nothing: the Classes header shows which class is selected, and the Overview header keeps the headline "Taught 32 of 110 · 78 to go" on view. Your choice is remembered, and nothing collapses itself while you are working. On a phone the panel starts collapsed, so the lesson list is still the first thing you see.

The class tiles are more compact too, so more of them fit on a row, and the overview's four boxes sit on one responsive line, four across on a wide pane and two on a phone. Between them, roughly a third of the pane goes back to your lessons.

---

## 🔧 Smaller improvements

- **Week dates on the prepared boxes.** Each box shows "w/c 14 Sept" on its own line, so it is clear which week is which, and it still shows when that week has no lessons, which is precisely when you want to know.
- **A lighter Lessons tab.** The whole year for the selected class used to be recalculated twice on every update, including once a minute for the clock. It is now worked out once and reused, so the panel refreshes without the extra work.
- **Tidier settings headings.** Four section names move to Obsidian's standard sentence case: "Holidays and INSET days", "My classes", "Recurring events: directed time", and "Recurring events: non-directed time".
- **Housekeeping under the bonnet.** A pass over the plugin's use of the Obsidian API to keep it in line with current guidance: modal titles, file lookups, note writing, and timer cleanup all now use the recommended calls. Nothing changes on screen.

---

## 🐞 Fixed

- **Full-screen sheets on mobile.** The add event sheet now sizes purely from the dynamic viewport height, so it fits the visible screen cleanly rather than briefly sizing to the taller full-window height as browser chrome moves.
- **Settings headings on mobile.** The collapsible section headers keep their chevron on the title line without overriding your theme's own styling to do it, so themed settings pages are left alone.

---

## ⬆️ Updating

Update from Settings, then Community plugins, in Obsidian, or download `main.js`, `manifest.json`, and `styles.css` from the release and drop them into `.obsidian/plugins/teacher-planner/`.

Teacher Planner requires Obsidian v1.7.2 or later. Your existing planners, timetables, and notes carry over automatically, so there is nothing you need to do. The overview panel appears the first time you open the Lessons tab and pick a class.

---

If Teacher Planner saves you time, you can [buy me a coffee](https://buymeacoffee.com/teacher.nsmith). It genuinely helps keep the project going. Found a bug or have an idea? [Open an issue on GitHub](https://github.com/NSDerred/teacher-planner-obsidian/issues).

Happy planning! 📚
