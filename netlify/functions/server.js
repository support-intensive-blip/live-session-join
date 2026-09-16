// Netlify Functions adapter. Wraps the same Express app used by
// src/server.js (for `npm start` / any non-serverless host) so there's
// only ever one copy of the actual routing/business logic — this file
// only handles the Netlify-specific plumbing.
//
// Netlify rewrites every request to
// /.netlify/functions/server/<original path> (see the redirect in
// netlify.toml), so the inner app is mounted at that same prefix here —
// src/server.js itself stays deployment-target-agnostic and knows nothing
// about Netlify.
import express from "express";
import serverless from "serverless-http";
import { createApp } from "../../src/server.js";

const { app: innerApp } = createApp();

const wrapper = express();
wrapper.use("/.netlify/functions/server", innerApp);

export const handler = serverless(wrapper);
