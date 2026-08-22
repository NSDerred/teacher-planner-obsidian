import { test } from "node:test";
import assert from "node:assert/strict";
import { calcDirectedTime } from "../src/utils/directedTimeUtils";

/**
 * Regression cover for the bug fixed in 0.3.7: week and day keys were built
 * with toISOString() from local-midnight dates, so east of UTC every key in the
 * directed-time week loop was a day early. A Friday holiday fell outside the
 * shifted window entirely and was never deducted.
 *
 * Every assertion here must hold in all three timezones the runner uses.
 */

const P1: any = { id: "p1", name: "P1", start: "09:00", end: "10:00", type: "lesson" };
const DAYS: any[] = ["monday", "tuesday", "wednesday", "thursday", "friday"];

/** One teaching week: Monday 5 January to Friday 9 January 2026, one lesson a day. */
function settings(over: Record<string, unknown> = {}): any {
  return {
    academicYear: {
      id: "ay", name: "Test", startDate: "2026-01-05", endDate: "2026-01-09",
      periods: [P1], abWeekEnabled: false, abWeekStartsOn: "A",
    },
    schoolDays: DAYS,
    classes: [{ id: "c1", year: "10", code: "10B", subjectId: "s1", colour: "#888", colourOverridden: false, lessonCount: 0 }],
    activities: [],
    dateEvents: [],
    slotExclusions: [],
    weekOverrides: [],
    timetableTemplates: [{
      id: "t1", name: "Main", startDate: "2026-01-05", endDate: "2026-01-09",
      slots: DAYS.map((d, i) => ({ id: "s" + i, day: d, periodId: "p1", classId: "c1", start: "09:00", end: "10:00" })),
    }],
    directedTime: { enabled: true, contractedHours: 1265, timetablePercentage: 100, defaultLessonDurationMinutes: 60 },
    ...over,
  };
}

test("the week is keyed by its Monday", () => {
  const calc = calcDirectedTime(settings());
  assert.equal(calc.weeks.length, 1);
  assert.equal(calc.weeks[0].weekStart, "2026-01-05");
});

test("a full teaching week counts every lesson", () => {
  const calc = calcDirectedTime(settings());
  assert.equal(calc.weeks[0].lessonCount, 5);
  assert.equal(calc.weeks[0].lessonMins, 300);
});

test("a Friday holiday is deducted (the 0.3.7 regression)", () => {
  const calc = calcDirectedTime(settings({
    weekOverrides: [{ type: "holiday", startDate: "2026-01-09", endDate: "2026-01-09" }],
  }));
  assert.equal(calc.weeks[0].lessonCount, 4, "the Friday lesson must not be counted");
  assert.equal(calc.weeks[0].lessonMins, 240);
});

test("a Monday holiday is deducted", () => {
  const calc = calcDirectedTime(settings({
    weekOverrides: [{ type: "holiday", startDate: "2026-01-05", endDate: "2026-01-05" }],
  }));
  assert.equal(calc.weeks[0].lessonCount, 4);
});

test("a lesson removed for one date is deducted on that date", () => {
  const calc = calcDirectedTime(settings({
    slotExclusions: [{ slotId: "s2", date: "2026-01-07" }], // Wednesday
  }));
  assert.equal(calc.weeks[0].lessonCount, 4);
});

test("a fully-holiday week counts nothing and is marked as such", () => {
  const calc = calcDirectedTime(settings({
    weekOverrides: [{ type: "holiday", startDate: "2026-01-05", endDate: "2026-01-09" }],
  }));
  assert.equal(calc.weeks[0].status, "holiday");
  assert.equal(calc.weeks[0].totalMins, 0);
});

test("a planner with no directed-time settings calculates nothing", () => {
  // `enabled` is a display flag only — the calculation still runs when it is
  // false, and the sidebar decides whether to show the result.
  const calc = calcDirectedTime(settings({ directedTime: undefined }));
  assert.equal(calc.weeks.length, 0);
  assert.equal(calc.contractedMins, 0);
});
