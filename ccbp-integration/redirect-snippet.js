// Drop-in logic for forms.ccbp.in/joinsession (or whichever authenticated
// CCBP route owns this flow). Runs entirely client-side, on the CCBP
// origin — that's what lets it call the profile endpoint successfully
// (see "Why identity handling lives on the CCBP side" in INTEGRATION.md).
//
// What it does:
//   1. Reads `course` from this page's own URL query string.
//   2. Calls the CCBP profile endpoint (however this page already does
//      that today) to get { user_id, name }.
//   3. Navigates the browser to this join-service's /api/join with
//      course/uid/name as query params. This is a plain page redirect,
//      not an SSO operation — accounts.ccbp.in's login flow is not
//      involved at this point at all, so its redirect_uri restrictions
//      (whatever they turn out to be) don't apply here.
//
// The join-service then submits the Google Form server-side and redirects
// straight to the webinar — nothing further needed on this end.

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

  // Confirmed: the profile endpoint's user_id is the same value the Form
  // expects as UID — no separate lookup needed.
  const params = new URLSearchParams({
    course,
    uid: profile.user_id,
    name: profile.name,
  });

  window.location.href = `${JOIN_SERVICE_BASE}/api/join?${params.toString()}`;
}

function onJoinFailed(message) {
  // Hook into whatever error affordance this page already has.
}

async function getStudentProfile() {
  throw new Error(
    "Replace getStudentProfile() with this page's existing authenticated profile fetch."
  );
}
