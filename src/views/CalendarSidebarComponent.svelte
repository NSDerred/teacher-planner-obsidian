<script lang="ts">
  import type TeacherPlannerPlugin from "../main";
  import type { SchoolDay } from "../types";
  import { getMondayOfWeek, weekKey } from "../utils/weekUtils";
  import { readWeekNote, writeWeekNote, weekNoteFilePath } from "../utils/weekNoteFiles";
  import { calcDirectedTime, fmtMins } from "../utils/directedTimeUtils";
  import { setIcon, MarkdownRenderer, TFile } from "obsidian";
  import type { TAbstractFile, EventRef } from "obsidian";
  import { tick, onMount, onDestroy } from "svelte";
  import { createEmbeddableEditor, type EmbeddableEditorHandle } from "../utils/embeddableEditor";

  function icon(node: HTMLElement, name: string) {
    setIcon(node, name);
    return { update(n: string) { node.empty(); setIcon(node, n); } };
  }

  export let plugin: TeacherPlannerPlugin;
  // currentWeek is exported so the planner can sync it via $set.
  // Also updated locally when the user clicks a day in the mini calendar.
  export let currentWeek: Date = getMondayOfWeek(new Date());

  let _tick = 0;
  /** Registers a reactive dependency on `_t` and returns `value` (TS-clean alternative to the comma idiom). */
  function _dep<T>(_t: unknown, value: T): T { return value; }
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
  $: calendarDays = _dep(_tick, buildCalendar(viewYear, viewMonth));

  function buildCalendar(year: number, month: number): Date[] {
    const firstDay = new Date(year, month, 1);
    const dow = firstDay.getDay();
    const startOffset = dow === 0 ? 6 : dow - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: Date[] = [];
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
    return (plugin.settings.schoolDays ?? ["monday","tuesday","wednesday","thursday","friday"]).includes(dayName as SchoolDay);
  }

  function onDayClick(d: Date) {
    if (!isInAcademicYear(d) || !isSchoolDay(d)) return;
    const monday = getMondayOfWeek(d);
    currentWeek = monday;
    plugin.navigateWeekView(monday);
  }

  // ── Week notes ────────────────────────────────────────────────────────────
  $: currentWeekKey = weekKey(getMondayOfWeek(currentWeek));
  let notesValue = "";
  $: fileMode = _dep(_tick, plugin.settings.weekNoteFiles ?? false);
  $: void loadNotes(currentWeekKey, fileMode, _tick);
  async function loadNotes(key: string, mode: boolean, _t: unknown) {
    if (editing) return;
    notesValue = mode
      ? await readWeekNote(plugin, key)
      : ((plugin.settings.weekNotes ?? {})[key] ?? "");
  }

  // Dynamic placeholder shows the Monday date of the currently selected week
  $: notesPlaceholder = (() => {
    const monday = getMondayOfWeek(currentWeek);
    const d = monday.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    return `Notes for week commencing ${d}:`;
  })();

  // ── Notes: edit / preview state ─────────────────────────────────────────
  let editing = false;
  let textareaEl: HTMLTextAreaElement;
  let previewEl: HTMLDivElement;

  // Re-render the markdown preview whenever the note text changes (and we're not editing)
  $: if (!editing && previewEl !== undefined) renderPreview(notesValue);

  async function renderPreview(md: string) {
    if (!previewEl) return;
    previewEl.empty();
    if (!md || !md.trim()) return;
    await MarkdownRenderer.render(plugin.app, md, previewEl, "", plugin);
  }

  async function enterEdit() {
    if (plugin.settings.weekNoteFiles && !editing) {
      notesValue = await readWeekNote(plugin, currentWeekKey);
    }
    editing = true;
    await tick();
    textareaEl?.focus();
  }

  async function persistFrom(v: string, refresh = false) {
    if (plugin.settings.weekNoteFiles) {
      // Safety: never overwrite a saved note with an accidental empty save.
      if (!v.trim()) {
        const existing = await readWeekNote(plugin, currentWeekKey);
        if (existing.trim()) { notesValue = existing; if (refresh) invalidate(); return; }
      }
      await writeWeekNote(plugin, currentWeekKey, v);
    } else {
      if (!plugin.settings.weekNotes) plugin.settings.weekNotes = {};
      plugin.settings.weekNotes[currentWeekKey] = v;
      await plugin.saveSettings();
    }
    notesValue = v;
    if (refresh) invalidate();
  }

  async function onNotesBlur(e: FocusEvent) {
    await persistFrom((e.currentTarget as HTMLTextAreaElement).value, true);
    editing = false;
  }

  // ── Live (formatted) week-note editor ─────────────────────────────────────
  // When week notes are file-backed, embed Obsidian's own Markdown editor so the
  // note formats as you type. Falls back to the textarea above if file mode is off
  // or the internal editor API can't be resolved (liveUnavailable).
  let liveEl: HTMLDivElement | undefined;
  let liveHandle: EmbeddableEditorHandle | null = null;
  let liveUnavailable = false;
  let liveKey = "";
  let mounting = false;
  let saveTimer: number | undefined;
  let suppressReload = false;
  let liveEmpty = true;
  $: useLive = fileMode && !liveUnavailable;

  function scheduleLiveSave(v: string) {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => { void flushLiveSave(v); }, 600);
  }
  async function flushLiveSave(v: string) {
    if (saveTimer) { window.clearTimeout(saveTimer); saveTimer = undefined; }
    suppressReload = true;
    await writeWeekNote(plugin, liveKey, v);
    notesValue = v;
    window.setTimeout(() => { suppressReload = false; }, 80);
  }
  async function mountLive() {
    if (!liveEl || mounting) return;
    mounting = true;
    try {
      const key = currentWeekKey;
      destroyLive();
      const body = await readWeekNote(plugin, key);
      liveHandle = createEmbeddableEditor(plugin.app, liveEl, {
        value: body,
        cls: "tp-sb-notes-live-cm",
        onChange: (v) => { liveEmpty = !v.trim(); scheduleLiveSave(v); },
        onBlur: (v) => { void flushLiveSave(v); },
      });
      if (!liveHandle) { liveUnavailable = true; return; }
      liveKey = key;
      notesValue = body;
      liveEmpty = !body.trim();
    } finally {
      mounting = false;
    }
  }
  function destroyLive() {
    if (saveTimer) { window.clearTimeout(saveTimer); saveTimer = undefined; }
    if (liveHandle) { liveHandle.destroy(); liveHandle = null; }
    liveKey = "";
  }
  async function reloadLive() {
    const body = await readWeekNote(plugin, liveKey);
    if (liveHandle && liveHandle.value !== body) liveHandle.setValue(body);
    notesValue = body;
  }
  function onVaultModify(file: TAbstractFile) {
    if (suppressReload || !liveHandle || !liveKey) return;
    if (!(file instanceof TFile)) return;
    if (file.path !== weekNoteFilePath(plugin, liveKey)) return;
    void reloadLive();
  }
  async function openWeekNoteInPane() {
    const key = currentWeekKey;
    if (liveHandle) await flushLiveSave(liveHandle.value);
    const path = weekNoteFilePath(plugin, key);
    let f = plugin.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) {
      await writeWeekNote(plugin, key, liveHandle?.value ?? notesValue ?? "");
      f = plugin.app.vault.getAbstractFileByPath(path);
    }
    if (!(f instanceof TFile)) return;
    const where = plugin.settings.weekNoteOpenIn ?? "tab";
    const leaf = where === "current"
      ? plugin.app.workspace.getLeaf(false)
      : plugin.app.workspace.getLeaf(where === "split" ? "split" : "tab");
    await leaf.openFile(f);
  }

  // Mount / remount when the editor becomes usable or the week changes; tear down otherwise.
  $: if (useLive && liveEl && currentWeekKey !== liveKey) void mountLive();
  $: if (!useLive && liveHandle) destroyLive();

  let modifyRef: EventRef | undefined;
  onMount(() => { modifyRef = plugin.app.vault.on("modify", onVaultModify); });
  onDestroy(() => {
    if (modifyRef) plugin.app.vault.offref(modifyRef);
    destroyLive();
  });

  // ── Notes: formatting toolbar ────────────────────────────────────────
  const HL_YELLOW = "#fff3a3";
  const HL_COLOURS = [
    { name: "Yellow", value: HL_YELLOW },
    { name: "Green",  value: "#c3f0c8" },
    { name: "Blue",   value: "#b6dcfb" },
    { name: "Pink",   value: "#f7c6da" },
    { name: "Orange", value: "#ffd5a8" },
  ];
  let lastHighlight = HL_YELLOW;
  let showSwatches = false;

  function ensureEditing() {
    if (!editing) editing = true;
  }

  // Wrap the current selection (or drop the cursor between the markers)
  function wrapSelection(before: string, after: string) {
    if (useLive && liveHandle) { liveHandle.wrapSelection(before, after); return; }
    ensureEditing();
    const ta = textareaEl;
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const val = ta.value;
    const sel = val.slice(s, e);
    ta.value = val.slice(0, s) + before + sel + after + val.slice(e);
    const caret = sel ? s + before.length + sel.length + after.length : s + before.length;
    ta.setSelectionRange(caret, caret);
    ta.focus();
    persistFrom(ta.value);
  }

  // Add a per-line prefix across the selected lines (heading / lists)
  function linePrefix(kind: "heading" | "bullet" | "number") {
    if (useLive && liveHandle) {
      liveHandle.transformSelectedLines((ln, i) => {
        const bare = ln.replace(/^(#{1,6}\s+|[-*]\s+|\d+\.\s+)/, "");
        if (kind === "heading") return ln.startsWith("## ") ? bare : "## " + bare;
        if (kind === "bullet")  return /^[-*]\s+/.test(ln) ? bare : "- " + bare;
        return /^\d+\.\s+/.test(ln) ? bare : (i + 1) + ". " + bare;
      });
      return;
    }
    ensureEditing();
    const ta = textareaEl;
    if (!ta) return;
    const val = ta.value;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const lineStart = val.lastIndexOf("\n", s - 1) + 1;
    let lineEnd = val.indexOf("\n", e);
    if (lineEnd === -1) lineEnd = val.length;
    const lines = val.slice(lineStart, lineEnd).split("\n");
    const out = lines.map((ln, i) => {
      const bare = ln.replace(/^(#{1,6}\s+|[-*]\s+|\d+\.\s+)/, "");
      if (kind === "heading") return ln.startsWith("## ") ? bare : "## " + bare;
      if (kind === "bullet")  return /^[-*]\s+/.test(ln) ? bare : "- " + bare;
      return /^\d+\.\s+/.test(ln) ? bare : (i + 1) + ". " + bare;
    }).join("\n");
    ta.value = val.slice(0, lineStart) + out + val.slice(lineEnd);
    ta.setSelectionRange(lineStart, lineStart + out.length);
    ta.focus();
    persistFrom(ta.value);
  }

  function applyHighlight(colour: string) {
    if (colour === HL_YELLOW) wrapSelection("==", "==");
    else wrapSelection(`<mark style="background:${colour}">`, "</mark>");
    lastHighlight = colour;
    showSwatches = false;
  }

  function toggleSwatches(e: MouseEvent) {
    e.stopPropagation();
    showSwatches = !showSwatches;
  }
  function closeSwatches() { showSwatches = false; }

  // ── Directed time panel ───────────────────────────────────────────────────
  $: dtEnabled = plugin.settings.directedTime?.enabled ?? false;

  // Recalculates whenever settings change (_tick ensures Svelte tracks it as a dependency)
  $: dtCalc = _dep(_tick, dtEnabled ? calcDirectedTime(plugin.settings) : null);

  const MONTH_NAMES = ["January","February","March","April","May","June",
                       "July","August","September","October","November","December"];
  const DAY_LABELS  = ["MON","TUE","WED","THU","FRI","SAT","SUN"];
</script>

<svelte:window on:mousedown={closeSwatches} />

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
        <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
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
    <!-- Formatting toolbar -->
    <div class="tp-sb-notes-toolbar">
      <button class="tp-fmt-btn" aria-label="Bold" title="Bold"
              on:mousedown|preventDefault={() => wrapSelection("**", "**")} use:icon={"bold"}></button>
      <button class="tp-fmt-btn" aria-label="Italic" title="Italic"
              on:mousedown|preventDefault={() => wrapSelection("*", "*")} use:icon={"italic"}></button>
      <button class="tp-fmt-btn" aria-label="Heading" title="Heading"
              on:mousedown|preventDefault={() => linePrefix("heading")} use:icon={"heading"}></button>
      <span class="tp-fmt-sep"></span>
      <button class="tp-fmt-btn" aria-label="Bullet list" title="Bullet list"
              on:mousedown|preventDefault={() => linePrefix("bullet")} use:icon={"list"}></button>
      <button class="tp-fmt-btn" aria-label="Numbered list" title="Numbered list"
              on:mousedown|preventDefault={() => linePrefix("number")} use:icon={"list-ordered"}></button>
      <span class="tp-fmt-sep"></span>
      <div class="tp-fmt-hl">
        <button class="tp-fmt-btn tp-fmt-hl-main" aria-label="Highlight" title="Highlight"
                on:mousedown|preventDefault={() => applyHighlight(lastHighlight)}>
          <span use:icon={"highlighter"}></span>
          <span class="tp-fmt-hl-bar" style="background:{lastHighlight}"></span>
        </button>
        <button class="tp-fmt-btn tp-fmt-hl-caret" aria-label="Highlight colour"
                on:mousedown|preventDefault={toggleSwatches} use:icon={"chevron-down"}></button>
        {#if showSwatches}
          <div class="tp-fmt-swatches" role="toolbar" tabindex="-1" aria-label="Highlight colours" on:mousedown={(e) => e.stopPropagation()}>
            {#each HL_COLOURS as c}
              <span class="tp-fmt-swatch" title={c.name} style="background:{c.value}"
                    class:tp-fmt-swatch--active={c.value === lastHighlight}
                    role="button" tabindex="0"
                    on:mousedown|preventDefault={() => applyHighlight(c.value)}></span>
            {/each}
          </div>
        {/if}
      </div>
      {#if useLive}
        <span class="tp-fmt-spacer"></span>
        <button class="tp-fmt-btn" aria-label="Open week note in a pane" title="Open full note"
                on:click={openWeekNoteInPane} use:icon={"maximize-2"}></button>
      {/if}
    </div>

    <!-- Editor + rendered preview overlay -->
    <div class="tp-sb-notes-body">
      {#if useLive}
        <div class="tp-sb-notes-live-wrap">
          <div class="tp-sb-notes-live" bind:this={liveEl}></div>
          {#if liveEmpty}<div class="tp-sb-notes-live-ph">{notesPlaceholder}</div>{/if}
        </div>
      {:else}
        <textarea
          class="tp-sb-notes-textarea"
          bind:this={textareaEl}
          placeholder={notesPlaceholder}
          value={notesValue}
          on:blur={onNotesBlur}
        ></textarea>
        <div
          class="tp-sb-notes-preview"
          class:tp-sb-notes-preview--hidden={editing || !notesValue.trim()}
          bind:this={previewEl}
          role="button"
          tabindex="0"
          on:click={enterEdit}
          on:keydown={(e) => e.key === "Enter" && enterEdit()}
        ></div>
      {/if}
    </div>
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
    color: var(--text-muted); padding: 0 0 8px;
  }
  .tp-cal-day {
    text-align: center; font-size: 13px; padding: 3px 2px;
    color: var(--text-normal); line-height: 1; min-height: 28px;
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

  /* Toolbar */
  .tp-sb-notes-toolbar {
    display: flex; align-items: center; flex-wrap: wrap; gap: 1px;
    padding: 4px 5px;
    border-bottom: 1px solid var(--background-modifier-border);
  }
  .tp-fmt-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 26px; height: 26px; padding: 0;
    background: transparent; border: none; border-radius: 5px;
    color: var(--text-muted); cursor: pointer; box-shadow: none;
  }
  .tp-fmt-btn:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
  .tp-fmt-btn :global(svg) { width: 15px; height: 15px; }
  .tp-fmt-sep { width: 1px; height: 16px; background: var(--background-modifier-border); margin: 0 3px; }

  /* Highlight split button + swatches */
  .tp-fmt-hl { position: relative; display: inline-flex; align-items: center; }
  .tp-fmt-hl-main { flex-direction: column; gap: 1px; width: 26px; }
  .tp-fmt-hl-bar { width: 14px; height: 3px; border-radius: 1px; }
  .tp-fmt-hl-caret { width: 16px; }
  .tp-fmt-hl-caret :global(svg) { width: 11px; height: 11px; }
  .tp-fmt-swatches {
    position: absolute; top: 30px; right: 0; z-index: 30;
    display: flex; gap: 6px; padding: 7px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 7px; box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  }
  .tp-fmt-swatch {
    width: 18px; height: 18px; border-radius: 4px; cursor: pointer;
    box-shadow: inset 0 0 0 1px rgba(0,0,0,0.12);
  }
  .tp-fmt-swatch--active { box-shadow: 0 0 0 2px var(--text-normal); }

  /* Editor body + preview overlay */
  .tp-sb-notes-body { position: relative; flex: 1; display: flex; min-height: 0; }
  .tp-sb-notes-live-wrap { position: relative; flex: 1; min-height: 0; display: flex; }
  .tp-sb-notes-live { flex: 1; min-height: 0; overflow: auto; }
  .tp-sb-notes-live-ph { position: absolute; top: 4px; left: 8px; right: 8px; pointer-events: none; color: var(--text-faint); font-style: italic; font-size: 12px; line-height: 1.5; }
  .tp-sb-notes-live :global(.cm-editor) { height: 100%; background: transparent; }
  .tp-sb-notes-live :global(.cm-scroller) { font-family: var(--font-text); font-size: 13px; line-height: 1.5; }
  .tp-sb-notes-live :global(.cm-content) { padding: 4px 6px; }
  .tp-fmt-spacer { margin-left: auto; }
  .tp-sb-notes-textarea {
    flex: 1; resize: none; width: 100%;
    box-sizing: border-box; padding: 10px 12px;
    background: transparent; color: var(--text-normal);
    border: none; outline: none; overflow-y: auto;
    font-family: var(--font-text); font-size: 13px; line-height: 1.5;
  }
  .tp-sb-notes-textarea::placeholder { color: var(--text-faint); font-style: italic; font-size: 12px; }
  .tp-sb-notes-preview {
    position: absolute; inset: 0; overflow-y: auto; cursor: text;
    padding: 4px 12px 10px;
    background: var(--background-secondary);
    color: var(--text-normal);
    font-family: var(--font-text); font-size: 13px; line-height: 1.5;
  }
  .tp-sb-notes-preview--hidden { display: none; }
  .tp-sb-notes-preview :global(p) { margin: 6px 0; }
  .tp-sb-notes-preview :global(ul),
  .tp-sb-notes-preview :global(ol) { margin: 6px 0; padding-left: 20px; }
  .tp-sb-notes-preview :global(h1),
  .tp-sb-notes-preview :global(h2),
  .tp-sb-notes-preview :global(h3) { margin: 8px 0 4px; line-height: 1.3; }

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
