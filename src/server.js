import express from "express";
import { loadConfig } from "./config/env.js";
import { getStore } from "./lib/store.js";
import { createCoursesRouter } from "./routes/courses.js";
import { createJoinRouter } from "./routes/join.js";
import { createAdminRouter } from "./routes/admin.js";
import { logger } from "./lib/logger.js";

// Deliberately just builds the app — doesn't call listen() or do any
// entry-point self-detection (e.g. `import.meta.url` vs `process.argv`).
// That kind of check doesn't survive esbuild's ESM->CJS transform cleanly
// (Netlify's function bundler crashed on load with it — import.meta.url
// came through as undefined). src/start.js is the actual `node` entry
// point for standalone use; the Netlify function
// (netlify/functions/server.js) imports only createApp from here and is
// never affected by start.js at all, since it never imports it.
export function createApp() {
  const config = loadConfig();
  const store = getStore(config);

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "10kb" }));
  // Admin dashboard forms post as application/x-www-form-urlencoded.
  app.use(express.urlencoded({ extended: false, limit: "10kb" }));

  // GET /api/courses/:id is public, non-sensitive config (see
  // src/routes/courses.js) — open CORS so the authenticated CCBP page can
  // read it regardless of its origin. /admin has its own auth and isn't
  // meant to be called cross-origin at all.
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/courses")) {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
    next();
  });

  app.get("/health", (req, res) => res.json({ ok: true }));

  app.use(createCoursesRouter({ config, store }));
  app.use(createJoinRouter({ config, store }));
  app.use(createAdminRouter({ config, store }));

  app.use((err, req, res, _next) => {
    logger.error("unhandled_error", { message: err.message });
    res.status(500).json({ error: "internal_error" });
  });

  return { app, config };
}
