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
