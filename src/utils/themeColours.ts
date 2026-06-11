/**
 * Theme colour tokens — block colours that automatically follow the user's
 * active Obsidian theme instead of being fixed hex values.
 *
 * A colour stored as "theme:<name>" is resolved at render time from the
 * corresponding Obsidian CSS variable, so it updates whenever the user
 * changes their theme. A plain "#rrggbb" value is treated as a manual
 * override and is never affected by theme changes.
 */

export interface ThemeColourToken {
  token: string;   // stored value, e.g. "theme:muted"
  label: string;   // shown in the colour picker
  cssVar: string;  // Obsidian CSS variable it resolves from
  fallback: string; // hex used if the variable is missing/unresolvable
}

/** Neutral, theme-conforming tokens first; bold theme accents after. */
export const THEME_COLOUR_TOKENS: ThemeColourToken[] = [
  { token: "theme:muted",   label: "Muted",   cssVar: "--text-muted",               fallback: "#888888" },
  { token: "theme:faint",   label: "Faint",   cssVar: "--text-faint",               fallback: "#666666" },
  { token: "theme:surface", label: "Surface", cssVar: "--background-secondary-alt", fallback: "#7a7a7a" },
  { token: "theme:accent",  label: "Accent",  cssVar: "--interactive-accent",       fallback: "#7c6fde" },
  { token: "theme:red",     label: "Red",     cssVar: "--color-red",                fallback: "#e05555" },
  { token: "theme:orange",  label: "Orange",  cssVar: "--color-orange",             fallback: "#d4903a" },
  { token: "theme:yellow",  label: "Yellow",  cssVar: "--color-yellow",             fallback: "#f2c97d" },
  { token: "theme:green",   label: "Green",   cssVar: "--color-green",              fallback: "#80c787" },
  { token: "theme:cyan",    label: "Cyan",    cssVar: "--color-cyan",               fallback: "#89dceb" },
  { token: "theme:blue",    label: "Blue",    cssVar: "--color-blue",               fallback: "#74a8ec" },
  { token: "theme:purple",  label: "Purple",  cssVar: "--color-purple",             fallback: "#b08fe0" },
  { token: "theme:pink",    label: "Pink",    cssVar: "--color-pink",               fallback: "#e8a2b8" },
];

/**
 * Token used by the Grid Visuals settings (grid lines / period block borders)
 * to follow the active theme's border colour. Kept out of THEME_COLOUR_TOKENS
 * so it doesn't appear in the block colour pickers.
 */
export const GRID_THEME_TOKEN = "theme:border";

const EXTRA_THEME_TOKENS: ThemeColourToken[] = [
  { token: GRID_THEME_TOKEN, label: "Theme border", cssVar: "--background-modifier-border", fallback: "#444444" },
];

function findToken(token: string): ThemeColourToken | undefined {
  return THEME_COLOUR_TOKENS.find(t => t.token === token)
    ?? EXTRA_THEME_TOKENS.find(t => t.token === token);
}

export function isThemeToken(colour: string | undefined | null): boolean {
  return typeof colour === "string" && colour.startsWith("theme:");
}

/**
 * Return a CSS colour expression for a stored colour.
 * - "theme:*" tokens → a var() reference so the colour updates live when the
 *   user switches Obsidian themes (no cache involved).
 * - anything else    → returned unchanged (manual hex override).
 */
export function colourToCss(colour: string | undefined | null, fallback = "#888888"): string {
  if (!colour) return fallback;
  if (!isThemeToken(colour)) return colour;
  const def = findToken(colour);
  if (!def) return fallback;
  return `var(${def.cssVar}, ${def.fallback})`;
}

// ── Resolution cache ──────────────────────────────────────────────────────
// CSS variable lookups go through getComputedStyle, so resolved values are
// cached. Call clearThemeColourCache() on Obsidian's "css-change" event.
const _cache = new Map<string, string>();

export function clearThemeColourCache(): void {
  _cache.clear();
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}

/**
 * Resolve any CSS colour string (hex, rgb(), hsl(), named, var output) to
 * "#rrggbb" by letting the browser compute it on a probe element.
 */
function computeToHex(cssColour: string): string | null {
  const probe = activeDocument.createElement("span");
  probe.setCssStyles({ display: "none" });
  probe.setCssStyles({ color: cssColour });
  activeDocument.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  const m = rgb.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (!m) return null;
  return `#${toHex(+m[1])}${toHex(+m[2])}${toHex(+m[3])}`;
}

/**
 * Resolve a stored colour to a concrete "#rrggbb" hex.
 * - "theme:*" tokens → resolved from the active theme's CSS variables.
 * - anything else    → returned unchanged (manual hex override).
 */
export function resolveColour(colour: string | undefined | null): string {
  if (!colour) return "#888888";
  if (!isThemeToken(colour)) return colour;

  const cached = _cache.get(colour);
  if (cached) return cached;

  const def = findToken(colour);
  if (!def) return "#888888";

  const raw = getComputedStyle(activeDocument.body).getPropertyValue(def.cssVar).trim();
  const hex = raw ? computeToHex(raw) : null;
  const result = hex ?? def.fallback;
  _cache.set(colour, result);
  return result;
}
