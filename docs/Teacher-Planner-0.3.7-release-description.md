# Teacher Planner 0.3.7: Week notes that start themselves, and a mobile view that keeps time

*Released 22 August 2026*

Two things this release. The week note in the sidebar can now begin from a template you write yourself, the way lesson plans and lesson notes already do. And the mobile views finally honour custom lesson and event times, instead of drawing everything as a full period.

---

## ✨ What's new

### Week note templates

If you keep the same headings in your week note every week — priorities, teaching notes, admin, whatever your week actually needs — you no longer have to type them out.

Write your layout once in **Settings → Week note templates**, press **Save as template**, and an **Insert template** button appears in the week-notes toolbar whenever the current week's note is empty. One tap fills it in. Keep several templates and the button offers a short menu instead, with your default marked.

Nothing is imposed on you. The only built-in is **Blank**, and Blank is the default, so if you never make a template your week notes behave exactly as they always have and the button never appears. Your templates are ordinary markdown files under `<planner folder>/Week note templates`, so you can edit them like any other note.

Templates understand a handful of tokens: `{{week}}` for the Monday, `{{weekEnd}}` for the Friday, `{{date}}` and `{{dateUK}}` for today, `{{academicYear}}`, and `{{cursor}}` for where the cursor should land.

---

## 🔧 Fixes and smaller improvements

- **Mobile now honours custom lesson and event times.** On a phone, the Day and Agenda lists drew every lesson and event as filling its whole period, whatever start time or duration you had set — all of that arithmetic lived in the desktop grid and had never reached the mobile views. Both now show the real start and end, mark a shortened block as inset, add a small duration pill, and draw the unused part of the period as a dashed free strip. The desktop grid was rebuilt on the same shared calculation, so a block holding both a lesson and an event now labels each with its own times rather than both with the period's.
- **A multi-period event no longer repeats on mobile.** An event covering two or three blocks used to produce a separate card for each one. It now appears as a single card spanning its whole run, matching the desktop grid, and the tap menu reports the event's own span and full run rather than whichever block you tapped.
- **`{{year}}` in note titles.** Lesson- and event-note title templates accept `{{year}}`, the class's year group, so two classes sharing a code can be told apart in generated filenames. Default templates are unchanged, so no existing filename shifts.
- **Housekeeping.** The lookup from a calendar date to a school day existed in eight separate copies across the code; there is now one. Nothing changes on screen, but the next change to the school week only has to be made once.

---

## 📦 Installing

Update through **Settings → Community plugins**, or download `main.js`, `manifest.json` and `styles.css` from the release and drop them into `.obsidian/plugins/teacher-planner/`.

Questions and bug reports are very welcome on the [GitHub issues page](https://github.com/NSDerred/teacher-planner-obsidian/issues).
