<script lang="ts">
  import type TeacherPlannerPlugin from "../main";
  import { getMondayOfWeek, weekKey } from "../utils/weekUtils";
  import { calcDirectedTime, fmtMins } from "../utils/directedTimeUtils";
  import { setIcon } from "obsidian";

  function icon(node: HTMLElement, name: string) {
    setIcon(node, name);
    return { update(n: string) { node.innerHTML = ""; setIcon(node, n); } };
  }

  export let plugin: TeacherPlannerPlugin;
  // currentWeek is exported so the planner can sync it via $set.
  // Also updated locally when the user clicks a day in the mini calendar.
  export let currentWeek: Date = getMondayOfWeek(new Date());

  let _tick = 0;
  function invalidate() { _tick++; }

  // ── Calendar display month (fully independent — not driven by the planner) ─
  // Uses a single Date object; reassigning it guarantees Svelte detects the change.
  function _firstOfMonth(y: number, m: number): Date {
    const d = new Date(y, m, 1); d.setHours(0,0,0,0); return d;
  }
  let viewDate: Date = _firstOfMonth(new Date().getFullYear(), new Date().getMonth());
  $: viewYear  = viewDate.getFullYear();
  $: viewMonth = viewDate.getMonth();

  // ── Academic year bounds ──────────────────────────────────────────────────
  $: ayStart = (() => { const d = new Date(plugin.settings.academicYear.startDate + "T00:00:00"); d.setHours(0,0,0,0); return d; })();
  $: ayEnd   = (() => { const d = new Date(plugin.settings.academicYear.endDate   + "T00:00:00"); d.setHours(0,0,0,0); return d; })();

  function prevMonth() {
    const y = viewDate.getFullYear(), m = viewDate.getMonth();
    viewDate = m === 0 ? _firstOfMonth(y - 1, 11) : _firstOfMonth(y, m - 1);
  }
  function nextMonth() {
    const y = viewDate.getFullYear(), m = viewDate.getMonth();
    viewDate = m === 11 ? _firstOfMonth(y + 1, 0) : _firstOfMonth(y, m + 1);
  }
  function goToday() {
    viewDate = _firstOfMonth(new Date().getFullYear(), new Date().getMonth());
  }

  // ── Calendar grid ─────────────────────────────────────────────────────────
  $: calendarDays = (_tick, buildCalendar(viewYear, viewMonth));

  function buildCalendar(year: number, month: number): (Date | null)[] {
    const firstDay = new Date(year, month, 1);
    const dow = firstDay.getDay();
    const startOffset = dow === 0 ? 6 : dow - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: (Date | null)[] = [];
    // Fill leading nulls from prev month
    const prevMonthDays = new Date(year, month, 0).getDate();
    for (let i = 0; i < startOffset; i++) days.push(new Date(year, month - 1, prevMonthDays - startOffset + i + 1));
    for (let d = 1; d <= daysInMonth; d++) days.push(new Date(year, month, d));
    let next = 1;
    while (days.length % 7 !== 0) days.push(new Date(year, month + 1, next++));
    return days;
  }

  // ── Date helpers ──────────────────────────────────────────────────────────
  const _today = new Date(); _today.setHours(0,0,0,0);

  function isToday(d: Date): boolean {
    return d.getFullYear() === _today.getFullYear() && d.getMonth() === _today.getMonth() && d.getDate() === _today.getDate();
  }

  function isThisMonth(d: Date): boolean { return d.getMonth() === viewMonth && d.getFullYear() === viewYear; }

  function isInAcademicYear(d: Date): boolean {
    const dt = new Date(d); dt.setHours(0,0,0,0);
    return dt >= ayStart && dt <= ayEnd;
  }

  const _dayNames = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  function isSchoolDay(d: Date): boolean {
    const dayName = _dayNames[d.getDay()];
    return (plugin.settings.schoolDays ?? ["monday","tuesday","wednesday","thursday","friday"]).includes(dayName as any);
  }

  function onDayClick(d: Date) {
    if (!isInAcademicYear(d) || !isSchoolDay(d)) return;
    const monday = getMondayOfWeek(d);
    currentWeek = monday;
    (plugin as any).navigateWeekView(monday);
  }

  // ── Week notes ────────────────────────────────────────────────────────────
  $: currentWeekKey = weekKey(getMondayOfWeek(currentWeek));
  $: notesValue = (_tick, (plugin.settings.weekNotes ?? {})[currentWeekKey] ?? "");

  // Dynamic placeholder shows the Monday date of the currently selected week
  $: notesPlaceholder = (() => {
    const monday = getMondayOfWeek(currentWeek);
    const d = monday.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    return `Notes for week commencing ${d}:`;
  })();

  async function onNotesBlur(e: FocusEvent) {
    const v = (e.currentTarget as HTMLTextAreaElement).value;
    if (!plugin.settings.weekNotes) plugin.settings.weekNotes = {};
    plugin.settings.weekNotes[currentWeekKey] = v;
    await plugin.saveSettings();
  }

  // ── Directed time panel ───────────────────────────────────────────────────
  $: dtEnabled = plugin.settings.directedTime?.enabled ?? false;

  // Recalculates whenever settings change (_tick ensures Svelte tracks it as a dependency)
  $: dtCalc = (_tick, dtEnabled ? calcDirectedTime(plugin.settings) : null);

  const MONTH_NAMES = ["January","February","March","April","May","June",
                       "July","August","September","October","November","December"];
  const DAY_LABELS  = ["MON","TUE","WED","THU","FRI","SAT","SUN"];
