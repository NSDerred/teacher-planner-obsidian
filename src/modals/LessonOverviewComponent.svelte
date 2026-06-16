<script lang="ts">
  import type TeacherPlannerPlugin from "../main";
  import type { ClassGroup } from "../types";
  import { setIcon } from "obsidian";
  import { tick as svelteTick } from "svelte";
  import { classOccurrences, groupByWeek, nextOccurrence, type LessonOccurrence } from "../utils/lessonOccurrences";
  import { getSlotPlan, isSlotPrepared, toggleSlotPrepared, getSlotExternal, externalKindOf, getLessonNote, setLessonNote } from "../utils/planLinkUtils";
  import { shiftForward, shiftBackward, snapshotState, restoreState, type ShiftSnapshot } from "../utils/lessonShiftApply";
  import { applyNoteMoves, reverseNoteMoves, type NoteUndoOp } from "../utils/lessonNoteFiles";
  import { getMondayOfWeek } from "../utils/weekUtils";
  import { openSystemPath } from "../utils/exportDestination";
  import { ConfirmModal } from "../settings/SettingsTab";

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
  let editingKey: string | null = null;
  let editingText = "";
  let lastSnap: ShiftSnapshot | null = null;
  let lastNoteUndo: NoteUndoOp[] = [];
  let toast = "";

  const keyOf = (o: LessonOccurrence) => o.slotId + "|" + o.date;
  const subjectFor = (c: ClassGroup) => subjects.find(s => s.id === c.subjectId);
  const emojiFor = (c: ClassGroup | undefined) => (c ? subjectFor(c)?.emoji ?? "" : "");
  const shortPeriod = (name: string) => name.replace(/^Period\s+/i, "P");
  const fmtWeek = (k: string) => new Date(k + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });
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

  function startEditNote(o: LessonOccurrence) { editingKey = keyOf(o); editingText = lessonNote(o); menuKey = null; }
  async function saveNote(o: LessonOccurrence) {
    setLessonNote(plugin.settings, o.slotId, o.date, editingText);
    await plugin.saveSettings();
    editingKey = null;
    refresh();
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
      : (res.filled ? "Pulled back — an Unplaced lesson dropped in." : "Lessons pulled back.");
  }
  function shiftFwd(o: LessonOccurrence) {
    const i = idxOf(o); if (i < 0) return; menuKey = null;
    const aff = occurrences.length - i;
    if (aff > 5) {
      new ConfirmModal(plugin.app,
        `This moves ${aff} lessons forward from ${fmtDay(o)}. The last lesson moves to Unplaced. Continue?`,
        () => void runShift(i, "forward"), "Shift forward").open();
    } else void runShift(i, "forward");
  }
  function shiftBack(o: LessonOccurrence) { const i = idxOf(o); if (i < 0) return; menuKey = null; void runShift(i, "backward"); }
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
  function back() { selectedClassId = null; menuKey = null; editingKey = null; toast = ""; }
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
</script>

