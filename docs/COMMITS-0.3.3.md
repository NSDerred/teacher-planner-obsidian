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

---

## fix(mobile): clear Obsidian's floating navbar at list bottom (issue 1)

Day and Agenda lists were running under Obsidian's floating mobile navbar, hiding the last lesson/event and its controls. On mobile we now measure the actual `.mobile-navbar` element at runtime (its distance from the viewport bottom, which already accounts for the home-indicator safe area and the floating gap) and apply that as the list's bottom padding via `--tp-mobile-pad`, re-measured on mount and on resize. Falls back to 68px if the element isn't found, so it adapts across phones, tablets, and the fixed/floating bar variants.

- File: `src/views/WeekView.svelte`

## feat(mobile): rebuild the header with a balanced date nav (issues 2 + 4)

The mobile header was cluttered and the date nav drifted off-centre because a variable-width day-name title sat beside it. The title is now dropped on mobile (the weekday strip already shows the selected day), the nav is a balanced row with the date button stretching the middle, and the prev/next controls use real arrow icons instead of chevrons. The Week tab is removed on mobile (Day / Agenda only); any previously stored "grid" mobile mode is coerced to Day.

- File: `src/views/WeekView.svelte`

## feat(mobile): tap the date to open a full calendar (issue 3a)

Tapping the date on mobile now opens a full month-grid calendar straight away (no intermediate dropdown), with month arrows, today highlighted, out-of-year days disabled, and a Today button. Tapping a day jumps to it and closes. Desktop keeps its existing inline date popover.

- File: `src/views/WeekView.svelte`

## feat(lessons): dropdown class selector on mobile (issue 3b)

On mobile the Lessons overview replaced its class-tile grid (which ate most of the screen) with a single dropdown class selector, giving the lesson list the full height below. Desktop keeps the searchable tile grid.

- File: `src/modals/LessonOverviewComponent.svelte`

## feat(events): mobile-only full-screen Add event sheet (issue 6)

The Add event modal was a desktop layout cramming Date / Start time / Duration onto one overlapping row on phones. On mobile it now presents as a full-screen sheet: single column, Date full-width with Start time and Duration two-up, 44px touch targets (16px inputs also stop iOS focus-zoom), and a sticky Cancel / Add event footer that clears the safe-area inset. Desktop is unchanged.

- Files: `src/modals/AddDateEventModal.ts`, `styles.css`

All five built changes: svelte-check 0/0, tsc clean, production build OK. Pending phone testing.

---

## fix(mobile): real spacer for navbar clearance + scrollable add-event sheet + rename tab

Follow-up fixes after on-device testing.

- Navbar clearance (real fix): the previous padding-bottom override was placed before the base .tp-daylist/.tp-agenda rules, so the base `padding` shorthand overrode it and the clearance had zero effect. Replaced it with an actual spacer element (`.tp-mobile-tail`) appended to the end of the Day and Week lists on mobile, sized `max(measured navbar, calc(96px + env(safe-area-inset-bottom)))`. A real in-flow element can't be defeated by shorthand ordering, so the last row now always scrolls clear of Obsidian's floating bar.

- Add event sheet (keyboard): the mobile sheet was fixed at 100vh with a non-scrolling body, so the soft keyboard covered fields. It's now a flex column at 100dvh (falls back to 100vh) with the body set to flex:1 / min-height:0 / overflow-y:auto, so it scrolls and the viewport shrinks to the keyboard — every field stays reachable.

- Renamed the mobile "Agenda" tab to "Week" (label only; internal mode stays `agenda`). With the grid Week view gone on mobile, "Day / Week" reads more clearly.

- Files: `src/views/WeekView.svelte`, `styles.css`
- svelte-check 0/0, tsc clean, production build OK. Pending phone re-test.

