<script lang="ts">
  import type TeacherPlannerPlugin from "../main";
  import type { ClassGroup } from "../types";
  import { setIcon, Platform } from "obsidian";
  import { tick as svelteTick } from "svelte";
  import { classOccurrences, groupByWeek, nextOccurrence, type LessonOccurrence } from "../utils/lessonOccurrences";
  import { getSlotPlan, setSlotPlan, clearSlotPlan, isSlotPrepared, toggleSlotPrepared, getSlotExternal, setSlotExternal, clearSlotExternal, externalKindOf, getLessonNote, setLessonNote, clearLessonNote, getLessonRoom, setLessonRoom, clearLessonRoom } from "../utils/planLinkUtils";
  import { shiftForward, shiftBackward, snapshotState, restoreState, type ShiftSnapshot } from "../utils/lessonShiftApply";
  import { applyNoteMoves, reverseNoteMoves, type NoteUndoOp, lessonNoteDefaultTitle, findLessonNoteByTitle, createLessonNoteFile } from "../utils/lessonNoteFiles";
  import { LessonPlanSuggestModal } from "../modals/LessonPlanSuggestModal";
  import { DatePickerModal } from "../modals/DatePickerModal";
  import { getMondayOfWeek } from "../utils/weekUtils";
  import { openSystemPath, openOSFilePicker, openOSFolderPicker } from "../utils/exportDestination";
  import { ConfirmModal, TextPromptModal } from "../settings/SettingsTab";

  export let plugin: TeacherPlannerPlugin;

  function obsIcon(node: HTMLElement, id: string) { setIcon(node, id); return { update(n: string) { setIcon(node, n); } }; }
  function dep<T>(_t: unknown, v: T): T { return v; }

  let _tick = 0;
  const refresh = () => { _tick++; };

  const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayIso = isoLocal(new Date());
  const currentWeekKey = isoLocal(getMondayOfWeek(new Date()));

  $: subjects = dep(_tick, plugin.settings.subjects ?? []);
  $: classes = dep(_tick, (plugin.settings.classes ?? []).filter(c => !c.archived));

  let selectedClassId: string | null = null;
  let classSearch = "";
  let jump = "";
  let listEl: HTMLElement | undefined;
  let menuKey: string | null = null;
  let panelNote = "";
  let panelRoom = "";
  const isMobile = Platform.isMobileApp;
  let lastSnap: ShiftSnapshot | null = null;
  let lastNoteUndo: NoteUndoOp[] = [];
  let toast = "";

  const keyOf = (o: LessonOccurrence) => o.slotId + "|" + o.date;
  const subjectFor = (c: ClassGroup) => subjects.find(s => s.id === c.subjectId);
  const emojiFor = (c: ClassGroup | undefined) => (c ? subjectFor(c)?.emoji ?? "" : "");
  const shortPeriod = (name: string) => name.replace(/^Period\s+/i, "P");
  const fmtWeek = (k: string) => { const [y, m, d] = k.split("-"); return `${d}/${m}/${y}`; };
  const fmtDay = (o: LessonOccurrence) => new Date(o.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric" });

  $: filteredClasses = classes.filter(c => {
    const q = classSearch.trim().toLowerCase();
    if (!q) return true;
    return c.code.toLowerCase().includes(q) || (subjectFor(c)?.name ?? "").toLowerCase().includes(q);
  });

  $: nextLabels = (() => {
    const m = new Map<string, string>();
    for (const c of classes) {
      const nx = nextOccurrence(classOccurrences(plugin.settings, c.id), todayIso);
      if (!nx) { m.set(c.id, "No lessons"); continue; }
      const d = new Date(nx.date + "T12:00:00");
      m.set(c.id, `${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} · ${shortPeriod(nx.periodName)}`);
    }
    return m;
  })();

  $: occurrences = dep(_tick, selectedClassId ? classOccurrences(plugin.settings, selectedClassId) : []);
  $: weeks = groupByWeek(occurrences);
  $: selectedClass = classes.find(c => c.id === selectedClassId);
  $: unplacedForClass = dep(_tick, (plugin.settings.unplacedLessons ?? []).filter(u => u.classId === selectedClassId));

  function planTitle(o: LessonOccurrence): string {
    const link = getSlotPlan(plugin.settings, o.slotId, o.date);
    if (!link?.path) return "";
    return (link.path.split("/").pop() ?? link.path).replace(/\.md$/, "");
  }
  const lessonNote = (o: LessonOccurrence) => getLessonNote(plugin.settings, o.slotId, o.date);

  function mainLine(o: LessonOccurrence): { text: string; faint: boolean } {
    const mode = plugin.settings.lessonOverviewMainLine ?? "notes-plan";
    const notes = (lessonNote(o) || o.notes || "").replace(/\s+/g, " ").trim();
    const plan = planTitle(o);
    if (mode === "notes") return notes ? { text: notes, faint: false } : { text: "No notes", faint: true };
    if (mode === "plan") return plan ? { text: plan, faint: false } : { text: "—", faint: true };
    if (notes) return { text: notes, faint: false };
    if (plan) return { text: "No notes  -  " + plan, faint: true };
    return { text: "No notes", faint: true };
  }
  function toggleMenu(o: LessonOccurrence) {
    if (menuKey === keyOf(o)) { void savePanel(o); menuKey = null; }
    else openPanel(o);
  }

  function openPlan(o: LessonOccurrence) {
    const link = getSlotPlan(plugin.settings, o.slotId, o.date);
    if (link?.path) void plugin.app.workspace.openLinkText(link.path, "", false);
  }
  function openExternal(o: LessonOccurrence) {
    const ext = getSlotExternal(plugin.settings, o.slotId, o.date);
    if (ext?.path) openSystemPath(ext.path);
  }
  async function togglePrep(o: LessonOccurrence) {
    toggleSlotPrepared(plugin.settings, o.slotId, o.date);
    await plugin.saveSettings();
    refresh();
  }

  const defaultRoom = (o: LessonOccurrence) => o.classroom ?? "";

  function openPanel(o: LessonOccurrence) {
    menuKey = keyOf(o);
    panelNote = lessonNote(o) || o.notes;
    panelRoom = getLessonRoom(plugin.settings, o.slotId, o.date) || defaultRoom(o);
  }
  async function savePanel(o: LessonOccurrence) {
    if (panelNote.trim() === (o.notes || "").trim()) clearLessonNote(plugin.settings, o.slotId, o.date);
    else setLessonNote(plugin.settings, o.slotId, o.date, panelNote);
    if (panelRoom.trim() === defaultRoom(o).trim()) clearLessonRoom(plugin.settings, o.slotId, o.date);
    else setLessonRoom(plugin.settings, o.slotId, o.date, panelRoom);
    await plugin.saveSettings();
    refresh();
  }

  function linkPlan(o: LessonOccurrence) {
    const code = selectedClass?.code ?? "";
    const subject = selectedClass ? subjectFor(selectedClass)?.name ?? "" : "";
    new LessonPlanSuggestModal(plugin.app, plugin, code, subject, async (path) => {
      setSlotPlan(plugin.settings, o.slotId, o.date, path);
      await plugin.saveSettings(); refresh();
    }).open();
  }
  async function unlinkPlan(o: LessonOccurrence) { clearSlotPlan(plugin.settings, o.slotId, o.date); await plugin.saveSettings(); refresh(); }
  async function linkExtFile(o: LessonOccurrence) { const path = await openOSFilePicker("Link a file to this lesson"); if (path) { setSlotExternal(plugin.settings, o.slotId, o.date, path, "file"); await plugin.saveSettings(); refresh(); } }
  async function linkExtFolder(o: LessonOccurrence) { const path = await openOSFolderPicker(); if (path) { setSlotExternal(plugin.settings, o.slotId, o.date, path, "folder"); await plugin.saveSettings(); refresh(); } }
  async function unlinkExternal(o: LessonOccurrence) { clearSlotExternal(plugin.settings, o.slotId, o.date); await plugin.saveSettings(); refresh(); }
  function doLessonNote(o: LessonOccurrence) {
    const cid = selectedClassId; if (!cid) return;
    const title = lessonNoteDefaultTitle(plugin.settings, cid, o.periodName, o.date);
    const existing = findLessonNoteByTitle(plugin.app, plugin.settings, o.date, title);
    if (existing) { void plugin.app.workspace.openLinkText(existing, "", false); return; }
    new TextPromptModal(plugin.app, "New lesson note", title, "Note title", (name) => {
      void createLessonNoteFile(plugin.app, plugin.settings, cid, o.periodName, o.date, name);
    }).open();
  }

  const idxOf = (o: LessonOccurrence) => occurrences.findIndex(x => x.slotId === o.slotId && x.date === o.date);
  async function runShift(idx: number, dir: "forward" | "backward") {
    const cid = selectedClassId;
    if (!cid) return;
    lastSnap = snapshotState(plugin.settings);
    const res = dir === "forward" ? shiftForward(plugin.settings, cid, idx) : shiftBackward(plugin.settings, cid, idx);
    lastNoteUndo = await applyNoteMoves(plugin.app, plugin.settings, cid, res.noteMoves);
    await plugin.saveSettings();
    refresh();
    toast = dir === "forward"
      ? (res.overflowed ? "Shifted forward — last lesson moved to Unplaced." : "Lessons shifted forward.")
      : (res.parked ? "Pulled back — this lesson moved to Unplaced." : res.filled ? "Pulled back — an Unplaced lesson dropped in." : "Lessons pulled back.");
  }
  async function shiftFwd(o: LessonOccurrence) {
    await savePanel(o);
    const i = idxOf(o); if (i < 0) return; menuKey = null;
    const aff = occurrences.length - i;
    if (aff > 5) {
      new ConfirmModal(plugin.app,
        `This moves ${aff} lessons forward from ${fmtDay(o)}. The last lesson moves to Unplaced. Continue?`,
        () => void runShift(i, "forward"), "Shift forward").open();
    } else void runShift(i, "forward");
  }
  async function shiftBack(o: LessonOccurrence) { await savePanel(o); const i = idxOf(o); if (i < 0) return; menuKey = null; void runShift(i, "backward"); }
  async function undoShift() {
    if (!lastSnap) return;
    restoreState(plugin.settings, lastSnap);
    await reverseNoteMoves(plugin.app, lastNoteUndo);
    lastSnap = null;
    lastNoteUndo = [];
    await plugin.saveSettings();
    toast = "";
    refresh();
  }

  function selectClass(id: string) { selectedClassId = id; void svelteTick().then(scrollToCurrent); }
  function onPickClass(e: Event) { selectClass((e.currentTarget as HTMLSelectElement).value); }
  function onCardKey(e: KeyboardEvent, id: string) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectClass(id); } }
  function scrollToCurrent() {
    const el = listEl?.querySelector<HTMLElement>(`[data-week="${currentWeekKey}"]`);
    if (el) el.scrollIntoView({ block: "start" });
  }
  function jumpTo() {
    if (!jump) return;
    const m = isoLocal(getMondayOfWeek(new Date(jump + "T12:00:00")));
    const el = listEl?.querySelector<HTMLElement>(`[data-week="${m}"]`);
    if (el) el.scrollIntoView({ block: "start" });
  }
  function openJump() {
    const ay = plugin.settings.academicYear;
    new DatePickerModal(plugin.app, {
      value: jump || todayIso,
      min: ay?.startDate,
      max: ay?.endDate,
      onPick: (iso) => { jump = iso; jumpTo(); },
    }).open();
  }

  // Prepared-tick contrast: pick black/white from --color-green's luminance so the
  // tick stays visible on light or dark theme greens.
  let _prepRootEl: HTMLElement;
  function _prepContrast(green: string): string {
    const t = green.trim();
    let r = 0, g = 0, b = 0;
    if (t.startsWith("#")) {
      let h = t.slice(1);
      if (h.length === 3) h = h.split("").map(x => x + x).join("");
      if (h.length < 6) return "#fff";
      r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
    } else {
      const m = t.match(/rgba?\(([^)]+)\)/);
      if (!m) return "#fff";
      const ps = m[1].split(",").map(n => parseFloat(n));
      if (ps.length < 3 || ps.slice(0, 3).some(n => isNaN(n))) return "#fff";
      [r, g, b] = ps;
    }
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? "#000" : "#fff";
  }
  $: _prepFg = _prepRootEl ? _prepContrast(getComputedStyle(_prepRootEl).getPropertyValue("--color-green")) : "#fff";
