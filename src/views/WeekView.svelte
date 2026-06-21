<script lang="ts">
  import type TeacherPlannerPlugin from "../main";
  import type { TimetableSlot, SchoolPeriod, DateEvent, SchoolDay } from "../types";
  import { TFile, Menu, Notice, Platform, setIcon } from "obsidian";

  // Svelte action: renders an Obsidian Lucide icon into the element
  function obsIcon(node: HTMLElement, id: string) {
    setIcon(node, id);
    return { update(newId: string) { setIcon(node, newId); } };
  }
  import {
    getWeekLabel, formatDateRange, addWeeks,
    getMondayOfWeek, weekKey, getAbWeekType,
  } from "../utils/weekUtils";
  import { TimetableEditorModal } from "../modals/TimetableEditorModal";
  import { SlotNotesModal } from "../modals/SlotNotesModal";
  import { ColourPickerModal, ConfirmModal, TextPromptModal } from "../settings/SettingsTab";
  import { AddDateEventModal } from "../modals/AddDateEventModal";
  import { lessonNoteFrontmatter } from "../utils/lessonNoteFiles";
  import { resolveColour, clearThemeColourCache, colourToCss } from "../utils/themeColours";
  import { periodAppliesTo, getPeriodsForDay } from "../utils/scheduleUtils";
  import { eventPeriodIds, eventIsDirected } from "../utils/eventUtils";
  import {
    getSlotPlan, setSlotPlan, clearSlotPlan, getEventPlan, setEventPlan, clearEventPlan,
    migrateSlotPlanToEvent, bulkApplyPlan, undoBulkApply,
    getSlotExternal, setSlotExternal, clearSlotExternal,
    getEventExternal, setEventExternal, clearEventExternal, migrateSlotExternalToEvent, externalKindOf,
    isSlotPrepared, isEventPrepared, toggleSlotPrepared, toggleEventPrepared, migrateSlotPreparedToEvent,
    getLessonNote, getLessonRoom,
  } from "../utils/planLinkUtils";
  import { openOSFolderPicker, openOSFilePicker, openSystemPath } from "../utils/exportDestination";
  import { LessonPlanSuggestModal } from "../modals/LessonPlanSuggestModal";
  import { buildNoteTitle } from "../utils/noteTitleUtils";
  import { DEFAULT_LESSON_NOTE_TITLE_TEMPLATE, DEFAULT_EVENT_NOTE_TITLE_TEMPLATE } from "../settings";

  export let plugin: TeacherPlannerPlugin;
  export let initialDate: Date = new Date();

  // ── Day columns ───────────────────────────────────────────────────────────
  const ALL_DAYS: { key: SchoolDay; label: string; offset: number }[] = [
    { key: "monday",    label: "Mon", offset: 0 },
    { key: "tuesday",   label: "Tue", offset: 1 },
    { key: "wednesday", label: "Wed", offset: 2 },
    { key: "thursday",  label: "Thu", offset: 3 },
    { key: "friday",    label: "Fri", offset: 4 },
    { key: "saturday",  label: "Sat", offset: 5 },
    { key: "sunday",    label: "Sun", offset: 6 },
  ];
  $: DAYS = _dep(_tick, ALL_DAYS.filter(d =>
    (plugin.settings.schoolDays ?? ["monday","tuesday","wednesday","thursday","friday"]).includes(d.key)
  ));

  // ── Reactivity tick ───────────────────────────────────────────────────────
  let _tick = 0;
  /** Registers a reactive dependency on `_t` and returns `value` (TS-clean alternative to the comma idiom). */
  function _dep<T>(_t: unknown, value: T): T { return value; }
  function invalidate() { _tick++; }

  // ── Public API (called by WeekView.ts) ────────────────────────────────────
  export function prevWeek()      { onPrev(); }
  export function nextWeek()      { onNext(); }
  export function updateSize()    { /* no-op for table layout */ }
  export function refreshEvents() { invalidate(); }

  // ── Date / week state ─────────────────────────────────────────────────────
  let currentDate = new Date(initialDate);
  let _lastInitialDate = initialDate;
  $: if (initialDate !== _lastInitialDate) {
    _lastInitialDate = initialDate;
    currentDate = new Date(initialDate);
  }

  $: currentMonday  = getMondayOfWeek(currentDate);
  $: currentWeekKey = weekKey(currentMonday);
  $: weekLabel      = getWeekLabel(currentDate);
  $: dateRange      = formatDateRange(currentDate);
  $: abEnabled      = _dep(_tick, !!plugin.settings.academicYear.abWeekEnabled);
  $: abWeekType     = _dep(_tick, abEnabled
    ? getAbWeekType(currentDate, plugin.settings.academicYear, plugin.settings.weekOverrides ?? [], plugin.settings.schoolDays)
    : null);
  $: abOverridden   = _dep(_tick, (plugin.settings.weekOverrides ?? []).some(o => o.abWeekOverride && getMondayOfWeek(new Date(o.startDate + "T12:00:00")).getTime() === currentMonday.getTime()));
  // Per-day override status — keyed by day.key ("monday" etc.) → "holiday" | "inset" | null
  $: dayOverrideMap = (() => {
    const map: Record<string, "holiday" | "inset" | null> = {};
    const overrides = plugin.settings.weekOverrides ?? [];
    for (const day of DAYS) {
      const iso = dayISODate(day.offset, currentMonday);
      const o = overrides.find(o => {
        const end = o.endDate ?? o.startDate;
        return iso >= o.startDate && iso <= end;
      });
      map[day.key] = o?.type === "holiday" ? "holiday" : o?.type === "inset" ? "inset" : null;
    }
    return map;
  })();

  // ── Settings data (re-read on _tick) ─────────────────────────────────────
  $: _periods     = _dep(_tick, plugin.settings.academicYear.periods);
  $: _periodTypes = _dep(_tick, plugin.settings.periodTypes ?? []);
  $: _templates   = _dep(_tick, plugin.settings.timetableTemplates ?? []);
  $: _classes     = _dep(_tick, plugin.settings.classes ?? []);
  $: _subjects    = _dep(_tick, plugin.settings.subjects ?? []);
  $: _activities  = _dep(_tick, plugin.settings.activities ?? []);
  $: _dateEvents      = _dep(_tick, plugin.settings.dateEvents ?? []);
  $: _slotExclusions  = _dep(_tick, plugin.settings.slotExclusions ?? []);
  $: _planLinks       = _dep(_tick, plugin.settings.lessonPlanLinks ?? []);
  $: _slotPlanMap = (() => {
    const m: Record<string, string> = {};
    for (const l of _planLinks) if (l.slotId && l.date) m[l.slotId + "|" + l.date] = l.path;
    return m;
  })();
  $: _eventPlanMap = (() => {
    const m: Record<string, string> = {};
    for (const l of _planLinks) if (l.eventId) m[l.eventId] = l.path;
    return m;
  })();
  $: _preparedMarks   = _dep(_tick, plugin.settings.preparedMarks ?? []);
  $: _showPrepared    = _dep(_tick, plugin.settings.showPreparedMark ?? true);
  $: _showDirected    = _dep(_tick, plugin.settings.directedTime?.enabled ?? false);
  $: _preparedSlotMap = (() => {
    const m: Record<string, boolean> = {};
    for (const k of _preparedMarks) if (k.slotId && k.date) m[k.slotId + "|" + k.date] = true;
    return m;
  })();
  $: _preparedEventMap = (() => {
    const m: Record<string, boolean> = {};
    for (const k of _preparedMarks) if (k.eventId) m[k.eventId] = true;
    return m;
  })();
  $: _externalLinks   = _dep(_tick, plugin.settings.externalLinks ?? []);
  $: _slotExternalMap = (() => {
    const m: Record<string, { path: string; kind: "file" | "folder" }> = {};
    for (const l of _externalLinks) if (l.slotId && l.date) m[l.slotId + "|" + l.date] = { path: l.path, kind: externalKindOf(l) };
    return m;
  })();
  $: _eventExternalMap = (() => {
    const m: Record<string, { path: string; kind: "file" | "folder" }> = {};
    for (const l of _externalLinks) if (l.eventId) m[l.eventId] = { path: l.path, kind: externalKindOf(l) };
    return m;
  })();

  // Date events for the current week, keyed by "day:periodId" → array.
  // Multi-period events are added under EACH period they cover, so they render
  // as a normal event chip inside every block (same hover-expand, prepared tick,
  // plan/attachment icons and menu as a single-period event).
  $: _dateEventMap = (() => {
    const m: Record<string, DateEvent[]> = {};
    const monday = currentMonday;
    const dayMap: Record<number, SchoolDay> = { 0:"sunday", 1:"monday", 2:"tuesday", 3:"wednesday", 4:"thursday", 5:"friday", 6:"saturday" };
    for (const ev of _dateEvents) {
      const d = new Date(ev.date + "T12:00:00");
      if (getMondayOfWeek(d).getTime() !== monday.getTime()) continue;
      const day = dayMap[d.getDay()];
      if (!day) continue;
      for (const pid of eventPeriodIds(ev)) {
        (m[day + ":" + pid] ??= []).push(ev);
      }
    }
    return m;
  })();

  // ── Multi-period event block merging ─────────────────────────────────────
  // A multi-period event covering 2+ adjacent blocks that are otherwise empty
  // (no lesson, no other event) merges those blocks into ONE spanning block
  // holding the event. Any clash (lesson/other event/gap) splits the run back
  // into the normal in-block chips. All reactive — removing the event reverts.
  function multiEventsOnDay(dayKey: SchoolDay): DateEvent[] {
    const monday = currentMonday;
    const dayMap: Record<number, SchoolDay> = { 0:"sunday", 1:"monday", 2:"tuesday", 3:"wednesday", 4:"thursday", 5:"friday", 6:"saturday" };
    return _dateEvents.filter(ev => {
      if (eventPeriodIds(ev).length < 2) return false;
      const d = new Date(ev.date + "T12:00:00");
      return getMondayOfWeek(d).getTime() === monday.getTime() && dayMap[d.getDay()] === dayKey;
    });
  }
  // A period is free for merging if it has no visible lesson and the only date
  // event occupying it is `ev` itself.
  function periodFreeExceptEvent(dayKey: SchoolDay, dayDate: string, periodId: string, ev: DateEvent): boolean {
    const raw = _slotMap[dayKey + ":" + periodId];
    if (raw && !isSlotExcluded(raw.id, dayDate)) return false;
    const evs = _dateEventMap[dayKey + ":" + periodId] ?? [];
    return evs.every(e => e.id === ev.id);
  }
  interface MergeRun { ev: DateEvent; run: SchoolPeriod[]; }
  function computeMerges(dayKey: SchoolDay, dayDate: string): { starts: Record<string, MergeRun>; consumed: Set<string> } {
    const ordered = getPeriodsForDay(plugin.settings.academicYear, dayKey);
    const starts: Record<string, MergeRun> = {};
    const consumed = new Set<string>();
    for (const ev of multiEventsOnDay(dayKey)) {
      const covered = new Set(eventPeriodIds(ev));
      let run: SchoolPeriod[] = [];
      const flush = () => {
        if (run.length >= 2) {
          starts[run[0].id] = { ev, run: run.slice() };
          for (const pr of run) consumed.add(pr.id);
        }
        run = [];
      };
      for (const pr of ordered) {
        if (covered.has(pr.id) && periodFreeExceptEvent(dayKey, dayDate, pr.id, ev)) run.push(pr);
        else flush();
      }
      flush();
    }
    return { starts, consumed };
  }

  // A timetabled slot counts toward directed time if it's a class lesson, or an
  // activity whose type isn't "other".
  function slotIsDirected(slot: TimetableSlot): boolean {
    if (isClassId(slot.classId)) return true;
    const act = _activities.find(a => a.id === slot.classId);
    return act ? act.activityType !== "other" : false;
  }

  // Per-day template resolution — different days in the same week can belong to
  // different templates (supports mid-week template changes).
  $: _slotMap = (() => {
    // Capture reactive vars at top so Svelte tracks them as dependencies.
    const _ab = abEnabled;
    const _wt = abWeekType;
    const m: Record<string, TimetableSlot> = {};
    for (const day of DAYS) {
      const date = dayISODate(day.offset, currentMonday);
      const tmpl = _templates.find(t => t.startDate <= date && t.endDate >= date);
      if (!tmpl) continue;
      const visible = !_ab || !_wt
        ? tmpl.slots
        : tmpl.slots.filter(s => s.weekType === _wt || s.weekType === "both" || s.weekType == null);
      for (const s of visible) {
        if (s.day === day.key) m[day.key + ":" + s.periodId] = s;
      }
    }
    return m;
  })();

  // ── Helpers ───────────────────────────────────────────────────────────────
  function timeToMinutes(t: string): number {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  }
  function minutesToTime(mins: number): string {
    const h = Math.floor(mins / 60), m = Math.round(mins % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  // ── Time axis (Option B, Phase 2) ─────────────────────────────────────────
  // Time-axis scale (px per minute), driven by the per-device grid-scale setting.
  $: PX_PER_MIN = _dep(_tick, plugin.getGridScale()) / 60;
  $: _axis = (() => {
    const _t = _tick;
    let min = 24 * 60, max = 0;
    for (const day of DAYS) {
      for (const p of getPeriodsForDay(plugin.settings.academicYear, day.key)) {
        min = Math.min(min, timeToMinutes(p.start));
        max = Math.max(max, timeToMinutes(p.end));
      }
    }
    if (min >= max) { min = 8 * 60; max = 16 * 60; }
    return { start: min, end: max };
  })();
  $: axisHeight = (_axis.end - _axis.start) * PX_PER_MIN;
  $: hourMarks = (() => {
    const marks: number[] = [];
    for (let m = Math.ceil(_axis.start / 60) * 60; m <= _axis.end; m += 60) marks.push(m);
    return marks;
  })();
  function fmtAxisTime(m: number): string {
    return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  }
  $: nowTop = (isCurrentWeek && nowMinutes >= _axis.start && nowMinutes <= _axis.end)
    ? (nowMinutes - _axis.start) * PX_PER_MIN
    : null;

  function getPeriodTypeColour(typeId: string): string {
    // resolveColour maps "theme:*" tokens to the active Obsidian theme;
    // plain hex overrides pass through unchanged.
    return resolveColour(_periodTypes.find(t => t.id === typeId)?.colour ?? "#888888");
  }

  function hexToRgba(hex: string, alpha: number): string {
    const clean = hex.replace("#", "");
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(128,128,128,${alpha})`;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function getDayDate(offset: number, monday: Date): string {
    const d = new Date(monday);
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }

  function isToday(offset: number, monday: Date): boolean {
    const d = new Date(monday);
    d.setDate(d.getDate() + offset);
    const t = new Date();
    return d.getFullYear() === t.getFullYear() &&
           d.getMonth()    === t.getMonth()    &&
           d.getDate()     === t.getDate();
  }

  // Compute a ISO date string for a day column using LOCAL date (avoids UTC shift in UTC+ zones)
  function dayISODate(offset: number, monday: Date): string {
    const d = new Date(monday);
    d.setDate(d.getDate() + offset);
    const yr  = d.getFullYear();
    const mo  = String(d.getMonth() + 1).padStart(2, "0");
    const dy  = String(d.getDate()).padStart(2, "0");
    return `${yr}-${mo}-${dy}`;
  }

  function getSlot(day: SchoolDay, periodId: string): TimetableSlot | undefined {
    return _slotMap[day + ":" + periodId];
  }

  function isSlotExcluded(slotId: string, date: string): boolean {
    return _slotExclusions.some(ex => ex.slotId === slotId && ex.date === date);
  }

  function getSlotLabel(slot: TimetableSlot) {
    const cls = _classes.find(c => c.id === slot.classId);
    if (cls) {
      const subj = _subjects.find(s => s.id === cls.subjectId);
      // per-slot classroom override takes precedence over class default
      const classroom = slot.classroom ?? cls.classroom ?? "";
      return { code: cls.code, year: cls.year ?? "", subjectName: subj?.name ?? "", colour: cls.colour, notes: slot.notes ?? "", classroom };
    }
    const act = _activities.find(a => a.id === slot.classId);
    if (act) return { code: act.label, year: "", subjectName: act.info ?? "", colour: act.colour, notes: slot.notes ?? "", classroom: slot.classroom ?? act.classroom ?? "" };
    return { code: "?", year: "", subjectName: "", colour: "#888", notes: "", classroom: "" };
  }

  // Effective per-lesson note/room: the date-keyed override if set, else the recurring slot value.
  const effNote = (slotId: string, date: string, fallback: string) => getLessonNote(plugin.settings, slotId, date) || fallback;
  const effRoom = (slotId: string, date: string, fallback: string) => getLessonRoom(plugin.settings, slotId, date) || fallback;

  function getDateEventLabel(ev: DateEvent) {
    if (ev.title && ev.title.trim()) {
      return {
        code: ev.title.trim(),
        meta: "",
        colour: ev.colour ?? "#9aa0a6",
        notes: ev.notes ?? "",
        classroom: ev.classroom ?? "",
      };
    }
    const cls = _classes.find(c => c.id === ev.classId);
    if (cls) {
      const subj = _subjects.find(s => s.id === cls.subjectId);
      // ev.classroom overrides class-level default (same precedence as slot classroom)
      const classroom = ev.classroom ?? cls.classroom ?? "";
      return { code: cls.code, meta: [cls.year, subj?.name].filter(Boolean).join(" · "), colour: cls.colour, notes: ev.notes ?? "", classroom };
    }
    const act = _activities.find(a => a.id === ev.classId);
    if (act) return { code: act.label, meta: act.info ?? "", colour: act.colour, notes: ev.notes ?? "", classroom: ev.classroom ?? act.classroom ?? "" };
    return { code: "?", meta: "", colour: "#888", notes: "", classroom: "" };
  }

  function cellKey(day: string, periodId: string) { return `${day}:${periodId}`; }

  // ── Keyboard navigation for the week grid (roving tabindex + arrow keys) ──
  let gridBodyEl: HTMLElement | undefined;
  let gridFocusKey: string | null = null;

  afterUpdate(() => {
    if (!gridBodyEl) return;
    const cells = gridBodyEl.querySelectorAll<HTMLElement>("[data-gridkey]");
    if (cells.length === 0) { gridFocusKey = null; return; }
    if (gridFocusKey && gridBodyEl.querySelector(`[data-gridkey="${gridCssEsc(gridFocusKey)}"]`)) return;
    gridFocusKey = cells[0].getAttribute("data-gridkey");
  });

  function gridCssEsc(v: string): string {
    const C = (window as unknown as { CSS?: { escape?: (s: string) => string } }).CSS;
    return C && C.escape ? C.escape(v) : v.replace(/["\\]/g, "\\$&");
  }

  function gridNeighbour(cur: HTMLElement, dir: string): HTMLElement | null {
    if (!gridBodyEl) return null;
    const cells = Array.from(gridBodyEl.querySelectorAll<HTMLElement>("[data-gridkey]"));
    const cr = cur.getBoundingClientRect();
    const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
    let best: HTMLElement | null = null, bestScore = Infinity;
    for (const el of cells) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect();
      const ex = r.left + r.width / 2, ey = r.top + r.height / 2;
      const dx = ex - cx, dy = ey - cy;
      let primary: number, cross: number;
      if (dir === "ArrowRight")     { if (dx <= 1)  continue; primary = dx;  cross = Math.abs(dy); }
      else if (dir === "ArrowLeft") { if (dx >= -1) continue; primary = -dx; cross = Math.abs(dy); }
      else if (dir === "ArrowDown") { if (dy <= 1)  continue; primary = dy;  cross = Math.abs(dx); }
      else                          { if (dy >= -1) continue; primary = -dy; cross = Math.abs(dx); }
      const score = primary + cross * 2; // weight the cross-axis so aligned cells win
      if (score < bestScore) { bestScore = score; best = el; }
    }
    return best;
  }

  function onCellKeydown(e: KeyboardEvent): void {
    const el = e.currentTarget as HTMLElement;
    const k = e.key;
    const isBtn = el.tagName === "BUTTON";
    if (!isBtn && (k === "Enter" || k === " ")) {
      e.preventDefault();
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return;
    }
    if (k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight") {
      const next = gridNeighbour(el, k);
      if (next) {
        e.preventDefault();
        gridFocusKey = next.getAttribute("data-gridkey");
        next.focus();
      }
    }
  }

  // ── Drag-and-drop ─────────────────────────────────────────────────────────
  let dragSlotId:  string | null = null;
  let dragEventId: string | null = null;
  let dragOverKey: string | null = null;
  let rejectKey:   string | null = null;
  let rejectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Flash the invalid-drop style on a cell for 600 ms. */
  function flashReject(key: string) {
    if (rejectTimer) clearTimeout(rejectTimer);
    rejectKey = key;
    rejectTimer = setTimeout(() => { rejectKey = null; rejectTimer = null; }, 600);
  }

  /** Holiday/INSET cells — or periods outside the day's schedule — can't accept drops. */
  function isDropRejected(day: SchoolDay, periodId?: string): boolean {
    if (dayOverrideMap[day]) return true;
    return periodId != null && !periodAppliesTo(plugin.settings.academicYear, periodId, day);
  }

  function onChipDragStart(e: DragEvent, slot: TimetableSlot) {
    dragSlotId = slot.id;
    e.dataTransfer?.setData("text/plain", slot.id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "copyMove";
  }

  function onEventDragStart(e: DragEvent, ev: DateEvent) {
    dragEventId = ev.id;
    e.dataTransfer?.setData("text/plain", "event:" + ev.id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "copyMove";
  }

  function onCellDragOver(e: DragEvent, day: SchoolDay, periodId: string) {
    if (!dragSlotId && !dragEventId) return;
    e.preventDefault();
    if (isDropRejected(day, periodId)) {
      if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
      dragOverKey = null;
      return;
    }
    if (e.dataTransfer) e.dataTransfer.dropEffect = (e.ctrlKey || e.metaKey) ? "copy" : "move";
    dragOverKey = cellKey(day, periodId);
  }

  function onCellDragLeave(e: DragEvent) {
    const rel = e.relatedTarget as HTMLElement | null;
    if (!rel?.closest(".tp-td-cell")) dragOverKey = null;
  }

  async function onCellDrop(e: DragEvent, day: SchoolDay, periodId: string) {
    e.preventDefault();
    dragOverKey = null;
    const copy = e.ctrlKey || e.metaKey;

    // Reject drops onto holiday/INSET cells — anything dropped there would be hidden.
    if (isDropRejected(day, periodId)) {
      flashReject(cellKey(day, periodId));
      dragSlotId = null;
      dragEventId = null;
      return;
    }

    // Handle date event drop
    if (dragEventId) {
      const evId = dragEventId;
      dragEventId = null;
      const dayInfo = DAYS.find(d => d.key === day);
      if (!dayInfo) return;
      const dayDate = dayISODate(dayInfo.offset, currentMonday);
      const ev = plugin.settings.dateEvents.find(ev => ev.id === evId);
      if (!ev) return;
      const single = eventPeriodIds(ev).length <= 1;
      if (copy) {
        // Duplicate: single-period lands on the drop period; multi keeps its span.
        const clone: DateEvent = {
          ...ev,
          id: "devevent-" + Date.now(),
          date: dayDate,
          periodId: single ? periodId : ev.periodId,
          periodIds: single ? [periodId] : (ev.periodIds ? ev.periodIds.slice() : undefined),
        };
        plugin.settings.dateEvents.push(clone);
      } else {
        ev.date = dayDate;
        // Single-period: actually move period (keep periodIds in sync — the grid
        // renders from periodIds). Multi-period: day-only move, span preserved.
        if (single) { ev.periodId = periodId; ev.periodIds = [periodId]; }
      }
      await plugin.saveSettings();
      invalidate();
      return;
    }

    if (!dragSlotId) return;

    // Timetable slot drag — create a date-specific override instead of mutating the template
    const slot = (plugin.settings.timetableTemplates ?? []).flatMap(t => t.slots).find(s => s.id === dragSlotId);
    dragSlotId = null;
    if (!slot) return;

    const sourceDayInfo = DAYS.find(d => d.key === slot.day);
    const targetDayInfo = DAYS.find(d => d.key === day);
    if (!sourceDayInfo || !targetDayInfo) return;

    const sourceDate = dayISODate(sourceDayInfo.offset, currentMonday);
    const targetDate = dayISODate(targetDayInfo.offset, currentMonday);

    // 1. Move only: exclude the slot from its original cell on this date.
    //    Copy (Ctrl/Cmd) leaves the original lesson in place.
    if (!copy) {
      if (!plugin.settings.slotExclusions) plugin.settings.slotExclusions = [];
      const alreadyExcluded = plugin.settings.slotExclusions.some(
        ex => ex.slotId === slot.id && ex.date === sourceDate
      );
      if (!alreadyExcluded) {
        plugin.settings.slotExclusions.push({ slotId: slot.id, date: sourceDate });
      }
    }

    // 2. Create a date event in the target cell carrying the same class/activity
    if (!plugin.settings.dateEvents) plugin.settings.dateEvents = [];
    const newEvId = "ev-" + Date.now();
    plugin.settings.dateEvents.push({
      id: newEvId,
      date: targetDate,
      periodId,
      classId: slot.classId,
      ...(slot.notes    ? { notes: slot.notes }       : {}),
      ...(slot.classroom ? { classroom: slot.classroom } : {}),
    });

    // 3. Move only: the lesson plan / external / prepared follow the moved lesson.
    //    Copy leaves them with the original.
    if (!copy) {
      migrateSlotPlanToEvent(plugin.settings, slot.id, sourceDate, newEvId);
      migrateSlotExternalToEvent(plugin.settings, slot.id, sourceDate, newEvId);
      migrateSlotPreparedToEvent(plugin.settings, slot.id, sourceDate, newEvId);
    }

    await plugin.saveSettings();
    invalidate();
  }

  function onDragEnd() { dragSlotId = null; dragEventId = null; dragOverKey = null; }

  // ── Chip action menu (Obsidian native Menu) ──────────────────────────────
  function openChipMenu(
    e: MouseEvent,
    type: "slot" | "event",
    date: string,
    periodId: string,
    slot?: TimetableSlot,
    event?: DateEvent
  ) {
    e.stopPropagation();
    const menu = new Menu();

    // Header row: period name and times (info only) — useful on mobile where
    // the hover reveal doesn't exist.
    const period = plugin.settings.academicYear.periods.find(p => p.id === periodId);
    if (period) {
      menu.addItem(i => i.setTitle(`${period.name} · ${period.start}–${period.end}`).setIcon("clock").setDisabled(true));
      menu.addSeparator();
    }

    const isClass = type === "slot"
      ? !!_classes.find(c => c.id === slot?.classId)
      : !!_classes.find(c => c.id === event?.classId);

    if (type === "slot" && slot) {
      menu.addItem(i => i.setTitle("Edit").setIcon("pencil").onClick(() => openNotesModal(slot, date, periodId)));
      if (isClass) menu.addItem(i => i.setTitle("Lesson note").setIcon("book-open").onClick(() => openOrCreateLessonNote(slot, date)));
      {
        const planPath = getSlotPlan(plugin.settings, slot.id, date)?.path;
        const itemLabel = getSlotLabel(slot).code;
        if (planPath) {
          menu.addItem(i => i.setTitle("Open lesson plan").setIcon("file-text").onClick(() => openPlan(planPath)));
          menu.addItem(i => i.setTitle("Unlink lesson plan").setIcon("unlink").onClick(async () => {
            clearSlotPlan(plugin.settings, slot.id, date);
            await plugin.saveSettings();
            invalidate();
          }));
        } else {
          menu.addItem(i => i.setTitle("Link lesson plan…").setIcon("file-plus").onClick(() => linkPlanForSlot(slot, date)));
        }
        if (isClass) {
          const prepared = isSlotPrepared(plugin.settings, slot.id, date);
          menu.addItem(i => i.setTitle(prepared ? "Clear prepared mark" : "Mark prepared").setIcon(prepared ? "x" : "check").onClick(async () => {
            toggleSlotPrepared(plugin.settings, slot.id, date);
            await plugin.saveSettings(); invalidate();
          }));
        }
        if (!_isMobileApp) {
          const ext = getSlotExternal(plugin.settings, slot.id, date)?.path;
          if (ext) {
            menu.addItem(i => i.setTitle("Open external resource").setIcon("external-link").onClick(() => openSystemPath(ext)));
            menu.addItem(i => i.setTitle("Unlink external resource").setIcon("unlink").onClick(async () => {
              clearSlotExternal(plugin.settings, slot.id, date);
              await plugin.saveSettings(); invalidate();
            }));
          } else {
            menu.addItem(i => i.setTitle("Link external file…").setIcon("paperclip").onClick(async () => {
              const p = await openOSFilePicker("Link a file to this lesson");
              if (p) { setSlotExternal(plugin.settings, slot.id, date, p, "file"); await plugin.saveSettings(); invalidate(); }
            }));
            menu.addItem(i => i.setTitle("Link external folder…").setIcon("folder-open").onClick(async () => {
              const p = await openOSFolderPicker();
              if (p) { setSlotExternal(plugin.settings, slot.id, date, p, "folder"); await plugin.saveSettings(); invalidate(); }
            }));
          }
        }
      }
      menu.addItem(i => i.setTitle("Add event").setIcon("calendar-plus").onClick(() => openEventPickerDirect(date, periodId)));
      menu.addSeparator();
      menu.addItem(i => i.setTitle("Change colour").setIcon("palette").onClick(() => changeColour(slot.classId)));
      menu.addItem(i => i.setTitle("Remove from timetable").setIcon("trash-2").onClick(() => removeSlot(slot.id)));
    } else if (type === "event" && event) {
      menu.addItem(i => i.setTitle("Edit").setIcon("pencil").onClick(() => onEditDateEvent(event)));
      {
        const planPath = getEventPlan(plugin.settings, event.id)?.path;
        if (planPath) {
          menu.addItem(i => i.setTitle("Open lesson plan").setIcon("file-text").onClick(() => openPlan(planPath)));
          menu.addItem(i => i.setTitle("Unlink lesson plan").setIcon("unlink").onClick(async () => {
            clearEventPlan(plugin.settings, event.id);
            await plugin.saveSettings();
            invalidate();
          }));
        } else {
          menu.addItem(i => i.setTitle("Link lesson plan…").setIcon("file-plus").onClick(() => linkPlanForEvent(event)));
        }
        if (isClass) {
          const prepared = isEventPrepared(plugin.settings, event.id);
          menu.addItem(i => i.setTitle(prepared ? "Clear prepared mark" : "Mark prepared").setIcon(prepared ? "x" : "check").onClick(async () => {
            toggleEventPrepared(plugin.settings, event.id);
            await plugin.saveSettings(); invalidate();
          }));
        }
        if (!_isMobileApp) {
          const ext = getEventExternal(plugin.settings, event.id)?.path;
          if (ext) {
            menu.addItem(i => i.setTitle("Open external resource").setIcon("external-link").onClick(() => openSystemPath(ext)));
            menu.addItem(i => i.setTitle("Unlink external resource").setIcon("unlink").onClick(async () => {
              clearEventExternal(plugin.settings, event.id);
              await plugin.saveSettings(); invalidate();
            }));
          } else {
            menu.addItem(i => i.setTitle("Link external file…").setIcon("paperclip").onClick(async () => {
              const p = await openOSFilePicker("Link a file to this event");
              if (p) { setEventExternal(plugin.settings, event.id, p, "file"); await plugin.saveSettings(); invalidate(); }
            }));
            menu.addItem(i => i.setTitle("Link external folder…").setIcon("folder-open").onClick(async () => {
              const p = await openOSFolderPicker();
              if (p) { setEventExternal(plugin.settings, event.id, p, "folder"); await plugin.saveSettings(); invalidate(); }
            }));
          }
        }
      }
      if (isClass) menu.addItem(i => i.setTitle("Lesson note").setIcon("book-open").onClick(() => openOrCreateLessonNoteForEvent(event, date)));
      if (!isClass) menu.addItem(i => i.setTitle("Event note").setIcon("book-open").onClick(() => {
        const periodName = _periods.find(p => p.id === event.periodId)?.name ?? "";
        const tpl = plugin.settings.eventNoteTitleTemplate ?? DEFAULT_EVENT_NOTE_TITLE_TEMPLATE;
        const defaultTitle = buildNoteTitle(tpl, {
          dateIso: date, periodName, eventName: getDateEventLabel(event).code,
        }) || `${date} ${getDateEventLabel(event).code}`;
        promptAndCreateNote({ dayDate: date, defaultTitle, body: "", promptTitle: "New event note" });
      }));
      menu.addItem(i => i.setTitle("Add event").setIcon("calendar-plus").onClick(() => openEventPickerDirect(date, periodId)));
      menu.addSeparator();
      menu.addItem(i => i.setTitle("Change colour").setIcon("palette").onClick(() => {
        if (event.title && event.title.trim()) changeEventColour(event);
        else changeColour(event.classId);
      }));
      menu.addItem(i => i.setTitle("Remove event").setIcon("trash-2").onClick(() => removeDateEvent(event.id)));
    }
    menu.showAtMouseEvent(e);
  }

  function changeColour(classId: string) {
    const cls = _classes.find(c => c.id === classId);
    const act = _activities.find(a => a.id === classId);
    const current = cls?.colour ?? act?.colour ?? "#888";
    const lbl     = cls?.code  ?? act?.label  ?? "Item";
    new ColourPickerModal(plugin.app, current, lbl, async (colour: string) => {
      if (cls) { cls.colour = colour; cls.colourOverridden = true; }
      else if (act) { act.colour = colour; }
      await plugin.saveSettings(); invalidate();
    }).open();
  }

  function changeEventColour(event: DateEvent) {
    new ColourPickerModal(plugin.app, event.colour ?? "#888", event.title ?? "Event", async (colour: string) => {
      const ev = (plugin.settings.dateEvents ?? []).find(e => e.id === event.id);
      if (ev) ev.colour = colour;
      await plugin.saveSettings(); invalidate();
    }).open();
  }

  async function removeSlot(slotId: string) {
    for (const tmpl of (plugin.settings.timetableTemplates ?? [])) {
      tmpl.slots = tmpl.slots.filter(s => s.id !== slotId);
    }
    await plugin.saveSettings(); invalidate();
  }

  function openEventPickerDirect(dayDate: string, periodId: string) {
    onAddEvent(dayDate, periodId);
  }

  function openNotesModal(slot: TimetableSlot, dayDate: string, periodId: string) {
    const lbl = getSlotLabel(slot);
    const period = _periods.find(p => p.id === periodId);
    const [y, mo, d] = dayDate.split("-");
    const formattedDate = `${d}/${mo}/${y.slice(-2)}`;
    const periodName = period?.name ?? "";
    const timeRange  = period ? `${period.start}–${period.end}` : "";
    new SlotNotesModal(
      plugin.app, plugin, slot.id, dayDate,
      effNote(slot.id, dayDate, lbl.notes), effRoom(slot.id, dayDate, lbl.classroom),
      lbl.code, formattedDate, periodName, timeRange,
      () => invalidate()
    ).open();
  }

  // ── Current time indicator ────────────────────────────────────────────────
  let nowMinutes = 0;
  function updateNow() {
    const n = new Date();
    nowMinutes = n.getHours() * 60 + n.getMinutes();
  }
  updateNow();
  const _nowInterval = setInterval(updateNow, 60_000);
  // Re-sync immediately when Obsidian regains focus — intervals are throttled when idle
  function _onVisibilityChange() { if (document.visibilityState === "visible") updateNow(); }
  document.addEventListener("visibilitychange", _onVisibilityChange);
  // Re-resolve theme-derived block colours when the Obsidian theme changes
  const _cssChangeRef = plugin.app.workspace.on("css-change", () => {
    clearThemeColourCache();
    invalidate();
  });
  import { onDestroy, afterUpdate } from "svelte";
  onDestroy(() => {
    clearInterval(_nowInterval);
    if (rejectTimer) clearTimeout(rejectTimer);
    document.removeEventListener("visibilitychange", _onVisibilityChange);
    plugin.app.workspace.offref(_cssChangeRef);
  });


  $: currentTimeStr = (() => {
    const h = Math.floor(nowMinutes / 60);
    const m = nowMinutes % 60;
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  })();

  $: isCurrentWeek = (() => {
    const thisMonday = getMondayOfWeek(new Date());
    return currentMonday.getTime() === thisMonday.getTime();
  })();

  // ── Academic-year bounds ──────────────────────────────────────────────────
  function _ayStart(): Date { return new Date(plugin.settings.academicYear.startDate + "T00:00:00"); }
  function _ayEnd():   Date { return new Date(plugin.settings.academicYear.endDate   + "T23:59:59"); }
  $: canGoWeekPrev = _dep(_tick, getMondayOfWeek(addWeeks(currentDate, -1)) >= _ayStart());
  $: canGoWeekNext = _dep(_tick, getMondayOfWeek(addWeeks(currentDate,  1)) <= _ayEnd());
  $: canGoPrev = isDayMode ? !!_stepSchoolDay(currentDate, -1) : canGoWeekPrev;
  $: canGoNext = isDayMode ? !!_stepSchoolDay(currentDate,  1) : canGoWeekNext;

  // Sync sidebar notes to the current planner week whenever it changes
  $: (plugin as any).notifySidebar(currentMonday);

  // ── Navigation ────────────────────────────────────────────────────────────
  function onPrev()  { if (isDayMode) { onPrevDay(); return; } if (canGoWeekPrev) currentDate = addWeeks(currentDate, -1); }
  function onNext()  { if (isDayMode) { onNextDay(); return; } if (canGoWeekNext) currentDate = addWeeks(currentDate, 1); }
  function onOpenOverview() {
    void plugin.activateLessonOverview();
  }

  function onToday() {
    const t = new Date();
    const s = _ayStart(); const e = _ayEnd();
    currentDate = t < s ? s : t > e ? e : t;
  }

  // ── Jump-to-date (week-nav centre) ────────────────────────────────────────
  let jumpOpen = false;
  function isoOf(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  $: navCentreLabel = (isDayMode ? currentDate : currentMonday)
    .toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  function jumpToDate(iso: string) {
    if (!iso) return;
    const d = new Date(iso + "T12:00:00");
    const s = _ayStart(); const e = _ayEnd();
    currentDate = d < s ? s : d > e ? e : d;
    jumpOpen = false;
  }
  function onJumpChange(e: Event) {
    jumpToDate((e.currentTarget as HTMLInputElement).value);
  }

  // ── A/B week override (per-week) ──────────────────────────────────────────
  async function setAbOverride(value: "A" | "B" | null, anchor: boolean) {
    const monIso = dayISODate(0, currentMonday);
    let overrides = (plugin.settings.weekOverrides ?? []).filter(o =>
      !(o.abWeekOverride && getMondayOfWeek(new Date(o.startDate + "T12:00:00")).getTime() === currentMonday.getTime()));
    if (value) overrides = [...overrides, { startDate: monIso, type: "custom", abWeekOverride: value, abWeekAnchor: anchor }];
    plugin.settings.weekOverrides = overrides;
    await plugin.saveSettings();
    invalidate();
  }
  function currentAbOverride(): { value: "A" | "B"; anchor: boolean } | null {
    for (const o of plugin.settings.weekOverrides ?? []) {
      if (o.abWeekOverride && getMondayOfWeek(new Date(o.startDate + "T12:00:00")).getTime() === currentMonday.getTime()) {
        return { value: o.abWeekOverride, anchor: !!o.abWeekAnchor };
      }
    }
    return null;
  }
  function openAbMenu(e: MouseEvent) {
    e.stopPropagation();
    const cur = currentAbOverride();
    const state = cur
      ? `This week: Week ${abWeekType} (forced${cur.anchor ? ", shifts rest" : ""})`
      : `This week: Week ${abWeekType} (automatic)`;
    const menu = new Menu();
    menu.addItem(i => i.setTitle(state).setIcon("calendar").setDisabled(true));
    menu.addSeparator();
    menu.addItem(i => i.setTitle("Use automatic rotation").setIcon("rotate-ccw").setChecked(!cur).onClick(() => setAbOverride(null, false)));
    menu.addSeparator();
    menu.addItem(i => i.setTitle("Relabel this week only").setDisabled(true));
    menu.addItem(i => i.setTitle("Show this week as A").setChecked(!!cur && !cur.anchor && cur.value === "A").onClick(() => setAbOverride("A", false)));
    menu.addItem(i => i.setTitle("Show this week as B").setChecked(!!cur && !cur.anchor && cur.value === "B").onClick(() => setAbOverride("B", false)));
    menu.addSeparator();
    menu.addItem(i => i.setTitle("Change pattern from here on").setDisabled(true));
    menu.addItem(i => i.setTitle("Make this an A week (shift the rest)").setChecked(!!cur && cur.anchor && cur.value === "A").onClick(() => setAbOverride("A", true)));
    menu.addItem(i => i.setTitle("Make this a B week (shift the rest)").setChecked(!!cur && cur.anchor && cur.value === "B").onClick(() => setAbOverride("B", true)));
    menu.showAtMouseEvent(e);
  }

  function onOpenTimetable() { new TimetableEditorModal(plugin.app, plugin).open(); }
  function onOpenSettings()  {
    const s = (plugin.app as any).setting;
    s.open();
    s.openTabById("teacher-planner");
  }
  function onAddEvent(prefillDate?: string, prefillPeriodId?: string) {
    new AddDateEventModal(plugin.app, plugin, null, () => invalidate(), prefillDate, prefillPeriodId).open();
  }

  // Overflow menu for narrow screens
  function showOverflowMenu(e: MouseEvent) {
    e.stopPropagation();
    const menu = new Menu();
    menu.addItem(i => i.setTitle("+ Event").setIcon("calendar-plus").onClick(() => onAddEvent()));
    menu.addItem(i => i.setTitle("Timetable").setIcon("layout-grid").onClick(onOpenTimetable));
    menu.addItem(i => i.setTitle("Settings").setIcon("settings").onClick(onOpenSettings));
    menu.showAtMouseEvent(e);
  }

  function onEditDateEvent(event: DateEvent) {
    new AddDateEventModal(plugin.app, plugin, event, () => invalidate()).open();
  }

  async function removeDateEvent(eventId: string) {
    plugin.settings.dateEvents = (plugin.settings.dateEvents ?? []).filter(e => e.id !== eventId);
    await plugin.saveSettings();
    invalidate();
  }



  // ── Event picker modal ────────────────────────────────────────────────────
  function openEventPicker(e: MouseEvent, dayDate: string, periodId: string) {
    e.stopPropagation();
    onAddEvent(dayDate, periodId);
  }

  // ── Weekly note folders ("WC - <Monday>") ─────────────────────────────────
  const _isMobileApp = Platform.isMobile;

  // ── Mobile view modes (day | agenda | grid). Desktop always shows the week grid. ──
  type MobileMode = "day" | "agenda" | "grid";
  $: viewMode = _dep(_tick, _isMobileApp ? ((plugin.settings.mobileViewMode as MobileMode) ?? "day") : "grid");
  $: isDayMode    = _isMobileApp && viewMode === "day";
  $: isAgendaMode = _isMobileApp && viewMode === "agenda";

  function addDaysLocal(base: Date, days: number): Date {
    const d = new Date(base); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days); return d;
  }
  function _schoolDayKeys(): SchoolDay[] {
    return (plugin.settings.schoolDays ?? ["monday","tuesday","wednesday","thursday","friday"]) as SchoolDay[];
  }
  function _isSchoolDate(d: Date): boolean {
    return _schoolDayKeys().includes(ALL_DAYS[(d.getDay() + 6) % 7].key);
  }

  // Selected day (day mode): offset of currentDate within its Monday-week.
  $: selectedOffset = (() => {
    const a = new Date(currentMonday); a.setHours(0, 0, 0, 0);
    const b = new Date(currentDate);   b.setHours(0, 0, 0, 0);
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  })();
  $: selectedDay = _dep(_tick, DAYS.find(d => d.offset === selectedOffset) ?? DAYS[0]);
  $: renderDays  = isDayMode && selectedDay ? [selectedDay] : DAYS;
  $: selectedDateObj    = addDaysLocal(currentMonday, selectedDay ? selectedDay.offset : 0);
  $: selectedDayLong    = selectedDateObj.toLocaleDateString("en-GB", { weekday: "long" });
  $: selectedDayDateStr = selectedDateObj.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  async function setMobileMode(m: MobileMode) {
    plugin.settings.mobileViewMode = m;
    await plugin.saveSettings();
    invalidate();
  }
  function selectDay(offset: number) { currentDate = addDaysLocal(currentMonday, offset); }

  // Step to the next/previous school day within the academic year (day-mode nav).
  function _stepSchoolDay(from: Date, dir: number): Date | null {
    const s = _ayStart(); const e = _ayEnd();
    let d = new Date(from); d.setHours(0, 0, 0, 0);
    for (let i = 0; i < 14; i++) {
      d = addDaysLocal(d, dir);
      if (d < s || d > e) return null;
      if (_isSchoolDate(d)) return d;
    }
    return null;
  }
  function onPrevDay() { const d = _stepSchoolDay(currentDate, -1); if (d) currentDate = d; }
  function onNextDay() { const d = _stepSchoolDay(currentDate,  1); if (d) currentDate = d; }

  // Does a school day in the current week have any lesson/event? (day-strip dot / agenda empty state)
  function dayHasItems(day: { key: SchoolDay; offset: number }): boolean {
    const date = dayISODate(day.offset, currentMonday);
    for (const p of getPeriodsForDay(plugin.settings.academicYear, day.key)) {
      const raw = _slotMap[day.key + ":" + p.id];
      if (raw && !isSlotExcluded(raw.id, date)) return true;
      if ((_dateEventMap[day.key + ":" + p.id] ?? []).length > 0) return true;
    }
    return false;
  }
  function subjectEmoji(classId: string): string {
    const cls = _classes.find(c => c.id === classId);
    const subj = cls ? _subjects.find(x => x.id === cls.subjectId) : undefined;
    return subj?.emoji ?? "";
  }

  function wcFolderFor(dateIso: string): string {
    const base = plugin.settings.plannerFolder || "Teacher Planner";
    if (!(plugin.settings.weeklyNoteFolders ?? true)) return base;
    const monday = getMondayOfWeek(new Date(dateIso + "T12:00:00"));
    const iso = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
    return `${base}/WC - ${iso}`;
  }

  /** Existing note for this name: weekly folder first, then the legacy flat path. */
  function findExistingNote(dateIso: string, fileName: string): string | null {
    const base = plugin.settings.plannerFolder || "Teacher Planner";
    for (const p of [`${wcFolderFor(dateIso)}/${fileName}.md`, `${base}/${fileName}.md`]) {
      if (plugin.app.vault.getAbstractFileByPath(p) instanceof TFile) return p;
    }
    return null;
  }

  async function createNoteIn(dateIso: string, fileName: string, content: string): Promise<void> {
    const base = plugin.settings.plannerFolder || "Teacher Planner";
    const folder = wcFolderFor(dateIso);
    if (!plugin.app.vault.getAbstractFileByPath(base))   { try { await plugin.app.vault.createFolder(base); }   catch {} }
    if (folder !== base && !plugin.app.vault.getAbstractFileByPath(folder)) { try { await plugin.app.vault.createFolder(folder); } catch {} }
    try {
      await plugin.app.vault.create(`${folder}/${fileName}.md`, content);
      plugin.app.workspace.openLinkText(`${folder}/${fileName}.md`, "", false);
    } catch (err) { console.error("Teacher Planner: note create failed.", err); }
  }

  // ── Bulk apply: confirm + journaled undo ──────────────────────────────────
  function doUndoBulkApply() {
    const journal = plugin.settings.lastBulkApply;
    if (!journal) { new Notice("Nothing to undo."); return; }
    new ConfirmModal(plugin.app, `Undo the last bulk plan apply (${journal.entries.length} lesson${journal.entries.length === 1 ? "" : "s"})? Previously linked plans will be restored.`, async () => {
      const n = undoBulkApply(plugin.settings);
      await plugin.saveSettings();
      invalidate();
      new Notice(`Bulk apply undone — ${n} lesson${n === 1 ? "" : "s"} reverted.`);
    }, "Undo").open();
  }

  function showBulkUndoNotice(count: number) {
    const frag = document.createDocumentFragment();
    frag.appendChild(document.createTextNode(`Plan linked to ${count} lesson${count === 1 ? "" : "s"}. `));
    const btn = document.createElement("button");
    btn.textContent = "Undo";
    btn.className = "tp-btn";
    btn.style.marginLeft = "8px";
    frag.appendChild(btn);
    const notice = new Notice(frag, 10000);
    btn.addEventListener("click", () => { notice.hide(); doUndoBulkApply(); });
  }

  // ── Lesson plan linking ───────────────────────────────────────────────────
  function isClassId(id: string): boolean { return !!_classes.find(c => c.id === id); }

  async function toggleSlotPrep(slot: TimetableSlot, date: string) {
    toggleSlotPrepared(plugin.settings, slot.id, date);
    await plugin.saveSettings();
    invalidate();
  }
  async function toggleEventPrep(ev: DateEvent) {
    toggleEventPrepared(plugin.settings, ev.id);
    await plugin.saveSettings();
    invalidate();
  }

  function openPlan(path: string) {
    if (!plugin.app.vault.getAbstractFileByPath(path)) {
      new Notice("Lesson plan note not found — it may have been deleted. Re-link from the lesson menu.");
      return;
    }
    plugin.app.workspace.openLinkText(path, "", false);
  }

  function planPickerInfo(classId: string): { code: string; subject: string } {
    const cls = _classes.find(c => c.id === classId);
    const subj = cls ? _subjects.find(x => x.id === cls.subjectId) : undefined;
    return { code: cls?.code ?? "", subject: subj?.name ?? "" };
  }

  function linkPlanForSlot(slot: TimetableSlot, date: string) {
    const info = planPickerInfo(slot.classId);
    new LessonPlanSuggestModal(plugin.app, plugin, info.code, info.subject, async (path) => {
      setSlotPlan(plugin.settings, slot.id, date, path);
      await plugin.saveSettings();
      invalidate();
    }).open();
  }

  function linkPlanForEvent(ev: DateEvent) {
    const info = planPickerInfo(ev.classId);
    new LessonPlanSuggestModal(plugin.app, plugin, info.code, info.subject, async (path) => {
      setEventPlan(plugin.settings, ev.id, path);
      await plugin.saveSettings();
      invalidate();
    }).open();
  }

  // ── Lesson / event note creation ───────────────────────────────────────────
  const LESSON_BODY_FALLBACK = "## Notes:\n---\n\n## Homework set:\n---\n\n## Next lesson:\n---\n";

  /** Pre-fill an editable title, then create the note — or open an existing match without prompting. */
  function promptAndCreateNote(opts: { dayDate: string; defaultTitle: string; body: string; promptTitle: string; classIdForCount?: string }) {
    const { dayDate, defaultTitle, body, promptTitle, classIdForCount } = opts;
    const existing = findExistingNote(dayDate, defaultTitle);
    if (existing) { plugin.app.workspace.openLinkText(existing, "", false); return; }
    new TextPromptModal(plugin.app, promptTitle, defaultTitle, "Note title", (name) => { void (async () => {
      const fileName = name.replace(/[\\/:*?"<>|]/g, "-").replace(/\s{2,}/g, " ").trim() || defaultTitle;
      const ex = findExistingNote(dayDate, fileName);
      if (ex) { plugin.app.workspace.openLinkText(ex, "", false); return; }
      if (classIdForCount) {
        const cls = _classes.find(c => c.id === classIdForCount);
        if (cls) { cls.lessonCount = (cls.lessonCount ?? 0) + 1; await plugin.saveSettings(); }
      }
      await createNoteIn(dayDate, fileName, body);
    })(); }).open();
  }

  function openOrCreateLessonNote(slot: TimetableSlot, dayDate: string) {
    const cls = _classes.find(c => c.id === slot.classId);
    const subj = cls ? _subjects.find(s => s.id === cls.subjectId) : undefined;
    const periodName = _periods.find(p => p.id === slot.periodId)?.name ?? "";
    const tpl = plugin.settings.lessonNoteTitleTemplate ?? DEFAULT_LESSON_NOTE_TITLE_TEMPLATE;
    const defaultTitle = buildNoteTitle(tpl, {
      dateIso: dayDate, periodName,
      classCode: cls?.code ?? getSlotLabel(slot).code,
      subjectName: subj?.name, emoji: subj?.emoji,
    }) || `${dayDate} ${getSlotLabel(slot).code}`;
    const fm = lessonNoteFrontmatter({ code: cls?.code ?? getSlotLabel(slot).code, subjectName: subj?.name, emoji: subj?.emoji }, periodName, dayDate);
    const body = fm + (plugin.settings.lessonNoteTemplate ?? LESSON_BODY_FALLBACK);
    promptAndCreateNote({ dayDate, defaultTitle, body, promptTitle: "New lesson note", classIdForCount: slot.classId });
  }

  // ── Lesson note from date event ──────────────────────────────────────────
  function openOrCreateLessonNoteForEvent(ev: DateEvent, dayDate: string) {
    const cls = _classes.find(c => c.id === ev.classId);
    if (!cls) return; // activities get "Event note" instead
    const subj = _subjects.find(s => s.id === cls.subjectId);
    const periodName = _periods.find(p => p.id === ev.periodId)?.name ?? "";
    const tpl = plugin.settings.lessonNoteTitleTemplate ?? DEFAULT_LESSON_NOTE_TITLE_TEMPLATE;
    const defaultTitle = buildNoteTitle(tpl, {
      dateIso: dayDate, periodName,
      classCode: cls.code, subjectName: subj?.name, emoji: subj?.emoji,
    }) || `${dayDate} ${cls.code}`;
    const body = plugin.settings.lessonNoteTemplate ?? LESSON_BODY_FALLBACK;
    promptAndCreateNote({ dayDate, defaultTitle, body, promptTitle: "New lesson note", classIdForCount: ev.classId });
  }


</script>



<div class="tp-week-view" data-tp-theme={plugin.settings.theme ?? "carbon"} data-tp-mode={plugin.settings.themeMode ?? "dark"} data-tp-view={isDayMode ? "day" : isAgendaMode ? "agenda" : "grid"}>

  <!-- ── Header ─────────────────────────────────────────────────────────── -->
  <header class="tp-header">
    <div class="tp-header-identity">
      <span class="tp-week-label">
        {isDayMode ? selectedDayLong : weekLabel}
        {#if abEnabled && abWeekType}
          <button class="tp-week-ab-badge tp-week-ab-badge--{abWeekType.toLowerCase()}" class:tp-week-ab-badge--forced={abOverridden}
            title={abOverridden ? "A/B forced for this week — click to change" : "Click to override this week's A/B"}
            on:click={openAbMenu}>Week {abWeekType}</button>
        {/if}
      </span>
      <span class="tp-date-range">{isDayMode ? selectedDayDateStr : dateRange}</span>
    </div>
    <nav class="tp-nav" aria-label="Week navigation">
      <button class="tp-btn tp-nav-arrow" on:click={onPrev} aria-label="Previous week" title="Previous week" disabled={!canGoPrev}>‹</button>
      <div class="tp-nav-jump">
        <button class="tp-btn tp-nav-centre" on:click={() => jumpOpen = !jumpOpen}
          aria-haspopup="true" aria-expanded={jumpOpen} title="Jump to a date">
          <span class="tp-nav-centre-icon" use:obsIcon={"calendar"}></span>
          <span class="tp-nav-centre-label">{navCentreLabel}</span>
          <span class="tp-nav-caret">▾</span>
        </button>
        {#if jumpOpen}
          <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
          <div class="tp-nav-backdrop" on:click={() => jumpOpen = false}></div>
          <div class="tp-nav-pop">
            <input class="tp-nav-date" type="date" value={isoOf(currentDate)}
              min={plugin.settings.academicYear.startDate} max={plugin.settings.academicYear.endDate}
              on:change={onJumpChange} />
            <button class="tp-btn" on:click={() => { onToday(); jumpOpen = false; }}>Today</button>
          </div>
        {/if}
      </div>
      <button class="tp-btn tp-nav-arrow" on:click={onNext} aria-label="Next week" title="Next week" disabled={!canGoNext}>›</button>
    </nav>
    <div class="tp-header-actions">
      <button class="tp-btn tp-action-btn" on:click={() => onAddEvent()} aria-label="Add event"><span use:obsIcon={"calendar-plus"} class="tp-btn-icon"></span>Event</button>
      <button class="tp-btn tp-action-btn" on:click={onOpenOverview} aria-label="Lesson overview" title="Lesson overview"><span use:obsIcon={"list-checks"} class="tp-btn-icon"></span>Lessons</button>
      <button class="tp-btn tp-action-btn" on:click={onOpenTimetable} aria-label="Edit timetable"><span use:obsIcon={"layout-grid"} class="tp-btn-icon"></span>Timetable</button>
      <button class="tp-btn tp-action-btn tp-action-btn--icon-only" on:click={onOpenSettings} aria-label="Settings" use:obsIcon={"settings"}></button>
      <button class="tp-btn tp-overflow-btn" on:click={showOverflowMenu} aria-label="More options" use:obsIcon={"more-horizontal"}></button>
    </div>
  </header>

  {#if _isMobileApp}
    <div class="tp-mobile-modes" role="tablist" aria-label="View mode">
      <button class="tp-mode-btn" class:tp-mode-btn--on={viewMode === "day"}    role="tab" aria-selected={viewMode === "day"}    on:click={() => setMobileMode("day")}>Day</button>
      <button class="tp-mode-btn" class:tp-mode-btn--on={viewMode === "agenda"} role="tab" aria-selected={viewMode === "agenda"} on:click={() => setMobileMode("agenda")}>Agenda</button>
      <button class="tp-mode-btn" class:tp-mode-btn--on={viewMode === "grid"}   role="tab" aria-selected={viewMode === "grid"}   on:click={() => setMobileMode("grid")}>Grid</button>
    </div>
  {/if}

  {#if isDayMode}
    <div class="tp-day-strip">
      {#each DAYS as day}
        <button class="tp-day-pill"
          class:tp-day-pill--sel={day.offset === selectedOffset}
          class:tp-day-pill--today={isToday(day.offset, currentMonday)}
          on:click={() => selectDay(day.offset)} aria-label={day.label}>
          <span class="tp-day-pill-dow">{day.label}</span>
          <span class="tp-day-pill-num">{addDaysLocal(currentMonday, day.offset).getDate()}</span>
          {#if dayHasItems(day)}<span class="tp-day-pill-dot"></span>{/if}
        </button>
      {/each}
    </div>
  {/if}

  {#if isAgendaMode}
    <div class="tp-agenda">
      {#each DAYS as day}
        {@const aDate = dayISODate(day.offset, currentMonday)}
        {@const aOverride = dayOverrideMap[day.key]}
        <div class="tp-agenda-day">
          <div class="tp-agenda-head" class:tp-agenda-head--today={isToday(day.offset, currentMonday)}>
            <span class="tp-agenda-dayname">{day.label} {addDaysLocal(currentMonday, day.offset).getDate()}</span>
            {#if aOverride === "holiday"}<span class="tp-day-override-badge tp-day-override-badge--holiday">Holiday</span>
            {:else if aOverride === "inset"}<span class="tp-day-override-badge tp-day-override-badge--inset">INSET</span>{/if}
          </div>
          {#if aOverride}
            <div class="tp-agenda-empty">{aOverride === "holiday" ? "Holiday" : "INSET day"}</div>
          {:else}
            {#each getPeriodsForDay(plugin.settings.academicYear, day.key) as period (period.id)}
              {@const aRaw = _slotMap[day.key + ":" + period.id]}
              {@const aSlot = aRaw && !isSlotExcluded(aRaw.id, aDate) ? aRaw : undefined}
              {@const aEvents = _dateEventMap[day.key + ":" + period.id] ?? []}
              {#if aSlot}
                {@const sl = getSlotLabel(aSlot)}
                <button class="tp-agenda-row" style="border-left:3px solid {sl.colour}; background:{hexToRgba(sl.colour,0.16)};"
                  on:click={(e) => openChipMenu(e, "slot", aDate, period.id, aSlot)}>
                  <span class="tp-agenda-period">{period.name}</span>
                  <span class="tp-agenda-main">{subjectEmoji(aSlot.classId)} {sl.code}{#if sl.subjectName} · {sl.subjectName}{/if}</span>
                  {#if effRoom(aSlot.id, aDate, sl.classroom)}<span class="tp-agenda-room">{effRoom(aSlot.id, aDate, sl.classroom)}</span>{/if}
                </button>
              {/if}
              {#each aEvents as aEv (aEv.id)}
                {@const el = getDateEventLabel(aEv)}
                <button class="tp-agenda-row tp-agenda-row--event" style="border-left:3px solid {el.colour}; background:{hexToRgba(el.colour,0.16)};"
                  on:click={(e) => openChipMenu(e, "event", aDate, period.id, undefined, aEv)}>
                  <span class="tp-agenda-period">{period.name}</span>
                  <span class="tp-agenda-main">{el.code}{#if el.meta} · {el.meta}{/if}</span>
                  {#if el.classroom}<span class="tp-agenda-room">{el.classroom}</span>{/if}
                </button>
              {/each}
            {/each}
            {#if !dayHasItems(day)}<div class="tp-agenda-empty">No lessons</div>{/if}
          {/if}
        </div>
      {/each}
    </div>
  {:else}
  <!-- ── Time-axis week grid (each day column has its own schedule) ──────── -->
  <div class="tp-table-scroll">
    <div class="tp-axis" style="--grid-colour:{colourToCss(plugin.settings.gridLineColour, '#555')}; --grid-weight:{plugin.settings.gridLineWeight ?? 1}px; --block-colour:{colourToCss(plugin.settings.blockBorderColour, '#444')}; --block-weight:{plugin.settings.blockBorderWeight ?? 1}px;">

      <div class="tp-axis-head">
        <div class="tp-axis-head-gutter"></div>
        {#each renderDays as day}
          {@const dayOverride = dayOverrideMap[day.key]}
          <div class="tp-axis-head-day"
            class:tp-th-day--today={isToday(day.offset, currentMonday)}
            class:tp-th-day--holiday={dayOverride === "holiday"}
            class:tp-th-day--inset={dayOverride === "inset"}>
            <div class="tp-th-day-inner">
              <span class="tp-day-label">
                <span class="tp-day-name">{day.label}</span>
                <span class="tp-day-date">{getDayDate(day.offset, currentMonday)}</span>
              </span>
              {#if dayOverride === "holiday"}<span class="tp-day-override-badge tp-day-override-badge--holiday">Holiday</span>
              {:else if dayOverride === "inset"}<span class="tp-day-override-badge tp-day-override-badge--inset">Inset</span>{/if}
            </div>
          </div>
        {/each}
      </div>

      <div class="tp-axis-body" bind:this={gridBodyEl}>
        <div class="tp-axis-gutter" style="height:{axisHeight}px;">
          {#each hourMarks as hm}
            <div class="tp-axis-hour" style="top:{(hm - _axis.start) * PX_PER_MIN}px;">{fmtAxisTime(hm)}</div>
          {/each}
          {#if nowTop !== null}
            <div class="tp-now-badge" style="top:{nowTop}px;">{currentTimeStr}</div>
          {/if}
        </div>

        {#if nowTop !== null}
          <div class="tp-now-line tp-now-line--week" style="top:{nowTop + 6}px;"></div>
        {/if}

        {#each renderDays as day}
          {@const dayDate     = dayISODate(day.offset, currentMonday)}
          {@const dayOverride = dayOverrideMap[day.key]}
          <div class="tp-axis-col"
            class:tp-axis-col--holiday={dayOverride === "holiday"}
            class:tp-axis-col--inset={dayOverride === "inset"}
            style="height:{axisHeight}px;">
            {#each hourMarks as hm}
              <div class="tp-axis-line" style="top:{(hm - _axis.start) * PX_PER_MIN}px;"></div>
            {/each}

            {#if dayOverride}
              <div class="tp-axis-override-label">{dayOverride === "holiday" ? "Holiday" : "INSET"}</div>
            {:else}
              {@const dayMerges = computeMerges(day.key, dayDate)}
              {#each getPeriodsForDay(plugin.settings.academicYear, day.key) as period (period.id)}
                {@const tc        = getPeriodTypeColour(period.type)}
                {@const bTop      = (timeToMinutes(period.start) - _axis.start) * PX_PER_MIN}
                {@const bHeight   = Math.max(20, (timeToMinutes(period.end) - timeToMinutes(period.start)) * PX_PER_MIN)}
                {@const _rawSlot  = _slotMap[day.key + ":" + period.id]}
                {@const slot      = _rawSlot && !isSlotExcluded(_rawSlot.id, dayDate) ? _rawSlot : undefined}
                {@const devEvents = _dateEventMap[day.key + ":" + period.id] ?? []}
                {@const key       = cellKey(day.key, period.id)}
                {@const isOver    = dragOverKey === key && !slot}
                {@const isReject  = rejectKey   === key}
                {@const _blockMins = timeToMinutes(period.end) - timeToMinutes(period.start)}
                {@const _occCount = (slot ? 1 : 0) + devEvents.length}
                {@const _soleEv = (!slot && devEvents.length === 1) ? devEvents[0] : undefined}
                {@const _evSingleBlock = _soleEv ? (eventPeriodIds(_soleEv).length <= 1) : false}
                {@const _occMins = slot && devEvents.length === 0
                  ? (slot.durationMinutes ?? _blockMins)
                  : (_soleEv && _evSingleBlock ? (_soleEv.durationMinutes ?? _blockMins) : _blockMins)}
                {@const _periodStartMin = timeToMinutes(period.start)}
                {@const _blockEndMin = timeToMinutes(period.end)}
                {@const _soleStartMin = slot && devEvents.length === 0
                  ? timeToMinutes(slot.start ?? period.start)
                  : (_soleEv && _evSingleBlock ? timeToMinutes(_soleEv.startTime ?? period.start) : _periodStartMin)}
                {@const _leadMins = Math.max(0, _soleStartMin - _periodStartMin)}
                {@const _leadPx = _leadMins * PX_PER_MIN}
                {@const _partial = _occCount === 1 && _occMins > 0 && (_occMins < _blockMins || _leadMins > 0) && (slot ? true : _evSingleBlock) && ((_leadMins + _occMins) * PX_PER_MIN) <= bHeight}
                {@const _occEndMin = _soleStartMin + _occMins}
                {@const _occEnd = minutesToTime(_occEndMin)}
                {@const _innerH = Math.max(0, bHeight - 6)}
                {@const _stackH = Math.min(_innerH, Math.max(_occMins * PX_PER_MIN, 40))}
                {@const _stackTop = Math.min(_leadPx, Math.max(0, _innerH - _stackH))}
                {#if dayMerges.starts[period.id]}
                  {@const _mrun  = dayMerges.starts[period.id]}
                  {@const _mev   = _mrun.ev}
                  {@const _first = _mrun.run[0]}
                  {@const _last  = _mrun.run[_mrun.run.length - 1]}
                  {@const _mTop  = (timeToMinutes(_first.start) - _axis.start) * PX_PER_MIN}
                  {@const _mH    = Math.max(20, (timeToMinutes(_last.end) - timeToMinutes(_first.start)) * PX_PER_MIN)}
                  {@const _mlbl  = getDateEventLabel(_mev)}
                  {@const _mPlan = _eventPlanMap[_mev.id]}
                  {@const _mPrep = _preparedEventMap[_mev.id]}
                  {@const _mExt  = _eventExternalMap[_mev.id]}
                  {@const _mRange = _first.name + (_mrun.run.length > 1 ? " – " + _last.name : "") + " · " + _first.start + "–" + _last.end}
                  <div class="tp-block tp-block--merged" style="top:{_mTop}px; height:{_mH}px; --bh:{_mH}px; --tint:{hexToRgba(_mlbl.colour, 0.08)}; background:{hexToRgba(_mlbl.colour, 0.08)}; border-left:3px solid {_mlbl.colour};">
                    <div class="tp-event-stack">
                      <!-- svelte-ignore a11y-interactive-supports-focus -->
                      <div class="tp-chip tp-chip--event" role="button" tabindex={gridFocusKey === `${day.key}:${_first.id}:merged` ? 0 : -1} draggable="true"
                        data-gridkey={`${day.key}:${_first.id}:merged`}
                        on:dragstart={(e) => onEventDragStart(e, _mev)}
                        on:dragend={onDragEnd}
                        on:click={(e) => openChipMenu(e, "event", dayDate, _first.id, undefined, _mev)}
                        on:keydown={onCellKeydown}
                        title="{_mlbl.code} · {_mRange}"
                        style="--ctint:{hexToRgba(_mlbl.colour,0.22)}; border-left:3px solid {_mlbl.colour}; background:{hexToRgba(_mlbl.colour,0.22)};">
                        <span class="tp-chip-period-time">{_mRange}</span>
                        <div class="tp-chip-body">
                          <span class="tp-chip-code">{_mlbl.code}</span>
                          {#if _mlbl.notes}<span class="tp-chip-notes">{_mlbl.notes}</span>{/if}
                        </div>
                        <div class="tp-chip-footer">
                          {#if _mlbl.classroom}<span class="tp-chip-room">{_mlbl.classroom}</span>{/if}
                          <div class="tp-chip-marks">
                            {#if _showPrepared && (isClassId(_mev.classId) || !!(_mev.title && _mev.title.trim()))}
                              <button class="tp-prep-tick" class:tp-prep-tick--on={_mPrep}
                                title={_mPrep ? "Marked prepared — click to clear" : "Mark prepared"}
                                aria-label="Toggle prepared" aria-pressed={_mPrep}
                                on:click|stopPropagation={() => toggleEventPrep(_mev)} use:obsIcon={"check"}></button>
                            {/if}
                            {#if _mPlan}
                              <button class="tp-plan-mark tp-plan-mark--linked" title="Open lesson plan" aria-label="Open lesson plan"
                                on:click|stopPropagation={() => openPlan(_mPlan)} use:obsIcon={"file-text"}></button>
                            {/if}
                            {#if _mExt && !_isMobileApp}
                              <button class="tp-ext-mark" title={_mExt.kind === "folder" ? "Open external folder" : "Open external file"} aria-label="Open external resource"
                                on:click|stopPropagation={() => openSystemPath(_mExt.path)} use:obsIcon={_mExt.kind === "folder" ? "folder" : "paperclip"}></button>
                            {/if}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                {:else if dayMerges.consumed.has(period.id)}
                  <!-- block consumed by the merged event rendered above -->
                {:else}
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <div
                  class="tp-block"
                  class:tp-block--dragover={isOver}
                  class:tp-block--reject={isReject}
                  style="top:{bTop}px; height:{bHeight}px; --bh:{bHeight}px; --tint:{hexToRgba(tc, 0.08)}; background:{hexToRgba(tc, 0.08)}; border-left:3px solid {hexToRgba(tc, 0.55)};"
                  on:dragover={(e) => onCellDragOver(e, day.key, period.id)}
                  on:dragleave={onCellDragLeave}
                  on:drop={(e) => onCellDrop(e, day.key, period.id)}
                >
                  {#if ((slot ? 1 : 0) + devEvents.length) >= 2}
                    {@const _dirOcc = (slot && slotIsDirected(slot) ? 1 : 0) + devEvents.filter(ev => eventIsDirected(ev, plugin.settings)).length}
                    <div class="tp-block-clash" class:tp-block-clash--directed={_showDirected && _dirOcc >= 2}
                      title={(_showDirected && _dirOcc >= 2) ? "Double-booked — directed time is counted twice here" : "Double-booked block"}>⚠</div>
                  {/if}
                  {#if !slot && devEvents.length === 0}
                    <div class="tp-block-label">
                      <span class="tp-block-name">{period.name}</span>
                      <span class="tp-block-time">{period.start}–{period.end}</span>
                    </div>
                  {/if}

                  {#if slot || devEvents.length > 0}
                    <div class="tp-event-stack" class:tp-event-stack--partial={_partial} style={_partial ? `--stack-h:${_stackH}px; --stack-top:${_stackTop}px;` : ""}>
                      {#if slot}
                        {@const lbl = getSlotLabel(slot)}
                        {@const slotPlanPath = _slotPlanMap[slot.id + "|" + dayDate]}
                        {@const slotPrepared = _preparedSlotMap[slot.id + "|" + dayDate]}
                        {@const slotExternal = _slotExternalMap[slot.id + "|" + dayDate]}
                        <!-- svelte-ignore a11y-interactive-supports-focus -->
                        <div
                          class="tp-chip"
                          draggable="true"
                          role="button"
                          tabindex={gridFocusKey === `${day.key}:${period.id}:slot` ? 0 : -1}
                          data-gridkey={`${day.key}:${period.id}:slot`}
                          on:dragstart={(e) => onChipDragStart(e, slot)}
                          on:dragend={onDragEnd}
                          on:click={(e) => openChipMenu(e, "slot", dayDate, period.id, slot)}
                          on:keydown={onCellKeydown}
                          title={_partial ? `${period.name} · ${minutesToTime(_soleStartMin)}–${_occEnd} · ${_occMins} min` : `${period.name} · ${period.start}–${period.end}`}
                          style="--ctint:{hexToRgba(lbl.colour,0.22)}; background:{hexToRgba(lbl.colour,0.22)}; border-left:3px solid {lbl.colour};"
                        >
                          <span class="tp-chip-period-time">{_partial ? `${minutesToTime(_soleStartMin)}–${_occEnd} · ${_occMins} min` : `${period.name} · ${period.start}–${period.end}`}</span>
                          <div class="tp-chip-body">
                            <span class="tp-chip-code">{lbl.code}</span>
                            {#if lbl.year || lbl.subjectName}
                              <span class="tp-chip-meta">{[lbl.year, lbl.subjectName].filter(Boolean).join(" · ")}</span>
                            {/if}
                            {#if effNote(slot.id, dayDate, lbl.notes)}
                              <span class="tp-chip-notes">{effNote(slot.id, dayDate, lbl.notes)}</span>
                            {/if}
                          </div>
                          <div class="tp-chip-footer">
                            {#if effRoom(slot.id, dayDate, lbl.classroom)}
                              <span class="tp-chip-room">{effRoom(slot.id, dayDate, lbl.classroom)}</span>
                            {/if}
                            <div class="tp-chip-marks">
                              {#if _showPrepared && isClassId(slot.classId)}
                                <button class="tp-prep-tick" class:tp-prep-tick--on={slotPrepared}
                                  title={slotPrepared ? "Marked prepared — click to clear" : "Mark lesson prepared"}
                                  aria-label="Toggle lesson prepared" aria-pressed={slotPrepared}
                                  on:click|stopPropagation={() => toggleSlotPrep(slot, dayDate)} use:obsIcon={"check"}></button>
                              {/if}
                              {#if slotPlanPath}
                                <button class="tp-plan-mark tp-plan-mark--linked" title="Open lesson plan" aria-label="Open lesson plan"
                                  on:click|stopPropagation={() => openPlan(slotPlanPath)} use:obsIcon={"file-text"}></button>
                              {/if}
                              {#if slotExternal && !_isMobileApp}
                                <button class="tp-ext-mark" title={slotExternal.kind === "folder" ? "Open external folder" : "Open external file"} aria-label="Open external resource"
                                  on:click|stopPropagation={() => openSystemPath(slotExternal.path)} use:obsIcon={slotExternal.kind === "folder" ? "folder" : "paperclip"}></button>
                              {/if}
                            </div>
                          </div>
                        </div>
                      {/if}
                      {#each devEvents as devEv (devEv.id)}
                        {@const lbl = getDateEventLabel(devEv)}
                        {@const evPlanPath = _eventPlanMap[devEv.id]}
                        {@const evPrepared = _preparedEventMap[devEv.id]}
                        {@const evExternal = _eventExternalMap[devEv.id]}
                        <!-- svelte-ignore a11y-interactive-supports-focus -->
                        <div
                          class="tp-chip tp-chip--event"
                          role="button"
                          tabindex={gridFocusKey === `${day.key}:${period.id}:ev:${devEv.id}` ? 0 : -1}
                          data-gridkey={`${day.key}:${period.id}:ev:${devEv.id}`}
                          draggable="true"
                          on:dragstart={(e) => onEventDragStart(e, devEv)}
                          on:dragend={onDragEnd}
                          on:click={(e) => openChipMenu(e, "event", dayDate, period.id, undefined, devEv)}
                          on:keydown={onCellKeydown}
                          title={_partial ? `${period.name} · ${minutesToTime(_soleStartMin)}–${_occEnd} · ${_occMins} min` : `${period.name} · ${period.start}–${period.end}`}
                          style="--ctint:{hexToRgba(lbl.colour,0.22)}; border-left:3px solid {lbl.colour}; background:{hexToRgba(lbl.colour,0.22)};"
                        >
                          <span class="tp-chip-period-time">{_partial ? `${minutesToTime(_soleStartMin)}–${_occEnd} · ${_occMins} min` : `${period.name} · ${period.start}–${period.end}`}</span>
                          <div class="tp-chip-body">
                            <span class="tp-chip-code">{lbl.code}</span>
                            {#if lbl.meta}
                              <span class="tp-chip-meta">{lbl.meta}</span>
                            {/if}
                            {#if lbl.notes}<span class="tp-chip-notes">{lbl.notes}</span>{/if}
                          </div>
                          <div class="tp-chip-footer">
                            {#if lbl.classroom}
                              <span class="tp-chip-room">{lbl.classroom}</span>
                            {/if}
                            <div class="tp-chip-marks">
                              {#if _showPrepared && (isClassId(devEv.classId) || !!(devEv.title && devEv.title.trim()))}
                                <button class="tp-prep-tick" class:tp-prep-tick--on={evPrepared}
                                  title={evPrepared ? "Marked prepared — click to clear" : "Mark lesson prepared"}
                                  aria-label="Toggle lesson prepared" aria-pressed={evPrepared}
                                  on:click|stopPropagation={() => toggleEventPrep(devEv)} use:obsIcon={"check"}></button>
                              {/if}
                              {#if evPlanPath}
                                <button class="tp-plan-mark tp-plan-mark--linked" title="Open lesson plan" aria-label="Open lesson plan"
                                  on:click|stopPropagation={() => openPlan(evPlanPath)} use:obsIcon={"file-text"}></button>
                              {/if}
                              {#if evExternal && !_isMobileApp}
                                <button class="tp-ext-mark" title={evExternal.kind === "folder" ? "Open external folder" : "Open external file"} aria-label="Open external resource"
                                  on:click|stopPropagation={() => openSystemPath(evExternal.path)} use:obsIcon={evExternal.kind === "folder" ? "folder" : "paperclip"}></button>
                              {/if}
                            </div>
                          </div>
                        </div>
                      {/each}
                    </div>
                  {:else}
                    <button
                      class="tp-cell-add-event"
                      title="Add one-off event to this slot"
                      tabindex={gridFocusKey === `${day.key}:${period.id}:add` ? 0 : -1}
                      data-gridkey={`${day.key}:${period.id}:add`}
                      on:keydown={onCellKeydown}
                      on:click={(e) => openEventPicker(e, dayDate, period.id)}
                    >＋ Event</button>
                  {/if}
                  {#if _partial}
                    {#if _leadMins > 0}
                      <div class="tp-block-free tp-block-free--lead" style="height:{_stackTop}px;">{period.start}–{minutesToTime(_soleStartMin)}</div>
                    {/if}
                    <div class="tp-block-durbadge">{_occMins}m</div>
                    {#if _occEndMin < _blockEndMin}
                      <div class="tp-block-free" style="top:{3 + _stackTop + _stackH}px;">{_occEnd}–{period.end}</div>
                    {/if}
                  {/if}
                </div>
                {/if}
              {/each}

            {/if}
          </div>
        {/each}
      </div>
    </div>
  </div>
  {/if}




</div>

<style>
  .tp-week-view { display:flex; flex-direction:column; flex:1; min-height:0; overflow:hidden; background:var(--background-primary); font-family:var(--font-interface); container-type:inline-size; }

  /* Header */
  .tp-header { display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:8px; padding:8px 16px; border-bottom:1px solid var(--background-modifier-border); flex-shrink:0; background:var(--background-secondary); }
  .tp-header-identity { display:flex; flex-direction:column; gap:1px; min-width:0; }
  .tp-week-label { font-size:15px; font-weight:700; color:var(--text-normal); line-height:1.2; }
  .tp-date-range { font-size:13px; color:var(--text-muted); }
  .tp-nav { display:flex; align-items:center; gap:4px; }
  .tp-nav-arrow { padding:4px 11px; font-size:18px; line-height:1; }
  .tp-nav-jump { position:relative; display:inline-flex; }
  .tp-nav-centre { display:inline-flex; align-items:center; gap:6px; padding:5px 11px; font-size:13px; font-weight:600; }
  .tp-nav-centre-icon :global(svg) { width:14px; height:14px; }
  .tp-nav-centre-label { white-space:nowrap; }
  .tp-nav-caret { font-size:10px; color:var(--text-muted); }
  .tp-nav-backdrop { position:fixed; inset:0; z-index:40; }
  .tp-nav-pop { position:absolute; top:calc(100% + 6px); left:50%; transform:translateX(-50%); z-index:50; display:flex; align-items:center; gap:6px; background:var(--background-primary); border:1px solid var(--background-modifier-border); border-radius:8px; padding:8px; box-shadow:0 4px 18px rgba(0,0,0,0.32); }
  .tp-nav-date { font-size:13px; padding:4px 6px; border:1px solid var(--background-modifier-border); border-radius:5px; background:var(--background-modifier-form-field); color:var(--text-normal); font-family:var(--font-interface); }
  .tp-header-actions { display:flex; gap:6px; justify-content:flex-end; }

  .tp-week-ab-badge { display:inline-block; margin-left:6px; padding:1px 7px; border-radius:10px; font-size:12px; font-weight:700; vertical-align:middle; background:var(--interactive-accent); color:var(--text-on-accent); }
  button.tp-week-ab-badge { border:none; cursor:pointer; font-family:var(--font-interface); line-height:1.5; }
  button.tp-week-ab-badge:hover { opacity:0.85; }
  .tp-week-ab-badge--forced { outline:1.5px dashed currentColor; outline-offset:1px; }
  .tp-week-ab-badge--b { background:var(--color-yellow,#f59e0b); color:#1e1e2e; }

  /* Buttons */
  .tp-btn { display:inline-flex; align-items:center; gap:5px; padding:5px 10px; border-radius:5px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal); font-size:13px; font-family:var(--font-interface); cursor:pointer; transition:background 0.1s; white-space:nowrap; }
  .tp-btn:hover { background:var(--background-modifier-hover); }
  .tp-btn:disabled { opacity:0.38; cursor:default; pointer-events:none; }
  .tp-btn-accent { background:var(--interactive-accent); color:var(--text-on-accent); border-color:var(--interactive-accent); }
  .tp-btn-accent:hover { background:var(--interactive-accent); opacity:0.88; }
  .tp-btn :global(svg), .tp-btn-icon :global(svg) { width:14px; height:14px; flex-shrink:0; }
  .tp-action-btn--icon-only { padding:5px 8px; }
  .tp-action-btn--icon-only :global(svg) { width:15px; height:15px; }
  .tp-overflow-btn { display:none; }

  /* Scroll container */
  .tp-table-scroll { flex:1 1 0; overflow:auto; min-height:0; }

  /* ── Time axis layout ─────────────────────────────────────────────────── */
  .tp-axis { display:flex; flex-direction:column; min-width:520px; }

  .tp-axis-head { position:sticky; top:0; z-index:10; display:flex; gap:6px; padding-right:6px; background:var(--background-primary); border-bottom:1px solid var(--background-modifier-border); }
  .tp-axis-head-gutter { width:48px; flex-shrink:0; }
  .tp-axis-head-day { flex:1; min-width:0; padding:8px 6px; font-size:12px; font-weight:600; color:var(--text-muted); border-radius:6px 6px 0 0; background:var(--background-primary); }
  .tp-th-day--today   { color:var(--interactive-accent); }
  .tp-th-day--holiday { background:color-mix(in srgb,var(--color-yellow,#f9e2af) 14%,var(--background-secondary)) !important; color:var(--color-yellow,#d4a017) !important; }
  .tp-th-day--inset   { background:color-mix(in srgb,var(--interactive-accent) 10%,var(--background-secondary)) !important; color:var(--interactive-accent) !important; }
  .tp-th-day-inner { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; }
  .tp-day-label { display:flex; flex-direction:column; align-items:center; gap:1px; min-width:0; }
  .tp-day-name { font-size:13px; font-weight:700; white-space:nowrap; }
  .tp-day-date { font-size:11px; color:var(--text-normal); opacity:0.85; white-space:nowrap; }
  .tp-day-override-badge { font-size:10px; font-weight:700; padding:1px 6px; border-radius:3px; white-space:nowrap; letter-spacing:0.03em; text-transform:uppercase; }
  .tp-day-override-badge--holiday { background:var(--color-yellow,#f59e0b); color:#1a1a1a; }
  .tp-day-override-badge--inset   { background:var(--interactive-accent); color:var(--text-on-accent,#fff); }

  .tp-axis-body { display:flex; align-items:flex-start; gap:6px; padding:6px 6px 12px 0; position:relative; }
  .tp-axis-gutter { width:48px; flex-shrink:0; position:relative; }
  .tp-axis-hour { position:absolute; right:6px; transform:translateY(-50%); font-size:11px; color:var(--text-muted); white-space:nowrap; }
  .tp-axis-col { flex:1; min-width:0; position:relative; background:var(--background-secondary); border-radius:6px; }
  .tp-axis-line { position:absolute; left:0; right:0; border-top:1px solid color-mix(in srgb,var(--grid-colour,var(--background-modifier-border)) 22%,transparent); pointer-events:none; }
  .tp-axis-col--holiday { background:color-mix(in srgb,var(--color-yellow,#f9e2af) 8%,transparent); }
  .tp-axis-col--inset   { background:color-mix(in srgb,var(--interactive-accent) 6%,transparent); }
  .tp-axis-override-label { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:var(--text-muted); opacity:0.55; pointer-events:none; }

  /* Period blocks — positioned by time within the day column */
  .tp-chip:focus-visible { outline:2px solid var(--interactive-accent); outline-offset:-2px; border-radius:4px; }
  .tp-block { position:absolute; left:4px; right:4px; border:1px solid var(--background-modifier-border); border-radius:4px; box-sizing:border-box; overflow:hidden; transition:background 0.1s; z-index:2; container-type:inline-size; container-name:block; }
  .tp-block-clash { position:absolute; top:1px; right:3px; z-index:6; font-size:11px; line-height:1; color:var(--color-yellow,#e0af68); cursor:help; }
  .tp-block-clash--directed { color:var(--color-red,#f38ba8); font-size:13px; font-weight:700; }

  .tp-block--dragover { background:color-mix(in srgb,var(--interactive-accent) 20%,transparent) !important; outline:2px dashed var(--interactive-accent); outline-offset:-2px; }
  .tp-block--reject   { background:color-mix(in srgb,var(--color-red,#f38ba8) 28%,transparent) !important; transition:background 0s; }
  /* Stacked label: period name with its time range underneath. Short blocks
     simply clip the second line (overflow:hidden on the block). */
  .tp-block-label { display:flex; flex-direction:column; padding:2px 6px; pointer-events:none; min-width:0; }
  .tp-block-name { max-width:100%; font-size:11px; font-weight:700; color:var(--text-muted); line-height:1.25; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  /* Time revealed on hover — keeps the resting grid to names only */
  .tp-block-time { display:none; font-size:10px; color:var(--text-muted); opacity:0.85; line-height:1.2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .tp-block:hover .tp-block-time { display:block; }

  /* Hover-overlay: clipped blocks expand above their neighbours, opaque.
     min-height keeps the timetable height as the floor — blocks only grow. */
  .tp-block:hover {
    height:auto !important;
    min-height:max(var(--bh, 20px), 48px);
    z-index:30;
    padding-bottom:6px;
    background:linear-gradient(var(--tint, transparent), var(--tint, transparent)) var(--background-secondary) !important;
    box-shadow:0 4px 16px rgba(0, 0, 0, 0.45);
    outline:1px solid var(--background-modifier-border-hover, var(--background-modifier-border));
  }
  /* Adaptive hover for blocks with chips: the block keeps its timetable
     footprint as an invisible hover hit-area (no flicker), while the card
     itself is painted on the chip stack, which hugs the content exactly. */
  .tp-block:hover:has(.tp-event-stack) {
    min-height:var(--bh, 20px);
    padding-bottom:0;
    overflow:visible;
    background:transparent !important;
    border-color:transparent !important;
    box-shadow:none;
    outline:none;
  }
  .tp-block:hover .tp-event-stack {
    position:relative; inset:auto; height:auto; margin:3px;
    border-radius:4px;
    background:linear-gradient(var(--tint, transparent), var(--tint, transparent)) var(--background-secondary);
    box-shadow:0 4px 16px rgba(0, 0, 0, 0.45);
    outline:1px solid var(--background-modifier-border-hover, var(--background-modifier-border));
  }
  .tp-block:hover .tp-block-label { padding:4px 8px; }
  .tp-block:hover .tp-chip {
    container-type:normal;
    background:linear-gradient(var(--ctint, transparent), var(--ctint, transparent)) var(--background-secondary) !important;
  }
  .tp-block:hover .tp-chip-body { overflow:visible; }
  .tp-block:hover .tp-chip-notes { display:block; -webkit-line-clamp:unset; line-clamp:unset; overflow:visible; }
  .tp-chip-period-time { display:none; font-size:12px; color:var(--text-muted); opacity:0.85; flex-shrink:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .tp-block:hover .tp-chip-period-time { display:block; }

  /* Lesson chip */
  .tp-chip { --mark-size:14px; position:absolute; inset:3px; border-radius:4px; padding:4px 6px; display:flex; flex-direction:column; gap:2px; cursor:pointer; overflow:hidden; user-select:none; transition:filter 0.1s; box-sizing:border-box; color:var(--text-normal); container-type:size; container-name:chip; }
  .tp-chip-body { flex:0 1 auto; min-height:0; overflow:hidden; display:flex; flex-direction:column; gap:2px; }
  .tp-chip-footer { flex-shrink:0; display:flex; align-items:center; gap:4px; }
  .tp-chip:hover { filter:brightness(1.08); }
  .tp-chip-code  { font-size:15px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex-shrink:0; }
  .tp-chip-meta  { font-size:13px; color:var(--text-normal); opacity:0.82; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex-shrink:0; }
  .tp-chip-room  { font-size:12px; color:var(--text-normal); opacity:0.75; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1 1 auto; min-width:0; font-style:italic; }
  .tp-chip-notes { font-size:12px; color:var(--text-normal); opacity:0.75; overflow:hidden; display:-webkit-box; -webkit-line-clamp:1; line-clamp:1; -webkit-box-orient:vertical; line-height:1.3; flex-shrink:1; }

  @container chip (max-height: 58px) {
    .tp-chip-meta,
    .tp-chip-notes { display: none; }
    .tp-chip-code  { font-size: 13px; }
    .tp-chip-room  { font-size: 11px; }
    .tp-chip-marks { --mark-size: 12px; }
  }
  @container chip (max-height: 44px) {
    .tp-chip-code { font-size: 12px; }
    .tp-chip-room { font-size: 10px; }
    .tp-chip-marks { --mark-size: 11px; }
  }
  @container chip (max-height: 34px) {
    .tp-chip-room { display: none; }
    .tp-chip-code { font-size: 11px; }
    .tp-chip-marks { --mark-size: 10px; }
  }
  @container chip (max-width: 90px) {
    .tp-chip-code { font-size: 13px; }
    .tp-chip-room { font-size: 10px; }
    .tp-chip-marks { --mark-size: 12px; }
  }
  @container chip (max-width: 60px) {
    .tp-chip-code { font-size: 11px; }
    .tp-chip-room { font-size: 9px; }
    .tp-chip-marks { --mark-size: 10px; }
  }
  @container chip (max-width: 84px) {
    .tp-chip-footer { flex-direction: column; align-items: stretch; gap: 1px; }
    .tp-chip-marks { margin-left: 0; align-self: flex-end; }
  }

  /* Lesson plan + prepared indicators — own line, pinned to chip bottom, size scales with --mark-size */
  .tp-chip-marks { margin-left:auto; display:flex; gap:calc(var(--mark-size) * 0.3); align-items:center; justify-content:flex-end; flex-shrink:0; }
  .tp-plan-mark { width:var(--mark-size); height:var(--mark-size); display:inline-flex; align-items:center; justify-content:center; background:none; border:none; padding:0; line-height:0; box-sizing:border-box; flex-shrink:0; }
  button.tp-plan-mark--linked { color:#43a047; opacity:1; cursor:pointer; }
  button.tp-plan-mark--linked:hover { opacity:0.7; }
  .tp-plan-mark :global(svg) { width:var(--mark-size); height:var(--mark-size); }
  .tp-ext-mark { width:var(--mark-size); height:var(--mark-size); display:inline-flex; align-items:center; justify-content:center; background:none; border:none; padding:0; line-height:0; box-sizing:border-box; flex-shrink:0; color:var(--text-muted); cursor:pointer; opacity:0.85; }
  .tp-ext-mark:hover { opacity:1; }
  .tp-ext-mark :global(svg) { width:var(--mark-size); height:var(--mark-size); }
  .tp-prep-tick { width:var(--mark-size); height:var(--mark-size); border-radius:50%; display:inline-flex; align-items:center; justify-content:center; background:transparent; border:1.5px solid var(--text-muted); padding:0; line-height:0; cursor:pointer; color:var(--text-muted); opacity:0; transition:opacity 80ms ease; box-sizing:border-box; flex-shrink:0; }
  .tp-chip:hover .tp-prep-tick { opacity:0.55; }
  button.tp-prep-tick--on { opacity:1 !important; background:#43a047; border-color:#43a047; color:#fff; }
  .tp-prep-tick :global(svg) { width:calc(var(--mark-size) * 0.7); height:calc(var(--mark-size) * 0.7); }

  /* Current time indicator */
  .tp-now-line { position:absolute; left:0; right:0; height:0; border-top:2px dashed var(--interactive-accent); opacity:0.9; pointer-events:none; z-index:5; }
  /* Continuous current-time line across the whole week (anchored to the axis body) */
  .tp-now-line--week { left:48px; right:6px; }
  .tp-now-badge { position:absolute; right:2px; transform:translateY(-50%); background:var(--interactive-accent); color:var(--text-on-accent,#fff); font-size:9px; font-weight:700; padding:1px 4px; border-radius:3px; pointer-events:none; z-index:6; white-space:nowrap; line-height:1.5; }

  /* Chip stack inside a block — below the block label */
  .tp-event-stack { position:absolute; top:3px; left:3px; right:3px; bottom:3px; display:flex; flex-direction:row; gap:2px; z-index:3; }
  .tp-event-stack--partial { bottom:auto; top:calc(3px + var(--stack-top, 0px)); height:var(--stack-h, auto); }
  .tp-block-free { position:absolute; left:6px; right:6px; bottom:3px; display:flex; align-items:center; justify-content:center; text-align:center; font-size:11px; color:var(--text-faint); white-space:nowrap; overflow:hidden; pointer-events:none; z-index:2; }
  .tp-block-free--lead { top:3px; bottom:auto; }
  .tp-block-durbadge { position:absolute; top:4px; right:4px; font-size:10px; font-weight:700; line-height:1.5; padding:0 4px; border-radius:3px; background:var(--interactive-accent); color:var(--text-on-accent, #fff); pointer-events:none; z-index:4; }
  .tp-block:hover .tp-block-free, .tp-block:hover .tp-block-durbadge { display:none; }
  .tp-event-stack .tp-chip { position:relative; inset:auto; flex:1; min-width:0; }

  /* Narrow-screen: overflow menu replaces action buttons */
  .tp-overflow-btn { display:none; }
  @container (max-width: 680px) {
    .tp-action-btn { display:none; }
    .tp-overflow-btn { display:inline-flex !important; }
    .tp-header { grid-template-columns:auto 1fr auto; gap:6px; padding:6px 10px; }
    .tp-nav { justify-content:center; }
    .tp-header-identity { min-width:0; overflow:hidden; }
    .tp-week-label { font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .tp-date-range { display:none; }
    .tp-axis-head-day { padding:5px 2px; }
    .tp-day-name { font-size:12px; }
    .tp-day-date { font-size:10px; }
    .tp-day-override-badge { font-size:9px; padding:1px 4px; }
  }
  @container (max-width: 480px) {
    .tp-axis { min-width:440px; }
    .tp-axis-head-gutter, .tp-axis-gutter { width:30px; }
    .tp-now-line--week { left:30px; }
    .tp-axis-hour { right:3px; font-size:9px; }
    .tp-day-name { font-size:11px; }
    .tp-day-date { font-size:10px; }
  }

  /* ── Mobile view modes ──────────────────────────────────────────────────── */
  .tp-mobile-modes { display:flex; gap:5px; padding:6px 12px; border-bottom:1px solid var(--background-modifier-border); background:var(--background-secondary); flex-shrink:0; }
  .tp-mode-btn { flex:1; padding:6px 0; font-size:13px; border:1px solid var(--background-modifier-border); border-radius:6px; background:var(--background-primary); color:var(--text-muted); cursor:pointer; font-family:var(--font-interface); }
  .tp-mode-btn--on { background:var(--interactive-accent); color:var(--text-on-accent); border-color:var(--interactive-accent); font-weight:600; }

  /* Day-selector strip */
  .tp-day-strip { display:flex; gap:5px; padding:8px 10px; border-bottom:1px solid var(--background-modifier-border); flex-shrink:0; }
  .tp-day-pill { flex:1; display:flex; flex-direction:column; align-items:center; gap:1px; padding:6px 0 5px; border:1px solid transparent; border-radius:9px; background:var(--background-secondary); color:var(--text-muted); cursor:pointer; min-width:0; }
  .tp-day-pill-dow { font-size:10px; text-transform:uppercase; letter-spacing:0.03em; }
  .tp-day-pill-num { font-size:15px; font-weight:600; color:var(--text-normal); }
  .tp-day-pill--today .tp-day-pill-num { color:var(--interactive-accent); }
  .tp-day-pill--sel { background:color-mix(in srgb,var(--interactive-accent) 18%,var(--background-secondary)); outline:1.5px solid var(--interactive-accent); }
  .tp-day-pill-dot { width:4px; height:4px; border-radius:50%; background:var(--interactive-accent); }

  /* Day mode: single full-width day, no sideways scroll, hide the redundant column header */
  .tp-week-view[data-tp-view="day"] .tp-axis { min-width:0; }
  .tp-week-view[data-tp-view="day"] .tp-axis-head { display:none; }

  /* ── Agenda (mobile week overview) ──────────────────────────────────────── */
  .tp-agenda { flex:1 1 0; overflow:auto; min-height:0; padding:8px 10px 16px; }
  .tp-agenda-day { margin-bottom:12px; }
  .tp-agenda-head { display:flex; align-items:center; gap:8px; font-size:13px; font-weight:700; color:var(--text-muted); padding:2px 2px 6px; position:sticky; top:0; background:var(--background-primary); z-index:2; }
  .tp-agenda-head--today { color:var(--interactive-accent); }
  .tp-agenda-dayname { text-transform:uppercase; letter-spacing:0.03em; }
  .tp-agenda-row { display:flex; align-items:center; gap:8px; width:100%; text-align:left; border:none; border-radius:0 7px 7px 0; padding:8px 10px; margin-bottom:5px; color:var(--text-normal); cursor:pointer; font-size:13px; font-family:var(--font-interface); }
  .tp-agenda-period { font-size:11px; color:var(--text-muted); min-width:64px; flex-shrink:0; }
  .tp-agenda-main { flex:1; min-width:0; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .tp-agenda-room { font-size:11px; font-style:italic; color:var(--text-muted); flex-shrink:0; }
  .tp-agenda-empty { font-size:12px; color:var(--text-faint); padding:2px 4px 6px; font-style:italic; }

</style>
