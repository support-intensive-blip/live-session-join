// Drop-in logic for the authenticated CCBP page that owns this flow (e.g.
// https://forms.ccbp.in/live-session-doubt-form, or a sibling route in
// that same "otg-forms" app). Runs entirely client-side, on the CCBP
// origin — that's what lets it call the profile endpoint successfully
// (see "Why this works from here but not from a separate domain" in
// INTEGRATION.md).
//
// What it does, in order:
//   1. Reads `course` from this page's own URL query string.
//   2. Calls the CCBP profile endpoint (however this page already does
//      that today) to get { user_id, name }.
//   3. Fetches this join-service's public course config
//      (GET /api/courses/:id) for the Google Form field id/value to use
//      and the current webinar URL.
//   4. Submits the Google Form directly, client-side.
//   5. Redirects to the webinar URL.
//
// Replace JOIN_SERVICE_BASE and getStudentProfile() with real values —
// everything else can be used close to as-is.

const JOIN_SERVICE_BASE = "https://join.yourdomain.com"; // TODO: set to the deployed join-service origin

export async function joinCourseFromQueryParam() {
  const course = new URLSearchParams(window.location.search).get("course");
  if (!course) {
    onJoinFailed("Missing course parameter.");
    return;
  }

  let profile;
  try {
    profile = await getStudentProfile();
  } catch {
    onJoinFailed("Could not load your profile.");
    return;
  }

  let courseConfig;
  try {
    const res = await fetch(
      `${JOIN_SERVICE_BASE}/api/courses/${encodeURIComponent(course)}`
    );
    if (!res.ok) throw new Error(`course lookup failed: ${res.status}`);
    courseConfig = await res.json();
  } catch {
    onJoinFailed("Could not look up that course.");
    return;
  }

  // Confirmed: the profile endpoint's user_id is the same value the Form
  // expects as UID — no separate lookup needed. If that ever changes,
  // this is the one place to add a real mapping.
  const uid = profile.user_id;
  const name = profile.name;

  submitGoogleForm(courseConfig.googleForm, {
    uid,
    name,
    course: courseConfig.formValue,
  });

  // Fire-and-forget: see "Google Forms submission reliability" in
  // INTEGRATION.md — a browser-side submission like this has no way to
  // confirm the row was actually recorded, so we don't claim success
  // anywhere; we just proceed to the webinar regardless.
  window.location.replace(courseConfig.webinarUrl);
}

function submitGoogleForm(googleForm, { uid, name, course }) {
  const body = new URLSearchParams({
    [googleForm.entryUid]: uid,
    [googleForm.entryName]: name,
    [googleForm.entryCourse]: course,
  });

  fetch(googleForm.actionUrl, {
    method: "POST",
    mode: "no-cors", // Google Forms doesn't send CORS headers; the response is opaque either way.
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  }).catch(() => {
    // Best-effort only — see the reliability note above. Nothing to
    // recover here; the redirect proceeds regardless.
  });
}

function onJoinFailed(message) {
  // Hook into whatever error affordance this page already has.
}

async function getStudentProfile() {
  throw new Error(
    "Replace getStudentProfile() with this page's existing authenticated profile fetch."
  );
}
