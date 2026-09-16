import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createCoursesRouter } from "../src/routes/courses.js";
import { createMemoryStore } from "../src/lib/store.js";
import { updateCourse } from "../src/lib/courseMappingStore.js";
import { SEED_COURSES } from "../src/config/courses.js";

function baseConfig() {
  return {
    googleForm: {
      actionUrl: "https://docs.google.com/forms/d/e/FAKE/formResponse",
      entryUid: "entry.111",
      entryName: "entry.222",
      entryCourse: "entry.333",
    },
  };
}

async function startServer(config) {
  const store = createMemoryStore();
  const app = express();
  app.use(createCoursesRouter({ config, store }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  return {
    server,
    store,
    url: (path) => `http://127.0.0.1:${port}${path}`,
  };
}

test("GET /api/courses/:id returns the course's form config and webinar URL", async (t) => {
  const config = baseConfig();
  const { server, url } = await startServer(config);
  t.after(() => server.close());

  const seed = SEED_COURSES.find((c) => c.id === "react-js-hooks");
  const res = await fetch(url("/api/courses/react-js-hooks"));
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.id, "react-js-hooks");
  assert.equal(data.formValue, seed.formValue);
  assert.equal(data.webinarUrl, seed.webinarUrl);
  assert.equal(data.googleForm.actionUrl, config.googleForm.actionUrl);
  assert.equal(data.googleForm.entryUid, "entry.111");
  assert.equal(data.googleForm.entryName, "entry.222");
  assert.equal(data.googleForm.entryCourse, "entry.333");
});

test("GET /api/courses/:id 404s for an unknown course id (no open redirect via this endpoint)", async (t) => {
  const config = baseConfig();
  const { server, url } = await startServer(config);
  t.after(() => server.close());

  const res = await fetch(url("/api/courses/not-a-real-course"));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "unknown_course");
});

test("GET /api/courses/:id reflects an admin-updated webinar URL", async (t) => {
  const config = baseConfig();
  const { server, url, store } = await startServer(config);
  t.after(() => server.close());

  await updateCourse(
    store,
    "react-js-hooks",
    {
      label: "React JS & React Hooks",
      formValue: "React",
      webinarUrl: "https://example.com/moved-room",
    },
    ["React"]
  );

  const res = await fetch(url("/api/courses/react-js-hooks"));
  const data = await res.json();
  assert.equal(data.webinarUrl, "https://example.com/moved-room");
});
