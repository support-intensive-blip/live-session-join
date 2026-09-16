import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/lib/store.js";
import {
  listCourses,
  getCourse,
  createCourse,
  updateCourse,
  deleteCourse,
} from "../src/lib/courseMappingStore.js";
import { SEED_COURSES } from "../src/config/courses.js";

const LIVE_OPTIONS = [
  ...new Set(SEED_COURSES.map((c) => c.formValue)),
  "SomeOtherOption",
];

test("listCourses seeds from SEED_COURSES on first access", async () => {
  const store = createMemoryStore();
  const courses = await listCourses(store);
  assert.equal(courses.length, SEED_COURSES.length);
  assert.deepEqual(
    courses.map((c) => c.id).sort(),
    SEED_COURSES.map((c) => c.id).sort()
  );
});

test("getCourse returns a seeded course, and null for an unknown id", async () => {
  const store = createMemoryStore();
  const course = await getCourse(store, "react-js-hooks");
  assert.equal(course.label, "React JS & React Hooks");

  assert.equal(await getCourse(store, "not-a-course"), null);
});

test("createCourse adds a new course that then appears in listCourses/getCourse", async () => {
  const store = createMemoryStore();
  await createCourse(
    store,
    { id: "new-course", label: "New Course", formValue: "SomeOtherOption", webinarUrl: "https://example.com/room" },
    LIVE_OPTIONS
  );

  const course = await getCourse(store, "new-course");
  assert.equal(course.label, "New Course");

  const courses = await listCourses(store);
  assert.ok(courses.some((c) => c.id === "new-course"));
});

test("createCourse rejects a duplicate id", async () => {
  const store = createMemoryStore();
  await assert.rejects(() =>
    createCourse(
      store,
      { id: "react-js-hooks", label: "Dup", formValue: "SomeOtherOption", webinarUrl: "https://example.com/x" },
      LIVE_OPTIONS
    )
  );
});

test("createCourse rejects an invalid id, non-https URL, and a formValue not in the live list", async () => {
  const store = createMemoryStore();
  await assert.rejects(() =>
    createCourse(store, { id: "Not Valid!", label: "x", formValue: "SomeOtherOption", webinarUrl: "https://example.com/x" }, LIVE_OPTIONS)
  );
  await assert.rejects(() =>
    createCourse(store, { id: "valid-id", label: "x", formValue: "SomeOtherOption", webinarUrl: "http://example.com/x" }, LIVE_OPTIONS)
  );
  await assert.rejects(() =>
    createCourse(store, { id: "valid-id-2", label: "x", formValue: "Not A Real Option", webinarUrl: "https://example.com/x" }, LIVE_OPTIONS)
  );
});

test("updateCourse changes label/formValue/webinarUrl in place", async () => {
  const store = createMemoryStore();
  await updateCourse(
    store,
    "react-js-hooks",
    { label: "React (updated)", formValue: "SomeOtherOption", webinarUrl: "https://example.com/new-room" },
    LIVE_OPTIONS
  );

  const course = await getCourse(store, "react-js-hooks");
  assert.equal(course.label, "React (updated)");
  assert.equal(course.formValue, "SomeOtherOption");
  assert.equal(course.webinarUrl, "https://example.com/new-room");
});

test("updateCourse with newId renames the course (old id gone, new id present)", async () => {
  const store = createMemoryStore();
  await updateCourse(
    store,
    "react-js-hooks",
    { label: "React", formValue: "SomeOtherOption", webinarUrl: "https://example.com/room", newId: "react-renamed" },
    LIVE_OPTIONS
  );

  assert.equal(await getCourse(store, "react-js-hooks"), null);
  const renamed = await getCourse(store, "react-renamed");
  assert.equal(renamed.id, "react-renamed");

  const courses = await listCourses(store);
  assert.equal(courses.length, SEED_COURSES.length);
});

test("updateCourse rejects renaming onto an id that already exists", async () => {
  const store = createMemoryStore();
  await assert.rejects(() =>
    updateCourse(
      store,
      "react-js-hooks",
      { label: "React", formValue: "SomeOtherOption", webinarUrl: "https://example.com/room", newId: "intro-databases" },
      LIVE_OPTIONS
    )
  );
});

test("updateCourse rejects an unknown course id", async () => {
  const store = createMemoryStore();
  await assert.rejects(() =>
    updateCourse(
      store,
      "not-a-course",
      { label: "x", formValue: "SomeOtherOption", webinarUrl: "https://example.com/x" },
      LIVE_OPTIONS
    )
  );
});

test("deleteCourse removes a course from listCourses/getCourse", async () => {
  const store = createMemoryStore();
  await deleteCourse(store, "react-js-hooks");

  assert.equal(await getCourse(store, "react-js-hooks"), null);
  const courses = await listCourses(store);
  assert.equal(courses.length, SEED_COURSES.length - 1);
});
