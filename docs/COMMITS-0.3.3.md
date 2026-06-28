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

Readability follow-up: colouring the header text with a custom highlight colour could be low-contrast on some themes/pale colours. Keep today's header day-name in the theme's normal bold text and move the colour cue to a 2px top accent border (in `--today-colour`) plus the existing wash, so it stays legible for any colour or theme. The column tint and header wash are unchanged.

---

## feat(week-view): auto-contrast the mobile agenda rows

Extend the chip auto-contrast to the mobile Agenda view. The agenda rows paint the class colour at 16% over the theme background; give each row a per-row `--chip-fg` (via `chipFg(colour, _themeBg)`) and use it for the main text so the class/subject stays readable on bright colours and any theme. Day mode already reuses the auto-contrast grid chips; agenda rows carry no status markers, so this is text-only.

- File: `src/views/WeekView.svelte`
- Status: built (svelte-check 0/0, production build OK); awaiting in-app confirmation on mobile.

---

## feat(week-view): mobile Day view as an equal-card list (mobile chunk 1)

Replace the mobile Day mode (previously the single-day time-axis) with an equal-height card list. Each filled period renders a card: lesson cards show 3 lines (class with subject emoji / year · subject · room / notes, one line with ellipsis) plus the desktop indicator icons (tick toggles prepared, plan icon opens the plan; external file/folder marker hidden on mobile). Empty periods and breaks render as slim tap-to-add rows; a duty/event inserted into a non-teaching slot becomes a full card. Tapping a card opens the same chip menu (`openChipMenu`); a small `onCardKeydown` gives Enter/Space activation. New `.tp-daylist` / `.tp-dcard` / `.tp-dslim` styles; reuses `chipFg`, prepared/plan maps and toggles. Only active on `Platform.isMobile`, Day mode.

- File: `src/views/WeekView.svelte`
- Status: built (svelte-check 0/0/0, production build OK); needs in-app testing on a phone (Day mode is mobile-only).

---

## feat(week-view): mobile action row (layout 3) (mobile chunk 2)

Mobile chrome reorganised to the agreed layout 3, avoiding a bottom bar/FAB. The header now shows only the title + date nav on mobile (the desktop action button group is wrapped in `{#if !_isMobileApp}`). A single `.tp-mobile-bar` below holds the mode tabs (Day / Agenda / Week) on the left and `+` (Add event) + `⋯` overflow on the right. The overflow menu now carries the secondary actions — Lessons, Today, Timetable, Settings (the dedicated `+` replaces the old "+ Event" menu item). The "Grid" tab is relabelled "Week". Desktop layout and its <600px overflow behaviour are unchanged.

- File: `src/views/WeekView.svelte`
- Status: built (svelte-check 0/0/0, production build OK); needs phone testing.

---

## feat(week-view): agenda rows as tappable cards with indicators (mobile chunk 3)

Polish the mobile Agenda view: each row is now a `div role="button"` (so it can hold nested action buttons) and carries the desktop indicator icons — prepared tick (tap to toggle) and lesson-plan link — on the right, reusing the prepared/plan maps and toggles. Enter/Space activation via `onCardKeydown`; the prepared tick is always visible on mobile (no hover). New `.tp-agenda-marks` style. Tinting/auto-contrast was already applied to agenda rows in 0.3.3 chunk 0.

- File: `src/views/WeekView.svelte`
- Status: built (svelte-check 0/0/0, production build OK); needs phone testing.

