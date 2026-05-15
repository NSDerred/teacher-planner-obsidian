<script lang="ts">
  import { onMount } from "svelte";
  import { CLASS_COLOUR_PALETTE } from "../settings";

  export let initialColour: string = "#4ade80";
  export let label: string = "";
  export let onSave: (colour: string) => Promise<void>;
  export let onCancel: () => void;

  // ── HSV state ──────────────────────────────────────────────────────────────
  let hue = 0;        // 0–360
  let saturation = 0; // 0–1
  let value = 1;      // 0–1 (brightness)
  let hexInput = "";

  // ── Canvas refs ────────────────────────────────────────────────────────────
  let squareEl: HTMLDivElement;
  let hueEl: HTMLDivElement;
  let squareCursor: HTMLDivElement;
  let hueCursor: HTMLDivElement;

  // ── Derived ────────────────────────────────────────────────────────────────
  $: currentHex = hsvToHex(hue, saturation, value);
  $: squareBg = `hsl(${hue}, 100%, 50%)`;
  $: previewBg = hexToRgba(currentHex, 0.18);

  // Initialise from prop
  onMount(() => {
    const hsv = hexToHsv(initialColour);
    hue = hsv.h;
    saturation = hsv.s;
    value = hsv.v;
    hexInput = initialColour;
  });

  // Keep hex input in sync when HSV changes
  $: hexInput = currentHex;

  // ── Mouse interaction ──────────────────────────────────────────────────────
  let draggingSquare = false;
  let draggingHue = false;

  function onSquareMouseDown(e: MouseEvent) {
    draggingSquare = true;
    updateSquare(e);
    window.addEventListener("mousemove", onSquareMouseMove);
    window.addEventListener("mouseup", onSquareMouseUp);
  }

  function onSquareMouseMove(e: MouseEvent) {
    if (draggingSquare) updateSquare(e);
  }

  function onSquareMouseUp() {
    draggingSquare = false;
    window.removeEventListener("mousemove", onSquareMouseMove);
    window.removeEventListener("mouseup", onSquareMouseUp);
  }

  function updateSquare(e: MouseEvent) {
    const rect = squareEl.getBoundingClientRect();
    saturation = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    value = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
  }

  function onHueMouseDown(e: MouseEvent) {
    draggingHue = true;
    updateHue(e);
    window.addEventListener("mousemove", onHueMouseMove);
    window.addEventListener("mouseup", onHueMouseUp);
  }

  function onHueMouseMove(e: MouseEvent) {
    if (draggingHue) updateHue(e);
  }

  function onHueMouseUp() {
    draggingHue = false;
    window.removeEventListener("mousemove", onHueMouseMove);
    window.removeEventListener("mouseup", onHueMouseUp);
  }

  function updateHue(e: MouseEvent) {
    const rect = hueEl.getBoundingClientRect();
    hue = Math.max(0, Math.min(360, ((e.clientX - rect.left) / rect.width) * 360));
  }

  // ── Hex input ─────────────────────────────────────────────────────────────
  function onHexInput(e: Event) {
    const raw = (e.target as HTMLInputElement).value;
    const val = raw.startsWith("#") ? raw : `#${raw}`;
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      const hsv = hexToHsv(val);
      hue = hsv.h;
      saturation = hsv.s;
      value = hsv.v;
    }
  }

  // ── Palette ───────────────────────────────────────────────────────────────
  function pickPalette(colour: string) {
    const hsv = hexToHsv(colour);
    hue = hsv.h;
    saturation = hsv.s;
    value = hsv.v;
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function save() {
    await onSave(currentHex);
  }

  // ── Colour math ───────────────────────────────────────────────────────────
  function hsvToHex(h: number, s: number, v: number): string {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60)       { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else              { r = c; g = 0; b = x; }
    return `#${toHex(Math.round((r + m) * 255))}${toHex(Math.round((g + m) * 255))}${toHex(Math.round((b + m) * 255))}`;
  }

  function toHex(n: number): string {
    return n.toString(16).padStart(2, "0");
  }

  function hexToHsv(hex: string): { h: number; s: number; v: number } {
    const clean = hex.replace("#", "");
    const r = parseInt(clean.substring(0, 2), 16) / 255;
    const g = parseInt(clean.substring(2, 4), 16) / 255;
    const b = parseInt(clean.substring(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r)      h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else                h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    return { h, s: max === 0 ? 0 : d / max, v: max };
  }

  function hexToRgba(hex: string, alpha: number): string {
    const clean = hex.replace("#", "");
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
</script>

<!-- ── Markup ────────────────────────────────────────────────────────────── -->
<div class="cp-root">
  <h3 class="cp-title">Colour — {label}</h3>

  <!-- Preview -->
  <div
    class="cp-preview"
    style="
      background: {previewBg};
      border-left-color: {currentHex};
      color: {currentHex};
    "
  >{label}</div>

  <!-- Hue/Saturation square -->
  <div
    class="cp-square"
    style="--hue-bg: {squareBg};"
    bind:this={squareEl}
    on:mousedown={onSquareMouseDown}
    role="slider"
    aria-label="Colour picker"
    tabindex="0"
  >
    <div class="cp-square-white"></div>
    <div class="cp-square-black"></div>
    <!-- Cursor -->
    <div
      class="cp-cursor"
      style="
        left: {saturation * 100}%;
        top: {(1 - value) * 100}%;
        border-color: {value > 0.5 ? '#000' : '#fff'};
      "
    ></div>
  </div>

  <!-- Hue slider -->
  <div
    class="cp-hue"
    bind:this={hueEl}
    on:mousedown={onHueMouseDown}
    role="slider"
    aria-label="Hue"
    tabindex="0"
  >
    <div
      class="cp-hue-cursor"
      style="left: {(hue / 360) * 100}%;"
    ></div>
  </div>

  <!-- Hex input + RGB display -->
  <div class="cp-inputs">
    <div class="cp-hex-row">
      <span class="cp-hex-label">#</span>
      <input
        class="cp-hex-input"
        type="text"
        maxlength="7"
        value={hexInput}
        on:input={onHexInput}
        spellcheck="false"
        aria-label="Hex colour value"
      />
    </div>
    <div
      class="cp-colour-dot"
      style="background: {currentHex};"
    ></div>
  </div>

  <!-- Palette swatches -->
  <div class="cp-palette">
    {#each CLASS_COLOUR_PALETTE as colour}
      <button
        class="cp-swatch"
        style="background: {colour};"
        class:cp-swatch--active={currentHex.toLowerCase() === colour.toLowerCase()}
        on:click={() => pickPalette(colour)}
        aria-label="Pick colour {colour}"
      ></button>
    {/each}
  </div>

  <!-- Footer -->
  <div class="cp-footer">
    <button class="tp-btn" on:click={onCancel}>Cancel</button>
    <button class="tp-btn tp-btn--primary" on:click={save}>Save colour</button>
  </div>
</div>

<!-- ── Styles ────────────────────────────────────────────────────────────── -->
<style>
  .cp-root {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 280px;
  }

  .cp-title {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    color: var(--text-normal);
  }

  /* Preview */
  .cp-preview {
    padding: 6px 10px;
    border-left: 4px solid;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 700;
    transition: background 0.1s, color 0.1s;
  }

  /* Hue/Saturation square */
  .cp-square {
    position: relative;
    width: 100%;
    height: 180px;
    background: var(--hue-bg);
    border-radius: 6px;
    cursor: crosshair;
    overflow: hidden;
    user-select: none;
  }

  .cp-square-white {
    position: absolute;
    inset: 0;
    background: linear-gradient(to right, #fff, transparent);
  }

  .cp-square-black {
    position: absolute;
    inset: 0;
    background: linear-gradient(to bottom, transparent, #000);
  }

  .cp-cursor {
    position: absolute;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid #fff;
    transform: translate(-50%, -50%);
    pointer-events: none;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.3);
  }

  /* Hue slider */
  .cp-hue {
    position: relative;
    height: 14px;
    border-radius: 7px;
    cursor: pointer;
    user-select: none;
    background: linear-gradient(to right,
      hsl(0,100%,50%), hsl(30,100%,50%), hsl(60,100%,50%),
      hsl(90,100%,50%), hsl(120,100%,50%), hsl(150,100%,50%),
      hsl(180,100%,50%), hsl(210,100%,50%), hsl(240,100%,50%),
      hsl(270,100%,50%), hsl(300,100%,50%), hsl(330,100%,50%),
      hsl(360,100%,50%)
    );
  }

  .cp-hue-cursor {
    position: absolute;
    top: 50%;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    border: 2px solid rgba(0,0,0,0.3);
    transform: translate(-50%, -50%);
    pointer-events: none;
    box-shadow: 0 1px 4px rgba(0,0,0,0.4);
  }

  /* Inputs */
  .cp-inputs {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .cp-hex-row {
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--background-modifier-form-field);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    padding: 4px 8px;
    flex: 1;
  }

  .cp-hex-label {
    font-size: 13px;
    color: var(--text-muted);
    font-family: var(--font-monospace);
  }

  .cp-hex-input {
    border: none;
    background: transparent;
    color: var(--text-normal);
    font-size: 13px;
    font-family: var(--font-monospace);
    width: 70px;
    outline: none;
  }

  .cp-colour-dot {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    flex-shrink: 0;
    border: 2px solid var(--background-modifier-border);
  }

  /* Palette */
  .cp-palette {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .cp-swatch {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    transition: transform 0.1s, border-color 0.1s;
  }

  .cp-swatch:hover {
    transform: scale(1.15);
  }

  .cp-swatch--active {
    border-color: var(--text-normal);
    transform: scale(1.15);
  }

  /* Footer */
  .cp-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 4px;
    border-top: 1px solid var(--background-modifier-border);
  }

  .tp-btn {
    padding: 5px 16px;
    border-radius: 5px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 13px;
    font-family: var(--font-interface);
    cursor: pointer;
    transition: background 0.1s;
  }

  .tp-btn:hover { background: var(--background-modifier-hover); }

  .tp-btn--primary {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border-color: var(--interactive-accent);
  }

  .tp-btn--primary:hover {
    background: var(--interactive-accent-hover);
  }
</style>
