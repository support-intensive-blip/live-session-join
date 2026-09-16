// Standalone entry point — `node -r dotenv/config src/start.js`
// (npm start / npm run dev). Never imported by the Netlify function; that
// path only ever imports createApp from ./server.js.
import { createApp } from "./server.js";
import { logger } from "./lib/logger.js";

const { app, config } = createApp();
app.listen(config.port, () => {
  logger.info("server_started", { port: config.port, env: config.nodeEnv });
});
