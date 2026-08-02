# Teacher Planner 0.3.5: Settings that fit your phone, and plans that start themselves

*Released 2 August 2026*

Two things this release. Settings finally feel right on a phone, instead of a desktop page squeezed onto a small screen. And lesson plans and notes can now start from a template you choose, filled in for the exact lesson you tapped, so a new plan begins with your structure already on the page.

---

## ✨ What's new

### Settings, rebuilt for a phone

The settings tab used to be a wall of desktop rows on mobile. Now each list — periods, classes, activities, block types, holidays and INSET — shows one tidy summary row per item: a colour dot, the name, and a line of detail. Tap a row and it opens into a proper editor with labelled fields; tap again and it closes. A whole term of holidays, or a full set of activities, is something you can scan at a glance instead of scrolling through open forms, and the buttons that delete things only appear inside the row you have deliberately opened.

A few specific fixes come with it. Your planners now stack cleanly, so the full name is always readable rather than clipped to "RG…", with Switch or Edit up front and Delete tucked into a menu where you cannot hit it by accident. The school-days picker uses the same tidy day chips as the timetable, so no more truncated "M / Tu / W". Holidays get a clear Holiday / INSET toggle and a day count. And the settings header no longer collides with the content scrolling underneath it. None of this touches the desktop, which is exactly as it was.

### Lesson plans and notes from a template

Tap the plan link on a lesson and you can now start a plan from a template. **Create new plan** uses your default and stays a single tap, exactly as before. **Create from template** opens a chooser with six built-in templates plus any of your own.

The six built-ins each suit a different kind of lesson: **Essentials** for the everyday plan, **Review · Build · Apply** for teaching new material, **5E Inquiry** for practical and investigation lessons, **Cover lesson** for when someone else takes your class, **Blank** for when you want no structure at all, and **Revision & feedback** for exam practice and DIRT. Whichever you pick, the plan opens with the class, subject, date, period, and room already filled in for that lesson, and your cursor sitting where you start writing.

You are not stuck with the six. In Settings under Lesson plans there is an editor with a live preview, a Save as template button, and a Manage list where you can edit or remove any template. Your own templates are ordinary notes you can edit or delete like any file; the built-ins can be hidden from the picker and restored whenever you like. The lesson-note template gets the same editor and preview. Nothing is written into your vault until you save a template or open the guide — there is a button at the top of the settings tab that opens a short how-to whenever you want it.

---

## 🔧 Smaller improvements

- **Deleting a template respects your preference.** Removing one of your templates now follows your Obsidian "Deleted files" setting — system trash, vault trash, or permanent — rather than forcing one.
- **Housekeeping under the bonnet.** Several near-identical helpers scattered across the plugin were folded into single shared ones, the week-folder logic now lives in one place so it can never drift, and the linter now checks the Svelte components too, not just the TypeScript. Nothing changes on screen.

---

## ⬆️ Updating

Update from Settings, then Community plugins, in Obsidian, or download `main.js`, `manifest.json`, and `styles.css` from the release and drop them into `.obsidian/plugins/teacher-planner/`.

Teacher Planner requires Obsidian v1.7.2 or later. Your existing planners, timetables, notes, and plans carry over automatically, so there is nothing you need to do. The template picker appears the next time you link a plan, and the built-in templates are ready to use straight away.

---

If Teacher Planner saves you time, you can [buy me a coffee](https://buymeacoffee.com/teacher.nsmith). It genuinely helps keep the project going. Found a bug or have an idea? [Open an issue on GitHub](https://github.com/NSDerred/teacher-planner-obsidian/issues).

Happy planning! 📚
