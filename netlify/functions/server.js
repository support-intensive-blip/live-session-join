// Netlify Functions adapter. Wraps the same Express app used by
// src/server.js (for `npm start` / any non-serverless host) so there's
// only ever one copy of the actual routing/business logic — this file
// only handles the Netlify-specific plumbing.
//
// Earlier version of this file assumed Netlify delivers the request path
// prefixed with /.netlify/functions/server/ (per netlify.toml's redirect
// target) and mounted the app under that fixed prefix. That assumption
// was wrong on real Netlify infrastructure — verified against a live
// deployment, not just local simulation this time: /admin came back
// "Cannot GET /admin" from Express, meaning the path Netlify actually
// delivers is already the plain resolved path (/admin), with no prefix.
// Stripping the prefix only if present (rather than assuming either way)
// makes this correct under both behaviors.
import express from "express";
import serverless from "serverless-http";
import { createApp } from "../../src/server.js";

const { app: innerApp } = createApp();
const FUNCTION_BASE = "/.netlify/functions/server";

const wrapper = express();
wrapper.use((req, res, next) => {
  if (req.url.startsWith(FUNCTION_BASE)) {
    req.url = req.url.slice(FUNCTION_BASE.length) || "/";
  }
  next();
});
wrapper.use(innerApp);

export const handler = serverless(wrapper);
