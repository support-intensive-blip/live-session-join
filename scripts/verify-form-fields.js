// Re-fetches the live Google Form and checks that:
//   1. the configured entry.* field ids still exist,
//   2. every `formValue` in src/config/courses.js is still a valid option
//      on the "Select the Course" dropdown.
// Run this after any change to the Google Form, and periodically in CI/ops,
// since Google Forms gives no change-notification mechanism and a renamed
// option would otherwise fail silently (submissions get rejected).
//
// Usage: npm run verify-form

import { loadConfig } from "../src/config/env.js";
import { SEED_COURSES } from "../src/config/courses.js";

const config = loadConfig();
const viewUrl = config.googleForm.actionUrl.replace(
  /\/formResponse$/,
  "/viewform"
);

const html = await fetch(viewUrl).then((r) => r.text());
const match = html.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*(\[.*?\]);/s);
if (!match) {
  console.error("Could not find FB_PUBLIC_LOAD_DATA_ in the form HTML.");
  console.error(
    "Google may have changed the form's page structure — inspect manually."
  );
  process.exit(1);
}

const data = JSON.parse(match[1]);
const questions = data[1][1];

const fields = questions.map((q) => ({
  title: q[1],
  entryId: `entry.${q[4][0][0]}`,
  options: (q[4][0][1] || []).map((o) => o[0]),
}));

let ok = true;

function checkEntry(label, expectedId) {
  const field = fields.find((f) => f.entryId === expectedId);
  if (!field) {
    console.error(`FAIL  ${label}: ${expectedId} not found on the live form`);
    ok = false;
  } else {
    console.log(`OK    ${label}: ${expectedId} ("${field.title}")`);
  }
  return field;
}

checkEntry("UID field", config.googleForm.entryUid);
checkEntry("Name field", config.googleForm.entryName);
const courseField = checkEntry("Course field", config.googleForm.entryCourse);

if (courseField) {
  for (const course of SEED_COURSES) {
    if (courseField.options.includes(course.formValue)) {
      console.log(`OK    course "${course.id}" -> "${course.formValue}"`);
    } else {
      console.error(
        `FAIL  course "${course.id}": formValue "${course.formValue}" is ` +
          `not a live option. Live options: ${JSON.stringify(
            courseField.options
          )}`
      );
      ok = false;
    }
  }
}

process.exit(ok ? 0 : 1);
