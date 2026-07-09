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

