import { Notice } from "obsidian";

/**
 * Logging helpers (0.3.8). The plugin had around twenty `catch { }` blocks that
 * swallowed a failure with no console line and no user feedback, so a week note
 * that failed to save looked exactly like one that saved. These give every
 * swallowed error a consistent, greppable prefix, and give the user-facing ones
 * an actual notice.
 *
 * Use `warn` for anything recoverable that the user does not need to act on
 * (an unreadable template is skipped, a folder already exists). Use
 * `notifyFailure` when the user asked for something and it did not happen.
 */

const PREFIX = "Teacher Planner:";

/** Log a recoverable problem. Nothing is shown to the user. */
export function warn(context: string, err?: unknown): void {
  if (err === undefined) console.warn(`${PREFIX} ${context}`);
  else console.warn(`${PREFIX} ${context}`, err);
}

/** Log a failure AND tell the user, for anything they explicitly asked for. */
export function notifyFailure(context: string, err?: unknown): void {
  if (err === undefined) console.error(`${PREFIX} ${context}`);
  else console.error(`${PREFIX} ${context}`, err);
  new Notice(`${PREFIX} ${context}`);
}
