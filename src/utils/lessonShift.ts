/**
 * Pure remapping logic for shifting a class's planned lessons along its
 * sequence of occurrences. No side effects: these functions only compute which
 * occurrence's content moves where. The caller applies the result (re-keying
 * plan/prepared/external links and renaming note files).
 *
 * A class's content is an ordered array of "bundles" aligned to its occurrences,
 * plus an ordered "unplaced" queue (lessons pushed off the end of the year).
 */

export interface ShiftMove { from: number; to: number; }

export interface ForwardPlan {
  /** Moves to apply (snapshot source bundles first, then write to targets). */
  moves: ShiftMove[];
  /** Occurrence index whose content overflows into the unplaced queue, or null. */
  overflowIndex: number | null;
  /** Occurrence index left empty ("free / not taught"). */
  freedIndex: number;
}

export interface BackwardPlan {
  moves: ShiftMove[];
  /** Occurrence index to fill from the front of the unplaced queue, or null. */
  fillIndex: number | null;
}

/**
 * "Lesson didn't happen at `from` — shift the rest forward" (also used by
 * "insert a free lesson here"). Content at `from..n-1` each slides one slot
 * later; the last occurrence's content overflows to the unplaced queue; `from`
 * is freed.
 */
export function planForward(n: number, from: number): ForwardPlan {
  if (n <= 0 || from < 0 || from >= n) return { moves: [], overflowIndex: null, freedIndex: from };
  const moves: ShiftMove[] = [];
  for (let j = from; j <= n - 2; j++) moves.push({ from: j, to: j + 1 });
  return { moves, overflowIndex: n - 1, freedIndex: from };
}

/**
 * "Pull later lessons back into this slot `from`". Content at `from+1..n-1`
 * each slides one slot earlier; the final slot is filled from the front of the
 * unplaced queue (if any).
 */
export function planBackward(n: number, from: number): BackwardPlan {
  if (n <= 0 || from < 0 || from >= n) return { moves: [], fillIndex: null };
  const moves: ShiftMove[] = [];
  for (let j = from; j <= n - 2; j++) moves.push({ from: j + 1, to: j });
  return { moves, fillIndex: n - 1 };
}

/** How many occurrences a forward shift from `from` would move (for the confirm/preview copy). */
export function affectedCount(n: number, from: number): number {
  if (n <= 0 || from < 0 || from >= n) return 0;
  return n - from;
}
