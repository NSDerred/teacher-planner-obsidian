# 0.3.4 commit log

Running record of 0.3.4 changes (gitignored). One entry per approved item.

---

## feat(directory): week-note directory backbone — Planner Home.md (0.3.4 item 1)

First piece of the notes-connectivity feature: a plugin-maintained week directory at the top of the planner folder.

- New `utils/academicWeeks.ts`: `enumerateWeeks(settings)` / `teachingWeeks(settings)` — classifies every week of the academic year as teaching / holiday / inset using the same whole-week rule as the directed-time calc (a week is holiday/inset only if ALL its school days are), but without requiring directed time to be configured. Date advancement uses a local-noon anchor + setDate() so week boundaries stay correct across the DST fall-back (a fixed-ms step landed a week on the wrong date around 25 Oct — caught in testing and fixed).
- New `utils/plannerDirectory.ts`: builds `Planner Home.md` in the planner folder. A managed block between `<!-- tp:week-directory:start/end -->` markers lists every teaching week grouped by calendar month (of the week-commencing Monday), as a 2-column markdown table: Week commencing | Week note (wikilink if the week note exists, else "no note yet"). Current week highlighted. Anything outside the markers is preserved. Update-in-place; the note is only created by the manual command (nothing written to the vault unprompted).
- `main.ts`: new command "Rebuild planner directory" (creates/updates the note); debounced auto-update when week-note files are created / deleted / renamed (update-only); timer cleared on unload.
- Verified: enumerateWeeks unit-checked against a sample year with a half-term holiday (correct month grouping, holiday week excluded, DST week boundary correct). svelte-check 0/0, tsc clean, production build OK.

Next: item 2 = generate the `Planner Map.canvas` from the same week set.

---

## feat(directory): rename Planner Home + open command/ribbon (0.3.4 item 1 follow-up)

- Renamed the directory note to "🏠 Planner Home.md" so it's easy to spot and sits at the top of the folder's files (Obsidian still lists sub-folders first by default). Existing "Planner Home.md" is auto-migrated once via fileManager.renameFile so there's no duplicate.
- New "Open Planner Home" command + a home ribbon icon; both create the note if missing then open it, giving one-click access independent of the file-tree sort.
- Files: src/utils/plannerDirectory.ts, src/main.ts. svelte-check 0/0, tsc clean, production build OK.

---

## feat(directory): Planner Map canvas (0.3.4 item 2)

Adds the visual half of the directory: "🗺 Planner Map.canvas" in the planner folder, generated from the same teaching-week set as the note.

- plannerDirectory.ts refactored into writeHomeNote + writeCanvas, both driven by rebuildPlannerDirectory; the canvas is fully generated (regenerated wholesale each rebuild — a generated map, so no manual layout to preserve) via the JSON Canvas format (nodes + edges; no new dependency).
- Canvas layout: a "🏠 Planner Home" gateway file-card top-left (purple), then one labelled group box per calendar month (of the week-commencing Monday) stacked down the canvas, each holding a row of that month's week cards. Only weeks that HAVE a note get a card (empty weeks omitted, per decision); the current week's card is tinted green. The note gains a "Visual map → [[🗺 Planner Map]]" cross-link.
- New "Open Planner Map (canvas)" command; same create-if-missing / update-only policy and the same week-note create/delete/rename auto-hooks keep both files in sync.
- Verified the real canvas builder against a mock vault: valid JSON, correct node set (gateway + month groups + week cards), group boxes sized correctly and non-overlapping, empty weeks omitted. svelte-check 0/0, tsc clean, production build OK. Canvas rendering itself needs on-device confirmation.

---

## revert: remove planner directory (items 1 + 2) — tried and pulled

