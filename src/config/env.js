import "dotenv/config";

function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

export function loadConfig() {
  return {
    port: Number(process.env.PORT || 3000),
    nodeEnv: process.env.NODE_ENV || "development",

    // Served (not submitted) by this service — see src/routes/courses.js.
    // The actual Google Form submission happens client-side, from within
    // the authenticated CCBP page — see ccbp-integration/INTEGRATION.md.
    googleForm: {
      actionUrl: required(
        "GOOGLE_FORM_ACTION_URL",
        "https://docs.google.com/forms/d/e/1FAIpQLScv_SLntBNHY4Rc61ukmh2wX8-5Hh5KFG9rBO-AxryY-4yEgw/formResponse"
      ),
      entryUid: required("GOOGLE_FORM_ENTRY_UID", "entry.1412875435"),
      entryName: required("GOOGLE_FORM_ENTRY_NAME", "entry.1981656091"),
      entryCourse: required("GOOGLE_FORM_ENTRY_COURSE", "entry.2071464654"),
    },

    redisUrl: process.env.REDIS_URL || "",

    admin: {
      username: required("ADMIN_USERNAME", "admin"),
      password: required("ADMIN_PASSWORD"),
    },
  };
}
