# Teacher Planner — Import design spec (timetable + holidays)

**Status:** Draft for review — _not scheduled_. Target: a later release (post-0.3.1).
**Author:** drafted with Claude (Cowork), 2026-06-20.
**Related:** vault note *Teacher Planner — Timetable & Holiday Import (research & options)*;
TO DO Item 2 (CSV timetable import). Item 3 (auto-pull holidays) was dropped in favour of `.ics` import here.

> This is a blueprint to consider carefully, not an approved build. Nothing here is implemented.
> Every phase still needs explicit "Approved" before coding, per project rules.

---

## 1. Goals & non-goals

**Goals**
- Let a teacher populate **holidays/INSET** and their **weekly timetable** with minimal manual entry.
- Be **adaptive** to any school without us maintaining per-MIS parsers.
- Never silently overwrite the user's data — every import is **preview → confirm**.
- Reuse existing infrastructure (`icalUtils.generateIcal`, `ExportModal`, day-schedule model).

**Non-goals**
- No direct MIS API integration (no SIMS/Arbor/Bromcom credentials).
- No per-vendor CSV parsers (research shows there is no standard; maintenance trap).
- No student timetables — teacher-facing only.
- No live calendar sync (one-shot import, not a subscription feed) in the initial phases.

---

## 2. Decisions locked vs open

**Locked (2026-06-20)**
- Timetable import target = **our own CSV template** + **AI-fill** bridge (not MIS parsing).
- Holidays = **`.ics` import** primary, with filtering; CSV fallback TBD.
- **Spec now, build in phases.**

**Open (carry into build approval)**
- Holiday CSV fallback: include, or `.ics` + AI-fill only?
- Timetable: single CSV (auto-create classes) vs. two files (classes + lessons)?
- Auto-create unknown classes/periods silently, or stop-and-ask per unmatched row?
- AI-fill: documented Cowork workflow only, or an in-plugin AI button (keys/cost — likely out of scope)?
- Round-trip export of the same template?
- A/B inference when the source has no week info (default `both`?).

---

## 3. Data model recap (what an import must build)

Importing a lesson is not a single write — `TimetableSlot` depends on a chain that must be
**resolved or created first**, in order:

| Step | Target type | Key fields |
|---|---|---|
| 1 | `PeriodTypeConfig` | block types: lesson / break / reg / custom |
| 2 | `SchoolPeriod` in `DaySchedule` | name, start, end, type |
| 3 | `Subject` + `ClassGroup` | code, year, subjectId, room, colour |
| 4 | `TimetableSlot` | day, periodId, classId, start, end, weekType (A/B/both), classroom, durationMinutes |
| 5 | `WeekOverride` | startDate, endDate, type (holiday/inset/custom), label, insetHours |

The parser is ~20% of the work. The **resolve-or-create matching** (steps 2–4) is ~80%.

---

## 4. Feature A — Holiday / INSET import via `.ics` (Phase 1, smaller, ship first)

### 4.1 Entry point
Settings → School timetable (or a new "Import" subsection): **"Import holidays (.ics)…"** button →
file picker (`.ics`) or paste box. Mobile-safe (text paste fallback).

### 4.2 Parse
Minimal iCalendar reader (mirror of `generateIcal`, inverse direction). Per `VEVENT` capture:
`SUMMARY`, `DTSTART`, `DTEND`, all-day flag (`VALUE=DATE`), `RRULE` (ignore/expand cautiously),
`CATEGORIES` if present. No external dependency — hand-rolled line unfolding + field split,
matching how `generateIcal` emits.

### 4.3 Filtering (the core concern — 3 levels)
1. **Structural** — only **all-day / multi-day** events are candidates. Timed events
   (have a time component) are lessons/meetings → excluded pre-display (toggle to reveal).
2. **Keyword auto-classify** (case-insensitive):
   - Holiday: `holiday`, `half term`, `break`, `vacation`, `bank holiday`, `closed`.
   - INSET: `inset`, `training`, `staff day`, `teacher day`, `professional development`, `PD day`.
   - Term boundary (info only): `term starts`, `term ends`, `first day`, `last day`.
   - No confident match → **unselected**, with a type dropdown (ambiguous = opt-in).
3. **Manual confirm** — checkbox list, live count, nothing written until "Add N dates".

### 4.4 Mapping to `WeekOverride`
- all-day single day → `{ startDate, type }`.
- multi-day (`DTEND` exclusive in iCal — subtract 1 day) → `{ startDate, endDate, type }`.
- INSET → prompt/allow `insetHours` (default blank; user fills for directed-time tracking).
- `label` ← `SUMMARY`.

### 4.5 Dedupe & idempotency
On commit, skip a `WeekOverride` whose `startDate`+`type` already exists; offer "replace vs skip"
for overlaps. Re-running the same import is a no-op.

### 4.6 Edge cases
Timezone (assume `Europe/London` like export; date-only events are tz-agnostic); multi-year files
(filter to current academic year ± buffer); recurring events (expand only simple yearly rules, else
list once and warn); overlapping holiday + INSET (INSET wins for that day).

---

## 5. Feature B — Timetable CSV import (Phase 2)

### 5.1 Template schema
One row per lesson occurrence in the weekly pattern:

```
Day,Week,Period,Start,End,ClassCode,Year,Subject,Room
Mon,A,1,09:20,10:05,13A/13B,13,IB DP Biology,B310
Mon,both,2,10:05,10:50,10B,10,Co-ordinated Science,B310
Tue,B,3,11:15,12:00,9B,9,Co-ordinated Science,B309
```

