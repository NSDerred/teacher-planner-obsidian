# 0.3.3 commit log

A running record of each change made for the 0.3.3 release, with its git title and short description. Newest at the bottom. Gitignored alongside the other `docs/RELEASE-*` / working notes.

---

## fix(week-view): chip hover fills its slot, no gap

On hover, the slot/event stack switched to in-flow content height, so a short chip collapsed and left a gap below it within the block (the block kept its slot height via min-height). Give the hovered `.tp-event-stack` a min-height floor of the slot height (`calc(var(--bh) - 6px)`) so the chip fills its slot tightly at rest and on hover, and only grows downward for a long note, matching the timetable editor.

Follow-up (gap persisted): the lesson chip wasn't reliably stretching to the stack height, and the block's `padding-bottom:6px` left dead space below the stack. Removed the hover `padding-bottom`, and floored the chip itself with `min-height:calc(var(--bh) - 12px)` on hover so it fills its slot regardless of flex behaviour and still grows for a long note.

- File: `src/views/WeekView.svelte`
- Status: DONE, confirmed in-app (2026-06-25). svelte-check 0/0, production build OK.

---

## feat(week-view): emphasise today's column, with a colour override

Today's column now gets a subtle accent wash (option C: 9% column tint + 14% header wash + coloured day name), driven by a new `--today-colour` CSS var and gated to the current week via the existing `isToday`. Placed before the holiday/INSET rules so those still win. Adds a global `todayHighlightColour` setting (default `theme:accent`, follows the Obsidian accent) with a full colour control under Settings -> Grid visuals (swatch + colour picker + "follow theme" preset + grey palette), wired through `GLOBAL_FIELDS` and included in "Reset grid visuals".

- Files: `src/views/WeekView.svelte`, `src/settings/SettingsTab.ts`, `src/types.ts`, `src/settings.ts`, `src/main.ts`
- Status: built (svelte-check 0/0, tsc 0, production build OK); awaiting in-app visual confirmation.

