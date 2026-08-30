import { test } from "node:test";
import assert from "node:assert/strict";
import { findOrphans, pruneOrphans, describeOrphans, knownSlotIds } from "../src/utils/orphanUtils";

/** A planner with one live slot ("live"), one live event ("ev"), and records pointing at both plus some ghosts. */
function settings(): any {
  return {
    timetableTemplates: [{ id: "t1", name: "Main", startDate: "2026-09-07", endDate: "2027-07-16",
      slots: [{ id: "live", day: "monday", periodId: "p1", classId: "c1", start: "09:00", end: "10:00" }] }],
    timetable: [],
    dateEvents: [{ id: "ev", date: "2026-09-08", periodId: "p1", classId: "c1" }],
    slotExclusions: [{ slotId: "live", date: "2026-09-14" }, { slotId: "ghost", date: "2026-09-14" }],
    lessonPlanLinks: [
      { slotId: "live", date: "2026-09-07", path: "Plans/a.md" },
      { slotId: "ghost", date: "2026-09-07", path: "Plans/b.md" },
      { eventId: "ev", path: "Plans/c.md" },
      { eventId: "gone", path: "Plans/d.md" },
      { path: "Plans/orphaned-but-malformed.md" },
    ],
    externalLinks: [{ slotId: "ghost", path: "/tmp/x.pdf" }],
    preparedMarks: [{ slotId: "live", date: "2026-09-07" }, { eventId: "gone" }],
    lessonNotes: [{ slotId: "ghost", date: "2026-09-07", text: "..." }],
    lessonRooms: [{ slotId: "live", date: "2026-09-07", room: "B12" }],
  };
}

test("knownSlotIds spans templates and the legacy flat list", () => {
  const s = settings();
  s.timetable = [{ id: "legacy" }];
  assert.deepEqual([...knownSlotIds(s)].sort(), ["legacy", "live"]);
});

test("findOrphans counts what points at nothing, and changes nothing", () => {
  const s = settings();
  const before = JSON.stringify(s);
  const r = findOrphans(s);
  assert.equal(r.slotExclusions, 1);
  assert.equal(r.planLinks, 2, "one dead slot link and one dead event link");
  assert.equal(r.externalLinks, 1);
  assert.equal(r.preparedMarks, 1);
  assert.equal(r.lessonNotes, 1);
  assert.equal(r.lessonRooms, 0);
  assert.equal(r.total, 6);
  assert.equal(JSON.stringify(s), before, "counting must not mutate");
});

test("a record with neither a slot nor an event id is left alone", () => {
  const s = settings();
  pruneOrphans(s);
  assert.ok(s.lessonPlanLinks.some((l: any) => l.path === "Plans/orphaned-but-malformed.md"),
    "guessing about malformed records is how data gets lost");
});

test("pruneOrphans removes exactly the orphans and keeps the live ones", () => {
  const s = settings();
  const removed = pruneOrphans(s);
  assert.equal(removed.total, 6);
  assert.deepEqual(s.slotExclusions.map((x: any) => x.slotId), ["live"]);
  assert.deepEqual(s.lessonPlanLinks.map((l: any) => l.path).sort(),
    ["Plans/a.md", "Plans/c.md", "Plans/orphaned-but-malformed.md"]);
  assert.equal(s.externalLinks.length, 0);
  assert.deepEqual(s.preparedMarks, [{ slotId: "live", date: "2026-09-07" }]);
  assert.equal(s.lessonNotes.length, 0);
  assert.equal(s.lessonRooms.length, 1);
  assert.equal(findOrphans(s).total, 0, "a second pass finds nothing");
});

test("a tidy planner reports nothing and is untouched", () => {
  const s = settings();
  pruneOrphans(s);
  const before = JSON.stringify(s);
  const r = pruneOrphans(s);
  assert.equal(r.total, 0);
  assert.equal(JSON.stringify(s), before);
  assert.deepEqual(describeOrphans(r), []);
});

test("describeOrphans lists only non-empty categories", () => {
  const lines = describeOrphans(findOrphans(settings()));
  assert.ok(lines.some(l => l.includes("lesson plan links")));
  assert.ok(!lines.some(l => l.includes("per-lesson rooms")), "zero categories are not listed");
});

test("missing arrays are treated as empty rather than throwing", () => {
  const r = findOrphans({} as any);
  assert.equal(r.total, 0);
});
