<script lang="ts">
  import type TeacherPlannerPlugin from "../main";
  import type { TimetableSlot, SchoolPeriod, DateEvent, SchoolDay } from "../types";
  import { TFile, Menu, setIcon } from "obsidian";

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
  import { ColourPickerModal } from "../settings/SettingsTab";
  import { AddDateEventModal } from "../modals/AddDateEventModal";

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
  $: DAYS = (_tick, ALL_DAYS.filter(d =>
    (plugin.settings.schoolDays ?? ["monday","tuesday","wednesday","thursday","friday"]).includes(d.key)
  ));

  // ── Reactivity tick ───────────────────────────────────────────────────────
  let _tick = 0;
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
  $: _periods     = (_tick, plugin.settings.academicYear.periods);
  $: _periodTypes = (_tick, plugin.settings.periodTypes ?? []);
  $: _templates   = (_tick, plugin.settings.timetableTemplates ?? []);
  $: _classes     = (_tick, plugin.settings.classes ?? []);
  $: _subjects    = (_tick, plugin.settings.subjects ?? []);
  $: _activities  = (_tick, plugin.settings.activities ?? []);
  $: _dateEvents      = (_tick, plugin.settings.dateEvents ?? []);
  $: _slotExclusions  = (_tick, plugin.settings.slotExclusions ?? []);

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

  function rowHeight(period: SchoolPeriod): number {
    const mins = timeToMinutes(period.end) - timeToMinutes(period.start);
    return Math.max(64, mins * 1.8);
  }

  function getPeriodTypeColour(typeId: string): string {
    return _periodTypes.find(t => t.id === typeId)?.colour ?? "#888888";
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
    plugin.settings.dateEvents.push({
      id: "ev-" + Date.now(),
      date: targetDate,
      periodId,
      classId: slot.classId,
      ...(slot.notes    ? { notes: slot.notes }       : {}),
      ...(slot.classroom ? { classroom: slot.classroom } : {}),
    });

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
    const isClass = type === "slot"
      ? !!_classes.find(c => c.id === slot?.classId)
      : !!_classes.find(c => c.id === event?.classId);

    if (type === "slot" && slot) {
      menu.addItem(i => i.setTitle("Edit").setIcon("pencil").onClick(() => openNotesModal(slot, date, periodId)));
      if (isClass) menu.addItem(i => i.setTitle("Lesson note").setIcon("book-open").onClick(() => openOrCreateLessonNote(slot, date)));
      menu.addItem(i => i.setTitle("Add event").setIcon("calendar-plus").onClick(() => openEventPickerDirect(date, periodId)));
      menu.addSeparator();
      menu.addItem(i => i.setTitle("Change colour").setIcon("palette").onClick(() => changeColour(slot.classId)));
      menu.addItem(i => i.setTitle("Remove from timetable").setIcon("trash-2").onClick(() => removeSlot(slot.id)));
    } else if (type === "event" && event) {
      menu.addItem(i => i.setTitle("Edit").setIcon("pencil").onClick(() => onEditDateEvent(event)));
      if (isClass) menu.addItem(i => i.setTitle("Lesson note").setIcon("book-open").onClick(() => openOrCreateLessonNoteForEvent(event, date)));
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
  import { onDestroy } from "svelte";
  onDestroy(() => {
    clearInterval(_nowInterval);
    document.removeEventListener("visibilitychange", _onVisibilityChange);
  });

  // Returns the % position (0–100) of the current time within a period row,
  // or null if now is outside the period.
  function nowOffsetInPeriod(period: SchoolPeriod): number | null {
    const start = timeToMinutes(period.start);
    const end   = timeToMinutes(period.end);
    if (nowMinutes < start || nowMinutes > end) return null;
    return ((nowMinutes - start) / (end - start)) * 100;
  }

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
  $: canGoPrev = (_tick, getMondayOfWeek(addWeeks(currentDate, -1)) >= _ayStart());
  $: canGoNext = (_tick, getMondayOfWeek(addWeeks(currentDate,  1)) <= _ayEnd());

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

  // ── Lesson note linking ────────────────────────────────────────────────────
  async function openOrCreateLessonNote(slot: TimetableSlot, dayDate: string) {
    const lbl = getSlotLabel(slot);
    const folder = plugin.settings.plannerFolder || "Teacher Planner";
    const safeName = lbl.code.replace(/[\\/:*?"<>|]/g, "-");
    const fileName = `${dayDate} ${safeName}`;
    const filePath = `${folder}/${fileName}.md`;

    const existing = plugin.app.vault.getAbstractFileByPath(filePath);
    if (existing instanceof TFile) {
      plugin.app.workspace.openLinkText(filePath, "", false);
      return;
    }

    // Count existing lesson notes for this class to compute lesson number
    const cls = _classes.find(c => c.id === slot.classId);
    const lessonNum = (cls?.lessonCount ?? 0) + 1;
    if (cls) { cls.lessonCount = lessonNum; await plugin.saveSettings(); }

    const template = plugin.settings.lessonNoteTemplate ?? "## Notes:\n---\n\n## Homework set:\n---\n\n## Next lesson:\n---\n";

    // Ensure folder exists
    const folderObj = plugin.app.vault.getAbstractFileByPath(folder);
    if (!folderObj) {
      try { await plugin.app.vault.createFolder(folder); } catch {}
    }

    try {
      await plugin.app.vault.create(filePath, template);
      plugin.app.workspace.openLinkText(filePath, "", false);
    } catch (err) {
      console.error("Lesson note error:", err);
    }
  }

  // ── Lesson note from date event ──────────────────────────────────────────
  async function openOrCreateLessonNoteForEvent(ev: DateEvent, dayDate: string) {
    const cls = _classes.find(c => c.id === ev.classId);
    if (!cls) return; // activities don't get lesson notes
    const folder = plugin.settings.plannerFolder || "Teacher Planner";
    const safeName = cls.code.replace(/[\\/:*?"<>|]/g, "-");
    const filePath = `${folder}/${dayDate} ${safeName}.md`;

    const existing = plugin.app.vault.getAbstractFileByPath(filePath);
    if (existing instanceof TFile) {
      plugin.app.workspace.openLinkText(filePath, "", false);
      return;
    }

    const lessonNum = (cls.lessonCount ?? 0) + 1;
    cls.lessonCount = lessonNum;
    await plugin.saveSettings();

    const template = plugin.settings.lessonNoteTemplate ?? "## Notes:\n---\n\n## Homework set:\n---\n\n## Next lesson:\n---\n";

    const folderObj = plugin.app.vault.getAbstractFileByPath(folder);
    if (!folderObj) { try { await plugin.app.vault.createFolder(folder); } catch {} }

    try {
      await plugin.app.vault.create(filePath, template);
      plugin.app.workspace.openLinkText(filePath, "", false);
    } catch (err) { console.error("Lesson note error:", err); }
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

  <!-- ── Timetable table ────────────────────────────────────────────────── -->
  <div class="tp-table-scroll">
    <table class="tp-grid" style="--grid-colour:{plugin.settings.gridLineColour ?? '#555'}; --grid-weight:{plugin.settings.gridLineWeight ?? 1}px; --block-colour:{plugin.settings.blockBorderColour ?? '#444'}; --block-weight:{plugin.settings.blockBorderWeight ?? 1}px;">
      <colgroup>
        <col class="tp-col-time" />
        <col class="tp-col-period" />
        {#each DAYS as _d}<col />{/each}
      </colgroup>
      <thead>
        <tr class="tp-head-row">
          <th class="tp-th-time">Time</th>
          <th class="tp-th-period">Period</th>
          {#each DAYS as day}
            {@const dayOverride = dayOverrideMap[day.key]}
            <th class="tp-th-day"
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
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>

        <!-- Regular period rows -->
        {#each _periods as period (period.id)}
          {@const tc = getPeriodTypeColour(period.type)}
          {@const rh = rowHeight(period)}
          {@const nowOffset = isCurrentWeek ? nowOffsetInPeriod(period) : null}
          <tr class="tp-period-row" style="--rh:{rh}px; border-top:var(--block-weight) solid var(--block-colour); border-bottom:var(--block-weight) solid var(--block-colour);">
            <td class="tp-td-time" style="position:relative;">
              {period.start}
              {#if nowOffset !== null}
                <div class="tp-now-badge" style="top:{nowOffset}%;">{currentTimeStr}</div>
              {/if}
            </td>
            <td class="tp-td-period" style="background:{hexToRgba(tc,0.28)}; border-left:3px solid {tc};">
              <div class="tp-period-inner">
                <span class="tp-period-name">{period.name}</span>
                <span class="tp-period-time">{period.start} - {period.end}</span>
              </div>
            </td>
            {#each DAYS as day}
              {@const dayDate    = dayISODate(day.offset, currentMonday)}
              {@const dayOverride = dayOverrideMap[day.key]}
              {@const _rawSlot   = _slotMap[day.key + ":" + period.id]}
              {@const slot       = _rawSlot && !isSlotExcluded(_rawSlot.id, dayDate) && !dayOverride ? _rawSlot : undefined}
              {@const devEvents  = dayOverride ? [] : (_dateEventMap[day.key + ":" + period.id] ?? [])}
              {@const key        = cellKey(day.key, period.id)}
              {@const isOver     = dragOverKey === key && !slot}
              {@const isReject   = rejectKey   === key}
              <td
                class="tp-td-cell"
                class:tp-td-cell--today={isToday(day.offset, currentMonday)}
                class:tp-td-cell--holiday={dayOverride === "holiday"}
                class:tp-td-cell--inset={dayOverride === "inset"}
                class:tp-td-cell--dragover={isOver}
                class:tp-td-cell--reject={isReject}
                style="background:{hexToRgba(tc, 0.07)};"
                on:dragover={(e) => onCellDragOver(e, day.key, period.id)}
                on:dragleave={onCellDragLeave}
                on:drop={(e) => onCellDrop(e, day.key, period.id)}
              >
                <!-- All chips in one stack — slot first, then date events as equal columns -->
                {#if slot || devEvents.length > 0}
                  <div class="tp-event-stack">
                    {#if slot}
                      {@const lbl = getSlotLabel(slot)}
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
                        style="background:{hexToRgba(lbl.colour,0.22)}; border-left:3px solid {lbl.colour};"
                      >
                        <span class="tp-chip-code">{lbl.code}</span>
                        {#if lbl.year || lbl.subjectName}
                          <span class="tp-chip-meta">{[lbl.year, lbl.subjectName].filter(Boolean).join(" · ")}</span>
                        {/if}
                        {#if lbl.classroom}
                          <span class="tp-chip-room">{lbl.classroom}</span>
                        {/if}
                        {#if lbl.notes}
                          <span class="tp-chip-notes">{lbl.notes}</span>
                        {/if}
                      </div>
                    {/if}
                    {#each devEvents as devEv (devEv.id)}
                      {@const lbl = getDateEventLabel(devEv)}
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
                        style="border-left:3px solid {lbl.colour}; background:{hexToRgba(lbl.colour,0.22)};"
                      >
                        <span class="tp-chip-code">{lbl.code}</span>
                        {#if lbl.meta}
                          <span class="tp-chip-meta">{lbl.meta}</span>
                        {/if}
                        {#if lbl.classroom}
                          <span class="tp-chip-room">{lbl.classroom}</span>
                        {/if}
                        {#if lbl.notes}<span class="tp-chip-notes">{lbl.notes}</span>{/if}
                      </div>
                    {/each}
                  </div>
                {/if}

                <!-- Add event button (empty non-holiday cells only) -->
                {#if !slot && devEvents.length === 0 && !dayOverride}
                  <button
                    class="tp-cell-add-event"
                    title="Add one-off event to this slot"
                    on:click={(e) => openEventPicker(e, dayDate, period.id)}
                  >＋ Event</button>
                {/if}

                <!-- Current time indicator line -->
                {#if nowOffset !== null}
                  <div class="tp-now-line" style="top:{nowOffset}%;"></div>
                {/if}
              </td>
            {/each}
          </tr>
        {/each}

      </tbody>
    </table>
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
  /* Icon sizing inside buttons */
  .tp-btn :global(svg), .tp-btn-icon :global(svg) { width:14px; height:14px; flex-shrink:0; }
  /* Icon-only button (Settings) */
  .tp-action-btn--icon-only { padding:5px 8px; }
  .tp-action-btn--icon-only :global(svg) { width:15px; height:15px; }
  .tp-overflow-btn { display:none; }

  /* Table scroll */
  .tp-table-scroll { flex:1 1 0; overflow:auto; min-height:0; }

  /* Table */
  .tp-grid { width:100%; border-collapse:collapse; table-layout:fixed; align-self:start; }
  .tp-col-time   { width:48px; }
  .tp-col-period { width:95px; }

  /* Header row */
  .tp-head-row { position:sticky; top:0; z-index:10; background:var(--background-secondary); }
  .tp-th-time, .tp-th-period, .tp-th-day { padding:8px 6px; font-size:12px; font-weight:600; color:var(--text-muted); text-align:center; border:var(--grid-weight,1px) solid var(--grid-colour,var(--background-modifier-border)); border-top:none; white-space:nowrap; background:var(--background-secondary); }
  .tp-th-time   { text-align:left; padding-left:8px; }
  .tp-th-period { text-align:left; padding-left:10px; }
  .tp-th-day--today   { color:var(--interactive-accent); }
  .tp-th-day--holiday { background:color-mix(in srgb,var(--color-yellow,#f9e2af) 14%,var(--background-secondary)) !important; color:var(--color-yellow,#d4a017) !important; }
  .tp-th-day--inset   { background:color-mix(in srgb,var(--interactive-accent) 10%,var(--background-secondary)) !important; color:var(--interactive-accent) !important; }
  /* Day header — single flex row: label left, icon right */
  .tp-th-day { text-align:left !important; }
  .tp-th-day-inner { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; }
  .tp-day-label { display:flex; flex-direction:column; align-items:center; gap:1px; min-width:0; }
  .tp-day-name { font-size:13px; font-weight:700; white-space:nowrap; }
  .tp-day-date { font-size:11px; color:var(--text-normal); opacity:0.85; white-space:nowrap; }
  .tp-day-override-badge { font-size:10px; font-weight:700; padding:1px 6px; border-radius:3px; white-space:nowrap; letter-spacing:0.03em; text-transform:uppercase; }
  .tp-day-override-badge--holiday { background:var(--color-yellow,#f59e0b); color:#1a1a1a; }
  .tp-day-override-badge--inset   { background:var(--interactive-accent); color:var(--text-on-accent,#fff); }

  /* Time cell */
  .tp-td-time { padding:4px 6px 0 8px; font-size:11px; color:var(--text-muted); vertical-align:top; white-space:nowrap; border:var(--grid-weight,1px) solid var(--grid-colour,var(--background-modifier-border)); background:var(--background-secondary); height:var(--rh,64px); max-height:var(--rh,64px); overflow:hidden; box-sizing:border-box; }

  /* Period label cell */
  .tp-td-period { padding:0; vertical-align:top; border:var(--grid-weight,1px) solid var(--grid-colour,var(--background-modifier-border)); height:var(--rh,64px); max-height:var(--rh,64px); overflow:hidden; box-sizing:border-box; }
  .tp-period-inner { display:flex; flex-direction:column; justify-content:flex-start; gap:2px; height:100%; padding:5px 8px; box-sizing:border-box; }
  .tp-period-name { font-size:13px; font-weight:700; color:var(--text-normal); line-height:1.2; }
  .tp-period-time { font-size:11px; color:var(--text-muted); line-height:1.2; white-space:nowrap; }

  /* Day cells */
  .tp-td-cell { position:relative; padding:3px; border:var(--grid-weight,1px) solid var(--grid-colour,var(--background-modifier-border)); vertical-align:top; transition:background 0.1s; overflow:hidden; height:var(--rh,64px); max-height:var(--rh,64px); box-sizing:border-box; }
  /* today column shading removed — only the header date text is accented */
  .tp-td-cell--holiday  { background:color-mix(in srgb,var(--color-yellow,#f9e2af) 8%,transparent) !important; }
  .tp-td-cell--inset    { background:color-mix(in srgb,var(--interactive-accent) 6%,transparent) !important; }
  .tp-td-cell--dragover { background:color-mix(in srgb,var(--interactive-accent) 20%,transparent) !important; outline:2px dashed var(--interactive-accent); outline-offset:-2px; }
  .tp-td-cell--reject   { background:color-mix(in srgb,var(--color-red,#f38ba8) 28%,transparent) !important; transition:background 0s; }

  /* Lesson chip */
  .tp-chip { position:absolute; inset:3px; border-radius:4px; padding:4px 6px; display:flex; flex-direction:column; gap:2px; cursor:pointer; overflow:hidden; user-select:none; transition:filter 0.1s; box-sizing:border-box; color:var(--text-normal); container-type:size; container-name:chip; }
  .tp-chip:hover { filter:brightness(1.08); }
  .tp-chip-code  { font-size:15px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex-shrink:0; }
  .tp-chip-meta  { font-size:13px; color:var(--text-normal); opacity:0.82; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex-shrink:0; }
  .tp-chip-room  { font-size:12px; color:var(--text-normal); opacity:0.75; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex-shrink:0; font-style:italic; }
  .tp-chip-notes { font-size:12px; color:var(--text-normal); opacity:0.75; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; line-height:1.3; flex-shrink:1; }

  /* Compact chip: hide meta + notes; start scaling fonts down */
  @container chip (max-height: 58px) {
    .tp-chip-meta,
    .tp-chip-notes { display: none; }
    .tp-chip-code  { font-size: 13px; }
    .tp-chip-room  { font-size: 11px; }
  }
  /* Tight: shrink further so both code + room still fit */
  @container chip (max-height: 44px) {
    .tp-chip-code { font-size: 12px; }
    .tp-chip-room { font-size: 10px; }
  }
  /* Very compact: hide room, show code only at minimum readable size */
  @container chip (max-height: 34px) {
    .tp-chip-room { display: none; }
    .tp-chip-code { font-size: 11px; }
  }
  /* Narrow chip (multiple side-by-side events): scale fonts by width too */
  @container chip (max-width: 90px) {
    .tp-chip-code { font-size: 13px; }
    .tp-chip-room { font-size: 10px; }
  }
  @container chip (max-width: 60px) {
    .tp-chip-code { font-size: 11px; }
    .tp-chip-room { font-size: 9px; }
  }

  /* Current time indicator */
  .tp-now-line { position:absolute; left:0; right:0; height:0; border-top:2px dashed var(--interactive-accent); opacity:0.9; pointer-events:none; z-index:5; }
  .tp-now-badge { position:absolute; right:2px; transform:translateY(-50%); background:var(--interactive-accent); color:var(--text-on-accent,#fff); font-size:9px; font-weight:700; padding:1px 4px; border-radius:3px; pointer-events:none; z-index:6; white-space:nowrap; line-height:1.5; }

  /* Event column stack (multiple date events — equal-width columns) */
  .tp-event-stack { position:absolute; inset:3px; display:flex; flex-direction:row; gap:2px; z-index:3; }
  .tp-event-stack .tp-chip { position:relative; inset:auto; flex:1; min-width:0; }

  /* Narrow-screen: overflow menu replaces action buttons; columns rotate */
  .tp-overflow-btn { display:none; }
  @container (max-width: 680px) {
    .tp-action-btn { display:none; }
    .tp-overflow-btn { display:inline-flex !important; }
    /* Switch to auto/1fr/auto so the nav fills centre and identity only takes what it needs */
    .tp-header { grid-template-columns:auto 1fr auto; gap:6px; padding:6px 10px; }
    .tp-nav { justify-content:center; }
    .tp-header-identity { min-width:0; overflow:hidden; }
    .tp-week-label { font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .tp-date-range { display:none; }
    /* Stack day name above date so narrow columns do not bleed */
    .tp-th-day { padding:5px 2px; }
    .tp-th-day-inner { flex-direction:column; align-items:center; justify-content:center; gap:1px; }
    .tp-day-label { flex-direction:column; align-items:center; gap:1px; }
    .tp-day-name { font-size:12px; }
    .tp-day-date { font-size:10px; }
    .tp-day-override-badge { font-size:9px; padding:1px 4px; }
  }
  @container (max-width: 480px) {
    .tp-col-time   { width:28px; }
    .tp-col-period { width:42px; }
    .tp-th-time   { writing-mode:vertical-rl; transform:rotate(180deg); text-align:center; padding:4px 2px; white-space:nowrap; vertical-align:middle; }
    .tp-th-period { writing-mode:vertical-rl; transform:rotate(180deg); text-align:center; padding:4px 2px; white-space:nowrap; vertical-align:middle; }
    .tp-td-time { writing-mode:vertical-rl; transform:rotate(180deg); text-align:center; padding:4px 2px; white-space:normal; vertical-align:middle; }
    .tp-period-inner { writing-mode:vertical-rl; transform:rotate(180deg); align-items:center; padding:4px 2px; }
    .tp-period-name { white-space:nowrap; }
    .tp-period-time { white-space:nowrap; }
    .tp-day-name { font-size:11px; }
    .tp-day-date { font-size:10px; }
  }
</style>