<div class="tp-lo">
  {#if !selectedClassId}
    <div class="tp-lo-head"><h3 class="tp-lo-title">Lesson overview</h3></div>
    <div class="tp-lo-search">
      <span class="tp-lo-search-icon" use:obsIcon={"search"}></span>
      <input type="text" bind:value={classSearch} placeholder="Search classes…" />
    </div>
    <div class="tp-lo-cards">
      {#each filteredClasses as c (c.id)}
        <button class="tp-lo-card" style="border-left:3px solid {c.colour};" on:click={() => selectClass(c.id)}>
          <span class="tp-lo-card-code">{emojiFor(c)} {c.code}</span>
          <span class="tp-lo-card-sub">{[subjectFor(c)?.name, c.year ? "Yr" + c.year : ""].filter(Boolean).join(" · ")}</span>
          <span class="tp-lo-card-next">Next: {nextLabels.get(c.id) ?? "—"}</span>
        </button>
      {/each}
      {#if filteredClasses.length === 0}<div class="tp-lo-empty">No classes</div>{/if}
    </div>
  {:else}
    <div class="tp-lo-head">
      <button class="tp-lo-back" on:click={back} aria-label="Back to classes" use:obsIcon={"arrow-left"}></button>
      <h3 class="tp-lo-title">{emojiFor(selectedClass)} {selectedClass?.code ?? ""}</h3>
      <label class="tp-lo-jump" title="Jump to a date">
        <span use:obsIcon={"calendar-search"}></span>
        <input type="date" bind:value={jump} on:change={jumpTo} />
      </label>
    </div>
    <div class="tp-lo-list" bind:this={listEl}>
      {#each weeks as w (w.weekKey)}
        {@const isCurrent = w.weekKey === currentWeekKey}
        <div class="tp-lo-weekhead" class:tp-lo-weekhead--current={isCurrent} data-week={w.weekKey}>
          <span>{isCurrent ? "This week ·" : "Week of"} {fmtWeek(w.weekKey)}</span>
          {#if w.weekType}<span class="tp-lo-ab" class:tp-lo-ab--current={isCurrent}>{w.weekType}</span>{/if}
        </div>
        {#each w.lessons as o (keyOf(o))}
          {@const past = o.date < todayIso}
          <div class="tp-lo-row" class:tp-lo-row--past={past} class:tp-lo-row--current={isCurrent && !past}>
            <div class="tp-lo-row-main">
              <span class="tp-lo-when">{fmtDay(o)} · {shortPeriod(o.periodName)}</span>
              <span class="tp-lo-topic">{planTitle(o) || "—"}</span>
              <span class="tp-lo-icons">
                {#if past}<span class="tp-lo-taught" title="Taught" use:obsIcon={"circle-check"}></span>{/if}
                <button class="tp-lo-ic" class:tp-lo-ic--on={isSlotPrepared(plugin.settings, o.slotId, o.date)}
                  title={isSlotPrepared(plugin.settings, o.slotId, o.date) ? "Prepared — click to clear" : "Mark prepared"}
                  on:click|stopPropagation={() => togglePrep(o)} use:obsIcon={"check"}></button>
                {#if getSlotPlan(plugin.settings, o.slotId, o.date)}
                  <button class="tp-lo-ic tp-lo-ic--plan" title="Open lesson plan" on:click|stopPropagation={() => openPlan(o)} use:obsIcon={"file-text"}></button>
                {/if}
                {#if getSlotExternal(plugin.settings, o.slotId, o.date)}
                  {@const ext = getSlotExternal(plugin.settings, o.slotId, o.date)}
                  <button class="tp-lo-ic" title="Open external resource" on:click|stopPropagation={() => openExternal(o)}
                    use:obsIcon={ext && externalKindOf(ext) === "folder" ? "folder" : "paperclip"}></button>
                {/if}
                <button class="tp-lo-ic" title="Lesson actions" on:click|stopPropagation={() => menuKey = menuKey === keyOf(o) ? null : keyOf(o)} use:obsIcon={"dots"}></button>
              </span>
            </div>

            {#if editingKey === keyOf(o)}
              <!-- svelte-ignore a11y-autofocus -->
              <textarea class="tp-lo-noteedit" bind:value={editingText} rows="2" autofocus
                placeholder="Notes for this lesson…" on:blur={() => saveNote(o)}></textarea>
            {:else if lessonNote(o)}
              <button class="tp-lo-note" on:click={() => startEditNote(o)}>{lessonNote(o)}</button>
            {/if}

            {#if menuKey === keyOf(o)}
              <div class="tp-lo-menu">
                <button on:click={() => shiftFwd(o)}><span use:obsIcon={"player-track-next"}></span> Lesson didn't happen, shift the rest forward</button>
                <button on:click={() => shiftBack(o)}><span use:obsIcon={"player-track-prev"}></span> Pull later lessons back into this slot</button>
                <button on:click={() => shiftFwd(o)}><span use:obsIcon={"square-plus"}></span> Insert a free lesson here</button>
                <button on:click={() => startEditNote(o)}><span use:obsIcon={"pencil"}></span> {lessonNote(o) ? "Edit" : "Add"} notes</button>
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
    </div>

    {#if toast}
      <div class="tp-lo-toast">
        <span>{toast}</span>
        <button on:click={undoShift}><span use:obsIcon={"arrow-back-up"}></span> Undo</button>
        <button class="tp-lo-toast-x" on:click={() => toast = ""} use:obsIcon={"x"} aria-label="Dismiss"></button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .tp-lo { display:flex; flex-direction:column; min-height:0; max-height:72vh; font-family:var(--font-interface); position:relative; }
  .tp-lo-head { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
  .tp-lo-title { margin:0; font-size:17px; font-weight:600; flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .tp-lo-back { border:none; background:transparent; cursor:pointer; color:var(--text-muted); display:inline-flex; padding:4px; border-radius:5px; }
  .tp-lo-back:hover { background:var(--background-modifier-hover); color:var(--text-normal); }

  .tp-lo-search { position:relative; margin-bottom:12px; }
  .tp-lo-search-icon { position:absolute; left:10px; top:8px; color:var(--text-muted); display:inline-flex; }
  .tp-lo-search-icon :global(svg) { width:16px; height:16px; }
  .tp-lo-search input { width:100%; box-sizing:border-box; padding:7px 10px 7px 32px; border:1px solid var(--background-modifier-border); border-radius:6px; background:var(--background-modifier-form-field); color:var(--text-normal); font-size:13px; }

  .tp-lo-cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:9px; overflow-y:auto; padding:2px; min-height:0; }
  .tp-lo-card { display:flex; flex-direction:column; gap:2px; text-align:left; padding:9px 11px; border:1px solid var(--background-modifier-border); border-radius:7px; background:var(--background-primary); cursor:pointer; transition:background 0.1s; }
  .tp-lo-card:hover { background:var(--background-modifier-hover); }
  .tp-lo-card-code { font-size:14px; font-weight:600; color:var(--text-normal); }
  .tp-lo-card-sub { font-size:11px; color:var(--text-muted); }
  .tp-lo-card-next { font-size:11px; color:var(--text-faint); margin-top:4px; }

  .tp-lo-jump { display:inline-flex; align-items:center; gap:5px; color:var(--text-muted); }
  .tp-lo-jump :global(svg) { width:15px; height:15px; }
  .tp-lo-jump input { font-size:12px; padding:3px 5px; border:1px solid var(--background-modifier-border); border-radius:5px; background:var(--background-modifier-form-field); color:var(--text-normal); }

  .tp-lo-list { overflow-y:auto; min-height:0; border:1px solid var(--background-modifier-border); border-radius:8px; }
  .tp-lo-weekhead { position:sticky; top:0; z-index:1; display:flex; align-items:center; gap:8px; padding:5px 12px; background:var(--background-secondary); font-size:11px; font-weight:600; color:var(--text-muted); border-bottom:1px solid var(--background-modifier-border); }
  .tp-lo-weekhead--current { background:color-mix(in srgb, var(--interactive-accent) 16%, var(--background-secondary)); color:var(--text-normal); }
  .tp-lo-ab { border:1px solid var(--background-modifier-border); border-radius:4px; padding:0 6px; font-weight:700; }
  .tp-lo-ab--current { border-color:var(--interactive-accent); }

  .tp-lo-row { padding:7px 12px; border-bottom:1px solid var(--background-modifier-border-hover); }
  .tp-lo-row:last-child { border-bottom:none; }
  .tp-lo-row--past { opacity:0.55; }
  .tp-lo-row--current { background:color-mix(in srgb, var(--interactive-accent) 8%, transparent); }
  .tp-lo-row-main { display:flex; align-items:center; gap:10px; }
  .tp-lo-when { font-size:12px; color:var(--text-muted); min-width:92px; flex-shrink:0; }
  .tp-lo-row--current .tp-lo-when { font-weight:600; color:var(--text-normal); }
  .tp-lo-topic { flex:1; min-width:0; font-size:13px; color:var(--text-normal); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .tp-lo-icons { display:flex; align-items:center; gap:3px; flex-shrink:0; }
  .tp-lo-taught { display:inline-flex; color:var(--color-green, #a6e3a1); }
  .tp-lo-taught :global(svg) { width:15px; height:15px; }
  .tp-lo-ic { border:none; background:transparent; cursor:pointer; color:var(--text-faint); display:inline-flex; padding:3px; border-radius:4px; }
  .tp-lo-ic:hover { background:var(--background-modifier-hover); color:var(--text-normal); }
  .tp-lo-ic :global(svg) { width:14px; height:14px; }
  .tp-lo-ic--on, .tp-lo-ic--plan { color:var(--color-green, #a6e3a1); }

  .tp-lo-note { display:block; width:100%; text-align:left; margin-top:4px; padding:3px 6px; border:none; border-radius:4px; background:transparent; color:var(--text-muted); font-size:12px; cursor:text; white-space:pre-wrap; }
  .tp-lo-note:hover { background:var(--background-modifier-hover); }
  .tp-lo-noteedit { width:100%; box-sizing:border-box; margin-top:4px; padding:5px 7px; border:1px solid var(--interactive-accent); border-radius:5px; background:var(--background-modifier-form-field); color:var(--text-normal); font-size:12px; font-family:var(--font-interface); resize:vertical; }

  .tp-lo-menu { margin-top:5px; border:1px solid var(--background-modifier-border); border-radius:6px; background:var(--background-primary); box-shadow:0 4px 14px rgba(0,0,0,0.25); overflow:hidden; }
  .tp-lo-menu button { display:flex; align-items:center; gap:8px; width:100%; text-align:left; padding:8px 11px; border:none; background:transparent; color:var(--text-normal); font-size:13px; cursor:pointer; font-family:var(--font-interface); }
  .tp-lo-menu button:hover { background:var(--background-modifier-hover); }
  .tp-lo-menu :global(svg) { width:15px; height:15px; flex-shrink:0; color:var(--text-muted); }

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
