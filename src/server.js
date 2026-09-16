import express from "express";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config/env.js";
import { getStore } from "./lib/store.js";
import { createCoursesRouter } from "./routes/courses.js";
import { createAdminRouter } from "./routes/admin.js";
import { logger } from "./lib/logger.js";

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
  app.use(createAdminRouter({ config, store }));

  app.use((err, req, res, _next) => {
    logger.error("unhandled_error", { message: err.message });
    res.status(500).json({ error: "internal_error" });
  });

  return { app, config };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { app, config } = createApp();
  app.listen(config.port, () => {
    logger.info("server_started", { port: config.port, env: config.nodeEnv });
  });
}
