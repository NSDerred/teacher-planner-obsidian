# Review Backlog — 11 June 2026

Source: full code review of v0.1.3 (~7,900 lines). Items to be discussed one at a time;
implemented only after explicit approval. Bug fixes 1–5 applied 11 June 2026.

---

## Bug fixes (APPLIED 11 June 2026)

1. **Dead drag-reject feedback** — `WeekView.svelte` declared `rejectKey` and styled
   `tp-td-cell--reject`, but nothing ever assigned it; the red invalid-drop flash never fired.
2. **Delete-planner save race** — `deletePlanner()` saved directly while a pending debounced
   `requestSave` timer could fire afterwards and resurrect stale state. Now flushes first.
3. **Weak date validation** — date fields were regex-only (`2025-02-30` passed). Now validated
   as real calendar dates in main.ts, SetupWizardModal, EditPlannerModal. Period start must be
   before end (AddPeriodModal). Date events warn if outside the academic year (AddDateEventModal).
4. **Overlapping holiday/INSET ranges** — wizard Step 4 allowed overlaps; directed-time was
   last-write-wins and silently wrong. Now detected and blocked with a notice.
5. **Emoji picker listener leak** — document-level click listener in `SettingsTab.ts` could
   orphan if settings closed before the popup. Now tracked and cleaned up.

---

## Code quality / performance (NOT YET DISCUSSED)

- **Q1. Split `SettingsTab.display()`** — ~1,300-line god function, 22 `container.empty()` full
  re-renders; focus/scroll lost on every edit. Split into per-section render methods.
- **Q2. Remove `as any` casts in planner sync** (`main.ts` populate/sync) — a typo in
  `PLANNER_FIELDS` silently drops data. Use `keyof`-typed helpers.
- **Q3. Deduplicate shared helpers** — `getPeriodTypeColour`/`hexToRgba` duplicated in WeekView
  and TimetableEditor; three different day-of-week maps; date-shift helpers duplicated across
  modals. Extract `utils/colourUtils.ts` + `utils/dateUtils.ts`.
- **Q4. Delete dead file** `src/modals/AddSpecialEventModal.ts` (2-line stub).
- **Q5. Data scale plan** — everything in one `data.json`, rewritten wholesale each save;
  `weekNotes` grows unbounded and isn't vault-searchable. Archive per-year or move notes to
  markdown files.
- **Q6. Inline styles → CSS classes** in SettingsTab (display/opacity/gap assignments).

## Feature suggestions (NOT YET DISCUSSED — prioritized by value vs effort)

- **F1. Jump to week / "Today" button** — week view currently only steps prev/next. Low effort.
- **F2. iCal (.ics) export** — sync timetable + events to Google/Apple Calendar. Medium effort.
- **F3. Week-notes as markdown files (opt-in)** — searchable/linkable in vault; also fixes
  unbounded growth (ties to Q5).
- **F4. Planner backup/restore** — JSON export-import; deleting a planner is unrecoverable.
- **F5. CSV timetable import** — import from school MIS export instead of manual entry.
  Medium-high effort, biggest onboarding win.
- **F6. Day view** — mobile-friendly single-day focus.
- **F7. One-off A/B week swap UI** — `WeekOverride.abWeekOverride` exists in types but no UI
  populates it.
- **F8. Drag-copy (Ctrl+drag)** in week view — drag currently always moves.
- **F9. Double-booking warning** in the timetable editor.
- **F10. Keyboard nav in grid cells** — Enter to open picker; accessibility win.

## Discarded review claims (false positives — do not re-raise)

- `workspace.offref()` is the correct Obsidian API (lowercase).
- `new Date(iso + "T12:00:00")` local-noon parsing is the intended DST-safe pattern.
- `Math.round` in A/B week diff is correct under DST (floor would break).
- Mobile export already hides the Browse button; vault export works on mobile.

## Pre-existing issues discovered during fix verification (11 June 2026)

These all exist at HEAD and were previously masked because a stray trailing `}` committed in
`src/main.ts` was a parse error that made tsc skip ALL semantic checking. The brace is now
removed (it matches the uncommitted local fix), so `npm run typecheck` reports them:

- `AddPeriodModal.ts(2)` — imports `PeriodType` which `types.ts` doesn't export.
- 4 × TS2307 — no TypeScript shim for `.svelte` module imports (add a `src/svelte.d.ts`
  with `declare module "*.svelte"`).
- `SettingsTab.ts(615)` — calls `this.close()` which doesn't exist on PluginSettingTab.
- 3 × TS2322 `string | undefined` assignments (SetupWizardModal 640, SettingsTab 750/829).
- 4 × Svelte a11y build warnings (CalendarSidebarComponent, ColourPickerComponent).
- The local git index was found corrupt ("bad signature 0x00000000"); repo objects are fine.
  On the main machine: delete `.git/index` then run `git reset` to rebuild it.
