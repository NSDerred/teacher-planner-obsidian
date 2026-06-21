<script lang="ts">
  import type TeacherPlannerPlugin from "../main";
  import type { TimetableEditorModal } from "./TimetableEditorModal";
  import type { TimetableSlot, SchoolPeriod, TimetableTemplate, SchoolDay } from "../types";
  import { AddTimetableTemplateModal } from "./AddTimetableTemplateModal";
  import { setIcon } from "obsidian";
  import { ConfirmModal } from "../settings/SettingsTab";
  import { resolveColour } from "../utils/themeColours";
  import { periodAppliesTo, periodLengthMinutes, getPeriodsForDay } from "../utils/scheduleUtils";

  function icon(node: HTMLElement, name: string) {
    setIcon(node, name);
    return { update(n: string) { node.empty(); setIcon(node, n); } };
  }

  export let plugin: TeacherPlannerPlugin;
  export let modal: TimetableEditorModal;

  const ALL_DAYS: { key: SchoolDay; label: string }[] = [
    { key: "monday",    label: "Mon" },
    { key: "tuesday",   label: "Tue" },
    { key: "wednesday", label: "Wed" },
    { key: "thursday",  label: "Thu" },
    { key: "friday",    label: "Fri" },
    { key: "saturday",  label: "Sat" },
    { key: "sunday",    label: "Sun" },
  ];
  $: DAYS = _dep(_tick, ALL_DAYS.filter(d =>
    (plugin.settings.schoolDays ?? ["monday","tuesday","wednesday","thursday","friday"]).includes(d.key)
  ));

  // ── Template management ────────────────────────────────────────────────────
  let _tick = 0;
  /** Registers a reactive dependency on `_t` and returns `value` (TS-clean alternative to the comma idiom). */
  function _dep<T>(_t: unknown, value: T): T { return value; }
  function invalidate() { _tick++; }

  $: allTemplates  = _dep(_tick, plugin.settings.timetableTemplates ?? []);
  $: classes       = plugin.settings.classes ?? [];
  $: subjects      = plugin.settings.subjects ?? [];
  $: activities    = plugin.settings.activities ?? [];
  $: abEnabled     = plugin.settings.academicYear.abWeekEnabled;
  $: periods       = plugin.settings.academicYear.periods;

  // ── Directed time ──────────────────────────────────────────────────────────
  $: directedTimeEnabled = plugin.settings.directedTime?.enabled ?? false;

  const tMin = (t: string): number => { const [h, m] = (t || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
  const mTime = (n: number): string => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

  function getSlotDuration(slot: TimetableSlot): number {
    if (slot.durationMinutes) return slot.durationMinutes;
    return periodLengthMinutes(plugin.settings.academicYear, slot.periodId);
  }
  /** True when this slot has a manual duration that differs from its block length. */
  function isDurationOverride(slot: TimetableSlot): boolean {
    return slot.durationMinutes != null && slot.durationMinutes !== periodLengthMinutes(plugin.settings.academicYear, slot.periodId);
  }


  function slotStartOf(slot: TimetableSlot, period: SchoolPeriod): string { return slot.start || period.start; }
  function isCustomStart(slot: TimetableSlot, period: SchoolPeriod): boolean { return !!slot.start && slot.start !== period.start; }
  function isCustomised(slot: TimetableSlot, period: SchoolPeriod): boolean { return isDurationOverride(slot) || isCustomStart(slot, period); }

  /** Set a slot's start time within its period; shrinks the length to fit the block (Phase 1: single block). */
  function commitSlotStart(slot: TimetableSlot, period: SchoolPeriod, val: string) {
    if (!val) return;
    const ps = tMin(period.start), pe = tMin(period.end);
    const sv = Math.max(ps, Math.min(tMin(val), pe - 1));
    let dur = getSlotDuration(slot);
    if (sv + dur > pe) dur = pe - sv;
    slot.start = sv === ps ? period.start : mTime(sv);
    slot.durationMinutes = dur;
    slot.end = mTime(sv + dur);
    slots = [...slots];
    markDirty();
  }

  /** Set a slot's length, clamped to the time remaining in its period from its start. */
  function commitSlotLength(slot: TimetableSlot, period: SchoolPeriod, val: string) {
    let d = parseInt(val); if (isNaN(d)) return;
    const ss = tMin(slotStartOf(slot, period)), pe = tMin(period.end);
    d = Math.max(1, Math.min(d, pe - ss));
    slot.durationMinutes = d;
    slot.end = mTime(ss + d);
    slots = [...slots];
    markDirty();
  }

  function commitSlotRoom(slot: TimetableSlot, val: string) {
    slot.classroom = val.trim() || undefined;
    slots = [...slots];
    markDirty();
  }
  function defaultRoomOf(slot: TimetableSlot): string {
    const cls = classes.find(c => c.id === slot.classId);
    if (cls) return cls.classroom ?? "";
    return activities.find(a => a.id === slot.classId)?.classroom ?? "";
  }
  /** Resolve the drafted Start/Length/Room into slot fields for a new assignment. */
  function draftFields(period: SchoolPeriod): { start: string; end: string; durationMinutes?: number; classroom?: string } {
    const ps = tMin(period.start), pe = tMin(period.end);
    let start = period.start;
    if (draftStart) { const sv = Math.max(ps, Math.min(tMin(draftStart), pe - 1)); start = sv === ps ? period.start : mTime(sv); }
    const ss = tMin(start);
    let durationMinutes: number | undefined;
    if (draftLen) { const d = parseInt(draftLen); if (!isNaN(d)) durationMinutes = Math.max(1, Math.min(d, pe - ss)); }
    const end = mTime(ss + (durationMinutes ?? (pe - ss)));
    return { start, end, durationMinutes, classroom: draftRoom.trim() || undefined };
  }

  // Default to the most-recently-starting template.
  // NOTE: must read plugin.settings directly here — $: reactive vars aren't
  // assigned yet when let initialisers run in Svelte 4.
  const _initTmpls = plugin.settings.timetableTemplates ?? [];
  const _initTmpl  = _initTmpls[_initTmpls.length - 1] ?? _initTmpls[0];
  let activeTemplateId: string = _initTmpl?.id ?? "";
  $: activeTemplate = allTemplates.find(t => t.id === activeTemplateId) ?? allTemplates[0];

  // Local editable copy of slots
  let slots: TimetableSlot[] = JSON.parse(JSON.stringify(_initTmpl?.slots ?? []));

  function doSwitchTemplate(id: string) {
    activeTemplateId = id;
    const tmpl = (plugin.settings.timetableTemplates ?? []).find(t => t.id === id);
    slots = JSON.parse(JSON.stringify(tmpl?.slots ?? []));
    activeWeek = plugin.settings.academicYear.abWeekEnabled ? "A" : null;
    closePicker();
    showPastConfirm = false;
    isDirty = false;
  }

  function switchTemplate(id: string) {
    if (id === activeTemplateId) return;
    if (isDirty) {
      pendingSwitchId = id;
      unsavedAction = "switch";
      showUnsavedConfirm = true;
      return;
    }
    doSwitchTemplate(id);
  }

  // ── Template edit warning ─────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  $: isPast = activeTemplate ? activeTemplate.endDate < today : false;
  let showPastConfirm = false;
  let warnCollapsed = false;

  // Reset warning state when switching templates
  $: if (activeTemplateId) { showPastConfirm = false; warnCollapsed = false; }

  // ── Template rename ────────────────────────────────────────────────────────
  let renamingId: string | null = null;
  let renameValue = "";

  function startRename(tmpl: TimetableTemplate) {
    renamingId = tmpl.id;
    renameValue = tmpl.name;
  }

  async function commitRename() {
    const tmpl = allTemplates.find(t => t.id === renamingId);
    if (tmpl && renameValue.trim()) {
      tmpl.name = renameValue.trim();
      await plugin.saveSettings();
    }
    renamingId = null;
  }

  // ── Archive toggle ─────────────────────────────────────────────────────────
  let showArchived = false;
  $: visibleClasses    = showArchived ? classes    : classes.filter(c => !c.archived);
  $: visibleActivities = showArchived ? activities : activities.filter(a => !a.archived);
  $: visibleDirected   = visibleActivities.filter(a => a.activityType !== "other");
  $: visibleOther      = visibleActivities.filter(a => a.activityType === "other");
  $: archivedCount = classes.filter(c => !!c.archived).length
                   + activities.filter(a => !!a.archived).length;

  async function toggleArchiveClass(id: string) {
    const cls = classes.find(c => c.id === id);
    if (cls) { cls.archived = !cls.archived; await plugin.saveSettings(); }
  }
  async function toggleArchiveActivity(id: string) {
    const act = activities.find(a => a.id === id);
    if (act) { act.archived = !act.archived; await plugin.saveSettings(); }
  }

  // ── A/B week tabs ──────────────────────────────────────────────────────────
  let activeWeek: "A" | "B" | null = plugin.settings.academicYear.abWeekEnabled ? "A" : null;
  $: currentWeek = abEnabled ? activeWeek : null;

  // Reactive slot grid — explicitly reads `slots` so Svelte re-renders when
  // slots is replaced (e.g. on template switch/discard). Without this, Svelte
  // cannot see the dependency because getSlot reads slots inside a function body.
  $: _slotGrid = (() => {
    const _s   = slots;       // explicit dependency: invalidates when slots reassigned
    const _w   = currentWeek; // explicit dependency: invalidates on A/B switch
    const _ab  = abEnabled;
    const m: Record<string, TimetableSlot | undefined> = {};
    for (const d of DAYS) {
      for (const p of periods) {
        if (!_ab || !_w) {
          m[d.key + ":" + p.id] = _s.find(s => s.day === d.key && s.periodId === p.id);
        } else {
          m[d.key + ":" + p.id] = _s.find(s =>
            s.day === d.key && s.periodId === p.id &&
            (s.weekType === _w || s.weekType === "both" || s.weekType == null)
          );
        }
      }
    }
    return m;
  })();

  // ── Unsaved changes ────────────────────────────────────────────────────────
  let isDirty = false;
  let showUnsavedConfirm = false;
  let pendingSwitchId: string | null = null;
  let unsavedAction: "switch" | "close" = "close";

  function markDirty() { isDirty = true; }

  async function saveWithoutClose() {
    const tmpl = plugin.settings.timetableTemplates?.find(t => t.id === activeTemplateId);
    if (tmpl) { tmpl.slots = slots; await plugin.saveSettings(); }
    isDirty = false;
  }

  async function confirmUnsaved_save() {
    showUnsavedConfirm = false;
    if (unsavedAction === "switch" && pendingSwitchId) {
      await saveWithoutClose();
      doSwitchTemplate(pendingSwitchId);
      pendingSwitchId = null;
    } else {
      await save(true);
    }
  }

  function confirmUnsaved_discard() {
    showUnsavedConfirm = false;
    isDirty = false;
    if (unsavedAction === "switch" && pendingSwitchId) {
      doSwitchTemplate(pendingSwitchId);
      pendingSwitchId = null;
    } else {
      modal.close();
    }
  }

  function confirmUnsaved_cancel() {
    showUnsavedConfirm = false;
    pendingSwitchId = null;
  }

  function onCancel() {
    if (isDirty) {
      unsavedAction = "close";
      showUnsavedConfirm = true;
      return;
    }
    modal.close();
  }

  // ── Picker state ───────────────────────────────────────────────────────────
  let pickerDay:      string | null = null;
  let pickerPeriodId: string | null = null;
  let pickerWeek:     "A" | "B" | null = null;
  let pickerEl:       HTMLElement | null = null;
  let pickerSearch:   string = "";
  // Draft Start/Length/Room while adding to an empty block (applied when a class is picked)
  let draftStart = "";
  let draftLen = "";
  let draftRoom = "";

  function focusPicker(node: HTMLElement) { setTimeout(() => node.focus(), 30); }

  function getSlot(day: string, periodId: string, week: "A" | "B" | null): TimetableSlot | undefined {
    if (!abEnabled || !week) return slots.find(s => s.day === day && s.periodId === periodId);
    return slots.find(s =>
      s.day === day && s.periodId === periodId &&
      (s.weekType === week || s.weekType === "both" || s.weekType == null)
    );
  }

  // Currently-assigned item id for the open picker cell (for the selected-row highlight)
  $: pickerCurId = (pickerDay && pickerPeriodId)
    ? getSlot(pickerDay, pickerPeriodId, currentWeek)?.classId
    : undefined;
  $: pickerSlot = (pickerDay && pickerPeriodId) ? getSlot(pickerDay, pickerPeriodId, currentWeek) : undefined;
  $: pickerPeriod = pickerPeriodId ? periods.find(p => p.id === pickerPeriodId) : undefined;

  function getLabel(slot: TimetableSlot) {
    const cls = classes.find(c => c.id === slot.classId);
    if (cls) {
      const subj = subjects.find(s => s.id === cls.subjectId);
      return { code: cls.code, sub: subj?.name ?? "", colour: cls.colour, classroom: slot.classroom ?? cls.classroom ?? "" };
    }
    const act = activities.find(a => a.id === slot.classId);
    if (act) return { code: act.label, sub: act.info ?? "", colour: act.colour, classroom: slot.classroom ?? act.classroom ?? "" };
    return { code: "?", sub: "", colour: "#888", classroom: "" };
  }

  function openPicker(day: string, periodId: string, week: "A" | "B" | null, el: HTMLElement) {
    if (pickerDay === day && pickerPeriodId === periodId && pickerWeek === week) {
      closePicker(); return;
    }
    pickerDay = day; pickerPeriodId = periodId; pickerWeek = week; pickerEl = el;
    draftStart = ""; draftLen = ""; draftRoom = "";
  }

  function closePicker() {
    pickerDay = null; pickerPeriodId = null; pickerWeek = null; pickerEl = null;
    pickerSearch = "";
  }

  function assignItem(day: string, period: SchoolPeriod, itemId: string, week: "A" | "B" | null) {
    if (abEnabled && week) {
      const exact = slots.find(s => s.day === day && s.periodId === period.id && s.weekType === week);
      if (exact) { exact.classId = itemId; slots = [...slots]; }
      else {
        const _df = draftFields(period);
        slots = [...slots, {
          id: "slot-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
          day: day as any, periodId: period.id, classId: itemId,
          start: _df.start, end: _df.end, weekType: week,
          ...(_df.durationMinutes != null ? { durationMinutes: _df.durationMinutes } : {}),
          ...(_df.classroom ? { classroom: _df.classroom } : {}),
        }];
      }
    } else {
      const exact = slots.find(s => s.day === day && s.periodId === period.id);
      if (exact) { exact.classId = itemId; slots = [...slots]; }
      else {
        const _df = draftFields(period);
        slots = [...slots, {
          id: "slot-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
          day: day as any, periodId: period.id, classId: itemId,
          start: _df.start, end: _df.end,
          ...(_df.durationMinutes != null ? { durationMinutes: _df.durationMinutes } : {}),
          ...(_df.classroom ? { classroom: _df.classroom } : {}),
        }];
      }
    }
    markDirty();
    closePicker();
  }

  function clearSlot(day: string, periodId: string, week: "A" | "B" | null) {
    if (abEnabled && week) {
      slots = slots.filter(s => !(s.day === day && s.periodId === periodId && (s.weekType === week || s.weekType == null)));
    } else {
      slots = slots.filter(s => !(s.day === day && s.periodId === periodId));
    }
    markDirty();
  }

  // ── Drag-and-drop (move / Ctrl-copy), mirroring the week planner ───────────
  let dragFromKey: string | null = null;   // "day:periodId" of the chip being dragged
  let dragOverKey: string | null = null;   // cell currently hovered as a drop target
  let rejectKey:   string | null = null;   // cell flashing the invalid-drop style
  let rejectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Flash the invalid-drop style on a cell for 600 ms. */
  function flashReject(key: string) {
    if (rejectTimer) clearTimeout(rejectTimer);
    rejectKey = key;
    rejectTimer = setTimeout(() => { rejectKey = null; rejectTimer = null; }, 600);
  }

  function onChipDragStart(e: DragEvent, day: string, periodId: string) {
    dragFromKey = day + ":" + periodId;
    if (e.dataTransfer) {
      e.dataTransfer.setData("text/plain", dragFromKey);
      e.dataTransfer.effectAllowed = "copyMove";
    }
  }

  function onCellDragOver(e: DragEvent, day: SchoolDay, periodId: string) {
    if (!dragFromKey) return;
    // Periods not in this day's schedule can't accept a drop.
    if (!periodAppliesTo(plugin.settings.academicYear, periodId, day)) {
      if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
      dragOverKey = null;
      return;
    }
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = (e.ctrlKey || e.metaKey) ? "copy" : "move";
    dragOverKey = day + ":" + periodId;
  }

  function onCellDragLeave(e: DragEvent) {
    const rel = e.relatedTarget as HTMLElement | null;
    if (!rel?.closest(".tp-te-blk")) dragOverKey = null;
  }

  function onCellDrop(e: DragEvent, day: SchoolDay, period: SchoolPeriod) {
    e.preventDefault();
    dragOverKey = null;
    const from = dragFromKey;
    dragFromKey = null;
    if (!from) return;
    const toKey = day + ":" + period.id;
    if (from === toKey) return;

    // Reject drops onto periods outside this day's schedule.
    if (!periodAppliesTo(plugin.settings.academicYear, period.id, day)) {
      flashReject(toKey);
      return;
    }

    const [fromDay, fromPeriodId] = from.split(":");
    const w = currentWeek;
    const source = getSlot(fromDay, fromPeriodId, w);
    if (!source) return;
    const target = getSlot(day, period.id, w);
    const copy = e.ctrlKey || e.metaKey;

    if (copy) {
      // Copy: drop a clone of the source class into the target, overwriting any class there.
      if (target) {
        target.classId = source.classId;
        if (source.durationMinutes != null) target.durationMinutes = source.durationMinutes;
        else delete target.durationMinutes;
      } else {
        slots = [...slots, {
          id: "slot-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
          day: day as any, periodId: period.id, classId: source.classId,
          start: period.start, end: period.end,
          ...(w ? { weekType: w } : {}),
          ...(source.durationMinutes != null ? { durationMinutes: source.durationMinutes } : {}),
        }];
      }
    } else if (target) {
      // Move onto an occupied cell → swap the two classes (and any duration overrides).
      const sClass = source.classId, sDur = source.durationMinutes;
      source.classId = target.classId; source.durationMinutes = target.durationMinutes;
      target.classId = sClass; target.durationMinutes = sDur;
    } else {
      // Move onto an empty cell → relocate the source slot (its weekType is preserved).
      source.day = day as any;
      source.periodId = period.id;
      source.start = period.start;
      source.end = period.end;
    }
    slots = [...slots];
    markDirty();
  }

  function onChipDragEnd() { dragFromKey = null; dragOverKey = null; }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function save(force = false) {
    if (isPast && !force) {
      showPastConfirm = true;
      return;
    }
    const tmpl = plugin.settings.timetableTemplates?.find(t => t.id === activeTemplateId);
    if (tmpl) {
      tmpl.slots = slots;
      await plugin.saveSettings();
    }
    isDirty = false;
    modal.close();
  }

  async function confirmPastSave() {
    showPastConfirm = false;
    await save(true);
  }

  // ── Add template ───────────────────────────────────────────────────────────
  function openAddTemplate() {
    new AddTimetableTemplateModal(plugin.app, plugin, (newId: string) => {
      invalidate();
      activeTemplateId = newId;
      const tmpl = plugin.settings.timetableTemplates?.find(t => t.id === newId);
      slots = JSON.parse(JSON.stringify(tmpl?.slots ?? []));
      activeWeek = plugin.settings.academicYear.abWeekEnabled ? "A" : null;
      isDirty = false;
    }).open();
  }

  // ── Delete template ────────────────────────────────────────────────────────
  function deleteTemplate() {
    if (allTemplates.length <= 1) return;
    new ConfirmModal(plugin.app, `Delete "${activeTemplate?.name}"? This cannot be undone.`, async () => {
      plugin.settings.timetableTemplates = allTemplates.filter(t => t.id !== activeTemplateId);
      await plugin.saveSettings();
      const remaining = plugin.settings.timetableTemplates;
      activeTemplateId = remaining[remaining.length - 1]?.id ?? "";
      const tmpl = remaining.find(t => t.id === activeTemplateId);
      slots = JSON.parse(JSON.stringify(tmpl?.slots ?? []));
    }, "Delete").open();
  }

  // ── Picker positioning ─────────────────────────────────────────────────────
  function getPickerStyle(el: HTMLElement | null): string {
    if (!el) return "display:none";
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const pickerH = 320;
    if (spaceBelow >= pickerH || spaceBelow > rect.top) {
      return "top:" + (rect.bottom + 4) + "px; left:" + rect.left + "px;";
    }
    return "bottom:" + (window.innerHeight - rect.top + 4) + "px; left:" + rect.left + "px;";
  }

  function fmtDate(dateStr: string): string {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  $: sortedSubjects    = [...subjects].sort((a, b) => a.name.localeCompare(b.name));

  // ── Picker search filters ───────────────────────────────────────────────────
  $: pickerFilteredClasses = (() => {
    const q = pickerSearch.toLowerCase();
    if (!q) return visibleClasses;
    return visibleClasses.filter(c => {
      const subj = subjects.find(s => s.id === c.subjectId);
      return c.code.toLowerCase().includes(q)
        || (subj?.name ?? "").toLowerCase().includes(q)
        || (c.year ?? "").toLowerCase().includes(q)
        || (c.classroom ?? "").toLowerCase().includes(q);
    });
  })();
  $: pickerFilteredDirected = pickerSearch
    ? visibleDirected.filter(a => a.label.toLowerCase().includes(pickerSearch.toLowerCase()))
    : visibleDirected;
  $: pickerFilteredOther = pickerSearch
    ? visibleOther.filter(a => a.label.toLowerCase().includes(pickerSearch.toLowerCase()))
    : visibleOther;

  // ── Period type colours ────────────────────────────────────────────────────
  $: periodTypes = plugin.settings.periodTypes ?? [];

  function getPeriodTypeColour(typeId: string): string {
    return resolveColour(periodTypes.find(t => t.id === typeId)?.colour ?? "#888888");
  }

  // ── Time-axis layout (each day column shows its own schedule's blocks) ──────
  const TE_PX = 1.7; // pixels per minute
  function getDayPeriods(day: SchoolDay): SchoolPeriod[] { return getPeriodsForDay(plugin.settings.academicYear, day); }
  $: _axisStart = periods.length ? Math.min(...periods.map(p => tMin(p.start))) : 8 * 60;
  $: _axisEnd   = periods.length ? Math.max(...periods.map(p => tMin(p.end)))   : 16 * 60;
  $: axisHeight = Math.max(40, (_axisEnd - _axisStart) * TE_PX);
  $: hourMarks  = (() => { const out: number[] = []; for (let h = Math.ceil(_axisStart / 60); h <= Math.floor((_axisEnd - 1) / 60); h++) out.push(h * 60); return out; })();
  function fmtAxis(min: number): string { return `${String(Math.floor(min / 60)).padStart(2, "0")}:00`; }

  function hexToRgba(hex: string, alpha: number): string {
    const clean = hex.replace("#", "");
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(128,128,128,${alpha})`;
    return `rgba(${r},${g},${b},${alpha})`;
  }
</script>

<svelte:window
  on:keydown={(e) => e.key === "Escape" && (renamingId ? renamingId = null : closePicker())}
  on:mousedown={(e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (pickerEl && !t?.closest(".tp-te-picker") && !t?.closest(".tp-te-blk")) closePicker();
    if (renamingId && !t?.closest(".tp-te-rename-input")) commitRename();
  }}
/>

<div class="tp-te-wrap">

  <!-- ── Template bar ──────────────────────────────────────────────────────── -->
  <div class="tp-te-tmpl-bar">
    <div class="tp-te-tmpl-tabs">
      {#each allTemplates as tmpl (tmpl.id)}
        <div class="tp-te-tmpl-tab-wrap">
          {#if renamingId === tmpl.id}
            <!-- svelte-ignore a11y-autofocus -->
            <input
              class="tp-te-rename-input"
              autofocus
              bind:value={renameValue}
              on:keydown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") renamingId = null; }}
            />
          {:else}
            <button
              class="tp-te-tmpl-tab"
              class:tp-te-tmpl-tab--active={tmpl.id === activeTemplateId}
              class:tp-te-tmpl-tab--past={tmpl.endDate < today}
              on:click={() => switchTemplate(tmpl.id)}
            >
              <span class="tp-te-tmpl-name">{tmpl.name}</span>
              <span class="tp-te-tmpl-dates">{fmtDate(tmpl.startDate)} – {fmtDate(tmpl.endDate)}</span>
            </button>
            {#if tmpl.id === activeTemplateId}
              <!-- svelte-ignore a11y-no-static-element-interactions -->
              <button class="tp-te-tmpl-rename-btn" title="Rename" on:click={() => startRename(tmpl)} use:icon={"pencil"}></button>
            {/if}
          {/if}
        </div>
      {/each}
    </div>
    <div class="tp-te-tmpl-actions">
      <button class="tp-te-tmpl-add-btn" on:click={openAddTemplate}>+ New Template</button>
      {#if allTemplates.length > 1}
        <button class="tp-te-tmpl-del-btn" title="Delete this template" on:click={deleteTemplate} use:icon={"trash-2"}></button>
      {/if}
    </div>
  </div>

  <!-- ── Template edit warning ────────────────────────────────────────────── -->
  {#if activeTemplate}
    {#if warnCollapsed}
      <div class="tp-te-edit-warn tp-te-edit-warn--collapsed">
        <span class="tp-te-edit-warn-pill">⚠️ Warning hidden</span>
        <button class="tp-te-edit-warn-show-btn" on:click={() => warnCollapsed = false}>Show</button>
      </div>
    {:else if showPastConfirm}
      <div class="tp-te-edit-warn tp-te-edit-warn--confirm">
        <span>⚠️ This template ended {fmtDate(activeTemplate.endDate)}. Saving will change historical records. Continue?</span>
        <div class="tp-te-edit-warn-actions">
          <button class="tp-te-past-confirm-btn" on:click={confirmPastSave}>Yes, save anyway</button>
          <button class="tp-te-past-cancel-btn" on:click={() => showPastConfirm = false}>Cancel</button>
        </div>
      </div>
    {:else}
      <div class="tp-te-edit-warn">
        <div class="tp-te-edit-warn-body">
          <span class="tp-te-edit-warn-icon">⚠️</span>
          <div class="tp-te-edit-warn-text">
            {#if isPast}
              <strong>This template ended {fmtDate(activeTemplate.endDate)}.</strong>{" "}
            {/if}
            Editing this template affects your directed time records for all weeks it covers. If your timetable has changed, create a new template from the date of the change to keep records accurate.
          </div>
        </div>
        <div class="tp-te-edit-warn-actions">
          <button class="tp-te-past-cancel-btn" title="Dismiss warning" on:click={() => warnCollapsed = true}>Dismiss</button>
        </div>
      </div>
    {/if}
  {/if}

  <!-- ── A/B week tabs ──────────────────────────────────────────────────────── -->
  {#if abEnabled}
    <div class="tp-te-week-tabs">
      <button
        class="tp-te-week-tab"
        class:tp-te-week-tab--active={activeWeek === "A"}
        on:click={() => { activeWeek = "A"; closePicker(); }}
      >Week A</button>
      <button
        class="tp-te-week-tab tp-te-week-tab--b"
        class:tp-te-week-tab--active={activeWeek === "B"}
        on:click={() => { activeWeek = "B"; closePicker(); }}
      >Week B</button>
    </div>
  {/if}

  <!-- ── Timetable grid ─────────────────────────────────────────────────────── -->
  <div class="tp-te-grid-wrap" style="--te-days:{DAYS.length}">
    <div class="tp-te-axis">
      <div class="tp-te-axis-head">
        <div class="tp-te-axis-gutter-head"></div>
        {#each DAYS as day}
          <div class="tp-te-axis-day-head">{day.label}</div>
        {/each}
      </div>
      <div class="tp-te-axis-body">
        <div class="tp-te-axis-gutter" style="height:{axisHeight}px;">
          {#each hourMarks as hm}
            <div class="tp-te-axis-hour" style="top:{(hm - _axisStart) * TE_PX}px;">{fmtAxis(hm)}</div>
          {/each}
        </div>
        {#each DAYS as day}
          <div class="tp-te-axis-col" style="height:{axisHeight}px;">
            {#each getDayPeriods(day.key) as period (period.id)}
              {@const tc      = getPeriodTypeColour(period.type)}
              {@const _bt     = (tMin(period.start) - _axisStart) * TE_PX}
              {@const _bh     = Math.max(22, (tMin(period.end) - tMin(period.start)) * TE_PX)}
              {@const slot    = _slotGrid[day.key + ":" + period.id]}
              {@const cellKey = day.key + ":" + period.id}
              <!-- svelte-ignore a11y-no-static-element-interactions -->
              <div
                class="tp-te-blk"
                class:tp-te-blk--dragover={dragOverKey === cellKey}
                class:tp-te-blk--reject={rejectKey === cellKey}
                style="top:{_bt}px; height:{_bh}px; background:{hexToRgba(tc, 0.08)}; border-left:3px solid {hexToRgba(tc, 0.55)};"
                on:dragover={(e) => onCellDragOver(e, day.key, period.id)}
                on:dragleave={onCellDragLeave}
                on:drop={(e) => onCellDrop(e, day.key, period)}
              >
                {#if slot}
                  {@const lbl = getLabel(slot)}
                  <button
                    class="tp-te-chip"
                    style="border-left: 3px solid {lbl.colour}; background: {lbl.colour}22;"
                    title="{lbl.code}{lbl.classroom ? ' · ' + lbl.classroom : ''}"
                    draggable="true"
                    on:dragstart={(e) => onChipDragStart(e, day.key, period.id)}
                    on:dragend={onChipDragEnd}
                    on:click={(e) => openPicker(day.key, period.id, currentWeek, e.currentTarget)}
                  >
                    <span class="tp-te-chip-time">{period.name} · {period.start}–{period.end}</span>
                    <span class="tp-te-chip-code" style="color:{lbl.colour}">{lbl.code}</span>
                    {#if lbl.sub || lbl.classroom}
                      <span class="tp-te-chip-sub">{[lbl.sub, lbl.classroom].filter(Boolean).join(" · ")}</span>
                    {/if}
                  </button>
                  {#if isCustomised(slot, period)}
                    <span class="tp-te-cust" title="Custom start / length — click to edit">{slotStartOf(slot, period)} · {getSlotDuration(slot)}m</span>
                  {/if}
                {:else}
                  <button
                    class="tp-te-blk-label"
                    on:click={(e) => openPicker(day.key, period.id, currentWeek, e.currentTarget)}
                  >
                    <span class="tp-te-blk-name">{period.name}</span>
                    <span class="tp-te-blk-time" class:tp-te-blk-time--hide={_bh < 44}>{period.start}–{period.end}</span>
                    <span class="tp-te-blk-add">+ assign</span>
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        {/each}
      </div>
    </div>
  </div>

  <!-- ── Floating picker ───────────────────────────────────────────────────── -->
  {#if pickerDay && pickerPeriodId && pickerEl}
    <div class="tp-te-picker" style={getPickerStyle(pickerEl)}>
      <div class="tp-te-picker-inner">
        <!-- svelte-ignore a11y-autofocus -->
        <input
          class="tp-te-picker-search"
          type="text"
          placeholder="Search…"
          bind:value={pickerSearch}
          use:focusPicker
          on:click|stopPropagation
        />

        {#if pickerPeriod}
          {@const _pp = pickerPeriod}
          {#if pickerSlot}
            {@const _ps = pickerSlot}
            <div class="tp-te-detail">
              <div class="tp-te-detail-grid">
                <label class="tp-te-detail-field">
                  <span class="tp-te-detail-label">Start</span>
                  <input type="time" value={slotStartOf(_ps, _pp)}
                    on:click|stopPropagation
                    on:change={(e) => commitSlotStart(_ps, _pp, e.currentTarget.value)} />
                </label>
                <label class="tp-te-detail-field">
                  <span class="tp-te-detail-label">Length</span>
                  <input type="number" min="1" max="480" value={getSlotDuration(_ps)}
                    on:click|stopPropagation
                    on:change={(e) => commitSlotLength(_ps, _pp, e.currentTarget.value)} />
                </label>
              </div>
              <label class="tp-te-detail-field">
                <span class="tp-te-detail-label">Room</span>
                <input type="text" placeholder={defaultRoomOf(_ps)} value={_ps.classroom ?? ""}
                  on:click|stopPropagation
                  on:change={(e) => commitSlotRoom(_ps, e.currentTarget.value)} />
              </label>
            </div>
          {:else}
            <div class="tp-te-detail">
              <div class="tp-te-detail-grid">
                <label class="tp-te-detail-field">
                  <span class="tp-te-detail-label">Start</span>
                  <input type="time" value={draftStart || _pp.start}
                    on:click|stopPropagation
                    on:change={(e) => draftStart = e.currentTarget.value} />
                </label>
                <label class="tp-te-detail-field">
                  <span class="tp-te-detail-label">Length</span>
                  <input type="number" min="1" max="480" value={draftLen || (tMin(_pp.end) - tMin(_pp.start))}
                    on:click|stopPropagation
                    on:change={(e) => draftLen = e.currentTarget.value} />
                </label>
              </div>
              <label class="tp-te-detail-field">
                <span class="tp-te-detail-label">Room</span>
                <input type="text" placeholder="Room" value={draftRoom}
                  on:click|stopPropagation
                  on:change={(e) => draftRoom = e.currentTarget.value} />
              </label>
            </div>
          {/if}
          <div class="tp-te-picker-divider"></div>
        {/if}

        {#if getSlot(pickerDay, pickerPeriodId, currentWeek)}
          <button
            class="tp-te-picker-clear"
            on:click={() => { if (pickerDay && pickerPeriodId) clearSlot(pickerDay, pickerPeriodId, currentWeek); closePicker(); }}
          ><span use:icon={"x"}></span> Remove</button>
          <div class="tp-te-picker-divider"></div>
        {/if}

        {#if sortedSubjects.some(s => pickerFilteredClasses.some(c => c.subjectId === s.id))}
          <div class="tp-te-picker-group-label">Classes</div>
          {#each sortedSubjects as subj}
            {@const subjClasses = pickerFilteredClasses.filter(c => c.subjectId === subj.id).sort((a,b) => a.code.localeCompare(b.code))}
            {#each subjClasses as cls}
              {@const secondary = [cls.year, subj.name].filter(Boolean).join(" · ")}
              <div class="tp-te-picker-row">
                <button
                  class="tp-te-picker-item"
                  class:tp-te-picker-item--active={cls.id === pickerCurId}
                  style="border-left: 3px solid {cls.colour};"
                  on:click={() => { const p = periods.find(p => p.id === pickerPeriodId); if (p && pickerDay) { assignItem(pickerDay, p, cls.id, currentWeek); } }}
                >
                  {#if subj.emoji}<span class="tp-te-picker-emoji">{subj.emoji}</span>{/if}
                  <span class="tp-te-picker-item-text">
                    <span class="tp-te-picker-code">{cls.code}</span>
                    {#if secondary}<span class="tp-te-picker-room">{secondary}</span>{/if}
                  </span>
                </button>
                <button class="tp-te-archive-btn" title="Archive class" on:click|stopPropagation={() => toggleArchiveClass(cls.id)} use:icon={"archive"}></button>
              </div>
            {/each}
          {/each}
        {/if}

        {#if pickerFilteredDirected.length}
          <div class="tp-te-picker-divider"></div>
          <div class="tp-te-picker-group-label">Directed time</div>
          {#each pickerFilteredDirected as act}
            <div class="tp-te-picker-row">
              <button
                class="tp-te-picker-item"
                class:tp-te-picker-item--active={act.id === pickerCurId}
                style="border-left: 3px solid {act.colour};"
                on:click={() => { const p = periods.find(p => p.id === pickerPeriodId); if (p && pickerDay) { assignItem(pickerDay, p, act.id, currentWeek); } }}
              >
                <span class="tp-te-picker-item-text">
                  <span class="tp-te-picker-code">{act.label}</span>
                  {#if act.classroom}<span class="tp-te-picker-room">{act.classroom}</span>{/if}
                </span>
              </button>
              <button class="tp-te-archive-btn" title="Archive activity" on:click|stopPropagation={() => toggleArchiveActivity(act.id)} use:icon={"archive"}></button>
            </div>
          {/each}
        {/if}

        {#if pickerFilteredOther.length}
          <div class="tp-te-picker-divider"></div>
          <div class="tp-te-picker-group-label">Other events</div>
          {#each pickerFilteredOther as act}
            <div class="tp-te-picker-row">
              <button
                class="tp-te-picker-item"
                class:tp-te-picker-item--active={act.id === pickerCurId}
                style="border-left: 3px solid {act.colour};"
                on:click={() => { const p = periods.find(p => p.id === pickerPeriodId); if (p && pickerDay) { assignItem(pickerDay, p, act.id, currentWeek); } }}
              >
                <span class="tp-te-picker-item-text">
                  <span class="tp-te-picker-code">{act.label}</span>
                  {#if act.classroom}<span class="tp-te-picker-room">{act.classroom}</span>{/if}
                </span>
              </button>
              <button class="tp-te-archive-btn" title="Archive activity" on:click|stopPropagation={() => toggleArchiveActivity(act.id)} use:icon={"archive"}></button>
            </div>
          {/each}
        {/if}

        {#if archivedCount > 0}
          <div class="tp-te-picker-divider"></div>
          <button
            class="tp-te-show-archived-btn"
            on:click={() => showArchived = !showArchived}
          >{showArchived ? "Hide archived" : `Show archived (${archivedCount})`}</button>
          {#if showArchived}
            {#each classes.filter(c => c.archived) as cls}
              <div class="tp-te-picker-row tp-te-picker-row--archived">
                <span class="tp-te-picker-item tp-te-picker-item--archived"
                  style="border-left: 3px solid {cls.colour}; opacity:0.5;">
                  <span class="tp-te-picker-item-text">
                    <span class="tp-te-picker-code">{cls.code}</span>
                  </span>
                </span>
                <button class="tp-te-archive-btn" title="Restore" on:click={() => toggleArchiveClass(cls.id)} use:icon={"rotate-ccw"}></button>
              </div>
            {/each}
            {#each activities.filter(a => a.archived) as act}
              <div class="tp-te-picker-row tp-te-picker-row--archived">
                <span class="tp-te-picker-item tp-te-picker-item--archived"
                  style="border-left: 3px solid {act.colour}; opacity:0.5;">
                  <span class="tp-te-picker-item-text">
                    <span class="tp-te-picker-code">{act.label}</span>
                  </span>
                </span>
                <button class="tp-te-archive-btn" title="Restore" on:click={() => toggleArchiveActivity(act.id)} use:icon={"rotate-ccw"}></button>
              </div>
            {/each}
          {/if}
        {/if}
      </div>
    </div>
  {/if}

  <!-- ── Unsaved changes dialog ───────────────────────────────────────────── -->
  {#if showUnsavedConfirm}
    <div class="tp-te-unsaved-overlay">
      <div class="tp-te-unsaved-dialog">
        <p class="tp-te-unsaved-msg">You have unsaved changes. What would you like to do?</p>
        <div class="tp-te-unsaved-actions">
          <button class="tp-te-btn tp-te-btn-primary" on:click={confirmUnsaved_save}>Save</button>
          <button class="tp-te-btn tp-te-btn-danger" on:click={confirmUnsaved_discard}>Discard</button>
          <button class="tp-te-btn" on:click={confirmUnsaved_cancel}>Keep editing</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- ── Footer ────────────────────────────────────────────────────────────── -->
  <div class="tp-te-footer">
    <button class="tp-te-btn" on:click={onCancel}>Cancel</button>
    <button class="tp-te-btn tp-te-btn-primary" on:click={() => void save()}>Save Timetable</button>
  </div>
</div>

<style>
  .tp-te-wrap { display: flex; flex-direction: column; width: 100%; box-sizing: border-box; flex: 1 1 auto; min-height: 0; overflow: visible; font-size: 14px; position: relative; }

  /* ── Template bar ─────────────────────────────────────────────────────────── */
  .tp-te-tmpl-bar { display: flex; align-items: flex-start; gap: 8px; padding: 8px 48px 12px 0; flex-shrink: 0; flex-wrap: wrap; }
  .tp-te-tmpl-tabs { display: flex; gap: 4px; flex-wrap: wrap; flex: 1; min-width: 0; }
  .tp-te-tmpl-tab-wrap { display: flex; align-items: center; gap: 2px; }
  .tp-te-tmpl-tab { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; padding: 10px 16px 11px; min-height: 54px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 13px; cursor: pointer; transition: all 0.15s; text-align: left; }
  .tp-te-tmpl-tab--active { background: var(--interactive-accent); color: var(--text-on-accent); border-color: var(--interactive-accent); }
  .tp-te-tmpl-tab--past:not(.tp-te-tmpl-tab--active) { opacity: 0.65; }
  .tp-te-tmpl-name { font-weight: 600; line-height: 1.2; }
  .tp-te-tmpl-dates { font-size: 11px; opacity: 0.75; line-height: 1.2; margin-top: 1px; }
  .tp-te-tmpl-rename-btn { background: transparent; border: none; cursor: pointer; font-size: 13px; padding: 2px 4px; opacity: 0.6; transition: opacity 0.1s; display: inline-flex; align-items: center; }
  .tp-te-tmpl-rename-btn:hover { opacity: 1; }
  .tp-te-tmpl-rename-btn :global(svg) { width: 13px; height: 13px; }
  .tp-te-rename-input { font-size: 13px; font-weight: 600; padding: 4px 8px; border: 1px solid var(--interactive-accent); border-radius: 6px; background: var(--background-primary); color: var(--text-normal); width: 140px; }
  .tp-te-tmpl-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .tp-te-tmpl-add-btn { padding: 10px 16px; border-radius: 6px; border: 1.5px dashed var(--interactive-accent); background: transparent; color: var(--interactive-accent); font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.15s; white-space: nowrap; }
  .tp-te-tmpl-add-btn:hover { background: color-mix(in srgb, var(--interactive-accent) 10%, transparent); }
  .tp-te-tmpl-del-btn { background: transparent; border: none; cursor: pointer; font-size: 16px; padding: 4px; opacity: 0.5; transition: opacity 0.1s; display: inline-flex; align-items: center; }
  .tp-te-tmpl-del-btn:hover { opacity: 1; }
  .tp-te-tmpl-del-btn :global(svg) { width: 15px; height: 15px; }

  /* ── Template edit warning ───────────────────────────────────────────────── */
  .tp-te-edit-warn { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 10px 12px; margin-bottom: 12px; background: color-mix(in srgb, var(--color-yellow, #f59e0b) 12%, transparent); border: 1px solid var(--color-yellow, #f59e0b); border-radius: 6px; font-size: 13px; color: var(--text-normal); flex-shrink: 0; }
  .tp-te-edit-warn--collapsed { align-items: center; padding: 6px 12px; }
  .tp-te-edit-warn--confirm { align-items: center; }
  .tp-te-edit-warn-body { display: flex; align-items: flex-start; gap: 8px; flex: 1; min-width: 0; }
  .tp-te-edit-warn-icon { flex-shrink: 0; }
  .tp-te-edit-warn-text { line-height: 1.5; }
  .tp-te-edit-warn-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-top: 2px; }
  .tp-te-edit-warn-pill { color: var(--text-muted); font-size: 12px; }
  .tp-te-edit-warn-show-btn { padding: 3px 10px; border-radius: 4px; border: 1px solid var(--background-modifier-border); background: transparent; color: var(--text-normal); font-size: 12px; cursor: pointer; }
  .tp-te-past-confirm-btn { padding: 4px 12px; border-radius: 4px; border: none; background: var(--color-red, #f38ba8); color: #fff; font-size: 12px; cursor: pointer; }
  .tp-te-past-cancel-btn { padding: 4px 12px; border-radius: 4px; border: 1px solid var(--background-modifier-border); background: transparent; color: var(--text-normal); font-size: 12px; cursor: pointer; }

  /* ── Week tabs ────────────────────────────────────────────────────────────── */
  .tp-te-week-tabs { display: flex; gap: 6px; margin-bottom: 14px; flex-shrink: 0; }
  .tp-te-week-tab { padding: 6px 20px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
  .tp-te-week-tab--active { background: var(--interactive-accent); color: var(--text-on-accent); border-color: var(--interactive-accent); }

  /* ── Grid ─────────────────────────────────────────────────────────────────── */
  .tp-te-grid-wrap { overflow: auto; min-height: 0; flex: 1 1 auto; border: 1px solid var(--background-modifier-border); border-radius: 8px; }
  .tp-te-axis { min-width: 640px; }
  .tp-te-axis-head { display: grid; grid-template-columns: 52px repeat(var(--te-days, 5), minmax(0, 1fr)); position: sticky; top: 0; z-index: 3; background: var(--background-secondary); border-bottom: 1px solid var(--background-modifier-border); }
  .tp-te-axis-day-head { padding: 8px 4px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); text-align: center; border-left: 1px solid var(--background-modifier-border); }
  .tp-te-axis-body { display: grid; grid-template-columns: 52px repeat(var(--te-days, 5), minmax(0, 1fr)); position: relative; }
  .tp-te-axis-gutter { position: relative; }
  .tp-te-axis-hour { position: absolute; left: 4px; font-size: 10px; color: var(--text-faint); transform: translateY(-50%); white-space: nowrap; }
  .tp-te-axis-col { position: relative; border-left: 1px solid var(--background-modifier-border); }
  .tp-te-blk { position: absolute; left: 3px; right: 3px; border-radius: 5px; box-sizing: border-box; overflow: hidden; }
  .tp-te-blk--dragover { outline: 2px solid var(--interactive-accent); outline-offset: -2px; background: color-mix(in srgb, var(--interactive-accent) 18%, transparent) !important; }
  .tp-te-blk--reject { outline: 2px solid var(--color-red, #f38ba8); outline-offset: -2px; }
  .tp-te-blk-label { width: 100%; height: 100%; border: 1.5px dashed transparent; border-radius: 5px; background: transparent; cursor: pointer; padding: 3px 6px; text-align: left; display: flex; flex-direction: column; justify-content: center; gap: 1px; color: var(--text-muted); overflow: hidden; box-sizing: border-box; }
  .tp-te-blk-label:hover { border-color: var(--interactive-accent); background: var(--background-modifier-hover); }
  .tp-te-blk-name { font-size: 11px; font-weight: 600; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tp-te-blk-time { font-size: 10px; color: var(--text-faint); }
  .tp-te-blk-time--hide { display: none; }
  .tp-te-blk:hover .tp-te-blk-time--hide { display: block; }
  .tp-te-blk-add { font-size: 10px; color: var(--text-faint); opacity: 0; transition: opacity 0.1s; }
  .tp-te-blk-label:hover .tp-te-blk-add { opacity: 1; color: var(--interactive-accent); }
  .tp-te-blk:hover { height: auto !important; min-height: 58px; z-index: 20; box-shadow: 0 2px 10px rgba(0,0,0,0.28); }
  .tp-te-blk:hover .tp-te-chip, .tp-te-blk:hover .tp-te-blk-label { height: auto; }
  .tp-te-chip-time { display: none; font-size: 10px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tp-te-blk:hover .tp-te-chip-time { display: block; }
  .tp-te-chip { width: 100%; height: 100%; border-radius: 6px; border: none; cursor: pointer; padding: 4px 6px; text-align: left; display: flex; flex-direction: column; justify-content: center; gap: 1px; overflow: hidden; transition: filter 0.1s; }
  .tp-te-chip:hover { filter: brightness(1.1); }
  .tp-te-chip-code { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tp-te-chip-sub { font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* ── Start-time + length: quiet badge (Option B) + inline editor (Option C) ──── */
  .tp-te-cust { position: absolute; top: 3px; right: 4px; font-size: 10px; font-weight: 600; background: var(--interactive-accent); color: var(--text-on-accent, #fff); border-radius: 3px; padding: 1px 5px; line-height: 1.4; pointer-events: none; z-index: 1; }
  .tp-te-detail { padding: 2px 2px 4px; }
  .tp-te-detail-grid { display: flex; gap: 6px; margin-bottom: 6px; }
  .tp-te-detail-field { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .tp-te-detail-label { font-size: 10px; color: var(--text-muted); }
  .tp-te-detail input { width: 100%; box-sizing: border-box; font-size: 12px; padding: 3px 6px; border: 1px solid var(--background-modifier-border); border-radius: 5px; background: var(--background-secondary); color: var(--text-normal); }
  .tp-te-detail input:focus { border-color: var(--interactive-accent); outline: none; }

  /* ── Picker ───────────────────────────────────────────────────────────────── */
  .tp-te-picker { position: fixed; z-index: 1000; width: 240px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,0.3); overflow: hidden; }
  .tp-te-picker-inner { max-height: 360px; overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 2px; }
  .tp-te-picker-search { width: 100%; box-sizing: border-box; padding: 6px 10px; margin-bottom: 2px; border: 1px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-secondary); color: var(--text-normal); font-size: 13px; outline: none; flex-shrink: 0; }
  .tp-te-picker-search:focus { border-color: var(--interactive-accent); }
  .tp-te-picker-group-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-faint); padding: 4px 8px 2px; }
  .tp-te-picker-divider { height: 1px; background: var(--background-modifier-border); margin: 4px 0; }
  .tp-te-picker-row { display: flex; align-items: center; gap: 2px; }
  .tp-te-picker-item { flex: 1; display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 6px; border: none; background: transparent; cursor: pointer; text-align: left; width: 100%; transition: background 0.1s; min-width: 0; }
  .tp-te-picker-item:hover { background: var(--background-modifier-hover); }
  .tp-te-picker-item--active { background: color-mix(in srgb, var(--interactive-accent) 16%, transparent); }
  .tp-te-picker-item--active:hover { background: color-mix(in srgb, var(--interactive-accent) 24%, transparent); }
  .tp-te-picker-emoji { font-size: 14px; line-height: 1; flex-shrink: 0; }
  .tp-te-picker-item--archived { cursor: default; pointer-events: none; }
  .tp-te-picker-item-text { display: flex; flex-direction: column; gap: 1px; overflow: hidden; flex: 1; min-width: 0; }
  .tp-te-picker-code { font-size: 13px; font-weight: 600; color: var(--text-normal); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tp-te-picker-room { font-size: 11px; color: var(--text-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tp-te-picker-clear { display: flex; align-items: center; gap: 6px; padding: 7px 8px; border-radius: 6px; border: none; background: transparent; cursor: pointer; color: var(--color-red, #f38ba8); font-size: 13px; width: 100%; transition: background 0.1s; }
  .tp-te-picker-clear :global(svg) { width: 13px; height: 13px; flex-shrink: 0; }
  .tp-te-picker-clear:hover { background: var(--background-modifier-hover); }
  .tp-te-archive-btn { background: transparent; border: none; cursor: pointer; font-size: 14px; padding: 4px 5px; opacity: 0; flex-shrink: 0; border-radius: 4px; transition: opacity 0.1s, background 0.1s; display: inline-flex; align-items: center; }
  .tp-te-archive-btn :global(svg) { width: 13px; height: 13px; }
  .tp-te-picker-row:hover .tp-te-archive-btn { opacity: 0.6; }
  .tp-te-picker-row--archived .tp-te-archive-btn { opacity: 0.7; }
  .tp-te-archive-btn:hover { opacity: 1 !important; background: var(--background-modifier-hover); }
  .tp-te-show-archived-btn { background: transparent; border: none; cursor: pointer; color: var(--text-faint); font-size: 12px; padding: 4px 8px; text-align: left; width: 100%; border-radius: 4px; }
  .tp-te-show-archived-btn:hover { background: var(--background-modifier-hover); color: var(--text-muted); }
  /* ── Unsaved changes dialog ──────────────────────────────────────────────── */
  .tp-te-unsaved-overlay { position:absolute; inset:0; background:rgba(0,0,0,0.45); z-index:200; display:flex; align-items:center; justify-content:center; border-radius:8px; }
  .tp-te-unsaved-dialog { background:var(--background-primary); border:1px solid var(--background-modifier-border); border-radius:10px; padding:20px 24px; max-width:340px; width:100%; box-shadow:0 8px 28px rgba(0,0,0,0.35); display:flex; flex-direction:column; gap:14px; }
  .tp-te-unsaved-msg { font-size:14px; color:var(--text-normal); margin:0; line-height:1.4; }
  .tp-te-unsaved-actions { display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; }
  .tp-te-btn-danger { background:var(--color-red,#f38ba8); color:var(--text-on-accent); border-color:var(--color-red,#f38ba8); }
  .tp-te-btn-danger:hover { filter:brightness(1.1); }

  /* ── Footer ───────────────────────────────────────────────────────────────── */
  .tp-te-footer { display: flex; justify-content: flex-end; gap: 8px; padding-top: 14px; flex-shrink: 0; }
  .tp-te-btn { padding: 8px 18px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 14px; cursor: pointer; transition: background 0.1s; }
  .tp-te-btn:hover { background: var(--background-modifier-hover); }
  .tp-te-btn-primary { background: var(--interactive-accent); color: var(--text-on-accent); border-color: var(--interactive-accent); }
  .tp-te-btn-primary:hover { filter: brightness(1.08); }
  .tp-te-chip { cursor: grab; }
  .tp-te-chip:active { cursor: grabbing; }
</style>