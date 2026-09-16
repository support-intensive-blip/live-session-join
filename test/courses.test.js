import { test } from "node:test";
import assert from "node:assert/strict";
import { SEED_COURSES } from "../src/config/courses.js";

test("every seed course has a non-empty id, label, formValue, webinarUrl", () => {
  for (const c of SEED_COURSES) {
    assert.ok(c.id, "id");
    assert.ok(c.label, "label");
    assert.ok(c.formValue, "formValue");
    assert.match(c.webinarUrl, /^https:\/\//);
  }
});

test("seed course ids are unique", () => {
  const ids = SEED_COURSES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});
