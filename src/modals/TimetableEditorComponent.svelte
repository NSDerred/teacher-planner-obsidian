<script lang="ts">
  import type TeacherPlannerPlugin from "../main";
  import type { TimetableEditorModal } from "./TimetableEditorModal";
  import type { TimetableSlot, SchoolPeriod, TimetableTemplate, SchoolDay } from "../types";
  import { AddTimetableTemplateModal } from "./AddTimetableTemplateModal";
  import { setIcon } from "obsidian";

  function icon(node: HTMLElement, name: string) {
    setIcon(node, name);
    return { update(n: string) { node.innerHTML = ""; setIcon(node, n); } };
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
  $: DAYS = (_tick, ALL_DAYS.filter(d =>
    (plugin.settings.schoolDays ?? ["monday","tuesday","wednesday","thursday","friday"]).includes(d.key)
  ));

  // ── Template management ────────────────────────────────────────────────────
  let _tick = 0;
  function invalidate() { _tick++; }

  $: allTemplates  = (_tick, plugin.settings.timetableTemplates ?? []);
  $: classes       = plugin.settings.classes ?? [];
  $: subjects      = plugin.settings.subjects ?? [];
  $: activities    = plugin.settings.activities ?? [];
  $: abEnabled     = plugin.settings.academicYear.abWeekEnabled;
  $: periods       = plugin.settings.academicYear.periods;

  // ── Directed time ──────────────────────────────────────────────────────────
  $: directedTimeEnabled = plugin.settings.directedTime?.enabled ?? false;
  $: defaultDuration     = plugin.settings.directedTime?.defaultLessonDurationMinutes ?? 60;

  // Duration badge editing state
  let durationEditKey: string | null = null;
  let durationEditValue: number = 60;

  function getSlotDuration(slot: TimetableSlot): number {
    if (slot.durationMinutes) return slot.durationMinutes;
    const act = activities.find(a => a.id === slot.classId);
    if (act?.durationMinutes) return act.durationMinutes;
    return defaultDuration;
  }

  function isDirectedSlot(slot: TimetableSlot): boolean {
    const cls = classes.find(c => c.id === slot.classId);
    if (cls) return true; // lessons always count as directed
    const act = activities.find(a => a.id === slot.classId);
    return act?.activityType !== "other";
  }

  function startDurationEdit(slot: TimetableSlot, key: string, e: MouseEvent) {
    e.stopPropagation();
    durationEditKey = key;
    durationEditValue = getSlotDuration(slot);
  }

  function commitDurationEdit(slot: TimetableSlot) {
    if (durationEditValue >= 1 && durationEditValue <= 480) {
      slot.durationMinutes = durationEditValue;
      slots = [...slots];
      markDirty();
    }
    durationEditKey = null;
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

  // ── Past-template warning ──────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  $: isPast = activeTemplate ? activeTemplate.endDate < today : false;
  let showPastConfirm = false;

  // Reset confirmation when switching templates
  $: if (activeTemplateId) { showPastConfirm = false; }

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

  function getSlot(day: string, periodId: string, week: "A" | "B" | null): TimetableSlot | undefined {
    if (!abEnabled || !week) return slots.find(s => s.day === day && s.periodId === periodId);
    return slots.find(s =>
      s.day === day && s.periodId === periodId &&
      (s.weekType === week || s.weekType === "both" || s.weekType == null)
    );
  }

  function getLabel(slot: TimetableSlot) {
    const cls = classes.find(c => c.id === slot.classId);
    if (cls) {
      const subj = subjects.find(s => s.id === cls.subjectId);
      return { code: cls.code, sub: subj?.name ?? "", colour: cls.colour, classroom: cls.classroom ?? "" };
    }
    const act = activities.find(a => a.id === slot.classId);
    if (act) return { code: act.label, sub: act.info ?? "", colour: act.colour, classroom: act.classroom ?? "" };
    return { code: "?", sub: "", colour: "#888", classroom: "" };
  }

  function openPicker(day: string, periodId: string, week: "A" | "B" | null, el: HTMLElement) {
    if (pickerDay === day && pickerPeriodId === periodId && pickerWeek === week) {
      closePicker(); return;
    }
    pickerDay = day; pickerPeriodId = periodId; pickerWeek = week; pickerEl = el;
  }

  function closePicker() {
    pickerDay = null; pickerPeriodId = null; pickerWeek = null; pickerEl = null;
  }

  function assignItem(day: string, period: SchoolPeriod, itemId: string, week: "A" | "B" | null) {
    if (abEnabled && week) {
      const exact = slots.find(s => s.day === day && s.periodId === period.id && s.weekType === week);
      if (exact) { exact.classId = itemId; slots = [...slots]; }
      else {
        slots = [...slots, {
          id: "slot-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
          day: day as any, periodId: period.id, classId: itemId,
          start: period.start, end: period.end, weekType: week,
        }];
      }
    } else {
      const exact = slots.find(s => s.day === day && s.periodId === period.id);
      if (exact) { exact.classId = itemId; slots = [...slots]; }
      else {
        slots = [...slots, {
          id: "slot-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
          day: day as any, periodId: period.id, classId: itemId,
          start: period.start, end: period.end,
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
  async function deleteTemplate() {
    if (allTemplates.length <= 1) return;
    if (!confirm(`Delete "${activeTemplate?.name}"? This cannot be undone.`)) return;
    plugin.settings.timetableTemplates = allTemplates.filter(t => t.id !== activeTemplateId);
    await plugin.saveSettings();
    const remaining = plugin.settings.timetableTemplates;
    activeTemplateId = remaining[remaining.length - 1]?.id ?? "";
    const tmpl = remaining.find(t => t.id === activeTemplateId);
    slots = JSON.parse(JSON.stringify(tmpl?.slots ?? []));
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

  // ── Period type colours ────────────────────────────────────────────────────
  $: periodTypes = plugin.settings.periodTypes ?? [];

  function getPeriodTypeColour(typeId: string): string {
    return periodTypes.find(t => t.id === typeId)?.colour ?? "#888888";
  }

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
  on:keydown={(e) => e.key === "Escape" && (renamingId ? renamingId = null : durationEditKey ? durationEditKey = null : closePicker())}
  on:mousedown={(e) => {
    const t = /** @type {Element} */ (e.target);
    if (pickerEl && !t?.closest?.(".tp-te-picker") && !t?.closest?.(".tp-te-cell")) closePicker();
    if (renamingId && !t?.closest?.(".tp-te-rename-input")) commitRename();
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

  <!-- ── Past-template warning ──────────────────────────────────────────────── -->
  {#if isPast}
    <div class="tp-te-past-warn">
      {#if showPastConfirm}
        <span>⚠️ Saving will change historical records. Continue?</span>
        <button class="tp-te-past-confirm-btn" on:click={confirmPastSave}>Yes, save anyway</button>
        <button class="tp-te-past-cancel-btn" on:click={() => showPastConfirm = false}>Cancel</button>
      {:else}
        <span>⚠️ This timetable ended {fmtDate(activeTemplate.endDate)}. Editing will affect historical records.</span>
      {/if}
    </div>
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
  <div class="tp-te-grid-wrap">
    <table class="tp-te-grid">
      <thead>
        <tr>
          <th class="tp-te-th tp-te-th--period">Period</th>
          {#each DAYS as day}
            <th class="tp-te-th">{day.label}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each periods as period}
          {@const tc = getPeriodTypeColour(period.type)}
          <tr style="background:{hexToRgba(tc, 0.05)};">
            <td class="tp-te-period-cell" style="background:{hexToRgba(tc, 0.25)}; border-left:3px solid {tc};">
              <span class="tp-te-period-name">{period.name}</span>
              <span class="tp-te-period-time">{period.start}–{period.end}</span>
            </td>
            {#each DAYS as day}
              {@const slot   = _slotGrid[day.key + ":" + period.id]}
              {@const isOpen = pickerDay === day.key && pickerPeriodId === period.id}
              {@const cellKey = day.key + ":" + period.id}
              <td
                class="tp-te-cell"
                class:tp-te-cell--filled={!!slot}
                class:tp-te-cell--open={isOpen}
              >
                {#if slot}
                  {@const lbl = getLabel(slot)}
                  <button
                    class="tp-te-chip"
                    style="border-left: 3px solid {lbl.colour}; background: {lbl.colour}22;"
                    title="{lbl.code}{lbl.classroom ? ' · ' + lbl.classroom : ''}"
                    on:click={(e) => openPicker(day.key, period.id, currentWeek, e.currentTarget)}
                  >
                    <span class="tp-te-chip-code" style="color:{lbl.colour}">{lbl.code}</span>
                    {#if lbl.sub || lbl.classroom}
                      <span class="tp-te-chip-sub">{[lbl.sub, lbl.classroom].filter(Boolean).join(" · ")}</span>
                    {/if}
                  </button>
                  {#if directedTimeEnabled && isDirectedSlot(slot)}
                    {#if durationEditKey === cellKey}
                      <!-- svelte-ignore a11y-autofocus -->
                      <input
                        class="tp-te-duration-input"
                        type="number"
                        min="1"
                        max="480"
                        autofocus
                        bind:value={durationEditValue}
                        on:click|stopPropagation
                        on:keydown={(e) => { if (e.key === "Enter") commitDurationEdit(slot); if (e.key === "Escape") durationEditKey = null; }}
                        on:blur={() => commitDurationEdit(slot)}
                      />
                    {:else}
                      <!-- svelte-ignore a11y-click-events-have-key-events -->
                      <!-- svelte-ignore a11y-no-static-element-interactions -->
                      <span
                        class="tp-te-duration-badge"
                        title="Duration: {getSlotDuration(slot)} min — click to edit"
                        on:click|stopPropagation={(e) => startDurationEdit(slot, cellKey, e)}
                      >{getSlotDuration(slot)}m</span>
                    {/if}
                  {/if}
                {:else}
                  <button
                    class="tp-te-add"
                    aria-label="Assign"
                    on:click={(e) => openPicker(day.key, period.id, currentWeek, e.currentTarget)}
                  >+</button>
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <!-- ── Floating picker ───────────────────────────────────────────────────── -->
  {#if pickerDay && pickerPeriodId && pickerEl}
    <div class="tp-te-picker" style={getPickerStyle(pickerEl)}>
      <div class="tp-te-picker-inner">
        {#if getSlot(pickerDay, pickerPeriodId, currentWeek)}
          <button
            class="tp-te-picker-clear"
            on:click={() => { clearSlot(pickerDay, pickerPeriodId, currentWeek); closePicker(); }}
          ><span use:icon={"x"}></span> Remove</button>
          <div class="tp-te-picker-divider"></div>
        {/if}

        {#if sortedSubjects.some(s => visibleClasses.some(c => c.subjectId === s.id))}
          <div class="tp-te-picker-group-label">Classes</div>
          {#each sortedSubjects as subj}
            {@const subjClasses = visibleClasses.filter(c => c.subjectId === subj.id).sort((a,b) => a.code.localeCompare(b.code))}
            {#each subjClasses as cls}
              <div class="tp-te-picker-row">
                <button
                  class="tp-te-picker-item"
                  style="border-left: 3px solid {cls.colour};"
                  on:click={() => { const p = periods.find(p => p.id === pickerPeriodId); if(p) { assignItem(pickerDay, p, cls.id, currentWeek); closePicker(); } }}
                >
                  <span class="tp-te-picker-item-text">
                    <span class="tp-te-picker-code">{cls.code}</span>
                    {#if cls.classroom}<span class="tp-te-picker-room">{cls.classroom}</span>{/if}
                  </span>
                </button>
                <button class="tp-te-archive-btn" title="Archive class" on:click|stopPropagation={() => toggleArchiveClass(cls.id)} use:icon={"archive"}></button>
              </div>
            {/each}
          {/each}
        {/if}

        {#if visibleDirected.length}
          <div class="tp-te-picker-divider"></div>
          <div class="tp-te-picker-group-label">Directed time</div>
          {#each visibleDirected as act}
            <div class="tp-te-picker-row">
              <button
                class="tp-te-picker-item"
                style="border-left: 3px solid {act.colour};"
                on:click={() => { const p = periods.find(p => p.id === pickerPeriodId); if(p) { assignItem(pickerDay, p, act.id, currentWeek); closePicker(); } }}
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

        {#if visibleOther.length}
          <div class="tp-te-picker-divider"></div>
          <div class="tp-te-picker-group-label">Other events</div>
          {#each visibleOther as act}
            <div class="tp-te-picker-row">
              <button
                class="tp-te-picker-item"
                style="border-left: 3px solid {act.colour};"
                on:click={() => { const p = periods.find(p => p.id === pickerPeriodId); if(p) { assignItem(pickerDay, p, act.id, currentWeek); closePicker(); } }}
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
    <button class="tp-te-btn tp-te-btn-primary" on:click={save}>Save Timetable</button>
  </div>
</div>

<style>
  .tp-te-wrap { display: flex; flex-direction: column; width: 100%; box-sizing: border-box; height: auto; overflow: visible; font-size: 14px; position: relative; }

  /* ── Template bar ─────────────────────────────────────────────────────────── */
  .tp-te-tmpl-bar { display: flex; align-items: flex-start; gap: 8px; padding: 8px 48px 12px 0; flex-shrink: 0; flex-wrap: wrap; }
  .tp-te-tmpl-tabs { display: flex; gap: 4px; flex-wrap: wrap; flex: 1; min-width: 0; }
  .tp-te-tmpl-tab-wrap { display: flex; align-items: center; gap: 2px; }
  .tp-te-tmpl-tab { display: flex; flex-direction: column; align-items: flex-start; padding: 10px 14px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-muted); font-size: 13px; cursor: pointer; transition: all 0.15s; text-align: left; }
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

  /* ── Past-template warning ───────────────────────────────────────────────── */
  .tp-te-past-warn { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 12px; margin-bottom: 12px; background: color-mix(in srgb, var(--color-yellow, #f59e0b) 12%, transparent); border: 1px solid var(--color-yellow, #f59e0b); border-radius: 6px; font-size: 13px; color: var(--text-normal); flex-shrink: 0; }
  .tp-te-past-confirm-btn { padding: 4px 12px; border-radius: 4px; border: none; background: var(--color-red, #f38ba8); color: #fff; font-size: 12px; cursor: pointer; }
  .tp-te-past-cancel-btn { padding: 4px 12px; border-radius: 4px; border: 1px solid var(--background-modifier-border); background: transparent; color: var(--text-normal); font-size: 12px; cursor: pointer; }

  /* ── Week tabs ────────────────────────────────────────────────────────────── */
  .tp-te-week-tabs { display: flex; gap: 6px; margin-bottom: 14px; flex-shrink: 0; }
  .tp-te-week-tab { padding: 6px 20px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-muted); font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
  .tp-te-week-tab--active { background: var(--interactive-accent); color: #fff; border-color: var(--interactive-accent); }

  /* ── Grid ─────────────────────────────────────────────────────────────────── */
  .tp-te-grid-wrap { overflow: auto; max-height: 55vh; border: 1px solid var(--background-modifier-border); border-radius: 8px; }
  .tp-te-grid { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .tp-te-th { padding: 10px 8px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); text-align: center; background: var(--background-secondary); border-bottom: 1px solid var(--background-modifier-border); position: sticky; top: 0; z-index: 2; }
  .tp-te-th--period { text-align: left; width: 130px; }
  .tp-te-period-cell { padding: 6px 10px; border-bottom: 1px solid var(--background-modifier-border); vertical-align: middle; }
  .tp-te-period-name { display: block; font-size: 13px; font-weight: 600; color: var(--text-normal); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tp-te-period-time { display: block; font-size: 11px; color: var(--text-faint); margin-top: 1px; }
  .tp-te-cell { height: 52px; padding: 4px; border-bottom: 1px solid var(--background-modifier-border); border-left: 1px solid var(--background-modifier-border); vertical-align: middle; position: relative; }
  .tp-te-cell:hover .tp-te-add { opacity: 1; }
  .tp-te-add { opacity: 0; width: 100%; height: 100%; border: 1.5px dashed var(--background-modifier-border); border-radius: 6px; background: transparent; color: var(--text-faint); font-size: 18px; cursor: pointer; transition: all 0.15s; display: flex; align-items: center; justify-content: center; }
  .tp-te-add:hover { border-color: var(--interactive-accent); color: var(--interactive-accent); background: var(--background-modifier-hover); }
  .tp-te-chip { width: 100%; height: 100%; border-radius: 6px; border: none; cursor: pointer; padding: 4px 6px; text-align: left; display: flex; flex-direction: column; justify-content: center; gap: 1px; overflow: hidden; transition: filter 0.1s; }
  .tp-te-chip:hover { filter: brightness(1.1); }
  .tp-te-chip-code { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tp-te-chip-sub { font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* ── Duration badge ───────────────────────────────────────────────────────── */
  .tp-te-duration-badge { position: absolute; bottom: 3px; right: 4px; font-size: 10px; font-weight: 700; background: rgba(0,0,0,0.30); color: #fff; border-radius: 3px; padding: 1px 4px; cursor: pointer; line-height: 1.4; transition: background 0.1s; z-index: 1; pointer-events: all; }
  .tp-te-duration-badge:hover { background: rgba(0,0,0,0.50); }
  .tp-te-duration-input { position: absolute; bottom: 3px; right: 4px; width: 46px; font-size: 10px; padding: 1px 3px; border: 1px solid var(--interactive-accent); border-radius: 3px; background: var(--background-primary); color: var(--text-normal); z-index: 2; text-align: center; }

  /* ── Picker ───────────────────────────────────────────────────────────────── */
  .tp-te-picker { position: fixed; z-index: 1000; width: 240px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,0.3); overflow: hidden; }
  .tp-te-picker-inner { max-height: 320px; overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 2px; }
  .tp-te-picker-group-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-faint); padding: 4px 8px 2px; }
  .tp-te-picker-divider { height: 1px; background: var(--background-modifier-border); margin: 4px 0; }
  .tp-te-picker-row { display: flex; align-items: center; gap: 2px; }
  .tp-te-picker-item { flex: 1; display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 6px; border: none; background: transparent; cursor: pointer; text-align: left; width: 100%; transition: background 0.1s; min-width: 0; }
  .tp-te-picker-item:hover { background: var(--background-modifier-hover); }
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
</style>
