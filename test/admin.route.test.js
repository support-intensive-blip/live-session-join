import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { createAdminRouter } from "../src/routes/admin.js";
import { createMemoryStore } from "../src/lib/store.js";
import { getCourse, listCourses } from "../src/lib/courseMappingStore.js";
import { clearLiveCourseFormOptionsCache } from "../src/lib/googleFormFields.js";
import { SEED_COURSES } from "../src/config/courses.js";

// googleFormFields.js caches the live options for 60s across ALL callers,
// keyed by nothing (there's only ever one real form in production). Each
// test here points at its own fake form server, so the cache must be
// cleared between tests or a later test would silently see an earlier
// test's cached options instead of hitting its own server.
function freshFormOptionsCache(t) {
  clearLiveCourseFormOptionsCache();
  t.after(() => clearLiveCourseFormOptionsCache());
}

// Stands in for the live Google Form viewform page, serving the minimal
// FB_PUBLIC_LOAD_DATA_ shape the admin dashboard parses for the course
// dropdown options.
function fakeFormHtml(courseEntryId, options) {
  const data = [
    null,
    [
      null,
      [
        [
          null,
          "Select the Course",
          null,
          3,
          [[courseEntryId, options.map((o) => [o, null, null, null]), 1]],
        ],
      ],
    ],
  ];
  return `<html><script>var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify(data)};</script></html>`;
}

const LIVE_OPTIONS = [...new Set(SEED_COURSES.map((c) => c.formValue)), "SomeOtherOption"];

async function startFakeGoogleFormSite({ down = false } = {}) {
  const server = http.createServer((req, res) => {
    if (down) {
      res.writeHead(500);
      res.end("nope");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(fakeFormHtml("333", LIVE_OPTIONS));
  });
  server.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  return { server, viewformUrl: `http://127.0.0.1:${port}/viewform` };
}

function baseConfig(viewformUrl) {
  return {
    admin: { username: "admin", password: "s3cret-pass" },
    googleForm: {
      actionUrl: viewformUrl.replace("/viewform", "/formResponse"),
      entryCourse: "entry.333",
    },
  };
}

function basicAuthHeader(user, pass) {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

async function startServer(config) {
  const store = createMemoryStore();
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(createAdminRouter({ config, store }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  return {
    server,
    store,
    url: (path) => `http://127.0.0.1:${port}${path}`,
  };
}

test("GET /admin without credentials is rejected", async (t) => {
  freshFormOptionsCache(t);
  const form = await startFakeGoogleFormSite();
  t.after(() => form.server.close());
  const config = baseConfig(form.viewformUrl);
  const { server, url } = await startServer(config);
  t.after(() => server.close());

  const res = await fetch(url("/admin"));
  assert.equal(res.status, 401);
});

test("GET /admin with wrong credentials is rejected", async (t) => {
  freshFormOptionsCache(t);
  const form = await startFakeGoogleFormSite();
  t.after(() => form.server.close());
  const config = baseConfig(form.viewformUrl);
  const { server, url } = await startServer(config);
  t.after(() => server.close());

  const res = await fetch(url("/admin"), {
    headers: { Authorization: basicAuthHeader("admin", "wrong") },
  });
  assert.equal(res.status, 401);
});

test("GET /admin with correct credentials lists seeded courses", async (t) => {
  freshFormOptionsCache(t);
  const form = await startFakeGoogleFormSite();
  t.after(() => form.server.close());
  const config = baseConfig(form.viewformUrl);
  const { server, url } = await startServer(config);
  t.after(() => server.close());

  const res = await fetch(url("/admin"), {
    headers: { Authorization: basicAuthHeader("admin", "s3cret-pass") },
  });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /react-js-hooks/);
});

test("POST /admin/courses creates a new course", async (t) => {
  freshFormOptionsCache(t);
  const form = await startFakeGoogleFormSite();
  t.after(() => form.server.close());
  const config = baseConfig(form.viewformUrl);
  const { server, url, store } = await startServer(config);
  t.after(() => server.close());

  const res = await fetch(url("/admin/courses"), {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader("admin", "s3cret-pass"),
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: url(""),
    },
    body: new URLSearchParams({
      id: "brand-new-course",
      label: "Brand New Course",
      formValue: "SomeOtherOption",
      webinarUrl: "https://example.com/new-room",
    }),
    redirect: "manual",
  });
  assert.equal(res.status, 302);

  const created = await getCourse(store, "brand-new-course");
  assert.equal(created.label, "Brand New Course");
});

test("POST /admin/courses/:id updates a course, including renaming its id", async (t) => {
  freshFormOptionsCache(t);
  const form = await startFakeGoogleFormSite();
  t.after(() => form.server.close());
  const config = baseConfig(form.viewformUrl);
  const { server, url, store } = await startServer(config);
  t.after(() => server.close());

  const res = await fetch(url("/admin/courses/react-js-hooks"), {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader("admin", "s3cret-pass"),
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: url(""),
    },
    body: new URLSearchParams({
      newId: "react-renamed",
      label: "React (renamed)",
      formValue: "SomeOtherOption",
      webinarUrl: "https://example.com/moved-room",
    }),
    redirect: "manual",
  });
  assert.equal(res.status, 302);

  assert.equal(await getCourse(store, "react-js-hooks"), null);
  const renamed = await getCourse(store, "react-renamed");
  assert.equal(renamed.label, "React (renamed)");
  assert.equal(renamed.webinarUrl, "https://example.com/moved-room");
});

test("POST /admin/courses/:id rejects an unknown course id", async (t) => {
  freshFormOptionsCache(t);
  const form = await startFakeGoogleFormSite();
  t.after(() => form.server.close());
  const config = baseConfig(form.viewformUrl);
  const { server, url } = await startServer(config);
  t.after(() => server.close());

  const res = await fetch(url("/admin/courses/not-a-course"), {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader("admin", "s3cret-pass"),
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: url(""),
    },
    body: new URLSearchParams({
      newId: "not-a-course",
      label: "x",
      formValue: "SomeOtherOption",
      webinarUrl: "https://example.com/x",
    }),
  });
  assert.equal(res.status, 400);
  const html = await res.text();
  assert.match(html, /Unknown course id/);
});

