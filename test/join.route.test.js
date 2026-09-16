import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { createJoinRouter } from "../src/routes/join.js";
import { createMemoryStore } from "../src/lib/store.js";

// Stands in for the real Google Forms formResponse endpoint. A real local
// server (not a mocked global fetch) so this test's own fetch() calls to
// the join-service server stay unaffected — see the note in
// admin.route.test.js's fake-form helper for why that distinction matters.
async function startFakeGoogleForm({ status = 200, body = "ok" } = {}) {
  let callCount = 0;
  const server = http.createServer((req, res) => {
    callCount += 1;
    res.writeHead(status, { "Content-Type": "text/html" });
    res.end(body);
  });
  server.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  return {
    server,
    actionUrl: `http://127.0.0.1:${port}/formResponse`,
    getCallCount: () => callCount,
  };
}

function baseConfig({ actionUrl }) {
  return {
    googleForm: {
      actionUrl,
      entryUid: "entry.111",
      entryName: "entry.222",
      entryCourse: "entry.333",
    },
  };
}

async function startJoinServer(config) {
  const store = createMemoryStore();
  const app = express();
  app.use(createJoinRouter({ config, store }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  return {
    server,
    store,
    url: (path) => `http://127.0.0.1:${port}${path}`,
  };
}

test("happy path: valid course + uid + name -> 302 to the webinar URL, form submitted", async (t) => {
  const form = await startFakeGoogleForm();
  t.after(() => form.server.close());
  const config = baseConfig({ actionUrl: form.actionUrl });
  const { server, url } = await startJoinServer(config);
  t.after(() => server.close());

  const res = await fetch(
    url("/api/join?course=react-js-hooks&uid=test-uuid-1&name=Ada+Lovelace"),
    { redirect: "manual" }
  );
  assert.equal(res.status, 302);
  assert.equal(
    res.headers.get("location"),
    "https://meetings.ccbp.in/mid/react-live-session"
  );
  assert.equal(form.getCallCount(), 1);
});

test("unknown course 404s and never submits or redirects", async (t) => {
  const form = await startFakeGoogleForm();
  t.after(() => form.server.close());
  const config = baseConfig({ actionUrl: form.actionUrl });
  const { server, url } = await startJoinServer(config);
  t.after(() => server.close());

  const res = await fetch(
    url("/api/join?course=not-a-real-course&uid=u1&name=Ada"),
    { redirect: "manual" }
  );
  assert.equal(res.status, 404);
  assert.equal(form.getCallCount(), 0);
});

test("missing course is rejected before any lookup", async (t) => {
  const form = await startFakeGoogleForm();
  t.after(() => form.server.close());
  const config = baseConfig({ actionUrl: form.actionUrl });
  const { server, url } = await startJoinServer(config);
  t.after(() => server.close());

  const res = await fetch(url("/api/join?uid=u1&name=Ada"), {
    redirect: "manual",
  });
  assert.equal(res.status, 400);
});

test("missing or empty uid/name is rejected, no form submission", async (t) => {
  const form = await startFakeGoogleForm();
  t.after(() => form.server.close());
  const config = baseConfig({ actionUrl: form.actionUrl });
  const { server, url } = await startJoinServer(config);
  t.after(() => server.close());

  const noUid = await fetch(url("/api/join?course=react-js-hooks&name=Ada"), {
    redirect: "manual",
  });
  assert.equal(noUid.status, 400);

  const emptyName = await fetch(
    url("/api/join?course=react-js-hooks&uid=u1&name="),
    { redirect: "manual" }
  );
  assert.equal(emptyName.status, 400);

  assert.equal(form.getCallCount(), 0);
});

test("Google Form submission failure still redirects to the webinar (best-effort, never blocks the student)", async (t) => {
  const form = await startFakeGoogleForm({ status: 500, body: "server error" });
  t.after(() => form.server.close());
  const config = baseConfig({ actionUrl: form.actionUrl });
  const { server, url } = await startJoinServer(config);
  t.after(() => server.close());

  const res = await fetch(
    url("/api/join?course=react-js-hooks&uid=u1&name=Ada"),
    { redirect: "manual" }
  );
  assert.equal(res.status, 302);
  assert.equal(
    res.headers.get("location"),
    "https://meetings.ccbp.in/mid/react-live-session"
  );
});

test("the webinar URL redirected to always comes from the course store, never from the request (no open redirect)", async (t) => {
  const form = await startFakeGoogleForm();
  t.after(() => form.server.close());
  const config = baseConfig({ actionUrl: form.actionUrl });
  const { server, url } = await startJoinServer(config);
  t.after(() => server.close());

  const res = await fetch(
    url(
      "/api/join?course=react-js-hooks&uid=u1&name=Ada&redirect=https://evil.example.com&webinarUrl=https://evil.example.com"
    ),
    { redirect: "manual" }
  );
  assert.equal(res.status, 302);
  assert.equal(
    res.headers.get("location"),
    "https://meetings.ccbp.in/mid/react-live-session"
  );
});
