// Structured logging that never prints tokens, auth headers, or cookies.
// Every log call goes through here rather than console.log directly so the
// redaction is enforced in one place instead of relied on at each call site.

const REDACTED = "[redacted]";
const SENSITIVE_KEYS = new Set([
  "token",
  "jwt",
  "authorization",
  "cookie",
  "cookies",
  "access_token",
  "accesstoken",
  "session",
  "sessionid",
]);

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? REDACTED : redact(v);
    }
    return out;
  }
  return value;
}

function log(level, msg, fields = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...redact(fields),
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (msg, fields) => log("info", msg, fields),
  warn: (msg, fields) => log("warn", msg, fields),
  error: (msg, fields) => log("error", msg, fields),
};
