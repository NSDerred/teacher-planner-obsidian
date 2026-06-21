# Timetable editor — time-axis redesign

**Status:** Phase 1 built 2026-06-21. **Author:** Claude (Cowork).
**Why:** the old editor was an HTML table whose rows were the *union* of all day schedules'
periods. With per-day schedules (e.g. a "Saturday" day), a foreign schedule's block could
only appear as a full-width row that was empty/greyed for every other day — the "random
Saturday row". A shared-row table cannot give a day its own blocks.

## Phase 1 (done) — functional time-axis

- The grid body is now a **time-axis**: a left time gutter + one column per school day, on a
  shared pixels-per-minute scale (`TE_PX = 1.4`). Axis range = earliest start → latest end
  across all schedules' periods.
- Each day column renders **its own** blocks via `getPeriodsForDay(day)`, positioned by time.
  So weekdays show the Standard-day blocks and **Saturday shows the Saturday block in the
  Saturday column** — no shared rows, no foreign rows.
- Filled blocks show the class chip (reuses `.tp-te-chip`); empty blocks show period
  name/time + "+ assign". Customised slots show the small `start · length` chip.
- Click a block → the consolidated slot popover (class + Start/Length/Room).
- Drag-and-drop (move / swap / Ctrl-copy) is preserved — handlers are keyed by `day:periodId`
  and were reused unchanged; only the markup elements (`.tp-te-blk`) and the two `.closest()`
  selectors changed.
- All surrounding chrome unchanged: template selector, new/rename/delete template, the
  directed-time warning, A/B week tabs, save/discard, unsaved-changes flow.
- The data model is untouched — only the grid rendering/interaction changed.
- `.tp-te-axis*` / `.tp-te-blk*` CSS replaces the old table CSS; `min-width:640px` on the axis
  gives horizontal scroll on narrow screens.

Files: `modals/TimetableEditorComponent.svelte`. svelte-check 0/0; production build OK.

## Phase 2 (later) — polish

- Mobile responsiveness pass (the horizontal scroll is the start; needs touch sizing / a
  day-at-a-time mode on phones — ties into the flagged mobile-editor issue).
- Render the custom start-time **offset** within a block in the editor (it currently shows the
  chip filling the period block; the week view already offsets — bring parity).
- A/B week visual polish; keyboard navigation across blocks.