</script>

<div class="tp-lo" bind:this={_prepRootEl} style="--tp-prep-fg:{_prepFg}">
  <div class="tp-lo-head"><h3 class="tp-lo-title">Lesson overview</h3></div>
  {#if isMobile}
    <div class="tp-lo-classpick">
      <select class="tp-lo-select" on:change={onPickClass}>
        <option value="" disabled selected={!selectedClassId}>Select a class…</option>
        {#each classes as c (c.id)}
          <option value={c.id} selected={c.id === selectedClassId}>{[emojiFor(c), c.code].filter(Boolean).join(" ")}{#if subjectFor(c)?.name} · {subjectFor(c)?.name}{/if}</option>
        {/each}
      </select>
    </div>
  {:else}
    <div class="tp-lo-search">
      <span class="tp-lo-search-icon" use:obsIcon={"search"}></span>
      <input type="text" bind:value={classSearch} placeholder="Search classes…" />
    </div>
    <div class="tp-lo-cards">
      {#each filteredClasses as c (c.id)}
        <div class="tp-lo-card" class:tp-lo-card--selected={c.id === selectedClassId} role="button" tabindex="0" style="border-left:3px solid {c.colour};" on:click={() => selectClass(c.id)} on:keydown={(e) => onCardKey(e, c.id)}>
          <span class="tp-lo-card-code">{#if emojiFor(c)}<span class="tp-lo-card-emoji">{emojiFor(c)}</span>{/if}<span class="tp-lo-card-codetext">{c.code}</span></span>
          <span class="tp-lo-card-sub">{[subjectFor(c)?.name, c.year ? "Yr" + c.year : ""].filter(Boolean).join(" · ")}</span>
          <span class="tp-lo-card-next">Next: {nextLabels.get(c.id) ?? "—"}</span>
        </div>
      {/each}
      {#if filteredClasses.length === 0}<div class="tp-lo-empty">No classes</div>{/if}
    </div>
  {/if}

  {#if selectedClassId}
    <div class="tp-lo-subhead">
      <h3 class="tp-lo-title">{emojiFor(selectedClass)} {selectedClass?.code ?? ""} · lessons</h3>
      <button class="tp-lo-jump" title="Jump to a date" on:click={openJump} aria-label="Jump to a date">
        <span use:obsIcon={"calendar-search"}></span>
        <span class="tp-lo-jump-label">Jump to date</span>
      </button>
    </div>
    <div class="tp-lo-list" bind:this={listEl}>
      {#each weeks as w (w.weekKey)}
        {@const isCurrent = w.weekKey === currentWeekKey}
        <div class="tp-lo-weekhead" class:tp-lo-weekhead--current={isCurrent} data-week={w.weekKey}>
          <span>{isCurrent ? "This week ·" : "Week:"} {fmtWeek(w.weekKey)}</span>
          {#if w.weekType}<span class="tp-lo-ab" class:tp-lo-ab--current={isCurrent}>{w.weekType}</span>{/if}
        </div>
        {#each w.lessons as o (keyOf(o))}
          {@const past = o.date < todayIso}
          {@const ml = mainLine(o)}
          <div class="tp-lo-row" class:tp-lo-row--past={past} class:tp-lo-row--current={isCurrent && !past} class:tp-lo-row--open={menuKey === keyOf(o)} class:tp-lo-row--dim={menuKey !== null && menuKey !== keyOf(o)}>
            <div class="tp-lo-row-main">
              <button class="tp-lo-rowbtn" on:click={() => toggleMenu(o)} aria-expanded={menuKey === keyOf(o)}>
                <span class="tp-lo-rowtext">
                  <span class="tp-lo-when">{fmtDay(o)} · {shortPeriod(o.periodName)}</span>
                  <span class="tp-lo-topic" class:tp-lo-topic--faint={ml.faint}>{ml.text}</span>
                </span>
              </button>
              <span class="tp-lo-icons">
                {#if past}<span class="tp-lo-taught" title="Taught" use:obsIcon={"circle-check"}></span>{/if}
                <button class="tp-lo-prep" class:tp-lo-prep--on={isSlotPrepared(plugin.settings, o.slotId, o.date)}
                  title={isSlotPrepared(plugin.settings, o.slotId, o.date) ? "Marked prepared — click to clear" : "Mark prepared"}
                  aria-label="Toggle prepared" aria-pressed={isSlotPrepared(plugin.settings, o.slotId, o.date)}
                  on:click|stopPropagation={() => togglePrep(o)} use:obsIcon={"check"}></button>
                {#if getSlotPlan(plugin.settings, o.slotId, o.date)}
                  <button class="tp-lo-ic tp-lo-ic--plan" title="Open lesson plan" on:click|stopPropagation={() => openPlan(o)} use:obsIcon={"file-text"}></button>
                {/if}
                {#if getSlotExternal(plugin.settings, o.slotId, o.date)}
                  {@const ext = getSlotExternal(plugin.settings, o.slotId, o.date)}
                  <button class="tp-lo-ic" title="Open external resource" on:click|stopPropagation={() => openExternal(o)}
                    use:obsIcon={ext && externalKindOf(ext) === "folder" ? "folder" : "paperclip"}></button>
                {/if}
                {#if menuKey === keyOf(o)}<span class="tp-lo-editing">editing</span>{/if}
                <span class="tp-lo-chev" class:tp-lo-chev--open={menuKey === keyOf(o)} use:obsIcon={"chevron-down"}></span>
              </span>
            </div>

            {#if menuKey === keyOf(o)}
              <div class="tp-lo-panel">
                <label class="tp-lo-field">
                  <span class="tp-lo-field-label">Notes</span>
                  <textarea class="tp-lo-noteedit" rows="2" placeholder="Notes for this lesson…"
                    bind:value={panelNote} on:blur={() => savePanel(o)}></textarea>
                </label>
                <label class="tp-lo-field">
                  <span class="tp-lo-field-label">Room</span>
                  <input class="tp-lo-roomedit" type="text" placeholder={defaultRoom(o) || "Room"}
                    bind:value={panelRoom} on:blur={() => savePanel(o)} />
                </label>
                <div class="tp-lo-menu">
                  <button on:click={() => doLessonNote(o)}><span use:obsIcon={"book-open"}></span> Lesson note</button>
                  {#if getSlotPlan(plugin.settings, o.slotId, o.date)}
                    <button on:click={() => openPlan(o)}><span use:obsIcon={"file-text"}></span> Open lesson plan</button>
                    <button on:click={() => unlinkPlan(o)}><span use:obsIcon={"unlink"}></span> Unlink lesson plan</button>
                  {:else}
                    <button on:click={() => linkPlan(o)}><span use:obsIcon={"file-plus"}></span> Link lesson plan…</button>
                  {/if}
                  <button on:click={() => togglePrep(o)}><span use:obsIcon={isSlotPrepared(plugin.settings, o.slotId, o.date) ? "x" : "check"}></span> {isSlotPrepared(plugin.settings, o.slotId, o.date) ? "Clear prepared mark" : "Mark prepared"}</button>
                  {#if getSlotExternal(plugin.settings, o.slotId, o.date)}
                    <button on:click={() => openExternal(o)}><span use:obsIcon={"external-link"}></span> Open external resource</button>
                    <button on:click={() => unlinkExternal(o)}><span use:obsIcon={"unlink"}></span> Unlink external resource</button>
                  {:else if !isMobile}
                    <button on:click={() => linkExtFile(o)}><span use:obsIcon={"paperclip"}></span> Link external file…</button>
                    <button on:click={() => linkExtFolder(o)}><span use:obsIcon={"folder-open"}></span> Link external folder…</button>
                  {/if}
                  <div class="tp-lo-menu-sep"></div>
                  <button on:click={() => shiftFwd(o)}><span use:obsIcon={"chevrons-right"}></span> Push lessons forward</button>
                  <button on:click={() => shiftBack(o)}><span use:obsIcon={"chevrons-left"}></span> Pull lessons back</button>
                  <button on:click={() => shiftFwd(o)}><span use:obsIcon={"square-plus"}></span> Insert a free lesson here</button>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      {/each}

      {#if unplacedForClass.length}
        <div class="tp-lo-unplaced">
          <div class="tp-lo-unplaced-head"><span use:obsIcon={"alert-triangle"}></span> Unplaced lessons ({unplacedForClass.length})</div>
          {#each unplacedForClass as u (u.id)}
            <div class="tp-lo-unplaced-row">{u.label ?? "Lesson"}</div>
          {/each}
          <div class="tp-lo-unplaced-hint">Pushed off the end of the year. Pull a run back, or free up a slot, to drop these back in.</div>
        </div>
      {/if}

      {#if occurrences.length === 0}<div class="tp-lo-empty">No lessons for this class this year.</div>{/if}
      {#if isMobile}<div class="tp-lo-tail" aria-hidden="true"></div>{/if}
    </div>

    {#if toast}
      <div class="tp-lo-toast">
        <span>{toast}</span>
        <button on:click={undoShift}><span use:obsIcon={"arrow-back-up"}></span> Undo</button>
        <button class="tp-lo-toast-x" on:click={() => toast = ""} use:obsIcon={"x"} aria-label="Dismiss"></button>
      </div>
    {/if}
  {:else}
    <div class="tp-lo-hint">Select a class above to see its lessons.</div>
  {/if}
</div>

<style>
  .tp-lo { display:flex; flex-direction:column; min-height:0; height:100%; font-family:var(--font-interface); position:relative; }
  .tp-lo-head { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
  .tp-lo-title { margin:0; font-size:17px; font-weight:600; flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .tp-lo-subhead { display:flex; align-items:center; gap:10px; margin:12px 0 10px; padding-top:11px; border-top:1px solid var(--background-modifier-border); }
  .tp-lo-hint { flex:1 1 auto; display:flex; align-items:center; justify-content:center; text-align:center; color:var(--text-faint); font-size:13px; padding:24px 12px; }

  .tp-lo-search { position:relative; margin-bottom:12px; }
  .tp-lo-classpick { margin-bottom:12px; }
  .tp-lo-select { width:100%; box-sizing:border-box; padding:11px 12px; border:1px solid var(--background-modifier-border); border-radius:8px; background:var(--background-modifier-form-field); color:var(--text-normal); font-size:15px; font-family:var(--font-interface); }
  .tp-lo-search-icon { position:absolute; left:10px; top:8px; color:var(--text-muted); display:inline-flex; }
  .tp-lo-search-icon :global(svg) { width:16px; height:16px; }
  .tp-lo-search input { width:100%; box-sizing:border-box; padding:7px 10px 7px 32px; border:1px solid var(--background-modifier-border); border-radius:6px; background:var(--background-modifier-form-field); color:var(--text-normal); font-size:13px; }

  .tp-lo-cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); align-content:start; align-items:start; gap:9px; overflow-y:auto; padding:2px; min-height:0; flex:0 0 auto; max-height:260px; }
  .tp-lo-card { display:flex; flex-direction:column; gap:3px; min-width:0; text-align:left; padding:10px 12px; border:1px solid var(--background-modifier-border); border-radius:7px; background:var(--background-primary); cursor:pointer; transition:background 0.1s; }
  .tp-lo-card:hover { background:var(--background-modifier-hover); }
  .tp-lo-card--selected { border-color:var(--interactive-accent); box-shadow:inset 0 0 0 1px var(--interactive-accent); background:color-mix(in srgb, var(--interactive-accent) 8%, var(--background-primary)); }
  .tp-lo-card-code { display:flex; align-items:center; gap:6px; min-width:0; font-size:15px; font-weight:600; line-height:1.5; color:var(--text-normal); }
  .tp-lo-card-emoji { flex-shrink:0; font-size:14px; line-height:1; }
  .tp-lo-card-codetext { min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .tp-lo-card-sub { display:block; font-size:12px; color:var(--text-muted); margin-top:2px; }
  .tp-lo-card-next { display:block; font-size:12px; color:var(--text-faint); margin-top:4px; }

  .tp-lo-jump { display:inline-flex; align-items:center; gap:5px; font-size:12px; padding:5px 9px; border:1px solid var(--background-modifier-border); border-radius:8px; background:var(--background-primary); color:var(--text-muted); cursor:pointer; font-family:var(--font-interface); }
  .tp-lo-jump:hover { background:var(--background-modifier-hover); }
  .tp-lo-jump :global(svg) { width:15px; height:15px; }
  .tp-lo-tail { flex:0 0 auto; height:calc(96px + env(safe-area-inset-bottom, 0px)); }

  .tp-lo-list { overflow-y:auto; min-height:0; flex:1 1 auto; border:1px solid var(--background-modifier-border); border-radius:8px; }
  .tp-lo-weekhead { position:sticky; top:0; z-index:1; display:flex; align-items:center; gap:8px; padding:9px 13px; background:var(--background-secondary); font-size:16px; font-weight:600; color:var(--interactive-accent); border-bottom:1px solid var(--background-modifier-border); }
  .tp-lo-weekhead--current { background:color-mix(in srgb, var(--interactive-accent) 16%, var(--background-secondary)); color:var(--text-normal); }
  .tp-lo-ab { border:1px solid var(--background-modifier-border); border-radius:4px; padding:1px 9px; font-size:13px; font-weight:700; }
  .tp-lo-ab--current { border-color:var(--interactive-accent); }

  .tp-lo-row { padding:11px 13px; border-bottom:1px solid var(--background-modifier-border-hover); transition:opacity 0.12s, background 0.12s; }
  .tp-lo-row:last-child { border-bottom:none; }
  .tp-lo-row--past { opacity:0.55; }
  .tp-lo-row--current { background:color-mix(in srgb, var(--interactive-accent) 8%, transparent); }
  .tp-lo-row--dim { opacity:0.5; }
  .tp-lo-row--open { border-left:3px solid var(--interactive-accent); padding-left:10px; background:color-mix(in srgb, var(--interactive-accent) 12%, transparent); }
  .tp-lo-row--open .tp-lo-when { font-size:16px; color:var(--interactive-accent); }
  .tp-lo-row--open .tp-lo-topic { color:var(--interactive-accent); opacity:0.85; }
  .tp-lo-editing { align-self:center; flex-shrink:0; margin-right:2px; font-size:11px; font-weight:600; color:var(--interactive-accent); border:1px solid var(--interactive-accent); border-radius:5px; padding:1px 7px; }
  .tp-lo-row-main { display:flex; align-items:center; gap:10px; }
  .tp-lo-when { font-size:15px; font-weight:500; color:var(--text-normal); }
  .tp-lo-row--current .tp-lo-when { font-weight:600; color:var(--text-normal); }
  .tp-lo-topic { display:block; max-width:100%; font-size:13px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .tp-lo-topic--faint { color:var(--text-faint); }
  .tp-lo-rowbtn { flex:1; min-width:0; display:flex; align-items:center; text-align:left; border:none; background:transparent; box-shadow:none; outline:none; border-radius:0; cursor:pointer; padding:0; color:inherit; font-family:var(--font-interface); }
  .tp-lo-rowbtn:hover .tp-lo-when { color:var(--interactive-accent); }
  .tp-lo-rowtext { display:flex; flex-direction:column; gap:3px; min-width:0; width:100%; }
  .tp-lo-chev { display:inline-flex; color:var(--text-faint); margin-left:2px; transition:transform 0.12s; }
  .tp-lo-chev :global(svg) { width:15px; height:15px; }
  .tp-lo-chev--open { transform:rotate(180deg); color:var(--text-muted); }
  .tp-lo-icons { display:flex; align-items:center; gap:3px; flex-shrink:0; }
  .tp-lo-taught { display:inline-flex; color:var(--color-green, #a6e3a1); }
  .tp-lo-taught :global(svg) { width:16px; height:16px; }
  .tp-lo-ic { border:none; background:transparent; box-shadow:none; cursor:pointer; color:var(--text-faint); display:inline-flex; padding:4px; border-radius:4px; }
  .tp-lo-ic:hover { background:var(--background-modifier-hover); color:var(--text-normal); }
  .tp-lo-ic :global(svg) { width:16px; height:16px; }
  .tp-lo-ic--plan { color:var(--color-green); }
  .tp-lo-prep { width:18px; height:18px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; background:transparent; border:1.5px solid var(--text-muted); padding:0; line-height:0; cursor:pointer; color:var(--text-muted); box-sizing:border-box; flex-shrink:0; }
  .tp-lo-prep:hover { color:var(--text-normal); border-color:var(--text-normal); }
  button.tp-lo-prep--on { background:var(--color-green); border-color:var(--color-green); color:var(--tp-prep-fg, #fff); }
  .tp-lo-prep :global(svg) { width:12px; height:12px; }

  .tp-lo-noteedit { width:100%; box-sizing:border-box; margin-top:0; padding:9px 11px; border:1px solid var(--interactive-accent); border-radius:6px; background:var(--background-modifier-form-field); color:var(--text-normal); font-size:13px; line-height:1.4; font-family:var(--font-interface); resize:vertical; }

  .tp-lo-panel { margin-top:8px; }
  .tp-lo-field { display:block; margin-bottom:9px; }
  .tp-lo-field-label { display:block; font-size:12px; font-weight:600; color:var(--text-muted); margin-bottom:4px; }
  .tp-lo-roomedit { width:100%; box-sizing:border-box; padding:9px 11px; border:1px solid var(--background-modifier-border); border-radius:6px; background:var(--background-modifier-form-field); color:var(--text-normal); font-size:13px; font-family:var(--font-interface); }
  .tp-lo-roomedit:focus { border-color:var(--interactive-accent); outline:none; }
  .tp-lo-menu-sep { height:1px; background:var(--background-modifier-border); margin:6px 0; }
  .tp-lo-menu { margin-top:6px; border-radius:6px; background:transparent; overflow:hidden; }
  .tp-lo-menu button { display:flex; align-items:center; justify-content:flex-start; gap:11px; width:100%; text-align:left; padding:12px 14px; border:none; background:transparent; box-shadow:none; outline:none; color:var(--text-normal); font-size:14px; line-height:1.35; cursor:pointer; font-family:var(--font-interface); }
  .tp-lo-menu button:hover { background:var(--background-modifier-hover); }
  .tp-lo-menu :global(svg) { width:16px; height:16px; flex-shrink:0; color:var(--text-muted); }

  .tp-lo-unplaced { margin:10px; border:1px dashed var(--color-orange, #e0af68); border-radius:7px; padding:9px 11px; }
  .tp-lo-unplaced-head { display:flex; align-items:center; gap:6px; font-size:12px; font-weight:600; color:var(--color-orange, #e0af68); margin-bottom:6px; }
  .tp-lo-unplaced-head :global(svg) { width:14px; height:14px; }
  .tp-lo-unplaced-row { font-size:13px; color:var(--text-normal); padding:3px 0; }
  .tp-lo-unplaced-hint { font-size:11px; color:var(--text-muted); margin-top:6px; }

  .tp-lo-empty { padding:20px; text-align:center; color:var(--text-muted); font-size:13px; }

  .tp-lo-toast { display:flex; align-items:center; gap:10px; margin-top:10px; padding:8px 12px; border-radius:7px; background:var(--background-secondary); border:1px solid var(--background-modifier-border); font-size:13px; }
  .tp-lo-toast > span { flex:1; }
  .tp-lo-toast button { display:inline-flex; align-items:center; gap:5px; border:1px solid var(--background-modifier-border); background:var(--background-primary); border-radius:5px; padding:4px 9px; cursor:pointer; color:var(--text-normal); font-size:12px; }
  .tp-lo-toast button:hover { background:var(--background-modifier-hover); }
  .tp-lo-toast :global(svg) { width:14px; height:14px; }
  .tp-lo-toast-x { padding:4px !important; }
</style>
