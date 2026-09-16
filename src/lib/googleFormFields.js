// Fetches the live Google Form and extracts the current options on the
// "Select the Course" dropdown, so the admin dashboard can offer them as a
// closed set (a <select>) rather than a free-text field — see
// src/config/courses.js for why that matters. Same parsing technique as
// scripts/verify-form-fields.js, factored out here for reuse.

const CACHE_TTL_MS = 60_000;
let cache = null; // { options: string[], fetchedAt: number }

export class GoogleFormFieldsError extends Error {}

export async function getLiveCourseFormOptions(config, { forceRefresh = false } = {}) {
  if (!forceRefresh && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.options;
  }

  const viewUrl = config.googleForm.actionUrl.replace(
    /\/formResponse\/?$/,
    "/viewform"
  );

  let html;
  try {
    const res = await fetch(viewUrl);
    if (!res.ok) {
      throw new GoogleFormFieldsError(
        `Fetching the live form failed: HTTP ${res.status}`
      );
    }
    html = await res.text();
  } catch (err) {
    if (err instanceof GoogleFormFieldsError) throw err;
    throw new GoogleFormFieldsError(
      `Could not reach the live Google Form: ${err.message}`
    );
  }

  const match = html.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*(\[.*?\]);/s);
  if (!match) {
    throw new GoogleFormFieldsError(
      "Could not parse the live form's structure (Google may have changed its page layout)"
    );
  }

  let questions;
  try {
    const data = JSON.parse(match[1]);
    questions = data[1][1];
  } catch {
    throw new GoogleFormFieldsError("Could not parse the live form's structure");
  }

  const wantedEntryId = config.googleForm.entryCourse.replace(/^entry\./, "");
  const field = questions.find((q) => String(q[4][0][0]) === wantedEntryId);
  if (!field) {
    throw new GoogleFormFieldsError(
      `Course field (${config.googleForm.entryCourse}) not found on the live form`
    );
  }

  const options = (field[4][0][1] || []).map((o) => o[0]);
  cache = { options, fetchedAt: Date.now() };
  return options;
}

export function clearLiveCourseFormOptionsCache() {
  cache = null;
}