</script>

<svelte:window />

<div class="tp-sidebar">

  <!-- ── Monthly calendar ────────────────────────────────────────────────── -->
  <div class="tp-cal">
    <div class="tp-cal-header">
      <h2 class="tp-cal-title">
        {MONTH_NAMES[viewMonth]} <span class="tp-cal-year">{viewYear}</span>
      </h2>
      <div class="tp-cal-nav-group">
        <button class="tp-cal-nav" on:click={prevMonth} aria-label="Previous month">‹</button>
        <button class="tp-cal-today-btn" on:click={goToday}>TODAY</button>
        <button class="tp-cal-nav" on:click={nextMonth} aria-label="Next month">›</button>
      </div>
    </div>

    <div class="tp-cal-grid">
      {#each DAY_LABELS as dl}
        <div class="tp-cal-dow">{dl}</div>
      {/each}

      {#each calendarDays as d}
        <!-- svelte-ignore a11y-interactive-supports-focus -->
        <div
          class="tp-cal-day"
          class:tp-cal-day--today={isToday(d)}
          class:tp-cal-day--outside={!isThisMonth(d)}
          class:tp-cal-day--faded={!isInAcademicYear(d) || !isSchoolDay(d)}
          class:tp-cal-day--clickable={isInAcademicYear(d) && isSchoolDay(d) && isThisMonth(d)}
          role={isInAcademicYear(d) && isSchoolDay(d) ? "button" : undefined}
          tabindex={isInAcademicYear(d) && isSchoolDay(d) ? 0 : undefined}
          on:click={() => onDayClick(d)}
          on:keydown={(e) => e.key === "Enter" && onDayClick(d)}
        ><span class="tp-cal-day-num">{d.getDate()}</span></div>
      {/each}
    </div>
  </div>

  <!-- ── Week notes ──────────────────────────────────────────────────────── -->
  <div class="tp-sb-notes">
    <textarea
      class="tp-sb-notes-textarea"
      placeholder={notesPlaceholder}
      value={notesValue}
      on:blur={onNotesBlur}
    ></textarea>
  </div>

  <!-- ── Directed time panel ─────────────────────────────────────────────── -->
  {#if dtEnabled && dtCalc}
    {@const diff = dtCalc.predictedMins - dtCalc.contractedMins}
    {@const isOver = diff > 0}
    <div class="tp-sb-dt">
      <div class="tp-sb-dt-title"><span class="tp-sb-dt-icon" use:icon={"clock"}></span> Directed Time</div>
      <div class="tp-sb-dt-rows">
        <div class="tp-sb-dt-row">
          <span class="tp-sb-dt-label">Accrued to date</span>
          <span class="tp-sb-dt-value">{fmtMins(dtCalc.accruedMins)}</span>
        </div>
        <div class="tp-sb-dt-row">
          <span class="tp-sb-dt-label">Predicted total</span>
          <span class="tp-sb-dt-value" class:tp-sb-dt-value--over={isOver}>{fmtMins(dtCalc.predictedMins)}</span>
        </div>
        <div class="tp-sb-dt-row">
          <span class="tp-sb-dt-label">Contracted max</span>
          <span class="tp-sb-dt-value">{fmtMins(dtCalc.contractedMins)}</span>
        </div>
      </div>
      <div class="tp-sb-dt-status" class:tp-sb-dt-status--over={isOver} class:tp-sb-dt-status--under={!isOver}>
        {#if isOver}
          <span class="tp-sb-dt-icon" use:icon={"alert-triangle"}></span> {fmtMins(diff)} over contracted — contact your union
        {:else if diff === 0}
          <span class="tp-sb-dt-icon" use:icon={"check"}></span> Exactly on contracted hours
        {:else}
          <span class="tp-sb-dt-icon" use:icon={"check"}></span> {fmtMins(-diff)} under contracted max
        {/if}
      </div>
    </div>
  {/if}

</div>

<style>
  .tp-sidebar {
    display: flex;
    flex-direction: column;
    flex: 1;
    height: 100%;
    min-height: 0;
    background: var(--background-primary);
    font-family: var(--font-interface);
    overflow: hidden;
  }

  /* ── Calendar ─────────────────────────────────────────────────────────── */
  .tp-cal { padding: 16px 12px 10px; flex-shrink: 0; }

  .tp-cal-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 14px;
  }
  .tp-cal-title {
    font-size: 20px; font-weight: 700; color: var(--text-normal);
    margin: 0; line-height: 1.1;
  }
  .tp-cal-year { color: var(--interactive-accent); }

  .tp-cal-nav-group { display: flex; align-items: center; gap: 2px; }
  .tp-cal-nav {
    background: none; border: none; cursor: pointer;
    color: var(--text-muted); font-size: 20px; padding: 2px 5px;
    border-radius: 4px; line-height: 1; transition: color 0.1s;
  }
  .tp-cal-nav:hover:not(:disabled) { color: var(--text-normal); background: var(--background-modifier-hover); }
  .tp-cal-nav:disabled { opacity: 0.25; cursor: default; }

  .tp-cal-today-btn {
    font-size: 11px; font-weight: 700; letter-spacing: 0.05em;
    color: var(--text-muted); background: none;
    border: none;
    border-radius: 4px; padding: 3px 7px; cursor: pointer;
    transition: color 0.1s;
  }
  .tp-cal-today-btn:hover { color: var(--text-normal); }

  .tp-cal-grid {
    display: grid; grid-template-columns: repeat(7, 1fr);
    gap: 0; row-gap: 2px;
  }
  .tp-cal-dow {
    text-align: center; font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
    color: var(--text-faint); padding: 0 0 8px;
  }
  .tp-cal-day {
    text-align: center; font-size: 13px; padding: 3px 2px;
    color: var(--text-muted); line-height: 1; min-height: 28px;
    display: flex; align-items: center; justify-content: center;
  }
  .tp-cal-day-num {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px;
    border: 1px solid transparent;
    border-radius: 3px;
    transition: border-color 0.12s;
  }
  .tp-cal-day--clickable { cursor: pointer; }
  .tp-cal-day--clickable:hover .tp-cal-day-num {
    border-color: var(--interactive-accent);
  }
  .tp-cal-day--outside { color: var(--text-faint); }
  .tp-cal-day--faded { opacity: 0.3; cursor: default; pointer-events: none; }
  .tp-cal-day--today .tp-cal-day-num {
    color: var(--interactive-accent);
    font-weight: 700;
  }

  /* ── Week notes ───────────────────────────────────────────────────────── */
  .tp-sb-notes {
    flex: 1; display: flex; flex-direction: column;
    margin: 6px 12px 12px; border-radius: 8px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    overflow: hidden; min-height: 60px;
  }
  .tp-sb-notes-textarea {
    flex: 1; resize: none; width: 100%;
    box-sizing: border-box; padding: 10px 12px;
    background: transparent; color: var(--text-normal);
    border: none; outline: none; overflow-y: auto;
    font-family: var(--font-text); font-size: 13px; line-height: 1.5;
  }
  .tp-sb-notes-textarea::placeholder { color: var(--text-faint); font-style: italic; font-size: 12px; }

  /* ── Directed time panel ──────────────────────────────────────────────── */
  .tp-sb-dt {
    margin: 0 12px 12px;
    border-radius: 8px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    padding: 10px 12px;
    flex-shrink: 0;
  }
  .tp-sb-dt-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-faint);
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .tp-sb-dt-icon { display: inline-flex; align-items: center; flex-shrink: 0; }
  .tp-sb-dt-icon :global(svg) { width: 12px; height: 12px; }
  .tp-sb-dt-rows { display: flex; flex-direction: column; gap: 5px; margin-bottom: 8px; }
  .tp-sb-dt-row { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; }
  .tp-sb-dt-label { font-size: 12px; color: var(--text-muted); white-space: nowrap; }
  .tp-sb-dt-value { font-size: 13px; font-weight: 700; color: var(--text-normal); white-space: nowrap; }
  .tp-sb-dt-value--over { color: var(--color-red, #f38ba8); }
  .tp-sb-dt-status {
    font-size: 11px;
    font-weight: 600;
    padding: 5px 8px;
    border-radius: 5px;
    line-height: 1.4;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .tp-sb-dt-status--over {
    background: color-mix(in srgb, var(--color-red, #f38ba8) 15%, transparent);
    color: var(--color-red, #f38ba8);
  }
  .tp-sb-dt-status--under {
    background: color-mix(in srgb, var(--color-green, #a6e3a1) 12%, transparent);
    color: var(--color-green, #a6e3a1);
  }
</style>
