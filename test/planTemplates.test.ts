import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTemplateBody } from "../src/utils/planTemplates";
import { localIso } from "../src/utils/weekUtils";

test("tokens are filled and unknown ones collapse to nothing", () => {
  const { body } = renderTemplateBody("{{class}} · {{subject}} · {{nope}}", {
    classCode: "10B", subjectName: "Biology",
  });
  assert.equal(body, "10B · Biology · ");
});

test("{{week}} and {{weekEnd}} bracket the lesson's week", () => {
  const { body } = renderTemplateBody("{{week}}|{{weekEnd}}", { lessonDate: "2026-09-09" });
  const [start, end] = body.split("|");
  assert.ok(start.length > 0 && end.length > 0);
  assert.notEqual(start, end, "the Monday and the Friday are different days");
  assert.ok(start.includes("2026") && end.includes("2026"));
});

test("{{date}} defaults to today in local time, not UTC", () => {
  const { body } = renderTemplateBody("{{date}}", {});
  assert.equal(body, localIso(new Date()));
});

test("{{cursor}} is stripped and its offset returned", () => {
  const { body, cursorOffset } = renderTemplateBody("ab{{cursor}}cd", {});
  assert.equal(body, "abcd");
  assert.equal(cursorOffset, 2);
});

test("a template with no cursor marker reports -1", () => {
  const { cursorOffset } = renderTemplateBody("no marker", {});
  assert.equal(cursorOffset, -1);
});

test("{{week}} and {{weekEnd}} use the shared Monday-of-week rule", () => {
  // Sunday belongs to the week that started on the preceding Monday, which is
  // what getMondayOfWeek does — these labels now delegate to it rather than
  // repeating the arithmetic.
  const wed = renderTemplateBody("{{week}}|{{weekEnd}}", { lessonDate: "2026-09-09" }).body;
  const sun = renderTemplateBody("{{week}}|{{weekEnd}}", { lessonDate: "2026-09-13" }).body;
  const mon = renderTemplateBody("{{week}}|{{weekEnd}}", { lessonDate: "2026-09-07" }).body;
  assert.equal(sun, wed, "Sunday sits in the week that began on the Monday before it");
  assert.equal(mon, wed, "so does the Monday itself");
});

test("an unparseable lesson date yields empty week labels rather than junk", () => {
  const { body } = renderTemplateBody("[{{week}}][{{weekEnd}}]", { lessonDate: "not-a-date" });
  assert.equal(body, "[][]");
});
