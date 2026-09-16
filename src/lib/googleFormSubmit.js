// Submits the join form to Google Forms' public `formResponse` endpoint,
// server-side. Unlike a browser fetch (which has to use mode:"no-cors" and
// gets an opaque, unreadable response), a server-side POST can actually
// read the real HTTP status and body — used here as a best-effort
// heuristic for "did this look accepted," never a hard guarantee, since
// Google Forms has no documented success contract either way.

const ERROR_MARKERS = [
  // Shown when a value doesn't match a predefined dropdown/radio option.
  "was not in the list of allowed values",
  // Shown when a required question was left blank.
  "This is a required question",
  // Generic Forms error page.
  "Sorry, your response could not be recorded",
];

export class GoogleFormSubmissionError extends Error {
  constructor(message, details) {
    super(message);
    this.details = details;
  }
}

export async function submitJoinForm({ uid, name, courseFormValue }, config) {
  const body = new URLSearchParams({
    [config.googleForm.entryUid]: uid,
    [config.googleForm.entryName]: name,
    [config.googleForm.entryCourse]: courseFormValue,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  let res;
  try {
    res = await fetch(config.googleForm.actionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (err) {
    throw new GoogleFormSubmissionError("Network error submitting form", {
      cause: err.message,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new GoogleFormSubmissionError(
      `Form endpoint returned HTTP ${res.status}`,
      { status: res.status }
    );
  }

  const text = await res.text();
  const marker = ERROR_MARKERS.find((m) => text.includes(m));
  if (marker) {
    throw new GoogleFormSubmissionError(
      "Form response body indicates the submission was not accepted",
      { marker }
    );
  }

  return { status: res.status, verified: "heuristic" };
}
