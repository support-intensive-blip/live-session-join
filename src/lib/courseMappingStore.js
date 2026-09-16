// Full course records (id, label, formValue, webinarUrl) live in the
// shared KV store (src/lib/store.js) — in-memory for local/single-instance,
// Redis when REDIS_URL is set. Set REDIS_URL for any multi-instance
// deployment, or courses added/edited on one instance won't be visible on
// another, and everything reverts to the seed list on every restart.
//
// src/config/courses.js's SEED_COURSES only ever populates the store once,
// the first time it's empty (ensureSeeded) — after that, the admin
// dashboard (src/routes/admin.js) is the only way courses change.

import { SEED_COURSES } from "../config/courses.js";

const FOREVER_TTL = 100 * 365 * 24 * 60 * 60;
const INDEX_KEY = "courses:index";

function courseKey(id) {
  return `course:${id}`;
}

async function getIndex(store) {
  return (await store.get(INDEX_KEY)) || [];
}

async function setIndex(store, ids) {
  await store.set(INDEX_KEY, ids, FOREVER_TTL);
}

export async function ensureSeeded(store) {
  const index = await getIndex(store);
  if (index.length > 0) return;

  for (const c of SEED_COURSES) {
    await store.set(
      courseKey(c.id),
      { id: c.id, label: c.label, formValue: c.formValue, webinarUrl: c.webinarUrl },
      FOREVER_TTL
    );
  }
  await setIndex(store, SEED_COURSES.map((c) => c.id));
}

export async function listCourses(store) {
  await ensureSeeded(store);
  const index = await getIndex(store);
  const courses = [];
  for (const id of index) {
    const course = await store.get(courseKey(id));
    if (course) courses.push(course);
  }
  return courses;
}

export async function getCourse(store, id) {
  await ensureSeeded(store);
  return store.get(courseKey(id));
}

const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function validateId(id) {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    throw new Error(
      "Course id must be lowercase letters, digits and hyphens only (e.g. react-js-hooks)"
    );
  }
}

function validateLabel(label) {
  if (typeof label !== "string" || !label.trim()) {
    throw new Error("Label is required");
  }
}

function validateWebinarUrl(url) {
  if (typeof url !== "string" || !/^https:\/\//.test(url)) {
    throw new Error("Webinar URL must be a non-empty https:// URL");
  }
}

function validateFormValue(formValue, validFormValues) {
  if (!validFormValues.includes(formValue)) {
    throw new Error(
      `"${formValue}" is not one of the live Google Form's course options`
    );
  }
}

// `validFormValues` is the live list from googleFormFields.js — passed in
// rather than fetched here so callers control caching/refresh and can
// surface a single clear error if the live form is unreachable.
export async function createCourse(store, { id, label, formValue, webinarUrl }, validFormValues) {
  await ensureSeeded(store);
  validateId(id);
  validateLabel(label);
  validateWebinarUrl(webinarUrl);
  validateFormValue(formValue, validFormValues);

  const existing = await store.get(courseKey(id));
  if (existing) {
    throw new Error(`Course id "${id}" already exists`);
  }

  const course = { id, label, formValue, webinarUrl };
  await store.set(courseKey(id), course, FOREVER_TTL);
  const index = await getIndex(store);
  await setIndex(store, [...index, id]);
  return course;
}

// `newId` is optional — set it to rename the course's id (and therefore
// the query-param value that selects it). Everything else is a plain
// field update.
export async function updateCourse(
  store,
  id,
  { label, formValue, webinarUrl, newId },
  validFormValues
) {
  await ensureSeeded(store);
  const existing = await store.get(courseKey(id));
  if (!existing) {
    throw new Error(`Unknown course id: ${id}`);
  }

  validateLabel(label);
  validateWebinarUrl(webinarUrl);
  validateFormValue(formValue, validFormValues);

  const renaming = Boolean(newId) && newId !== id;
  if (renaming) {
    validateId(newId);
    const clashing = await store.get(courseKey(newId));
    if (clashing) {
      throw new Error(`Course id "${newId}" already exists`);
    }
  }

  const finalId = renaming ? newId : id;
  const course = { id: finalId, label, formValue, webinarUrl };
  await store.set(courseKey(finalId), course, FOREVER_TTL);

  if (renaming) {
    await store.delete(courseKey(id));
    const index = await getIndex(store);
    await setIndex(store, index.map((existingId) => (existingId === id ? finalId : existingId)));
  }

  return course;
}

export async function deleteCourse(store, id) {
  await ensureSeeded(store);
  await store.delete(courseKey(id));
  const index = await getIndex(store);
  await setIndex(store, index.filter((existingId) => existingId !== id));
}
