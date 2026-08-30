import { test } from "node:test";
import assert from "node:assert/strict";
import { composeNoteBody, lessonNoteFrontmatter } from "../src/utils/lessonNoteFiles";

const FM = lessonNoteFrontmatter({ code: "10B" } as any, "Period 2", "2026-09-08");

/** Count of "---" fence lines, i.e. how many frontmatter blocks the note appears to have. */
const fences = (s: string) => s.split(/\r?\n/).filter(l => l.trim() === "---").length;

test("a template with no frontmatter is simply appended", () => {
  const { body, cursorIndex } = composeNoteBody(FM, "## Notes\n", -1);
  assert.equal(body, FM + "## Notes\n");
  assert.equal(cursorIndex, -1);
  assert.equal(fences(body), 2);
});

test("a template's own frontmatter is merged, not duplicated", () => {
  const tpl = '---\nunit: "Waves"\nstandards: [HS-PS4-1]\n---\n## Notes\n';
  const { body } = composeNoteBody(FM, tpl);
  assert.equal(fences(body), 2, "exactly one frontmatter block");
  assert.match(body, /unit: "Waves"/);
  assert.match(body, /standards: \[HS-PS4-1\]/);
  assert.match(body, /class: "10B"/);
  assert.ok(body.endsWith("## Notes\n"));
});

test("the plugin's own keys win, so notes stay findable", () => {
  const tpl = '---\nclass: "WRONG"\ndate: "1999-01-01"\nunit: "Waves"\n---\nbody\n';
  const { body } = composeNoteBody(FM, tpl);
  assert.match(body, /class: "10B"/);
  assert.doesNotMatch(body, /WRONG/);
  assert.doesNotMatch(body, /1999-01-01/);
  assert.match(body, /date: "2026-09-08"/);
  assert.match(body, /unit: "Waves"/);
});

test("continuation lines under a dropped key are dropped with it", () => {
  const tpl = '---\nclass:\n  - "WRONG"\n  - "ALSO WRONG"\nunit: "Waves"\n---\nbody\n';
  const { body } = composeNoteBody(FM, tpl);
  assert.doesNotMatch(body, /WRONG/);
  assert.match(body, /unit: "Waves"/);
});

test("the cursor offset survives the merge", () => {
  const tpl = '---\nunit: ""\n---\nab';           // cursor between a and b
  const offset = tpl.length - 1;
  const { body, cursorIndex } = composeNoteBody(FM, tpl, offset);
  assert.equal(body[cursorIndex], "b", "cursor still lands where the template put it");
});

test("the cursor offset survives when there is no template frontmatter", () => {
  const tpl = "ab";
  const { body, cursorIndex } = composeNoteBody(FM, tpl, 1);
  assert.equal(body[cursorIndex], "b");
});

test("an empty template still produces a valid note", () => {
  const { body } = composeNoteBody(FM, "");
  assert.equal(body, FM);
  assert.equal(fences(body), 2);
});
