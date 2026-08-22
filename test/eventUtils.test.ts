import { test } from "node:test";
import assert from "node:assert/strict";
import { occurrenceTime, contiguousRuns, eventPeriodIds } from "../src/utils/eventUtils";

const P1: any = { id: "p1", name: "P1", start: "09:00", end: "10:00", type: "lesson" };
const BREAK: any = { id: "br", name: "Break", start: "10:00", end: "10:20", type: "break" };
const P2: any = { id: "p2", name: "P2", start: "10:20", end: "11:20", type: "lesson" };

test("an occurrence with no overrides fills its period", () => {
  const t = occurrenceTime([P1], {});
  assert.equal(t.range, "09:00–10:00");
  assert.equal(t.mins, 60);
  assert.equal(t.teachingMins, 60);
  assert.equal(t.isPartial, false);
});

test("a custom start leaves lead time and marks the occurrence partial", () => {
  const t = occurrenceTime([P1], { start: "09:30" });
  assert.equal(t.startLabel, "09:30");
  assert.equal(t.endLabel, "10:00");
  assert.equal(t.leadMins, 30);
  assert.equal(t.trailMins, 0);
  assert.equal(t.isPartial, true);
});

test("a custom duration leaves trail time", () => {
  const t = occurrenceTime([P1], { durationMinutes: 25 });
  assert.equal(t.endLabel, "09:25");
  assert.equal(t.trailMins, 35);
  assert.equal(t.teachingMins, 25);
});

test("duration is spent as teaching minutes, so a run skips the break it spans", () => {
  // Runs come from contiguousRuns, which keeps P1 and P2 in one run but leaves
  // an unselected break out of it. 120 taught minutes must therefore reach the
  // end of P2 (11:20) rather than stopping 20 minutes early at 11:00, which is
  // what a naive wall-clock model would do.
  const t = occurrenceTime([P1, P2], { durationMinutes: 120 });
  assert.equal(t.endLabel, "11:20");
  assert.equal(t.teachingMins, 120);
  assert.equal(t.mins, 140, "wall clock still includes the break");
  assert.equal(t.isPartial, false);
});

test("an over-long duration is clamped to the end of the run", () => {
  const t = occurrenceTime([P1], { durationMinutes: 999 });
  assert.equal(t.endLabel, "10:00");
  assert.equal(t.mins, 60);
});

test("a start past the end of the run still renders a block", () => {
  const t = occurrenceTime([P1], { start: "23:00" });
  assert.ok(t.endMin > t.startMin, "never zero-length");
  assert.equal(t.endLabel, "10:00");
});

test("an empty run is handled without throwing", () => {
  const t = occurrenceTime([], {});
  assert.equal(t.mins, 0);
  assert.equal(t.range, "");
  assert.equal(t.isPartial, false);
});

test("contiguousRuns splits on an unselected lesson, not on a break", () => {
  // A break between two selected lessons is a continuation, not a gap; an
  // unselected teaching period is a real gap.
  const P3: any = { id: "p3", name: "P3", start: "11:20", end: "12:20", type: "lesson" };
  assert.equal(contiguousRuns([P1, BREAK, P2], ["p1", "p2"]).length, 1);
  assert.deepEqual(contiguousRuns([P1, BREAK, P2], ["p1", "p2"])[0].map((p: any) => p.id), ["p1", "p2"]);
  assert.equal(contiguousRuns([P1, BREAK, P2, P3], ["p1", "p3"]).length, 2);
  assert.equal(contiguousRuns([P1, BREAK, P2], []).length, 0);
});

test("eventPeriodIds falls back to the single periodId", () => {
  assert.deepEqual(eventPeriodIds({ periodId: "p1" } as any), ["p1"]);
  assert.deepEqual(eventPeriodIds({ periodId: "p1", periodIds: ["p1", "p2"] } as any), ["p1", "p2"]);
});
