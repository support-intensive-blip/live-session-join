// Stands in for the real Google Forms formResponse endpoint during local
// testing, so GOOGLE_FORM_ACTION_URL can point here instead of production
// — nothing submitted while testing touches the real response sheet.
//
// Usage: node scripts/local-form-stub.mjs
// Then set in .env: GOOGLE_FORM_ACTION_URL=http://localhost:4001/formResponse

import http from "node:http";

const port = process.env.PORT || 4001;

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url.startsWith("/formResponse")) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      console.log("[local-form-stub] received submission:", body);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html>ok</html>");
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(port, () => {
  console.log(`[local-form-stub] listening on http://localhost:${port}/formResponse`);
});
