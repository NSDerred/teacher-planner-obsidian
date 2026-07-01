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

