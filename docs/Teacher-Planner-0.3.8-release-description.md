# Teacher Planner 0.3.8: Fixes from the first week of feedback

*Released 30 August 2026*

No new features this time. This release is what came out of the first proper week of the plugin being used by other people, plus a full read back through the code: a dead navigation button, text spilling out of cards on a phone, dates that could not agree on a format, and a quiet tidy-up of records left behind by deleted lessons.

---

## 🐞 Fixed

- **The back arrow worked only if your year started on a Monday.** If your academic year began mid-week, the week view refused to step back into its own first week, so that week could only be reached through the date picker. The arrows now measure from Monday to Monday and the first week behaves like any other. Thanks to @croxis for reporting it.
- **Text spilled out of the cards on a phone.** On a busy day the day-view cards were squeezed shorter than their own contents, so the last line — usually the notes, or "No notes" — fell outside the coloured block. Anything with a shortened time was hit first. Cards now keep their full height however long the day is, and a shortened lesson or duty is no longer indented from the edge: it looks like every other card, with its real start and end times, a duration pill, and dashed strips showing the part of the period it does not fill.
- **"Restore removed lesson" could disappear.** Removing a lesson for a single date and then dropping an event into the freed block took away the button that offered the restore. The restore now lives in the block's own menu too, so a removal can always be undone.
- **Lesson note templates can carry their own frontmatter.** The plugin writes the class, period and date into every lesson note it creates, and a template that started with its own `---` block produced a second block Obsidian could not read, which is why fields like `unit:` or `standards:` never worked. The two are now merged into one, with the plugin's three keys taking precedence so notes stay findable. Anything else you put there comes through untouched, ready for Bases or Dataview to query.

---

## 🔧 Smaller improvements

- **Dates follow your language settings.** Some dates in the planner were fixed to UK formatting while others already followed your locale, so the same date could appear two ways in different parts of the interface. Everything on screen, and the `{{lessonDate}}`, `{{week}}` and `{{weekEnd}}` template tokens, now follows your locale. Generated filenames and the CSV, spreadsheet and calendar exports keep a fixed format on purpose, since other software reads those, and `{{dateUK}}` is still there whenever you want a date that never changes shape.
- **Deleting a lesson cleans up after itself.** Plan links, prepared marks, per-lesson notes and rooms, and one-off removals are attached to a lesson, and deleting that lesson from the timetable used to leave them behind, invisible and carried in every save. They now go with it, the way an event's records have since 0.3.6. For anything left behind by earlier versions, Settings gains **Tidy up leftover records** under Reset: it counts what it finds and tells you exactly what it would remove before you decide. Nothing you can still see in the planner is touched.
- **A phone and a desktop now agree about clashes.** An event covering several periods could be drawn as one card on a phone but two separate blocks on the desktop, because the phone was not checking whether anything else sat in those periods. Both now break in the same place.
- **Under the bonnet.** The same time parser had been written out seven times, a display-date helper was named for something it did not do, the sidebar was re-reading your whole vault to decide whether to show one button, and around a dozen errors were being swallowed in silence — including a week note that failed to save, which now tells you. The test suite grew from 35 checks to 57, and runs in three timezones every time.

---

## ⬆️ Updating

Update from Settings, then Community plugins, in Obsidian, or download `main.js`, `manifest.json`, and `styles.css` from the release and drop them into `.obsidian/plugins/teacher-planner/`.

Teacher Planner requires Obsidian v1.7.2 or later. Your existing planners, timetables, notes, and plans carry over automatically, and nothing here changes anything you have already written. Dates you see on screen may look slightly different if your language settings are not British English — that is the fix described above doing its job.

---

If Teacher Planner saves you time, you can [buy me a coffee](https://buymeacoffee.com/teacher.nsmith). It genuinely helps keep the project going. Found a bug or have an idea? [Open an issue on GitHub](https://github.com/NSDerred/teacher-planner-obsidian/issues).

Happy planning! 📚
