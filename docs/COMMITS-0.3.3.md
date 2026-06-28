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

---

## feat(mobile): shared calendar, lessons spacer, agenda top gap, uniform add-event fields

Round of mobile polish after testing.

- Universal date picker: new shared `DatePickerModal` (clean month-grid look from the mobile main planner) now backs every date jump. The week view (mobile and desktop) opens it from the date button instead of the old native-date popover, and the Lessons overview opens it from a "Jump to date" button instead of its `type="date"` input. One consistent calendar across the plugin. Removed the now-dead inline calendar markup, the desktop jump popover, and their CSS/state. (The separate calendar sidebar component is unchanged.)

- Lessons overview spacer: added the same `tp-mobile-tail`-style spacer (`tp-lo-tail`) to the bottom of the lesson list on mobile so the last lesson clears Obsidian's floating navbar.

- Week (agenda) top gap: removed the empty band under the tabs by dropping the agenda's top padding so the first day header sits snug below the tab bar (the band where the day-strip sits in Day view).

- Add event field shapes: forced every control in the mobile sheet (text/date/time/number inputs, select, period field, Auto and colour buttons) to a uniform 8px rounded rectangle, overriding Obsidian's pill-shaped mobile defaults via a higher-specificity selector.

- Files: `src/modals/DatePickerModal.ts` (new), `src/views/WeekView.svelte`, `src/modals/LessonOverviewComponent.svelte`, `styles.css`
- svelte-check 0/0, tsc clean, production build OK. Pending phone re-test.

---

## feat(calendar): fixed six-week grid, no layout shift or empty space (desktop + mobile)

Redesign the shared DatePickerModal to current date-picker best practice: always render a fixed six-week (42-cell) grid, filling the lead/trail with muted adjacent-month days instead of blanks. This removes the empty band and stops the footer/arrows moving as months change between five and six rows. Today (accent ring) is now visually distinct from the selection (accent fill); out-of-range days are disabled; a "Selected: …" label gives context. Compact sizing with minmax(0,1fr) cells, min-width:0, and box-sizing means it always fits — fixing the mobile cut-off and horizontal scroll at the same time.

NOTE: the Write tool silently truncated DatePickerModal.ts on the first attempt (the documented Cowork bug); rewritten via shell and verified with file-integrity-guard.

- Files: src/modals/DatePickerModal.ts, styles.css
- Research: NN/g, Carbon, Ant Design — six-week grids + adjacent days are the standard fix.

## feat(timetable): mobile day-at-a-time editor (chunk 4)

The timetable editor was a wide time-axis grid (600px min-width modal), unusable on a phone. Added a mobile-only layout that reuses all existing assign/clear/save logic:

- Full-screen sheet on mobile (modal forced to 100dvh, no min-width).
- Template dropdown selector with New / Rename / Delete in an overflow menu (replacing the desktop tab bar).
- A/B week tabs (reused).
- Day selector (Mon–Fri) + a vertical list of that day's periods; assigned slots show class/room (+ custom start/length badge), empty slots show "+ assign".
- Tap a period → the existing class picker, rendered as a bottom sheet on mobile, keeping the same start time / length / room controls, search, clear, and grouped class/activity lists. Search auto-focus is suppressed on mobile so the keyboard doesn't cover the sheet.
- Drag-to-rearrange stays desktop-only; mobile is tap-to-assign. Desktop layout unchanged.

- Files: src/modals/TimetableEditorComponent.svelte, src/modals/TimetableEditorModal.ts, styles.css
- svelte-check 0/0, tsc clean, production build OK; file-integrity-guard passed. Pending phone test.

---

## fix(mobile): keyboard-aware add-event sheet, calendar sizing, timetable alignment + padding

Four fixes after device testing.

- Add event keyboard: 100dvh did not shrink for the soft keyboard in Obsidian's mobile webview, so lower fields stayed hidden with nothing to scroll. The sheet is now sized to window.visualViewport (height + top, updated on its resize/scroll), so the visible area shrinks above the keyboard, the content overflows and scrolls, and the sticky footer stays above the keyboard. Focused fields scroll into view. Sheet set position:fixed so the JS values drive its box. Listeners cleaned up on close.

- Calendar sizing/centring: the modal box stayed at Obsidian's default (huge) width because only the content was sized, leaving the calendar floating top-left on desktop and capped at 330px on mobile. Now the modal element itself is min(340px, 94vw) with min-width:0 and content at 100% — a compact centred box on desktop, and on mobile it scales up to fill the screen instead of squashing.

- Timetable "+ assign" alignment: in empty rows the "+ assign" now right-aligns (margin-left:auto, fixed width) and the period-name column takes flexible width with wrapping, so long names like "Period 8/Pick Up" no longer overlap it.

- Timetable padding: increased the editor's top padding (clears the status bar) and bottom padding (clears the Android nav bar) using safe-area insets with solid floors, and nudged the close button below the status bar — Cancel/Save no longer sit under the system buttons.

- Files: src/modals/AddDateEventModal.ts, src/modals/TimetableEditorComponent.svelte, styles.css
- svelte-check 0/0, tsc clean, production build OK; file-integrity-guard passed.

---

## fix(add-event): keyboard-aware sheet via Capacitor events, shared calendar date field, picker close-X

- Keyboard (real fix): the earlier visualViewport approach did nothing on Android because Obsidian's WebView is not resized when the keyboard opens (so visualViewport never changes) — a known Capacitor/Android behaviour. Now we listen for Capacitor's keyboardWillShow/keyboardDidShow events (which carry keyboardHeight even when the WebView doesn't resize) and shrink the sheet to innerHeight − keyboardHeight, so the form overflows and scrolls and the sticky footer stays above the keys; restored on keyboardWillHide/DidHide. visualViewport listeners kept for iOS, which does resize. Focused fields scroll into view. Listeners cleaned up on close.

- Date field: the Add event Date control is now a button that opens the shared DatePickerModal (desktop + mobile), bounded to the academic year, wired to the same date state so the block list, duration, and start all refresh on pick. Replaces the native <input type="date"> (also removes its OS date popup). Start time stays a native time input.

- Date picker close button: on mobile the modal close X was overlapping the month navigator; added a tp-datepicker-modal--mobile class and raised the X into the corner with extra top padding so the nav row sits clear.

- Files: src/modals/AddDateEventModal.ts, src/modals/DatePickerModal.ts, styles.css
- svelte-check 0/0, tsc clean, production build OK; file-integrity-guard passed. The keyboard behaviour cannot be reproduced in-sandbox — needs on-device confirmation.

