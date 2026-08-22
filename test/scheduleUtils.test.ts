import { test } from "node:test";
import assert from "node:assert/strict";
import { timeMins, normalizeTime, syncPeriodsUnion, getPeriodsForDay, periodLengthMinutes } from "../src/utils/scheduleUtils";

test("timeMins parses both padded and unpadded times", () => {
  assert.equal(timeMins("09:20"), 560);
  assert.equal(timeMins("9:20"), 560);
  assert.equal(timeMins("16:30"), 990);
  assert.equal(timeMins(""), 0);
});

test("normalizeTime zero-pads the hour and leaves anything else alone", () => {
  assert.equal(normalizeTime("9:20"), "09:20");
  assert.equal(normalizeTime("09:20"), "09:20");
  assert.equal(normalizeTime("not a time"), "not a time");
});

test("syncPeriodsUnion sorts by time of day, not by text (0.3.6 regression)", () => {
  const ay: any = {
    periods: [],
    daySchedules: [{
      id: "s1", name: "Standard", periods: [
        { id: "b", name: "Afternoon", start: "16:30", end: "17:30", type: "lesson" },
        { id: "a", name: "Morning", start: "9:20", end: "10:20", type: "lesson" },
      ],
    }],
  };
  syncPeriodsUnion(ay);
  assert.deepEqual(ay.periods.map((p: any) => p.id), ["a", "b"]);
  assert.equal(ay.periods[0].start, "09:20", "times are normalised in place");
});

test("getPeriodsForDay falls back to the flat list when no schedules exist", () => {
  const flat: any = { periods: [{ id: "p1", name: "P1", start: "09:00", end: "10:00", type: "lesson" }] };
  assert.equal(getPeriodsForDay(flat, "monday" as any).length, 1);
});

test("periodLengthMinutes measures the block, and is 0 for an unknown id", () => {
  const ay: any = { periods: [{ id: "p1", name: "P1", start: "09:00", end: "10:00", type: "lesson" }] };
  assert.equal(periodLengthMinutes(ay, "p1"), 60);
  assert.equal(periodLengthMinutes(ay, "nope"), 0);
});
