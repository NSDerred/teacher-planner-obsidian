# Teacher Planner 0.3.7: Week notes that start themselves, and dates that land on the right day

*Released 22 August 2026*

Two things this release. The week note in the sidebar can now begin from a template you write yourself, the way lesson plans and lesson notes already do. And a quiet date bug that had been miscounting holidays and lesson removals is fixed, so directed time, bulk plan apply and the calendar export all land on the day they should.

---

## ✨ What's new

### Week notes from a template

If your week note starts with the same headings every week — priorities, teaching notes, admin, whatever your week actually needs — you no longer have to type them out.

Write your layout once in **Settings**, under **Week note templates**, press **Save as template**, and an **Insert template** button appears in the week-notes toolbar whenever the current week's note is empty. One tap fills it in. Keep several templates and the button offers a short menu instead, with your default marked.

Nothing is imposed on you here. The only built-in is **Blank**, and Blank is the default, so if you never make a template your week notes behave exactly as they always have and the button never appears. Your templates are ordinary markdown files under **Week note templates** in your planner folder, so you can edit them like any other note.

Templates understand a few tokens: `{{week}}` for the Monday, `{{weekEnd}}` for the Friday, `{{date}}` and `{{dateUK}}` for today, `{{academicYear}}`, and `{{cursor}}` for where the cursor should land.

---

## 🔧 Smaller improvements

- **Mobile now honours custom lesson and event times.** On a phone, the Day and Agenda lists drew every lesson and event as filling its whole period, whatever start time or duration you had set. Both now show the real start and end, mark a shortened block as inset, add a small duration pill, and draw the unused part of the period as a dashed free strip. The desktop grid was rebuilt on the same calculation, so a block holding both a lesson and an event now labels each with its own times rather than both with the period's.
- **A multi-period event no longer repeats itself on mobile.** An event covering two or three blocks used to produce a separate card for each one. It now appears as a single card spanning its whole run, matching the desktop grid, and the tap menu reports the event's own span rather than whichever block you tapped.
- **`{{year}}` in note titles.** Lesson- and event-note title templates accept `{{year}}`, the class's year group, so two classes that share a code can be told apart in generated filenames. The default templates are unchanged, so no existing filename shifts.
- **The plugin now has a test suite.** Thirty-five tests cover the parts where a mistake is silent rather than loud: the A/B rotation, directed-time accrual, partial-period times, template tokens and date handling. They run in three timezones every time, for the reason described below.

---

## 🐞 Fixed

- **Holidays and one-off lesson removals could be counted on the wrong day.** Dates were being keyed by converting to UTC, which lands a day early anywhere east of UTC — including the whole of the UK through British Summer Time, so most of the school year. The effects were quiet rather than obvious: a Friday holiday was not deducted from directed time at all, a holiday earlier in the week or a lesson removed for a single date was applied to the neighbouring day, and a timetable template beginning exactly on a Monday was treated as not yet started for its own first week, which could drop that week from bulk plan apply and from the iCal export. Dates are now handled in local time throughout. Nothing stored on your machine changes and there is nothing to repair — the numbers simply come out right from this version on.
- **Housekeeping.** The lookup from a calendar date to a school day existed in eight separate copies across the code; there is now one. Nothing changes on screen, but the next change to the school week only has to be made in a single place.

---

## ⬆️ Updating

Update from Settings, then Community plugins, in Obsidian, or download `main.js`, `manifest.json`, and `styles.css` from the release and drop them into `.obsidian/plugins/teacher-planner/`.

Teacher Planner requires Obsidian v1.7.2 or later. Your existing planners, timetables, notes, and plans carry over automatically, so there is nothing you need to do. Week notes carry on exactly as before until you decide to save a template of your own.

---

If Teacher Planner saves you time, you can [buy me a coffee](https://buymeacoffee.com/teacher.nsmith). It genuinely helps keep the project going. Found a bug or have an idea? [Open an issue on GitHub](https://github.com/NSDerred/teacher-planner-obsidian/issues).

Happy planning! 📚
