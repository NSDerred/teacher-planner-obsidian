# Teacher Planner 0.3.6: Notes that start themselves, and lessons you can skip for a day

*Released 5 August 2026*

Two things this release. Lesson notes now begin from a template you choose, picked right inside the new-note dialog, the same way lesson plans learned to in 0.3.5. And removing a lesson from the week view now removes it for that date only — cover, a trip, an exam morning — without touching your timetable template, with directed time adjusting itself and a restore option waiting if you change your mind.

---

## ✨ What's new

### Lesson notes from a template

Creating a lesson note now opens a small dialog with the title and a template dropdown together. Four built-ins cover the common shapes: **Blank** for a clean page, **Standard** for the classic pre-filled header, **Lesson record** for what actually happened, and **Homework log** for what was set and when it is due. Your own templates sit alongside them — save one from Settings and it appears in the dropdown like any other.

Whichever you pick, the note opens with the class, date, period, and room already filled in for that lesson and the cursor sitting where you start writing. These are a separate set from your lesson-*plan* templates, managed from their own **Lesson note templates** section in Settings, with the same editor, live preview, Save-as-template button, and Manage list. If you had customised the old note body, nothing is lost: it lives on as the Standard template, one pick away.

### Remove a lesson for just one date

"Remove from timetable" on a lesson used to mean exactly that — the lesson vanished from every week of the year, past and future, and your accrued directed time quietly changed with it. It is now **Remove this lesson (this date only)**: that one occurrence disappears, the timetable template and every other week stay put, and directed time adjusts for that week alone.

Changed your mind? The empty block offers **Restore removed lesson**, and the lesson comes back with its plan link, prepared mark, and notes intact. Removing a lesson from every week is still possible — in the timetable editor, where a decision that big belongs.

---

## 🔧 Fixes and smaller improvements

- **The repeating "Exit setup wizard?" dialog is gone.** Creating a new planner from Settings could trap you in an endless confirmation loop. Settings now close before the wizard opens, and the wizard gained guards against creating a duplicate planner or stacking multiple exit prompts.
- **Period times without a leading zero sort correctly.** A start time entered as "9:20" used to sink to the bottom of the period lists and the add-event block picker, below the afternoon. Times typed in Settings are now checked and tidied to HH:MM, lists sort by actual time of day, and any unpadded times already in your planner repair themselves automatically.
- **Deleting a one-off event cleans up after itself.** Its lesson-plan link, external file link, and prepared mark are removed with it instead of lingering invisibly in the plugin data.

---

## ⬆️ Updating

Update from Settings, then Community plugins, in Obsidian, or download `main.js`, `manifest.json`, and `styles.css` from the release and drop them into `.obsidian/plugins/teacher-planner/`.

Teacher Planner requires Obsidian v1.7.2 or later. Your existing planners, timetables, notes, and plans carry over automatically. One small behaviour change to know about: new lesson notes now default to the **Blank** template — your customised note body is still there as the **Standard** template, and you can make it the default again in Settings under Lesson note templates.

---

If Teacher Planner saves you time, you can [buy me a coffee](https://buymeacoffee.com/teacher.nsmith). It genuinely helps keep the project going. Found a bug or have an idea? [Open an issue on GitHub](https://github.com/NSDerred/teacher-planner-obsidian/issues).

Happy planning! 📚