Column semantics:
- **Day** — Mon..Sun (or full names); maps to `SchoolDay`.
- **Week** — `A` / `B` / `both` → `TimetableSlot.weekType`. Empty ⇒ `both`.
- **Period** — matched to an existing `SchoolPeriod` by name first, else created from Start/End.
- **Start/End** — `HH:MM`; used to create/verify the period and to set slot times.
- **ClassCode** — `ClassGroup.code` (e.g. `10B`, `13A/13B`).
- **Year** — `ClassGroup.year`.
- **Subject** — `Subject.name` (resolved/created; emoji default).
- **Room** — `TimetableSlot.classroom` (falls back to class default).

Ship with: a pre-filled example CSV + a **"Download blank template"** button in Settings.

### 5.2 Resolve-or-create matching (the hard 80%)
- **Subject**: case-insensitive name match → else create with default emoji + `randomClassColour`.
- **Class**: match on `code`+`year` → else create, linked to resolved subject, colour from subject.
- **Period**: match on name (case-insensitive) within the day's schedule → else match on Start/End
  → else create a new `SchoolPeriod` (type defaults to `lesson`) and add to the day schedule.
- **Slot**: `(day, periodId, weekType)` key; on collision, preview shows conflict, user picks
  overwrite/skip per row.
- All matching is **previewed** with a per-row status: `match` / `will create` / `conflict` / `error`.

### 5.3 Preview UI
Same dialog pattern as holidays: parsed table, a status badge per row, counts of
"X lessons, Y new classes, Z new periods will be created", and a commit button. Errors (bad time,
unknown day) are flagged inline and block only their own row.

### 5.4 A/B handling
If no `Week` column at all → treat the file as a single-week timetable (all `both`), respecting the
planner's current A/B setting. If `Week` present, set `weekType` per row.

### 5.5 Edge cases
Duplicate rows; a class taught in both A and B at the same period (two rows, `A` and `B`);
merged/double periods (two rows same class adjacent periods — kept as separate slots, grid already
merges visually); rooms differing per occurrence (per-slot `classroom`).

---

## 6. AI-fill bridge (Phase 3 / cross-cutting)

The plugin only ever parses **our** template. To handle "any school", the messy→clean step is done by
**Cowork/Claude**, not plugin code:

- User exports / screenshots / copies whatever their MIS or portal gives (SIMS grid, PDF, HTML, photo).
- In Cowork, Claude maps it into our timetable CSV / holiday list (a documented prompt + the blank
  template as the target schema).
- User imports the clean file via Phase 1/2.

Deliverable for this phase = documentation + example prompts + the canonical template files, **not**
in-plugin AI (which would need API keys, cost, and review — explicitly out of scope unless revisited).

---

## 7. Shared mechanics

- **Preview → commit** for every import; no write before confirm.
- **Single undo**: wrap each import commit so it can be reverted in one step (mirror lessonShift undo).
- **Validation**: collect row-level errors, show a summary, allow partial import of valid rows.
- **Idempotency**: re-importing the same file makes no duplicate data.
- **Backup**: auto-snapshot planner data before commit (reuse `plannerBackup.ts`).

---

## 8. UX entry points (Settings)

A new **"Import"** subsection near Export:
- "Import holidays (.ics)…" (Phase 1)
- "Import timetable (.csv)…" + "Download blank template" (Phase 2)
- A short "Using AI to fill the template" help link (Phase 3).

Mirror the existing `ExportModal` styling/placement so import/export read as a pair.

---

## 9. New code (anticipated)

- `utils/icsImport.ts` — parse `.ics` → candidate events (inverse of `generateIcal`).
- `utils/holidayImport.ts` — classify + map → `WeekOverride[]`.
- `utils/timetableCsv.ts` — parse + resolve-or-create → `{slots, newClasses, newSubjects, newPeriods}`.
- `modals/ImportModal.ts` (or two modals) — the preview/commit dialog(s).
- Template asset: `resources/timetable-template.csv`.
- Unit tests for parse + classify + resolve-or-create (no DOM).

---

## 10. Testing

- Pure-function unit tests: ics parse, keyword classify, csv parse, resolve-or-create matching,
  dedupe/idempotency, A/B mapping, multi-day DTEND off-by-one.
- Fixture files: a clean council term-dates `.ics`, a noisy whole-calendar `.ics`, a SIMS-shaped CSV
  after AI cleanup, a one-week (no A/B) CSV.
- Manual: import into a throwaway planner; verify undo restores prior state.

---

## 11. Risks

- Resolve-or-create ambiguity (fuzzy codes) → mitigated by preview + per-row override.
- iCal variability (tz, RRULE) → keep parser conservative; warn rather than guess.
- Scope creep into in-plugin AI → explicitly deferred.
- Data loss → pre-commit backup + single undo + preview.

---

## 12. Phasing & rough effort

1. **Phase 1 — Holidays `.ics`** (S–M): parser + 3-level filter + preview + WeekOverride write + tests.
2. **Phase 2 — Timetable CSV** (M–L): template + parser + resolve-or-create + preview + tests.
3. **Phase 3 — AI-fill + polish** (S): docs, example prompts, optional export/round-trip.

Recommend shipping Phase 1 alone first (high value, contained), then Phase 2.

---

## 13. Open questions (decide at build-approval)

See §2 "Open". Headline ones: holiday CSV fallback yes/no; auto-create vs stop-and-ask;
AI-fill as docs vs in-plugin; round-trip export.

---

## 14. Sources

- jamesgurung/timetable-calendar-generator — template approach + SIMS export steps
- TimeTabler / Arbor / iSAMS / PowerSchool export docs
- GOV.UK open standard: exchange of calendar events (iCalendar)
- UK council term-date `.ics` feeds (e.g. Cornwall, East Lothian)