Nick decided the Planner Home note + Planner Map canvas didn't earn their place, so the whole feature is removed. Reverted all wiring in main.ts (the 3 commands, home ribbon icon, the week-note create/delete/rename listeners, the import, and the onunload cancel). src/utils/plannerDirectory.ts and src/utils/academicWeeks.ts are emptied to inert stubs (the sandbox can't delete files in the synced folder — Nick to delete the two files, plus the generated "🏠 Planner Home.md" and "🗺 Planner Map.canvas" in his vault). Plugin returns to its pre-item-1 state. svelte-check 0/0, tsc clean, build OK. See RELEASE-0.3.4.md → "Ideas tried and removed".

---

## feat(lessons): class overview dashboard (0.3.4 item 3)

A curated, glanceable panel above the lesson list once a class is selected. Deliberately trimmed — the earlier all-in-one mock was cluttered, so only the actionable metrics are in the headline.

- New `utils/classStats.ts` — `computeClassStats(settings, classId, now, attentionCount, occurrences?)`. Pure derivation from existing data (classOccurrences, preparedMarks, holiday overrides); no new data capture. The occurrence list is injectable so the aggregation is unit-testable.
  - **Taught is time-aware**: a lesson counts once its period's END time has passed (date + time), so counts roll over through the day.
  - **This week / next week prepared**: counts EVERY lesson in the week (past included — a complete review; the tick means planned/ready), null when the class has no lessons that week.
  - **Before break**: upcoming lessons before the next holiday override, with the date of the last one (falls back to end of year).
  - **Needs attention**: next 3 upcoming lessons NOT prepared — keyed on prepared only, not plan links (many teachers never use plan links).
- `LessonOverviewComponent.svelte`: the panel — headline taught/remaining bar, the two week boxes (green + 🎉 at 100%), Next lesson + Before break chips, and the needs-attention list (rows click through to that lesson in the list via a new `data-lesson` attribute). Minute tick drives the time-aware figures. On mobile the whole panel collapses to a one-line summary (per the 0.3.3 mobile note).
- Verified with a unit test over synthetic occurrences: time-aware taught (period ended vs not), week grouping, 3-of-4 / 1-of-2 prepared, before-break stopping at the holiday, needs-attention selection. svelte-check 0/0, tsc clean, production build OK.

---

## refactor(lessons): collapsible sections + compact spacing in the overview

Space was at a premium once the dashboard landed — tiles (~250px) + panel (~450px) left the lesson list a sliver.

- **Collapsible Classes and Overview sections** (desktop and mobile), each with a summary in its header so collapsing loses nothing: Classes shows the selected class; Overview shows "Taught 32 of 110 · 78 to go". No auto-collapse on select (deliberate — the UI shouldn't move under you). State persists via two new global settings (loClassesOpen / loStatsOpen) wired through the usual GLOBAL_FIELDS pattern (types.ts, settings.ts DEFAULT_GLOBAL_DATA, main.ts fields + defensive defaults + planner-build literal).
- **Compacted layout:** class tiles trimmed (minmax 160→142px, padding 10/12→6/9, smaller text, max-height 260→190) so more fit per row; the panel's two week boxes and two chips merged into ONE responsive grid row (auto-fit minmax(132px)) — four across on desktop, two on mobile; taught/remaining moved into the header; slimmer progress bar and needs-attention rows. Roughly 350px handed back.
- The lesson list needs no change: `.tp-lo` is already a full-height flex column and `.tp-lo-list` is the only `flex:1` child, so it absorbs whatever the fixed sections give back.

svelte-check 0/0 (removed the now-unused CSS from the restructure), tsc clean, production build OK.

---

## feat(lessons): week-commencing dates on the prepared boxes

Adds "w/c 14 Sept" under the label on the this-week / next-week boxes so it's unambiguous which weeks they mean. computeClassStats now returns thisWeekStart / nextWeekStart (ISO Mondays) at the top level rather than inside the nullable week stats, so the date still shows when a box reads "No lessons" — precisely when you most need it. Given its own muted line rather than inline, so it never truncates when the boxes drop to ~160px on mobile (costs ~10px of row height).

Verified the Monday resolution from mid-week, from a Monday, and from a Sunday. svelte-check 0/0, tsc clean, build OK.

