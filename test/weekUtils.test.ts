import { test } from "node:test";
import assert from "node:assert/strict";
import {
  localIso, getMondayOfWeek, schoolDayOf, getAbWeekType, isFullyHolidayWeek, isValidIsoDate,
} from "../src/utils/weekUtils";

const SCHOOL_DAYS: any = ["monday", "tuesday", "wednesday", "thursday", "friday"];

/** Academic year starting Monday 7 September 2026. */
const ay = (over: Record<string, unknown> = {}): any => ({
  id: "ay", name: "2026-27",
  startDate: "2026-09-07", endDate: "2027-07-16",
  periods: [], abWeekEnabled: true, abWeekStartsOn: "A",
  ...over,
});

test("getMondayOfWeek returns the Monday of the containing week", () => {
  assert.equal(localIso(getMondayOfWeek(new Date("2026-09-09T12:00:00"))), "2026-09-07"); // Wednesday
  assert.equal(localIso(getMondayOfWeek(new Date("2026-09-13T12:00:00"))), "2026-09-07"); // Sunday
  assert.equal(localIso(getMondayOfWeek(new Date("2026-09-07T12:00:00"))), "2026-09-07"); // Monday itself
});

test("localIso keeps the local date for a local-midnight value", () => {
  // getMondayOfWeek zeroes the clock, so its result is local midnight — the
  // exact value that toISOString() misreports east of UTC.
  const monday = getMondayOfWeek(new Date("2026-09-09T12:00:00"));
  assert.equal(monday.getHours(), 0);
  assert.equal(localIso(monday), "2026-09-07");
});

test("the toISOString pattern localIso replaced really does shift east of UTC", () => {
  // Documents the hazard rather than the fix: this is why every date key in the
  // plugin goes through localIso.
  const monday = getMondayOfWeek(new Date("2026-09-09T12:00:00"));
  const utcKey = monday.toISOString().slice(0, 10);
  const minutesEastOfUtc = -monday.getTimezoneOffset();
  if (minutesEastOfUtc > 0) assert.notEqual(utcKey, localIso(monday));
  else assert.equal(utcKey, localIso(monday));
});

test("schoolDayOf maps every weekday", () => {
  assert.equal(schoolDayOf(new Date("2026-09-06T12:00:00")), "sunday");
  assert.equal(schoolDayOf(new Date("2026-09-07T12:00:00")), "monday");
  assert.equal(schoolDayOf(new Date("2026-09-11T12:00:00")), "friday");
  assert.equal(schoolDayOf(new Date("2026-09-12T12:00:00")), "saturday");
});

test("A/B rotation alternates from the academic year's first week", () => {
  const y = ay();
  assert.equal(getAbWeekType(new Date("2026-09-09T12:00:00"), y, [], SCHOOL_DAYS), "A");
  assert.equal(getAbWeekType(new Date("2026-09-16T12:00:00"), y, [], SCHOOL_DAYS), "B");
  assert.equal(getAbWeekType(new Date("2026-09-23T12:00:00"), y, [], SCHOOL_DAYS), "A");
});

test("a fully-holiday week does not advance the rotation", () => {
  const y = ay();
  const overrides: any = [{ type: "holiday", startDate: "2026-09-14", endDate: "2026-09-18" }];
  assert.equal(getAbWeekType(new Date("2026-09-07T12:00:00"), y, overrides, SCHOOL_DAYS), "A");
  assert.equal(getAbWeekType(new Date("2026-09-14T12:00:00"), y, overrides, SCHOOL_DAYS), null);
  // Teaching resumes where it left off: the week after the break is B, not A.
  assert.equal(getAbWeekType(new Date("2026-09-21T12:00:00"), y, overrides, SCHOOL_DAYS), "B");
});

test("an anchor override re-bases the rotation, a plain one relabels a single week", () => {
  const y = ay();
  const relabel: any = [{ type: "custom", startDate: "2026-09-14", abWeekOverride: "A" }];
  assert.equal(getAbWeekType(new Date("2026-09-14T12:00:00"), y, relabel, SCHOOL_DAYS), "A");
  assert.equal(getAbWeekType(new Date("2026-09-21T12:00:00"), y, relabel, SCHOOL_DAYS), "A");

  const anchor: any = [{ type: "custom", startDate: "2026-09-14", abWeekOverride: "A", abWeekAnchor: true }];
  assert.equal(getAbWeekType(new Date("2026-09-14T12:00:00"), y, anchor, SCHOOL_DAYS), "A");
  assert.equal(getAbWeekType(new Date("2026-09-21T12:00:00"), y, anchor, SCHOOL_DAYS), "B");
});

test("isFullyHolidayWeek only counts school days", () => {
  const monday = getMondayOfWeek(new Date("2026-09-14T12:00:00"));
  const wholeWeek: any = [{ type: "holiday", startDate: "2026-09-14", endDate: "2026-09-18" }];
  const partWeek: any = [{ type: "holiday", startDate: "2026-09-14", endDate: "2026-09-16" }];
  assert.equal(isFullyHolidayWeek(monday, SCHOOL_DAYS, wholeWeek), true);
  assert.equal(isFullyHolidayWeek(monday, SCHOOL_DAYS, partWeek), false);
  assert.equal(isFullyHolidayWeek(monday, SCHOOL_DAYS, []), false);
});

test("isValidIsoDate rejects well-formed impossible dates", () => {
  assert.equal(isValidIsoDate("2026-02-28"), true);
  assert.equal(isValidIsoDate("2026-02-30"), false);
  assert.equal(isValidIsoDate("2026-13-01"), false);
  assert.equal(isValidIsoDate("26-01-01"), false);
});