test("POST /admin/courses/:id from a foreign Origin is rejected", async (t) => {
  freshFormOptionsCache(t);
  const form = await startFakeGoogleFormSite();
  t.after(() => form.server.close());
  const config = baseConfig(form.viewformUrl);
  const { server, url, store } = await startServer(config);
  t.after(() => server.close());

  const res = await fetch(url("/admin/courses/react-js-hooks"), {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader("admin", "s3cret-pass"),
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://evil.example.com",
    },
    body: new URLSearchParams({
      newId: "react-js-hooks",
      label: "Hijacked",
      formValue: "SomeOtherOption",
      webinarUrl: "https://example.com/hijacked",
    }),
  });
  assert.equal(res.status, 403);

  const course = await getCourse(store, "react-js-hooks");
  assert.notEqual(course.label, "Hijacked");
});

test("POST /admin/courses/:id/delete removes the course", async (t) => {
  freshFormOptionsCache(t);
  const form = await startFakeGoogleFormSite();
  t.after(() => form.server.close());
  const config = baseConfig(form.viewformUrl);
  const { server, url, store } = await startServer(config);
  t.after(() => server.close());

  const res = await fetch(url("/admin/courses/react-js-hooks/delete"), {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader("admin", "s3cret-pass"),
      Origin: url(""),
    },
    redirect: "manual",
  });
  assert.equal(res.status, 302);

  assert.equal(await getCourse(store, "react-js-hooks"), null);
  const courses = await listCourses(store);
  assert.equal(courses.length, SEED_COURSES.length - 1);
});

test("create/update are refused (503) when the live Google Form is unreachable, but the list and delete still work", async (t) => {
  freshFormOptionsCache(t);
  const form = await startFakeGoogleFormSite({ down: true });
  t.after(() => form.server.close());
  const config = baseConfig(form.viewformUrl);
  const { server, url, store } = await startServer(config);
  t.after(() => server.close());

  const listRes = await fetch(url("/admin"), {
    headers: { Authorization: basicAuthHeader("admin", "s3cret-pass") },
  });
  assert.equal(listRes.status, 200);
  const html = await listRes.text();
  assert.match(html, /Could not load the live Google Form/);

  const createRes = await fetch(url("/admin/courses"), {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader("admin", "s3cret-pass"),
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: url(""),
    },
    body: new URLSearchParams({
      id: "wont-be-created",
      label: "x",
      formValue: "React",
      webinarUrl: "https://example.com/x",
    }),
  });
  assert.equal(createRes.status, 503);

  const deleteRes = await fetch(url("/admin/courses/react-js-hooks/delete"), {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader("admin", "s3cret-pass"),
      Origin: url(""),
    },
    redirect: "manual",
  });
  assert.equal(deleteRes.status, 302);
  assert.equal(await getCourse(store, "react-js-hooks"), null);
});
