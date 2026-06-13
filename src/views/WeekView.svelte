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
  import { resolveColour, clearThemeColourCache, colourToCss } from "../utils/themeColours";
  import { periodAppliesTo, getPeriodsForDay } from "../utils/scheduleUtils";
  import {
    getSlotPlan, setSlotPlan, clearSlotPlan, getEventPlan, setEventPlan, clearEventPlan,
    migrateSlotPlanToEvent, bulkApplyPlan, undoBulkApply,
    getSlotExternal, setSlotExternal, clearSlotExternal,
    getEventExternal, setEventExternal, clearEventExternal, migrateSlotExternalToEvent,
    isSlotPrepared, isEventPrepared, toggleSlotPrepared, toggleEventPrepared, migrateSlotPreparedToEvent,
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
  $: abEnabled      = !!plugin.settings.academicYear.abWeekEnabled;
  $: abWeekType     = abEnabled
    ? getAbWeekType(currentDate, plugin.settings.academicYear.startDate, plugin.settings.academicYear.abWeekStartsOn)
    : null;
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
  $: _showUnplanned   = _dep(_tick, plugin.settings.showUnplannedDot ?? true);
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

  // Date events for the current week, keyed by "day:periodId" → array
  $: _dateEventMap = (() => {
    const m: Record<string, DateEvent[]> = {};
    const monday = currentMonday;
    for (const ev of _dateEvents) {
      const d = new Date(ev.date + "T12:00:00");
      const evMonday = getMondayOfWeek(d);
      if (evMonday.getTime() !== monday.getTime()) continue;
      const dayNum = d.getDay();
      const dayMap: Record<number, SchoolDay> = { 0:"sunday", 1:"monday", 2:"tuesday", 3:"wednesday", 4:"thursday", 5:"friday", 6:"saturday" };
      const day = dayMap[dayNum];
      if (!day) continue;
      const key = day + ":" + ev.periodId;
      if (!m[key]) m[key] = [];
      m[key].push(ev);
    }
    return m;
  })();

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

  // ── Time axis (Option B, Phase 2) ─────────────────────────────────────────
  const PX_PER_MIN = 1.8;
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

  function getDateEventLabel(ev: DateEvent) {
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
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }

  function onEventDragStart(e: DragEvent, ev: DateEvent) {
    dragEventId = ev.id;
    e.dataTransfer?.setData("text/plain", "event:" + ev.id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }

  function onCellDragOver(e: DragEvent, day: SchoolDay, periodId: string) {
    if (!dragSlotId && !dragEventId) return;
    e.preventDefault();
    if (isDropRejected(day, periodId)) {
      if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
      dragOverKey = null;
      return;
    }
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    dragOverKey = cellKey(day, periodId);
  }

  function onCellDragLeave(e: DragEvent) {
    const rel = e.relatedTarget as HTMLElement | null;
    if (!rel?.closest(".tp-td-cell")) dragOverKey = null;
  }

  async function onCellDrop(e: DragEvent, day: SchoolDay, periodId: string) {
    e.preventDefault();
    dragOverKey = null;

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
      ev.date     = dayDate;
      ev.periodId = periodId;
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

    // 1. Exclude the slot from its original cell on this specific date
    if (!plugin.settings.slotExclusions) plugin.settings.slotExclusions = [];
    const alreadyExcluded = plugin.settings.slotExclusions.some(
      ex => ex.slotId === slot.id && ex.date === sourceDate
    );
    if (!alreadyExcluded) {
      plugin.settings.slotExclusions.push({ slotId: slot.id, date: sourceDate });
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

    // 3. The lesson plan and external resource follow the moved lesson
    migrateSlotPlanToEvent(plugin.settings, slot.id, sourceDate, newEvId);
    migrateSlotExternalToEvent(plugin.settings, slot.id, sourceDate, newEvId);
    migrateSlotPreparedToEvent(plugin.settings, slot.id, sourceDate, newEvId);

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
          menu.addItem(i => i.setTitle("Apply plan to future lessons").setIcon("copy-plus").onClick(() => {
            const dry = bulkApplyPlan(plugin.settings, slot.classId, date, planPath, true);
            if (dry.count === 0) { new Notice("No future lessons of this item found."); return; }
            new ConfirmModal(plugin.app, `Link this plan to ${dry.count} future lesson${dry.count === 1 ? "" : "s"} of ${itemLabel} (until the end of the academic year)?`, async () => {
              const res = bulkApplyPlan(plugin.settings, slot.classId, date, planPath);
              plugin.settings.lastBulkApply = { path: planPath, entries: res.entries };
              await plugin.saveSettings();
              invalidate();
              showBulkUndoNotice(res.count);
            }, "Apply").open();
          }));
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
        if (plugin.settings.lastBulkApply) {
          menu.addItem(i => i.setTitle("Undo last bulk plan apply").setIcon("undo-2").onClick(() => doUndoBulkApply()));
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
              if (p) { setSlotExternal(plugin.settings, slot.id, date, p); await plugin.saveSettings(); invalidate(); }
            }));
            menu.addItem(i => i.setTitle("Link external folder…").setIcon("folder-open").onClick(async () => {
              const p = await openOSFolderPicker();
              if (p) { setSlotExternal(plugin.settings, slot.id, date, p); await plugin.saveSettings(); invalidate(); }
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
              if (p) { setEventExternal(plugin.settings, event.id, p); await plugin.saveSettings(); invalidate(); }
            }));
            menu.addItem(i => i.setTitle("Link external folder…").setIcon("folder-open").onClick(async () => {
              const p = await openOSFolderPicker();
              if (p) { setEventExternal(plugin.settings, event.id, p); await plugin.saveSettings(); invalidate(); }
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
      menu.addItem(i => i.setTitle("Change colour").setIcon("palette").onClick(() => changeColour(event.classId)));
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
      lbl.notes, lbl.classroom,
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
  import { onDestroy } from "svelte";
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
  $: canGoPrev = _dep(_tick, getMondayOfWeek(addWeeks(currentDate, -1)) >= _ayStart());
  $: canGoNext = _dep(_tick, getMondayOfWeek(addWeeks(currentDate,  1)) <= _ayEnd());

  // Sync sidebar notes to the current planner week whenever it changes
  $: (plugin as any).notifySidebar(currentMonday);

  // ── Navigation ────────────────────────────────────────────────────────────
  function onPrev()  { if (canGoPrev) currentDate = addWeeks(currentDate, -1); }
  function onNext()  { if (canGoNext) currentDate = addWeeks(currentDate, 1); }
  function onToday() {
    const t = new Date();
    const s = _ayStart(); const e = _ayEnd();
    currentDate = t < s ? s : t > e ? e : t;
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
    const body = plugin.settings.lessonNoteTemplate ?? LESSON_BODY_FALLBACK;
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



<div class="tp-week-view" data-tp-theme={plugin.settings.theme ?? "carbon"} data-tp-mode={plugin.settings.themeMode ?? "dark"}>

  <!-- ── Header ─────────────────────────────────────────────────────────── -->
  <header class="tp-header">
    <div class="tp-header-identity">
      <span class="tp-week-label">
        {weekLabel}
        {#if abEnabled && abWeekType}
          <span class="tp-week-ab-badge tp-week-ab-badge--{abWeekType.toLowerCase()}">Week {abWeekType}</span>
        {/if}
      </span>
      <span class="tp-date-range">{dateRange}</span>
    </div>
    <nav class="tp-nav" aria-label="Week navigation">
      <button class="tp-btn tp-nav-arrow" on:click={onPrev} aria-label="Previous week" disabled={!canGoPrev}>←</button>
      <button class="tp-btn tp-btn-accent tp-nav-today" on:click={onToday}>Go to today</button>
      <button class="tp-btn tp-nav-arrow" on:click={onNext} aria-label="Next week" disabled={!canGoNext}>→</button>
    </nav>
    <div class="tp-header-actions">
      <button class="tp-btn tp-action-btn" on:click={() => onAddEvent()} aria-label="Add event"><span use:obsIcon={"calendar-plus"} class="tp-btn-icon"></span>Event</button>
      <button class="tp-btn tp-action-btn" on:click={onOpenTimetable} aria-label="Edit timetable"><span use:obsIcon={"layout-grid"} class="tp-btn-icon"></span>Timetable</button>
      <button class="tp-btn tp-action-btn tp-action-btn--icon-only" on:click={onOpenSettings} aria-label="Settings" use:obsIcon={"settings"}></button>
      <button class="tp-btn tp-overflow-btn" on:click={showOverflowMenu} aria-label="More options" use:obsIcon={"more-horizontal"}></button>
    </div>
  </header>

  <!-- ── Time-axis week grid (each day column has its own schedule) ──────── -->
  <div class="tp-table-scroll">
    <div class="tp-axis" style="--grid-colour:{colourToCss(plugin.settings.gridLineColour, '#555')}; --grid-weight:{plugin.settings.gridLineWeight ?? 1}px; --block-colour:{colourToCss(plugin.settings.blockBorderColour, '#444')}; --block-weight:{plugin.settings.blockBorderWeight ?? 1}px;">

      <div class="tp-axis-head">
        <div class="tp-axis-head-gutter"></div>
        {#each DAYS as day}
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

      <div class="tp-axis-body">
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

        {#each DAYS as day}
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
                  {#if !slot && devEvents.length === 0}
                    <div class="tp-block-label">
                      <span class="tp-block-name">{period.name}</span>
                      <span class="tp-block-time">{period.start}–{period.end}</span>
                    </div>
                  {/if}

                  {#if slot || devEvents.length > 0}
                    <div class="tp-event-stack">
                      {#if slot}
                        {@const lbl = getSlotLabel(slot)}
                        {@const slotPlanPath = _slotPlanMap[slot.id + "|" + dayDate]}
                        {@const slotPrepared = _preparedSlotMap[slot.id + "|" + dayDate]}
                        <!-- svelte-ignore a11y-interactive-supports-focus -->
                        <div
                          class="tp-chip"
                          draggable="true"
                          role="button"
                          tabindex="0"
                          on:dragstart={(e) => onChipDragStart(e, slot)}
                          on:dragend={onDragEnd}
                          on:click={(e) => openChipMenu(e, "slot", dayDate, period.id, slot)}
                          on:keydown={(e) => { if (e.key === "Enter") e.currentTarget?.dispatchEvent(new MouseEvent("click", {bubbles:true})); }}
                          title="{period.name} · {period.start}–{period.end}"
                          style="--ctint:{hexToRgba(lbl.colour,0.22)}; background:{hexToRgba(lbl.colour,0.22)}; border-left:3px solid {lbl.colour};"
                        >
                          <span class="tp-chip-period-time">{period.name} · {period.start}–{period.end}</span>
                          <div class="tp-chip-body">
                            <span class="tp-chip-code">{lbl.code}</span>
                            {#if lbl.year || lbl.subjectName}
                              <span class="tp-chip-meta">{[lbl.year, lbl.subjectName].filter(Boolean).join(" · ")}</span>
                            {/if}
                            {#if lbl.notes}
                              <span class="tp-chip-notes">{lbl.notes}</span>
                            {/if}
                          </div>
                          <div class="tp-chip-footer">
                            {#if lbl.classroom}
                              <span class="tp-chip-room">{lbl.classroom}</span>
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
                              {:else if _showUnplanned && isClassId(slot.classId)}
                                <span class="tp-plan-mark tp-plan-mark--empty" title="No lesson plan linked"></span>
                              {/if}
                            </div>
                          </div>
                        </div>
                      {/if}
                      {#each devEvents as devEv (devEv.id)}
                        {@const lbl = getDateEventLabel(devEv)}
                        {@const evPlanPath = _eventPlanMap[devEv.id]}
                        {@const evPrepared = _preparedEventMap[devEv.id]}
                        <!-- svelte-ignore a11y-interactive-supports-focus -->
                        <div
                          class="tp-chip tp-chip--event"
                          role="button"
                          tabindex="0"
                          draggable="true"
                          on:dragstart={(e) => onEventDragStart(e, devEv)}
                          on:dragend={onDragEnd}
                          on:click={(e) => openChipMenu(e, "event", dayDate, period.id, undefined, devEv)}
                          on:keydown={(e) => { if (e.key === "Enter") e.currentTarget?.dispatchEvent(new MouseEvent("click", {bubbles:true})); }}
                          title="{period.name} · {period.start}–{period.end}"
                          style="--ctint:{hexToRgba(lbl.colour,0.22)}; border-left:3px solid {lbl.colour}; background:{hexToRgba(lbl.colour,0.22)};"
                        >
                          <span class="tp-chip-period-time">{period.name} · {period.start}–{period.end}</span>
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
                              {#if _showPrepared && isClassId(devEv.classId)}
                                <button class="tp-prep-tick" class:tp-prep-tick--on={evPrepared}
                                  title={evPrepared ? "Marked prepared — click to clear" : "Mark lesson prepared"}
                                  aria-label="Toggle lesson prepared" aria-pressed={evPrepared}
                                  on:click|stopPropagation={() => toggleEventPrep(devEv)} use:obsIcon={"check"}></button>
                              {/if}
                              {#if evPlanPath}
                                <button class="tp-plan-mark tp-plan-mark--linked" title="Open lesson plan" aria-label="Open lesson plan"
                                  on:click|stopPropagation={() => openPlan(evPlanPath)} use:obsIcon={"file-text"}></button>
                              {:else if _showUnplanned && isClassId(devEv.classId)}
                                <span class="tp-plan-mark tp-plan-mark--empty" title="No lesson plan linked"></span>
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
                      on:click={(e) => openEventPicker(e, dayDate, period.id)}
                    >＋ Event</button>
                  {/if}
                </div>
              {/each}
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </div>




</div>

<style>
  .tp-week-view { display:flex; flex-direction:column; flex:1; min-height:0; overflow:hidden; background:var(--background-primary); font-family:var(--font-interface); container-type:inline-size; }

  /* Header */
  .tp-header { display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:8px; padding:8px 16px; border-bottom:1px solid var(--background-modifier-border); flex-shrink:0; background:var(--background-secondary); }
  .tp-header-identity { display:flex; flex-direction:column; gap:1px; min-width:0; }
  .tp-week-label { font-size:15px; font-weight:700; color:var(--text-normal); line-height:1.2; }
  .tp-date-range { font-size:13px; color:var(--text-muted); }
  .tp-nav { display:flex; gap:4px; }
  .tp-nav-arrow { padding:4px 9px; font-size:15px; line-height:1; }
  .tp-nav-today { padding:4px 10px; font-size:12px; font-weight:600; letter-spacing:0.02em; }
  .tp-header-actions { display:flex; gap:6px; justify-content:flex-end; }

  .tp-week-ab-badge { display:inline-block; margin-left:6px; padding:1px 7px; border-radius:10px; font-size:12px; font-weight:700; vertical-align:middle; background:var(--interactive-accent); color:var(--text-on-accent); }
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
  .tp-block { position:absolute; left:4px; right:4px; border:1px solid var(--background-modifier-border); border-radius:4px; box-sizing:border-box; overflow:hidden; transition:background 0.1s; z-index:2; container-type:inline-size; container-name:block; }
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
  .tp-plan-mark--empty { border:1.5px solid var(--text-muted); border-radius:50%; opacity:0.5; }
  button.tp-plan-mark--linked { color:#43a047; opacity:1; cursor:pointer; }
  button.tp-plan-mark--linked:hover { opacity:0.7; }
  .tp-plan-mark :global(svg) { width:var(--mark-size); height:var(--mark-size); }
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
</style>
