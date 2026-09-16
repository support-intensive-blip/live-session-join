# CCBP-side integration contract

This service never receives, stores, or forwards a student's CCBP session,
cookie, or access token, and never sees student identity at all. The
authenticated CCBP page does the identity part itself, since it's the only
place that legitimately can — see below.

## Why this shape, and what was ruled out first

The CCBP profile endpoint
(`https://ccbp-forms-backend-prod-apis.ccbp.in/api/otg_forms_auth/user/profile/v1/`)
authenticates via `Authorization: Bearer <token>` (confirmed from its `401`
response's `WWW-Authenticate: Bearer realm="api"` header), not a cookie.
Its CORS is wide open (`Access-Control-Allow-Origin: *`), but that doesn't
help a page on a different origin: CORS only governs whether a cross-origin
response can be *read*, not whether the request can be authenticated. The
bearer token itself lives in the CCBP app's own JS context
(memory/localStorage) on its own origin, and browser storage is isolated
per-origin — a page on any other domain simply has no way to obtain it. A
page on a foreign origin calling this endpoint gets a clean `401` every
time, regardless of CORS.

That rules out a standalone join-service domain handling identity directly
(what an earlier version of this doc attempted, via a signed handoff-token
redirect through `accounts.ccbp.in`) — that path turned out to depend on a
proprietary client-side "Auth SDK" whose exact redirect/token contract
wasn't discoverable from outside a minified private bundle, which isn't a
safe thing to build an auth integration on top of.

**The shape that actually works:** run the identity-handling part of this
flow *inside* an already-authenticated CCBP page — e.g.
`https://forms.ccbp.in/live-session-doubt-form`, or a new sibling route in
that same "otg-forms" app. That page already has (or can get) the bearer
token in its own JS scope, so it can call the profile endpoint
successfully, the same way it presumably already does today. Nothing about
authentication needs to cross an origin boundary at all.

## What each side does

```
Student clicks a link to the CCBP page (with ?course=<id> on it)
  |
  v
Authenticated CCBP page (forms.ccbp.in or a sibling route — NOT this repo)
  | 1. reads `course` from its own URL
  | 2. calls the profile endpoint (already-authenticated, same as today)
  |    -> { user_id, name }
  | 3. GET https://join.yourdomain.com/api/courses/<course>
  |    -> { formValue, webinarUrl, googleForm: {actionUrl, entryUid, entryName, entryCourse} }
  | 4. submits the Google Form directly (client-side POST — see reliability
  |    note below)
  | 5. redirects to webinarUrl
  v
Student lands in the webinar
```

**This repo's only job** is step 3: `GET /api/courses/:id`
(`src/routes/courses.js`) — a public, unauthenticated endpoint returning
non-sensitive config (which Google Form option a course submits, and its
current webinar URL). No student identity ever reaches this service. It
also runs the admin dashboard (`/admin`) for changing a course's webinar
URL without a deploy.

**Confirmed, not assumed:** the profile endpoint's `user_id` (a UUID) is
the same value the Google Form expects as UID — use it directly, no
separate lookup needed.

## What CCBP needs to add

Nothing on the backend. The only change is to the authenticated page's own
frontend code: implement `joinCourseFromQueryParam()` from
`redirect-snippet.js` (or port the equivalent logic from
`reference-join-page.html`) into that page, swapping in however it already
fetches the student's profile today.

If the "Join live session" link needs to *land* on that page with a
`course` query param (e.g. `https://forms.ccbp.in/live-session-doubt-form?course=react-js-hooks`),
that's a routing/linking change, not a new backend contract — the page
already handles being an authenticated destination; it just needs to read
one more query param and run this logic on load.

## Google Forms submission reliability

Investigated directly (server-side, from this repo's own test scripts):
the classic `formResponse` endpoint has no documented success contract —
no request id, no structured response. Submitting it from server-side code
lets you at least read the real HTTP status and body (see this repo's git
history for that heuristic, no longer used now that submission moved
client-side). Submitting it **client-side**, as this design now does, is
strictly weaker: a `mode: "no-cors"` POST from the browser returns an
opaque response with no way to tell success from failure at all. This
mirrors the exact limitation the original project brief called out about
browser-side `no-cors` submissions, and it's an accepted tradeoff of
keeping this change frontend-only rather than requiring new backend work.
If reliable confirmation ever becomes a requirement, the fix is an
authenticated integration (Forms API with OAuth, or the Sheets API) from
a backend that CCBP's engineering team runs — out of scope here.

## Duplicate submissions

Since identity never reaches this service, it can't dedupe registrations
server-side the way an earlier version of this design did. If duplicate
Sheet rows from repeated clicks/refreshes are a concern, the lightest fix
is a client-side guard in the CCBP page itself (e.g. a `sessionStorage`
flag per course+day before calling `submitGoogleForm`) — optional, and
lower-stakes than it sounds, since a few duplicate rows are easy to filter
out of a tracking sheet.

## Security notes

- The join-service course-lookup endpoint is intentionally public — it
  returns only non-sensitive configuration (Google Form field ids/values,
  webinar URLs), the same data that's already visible to anyone who views
  the Google Form's source or knows a webinar URL. Nothing here is a
  secret.
- The admin dashboard (`/admin`) is the only way to change a webinar URL,
  and it's the only piece of this service worth protecting — see the main
  README's security section for its auth model.
- Because identity never crosses into this service, there's no handoff
  token, signature, or replay-guard to reason about on this side at all —
  simpler, at the cost of the server-side dedup and submission-status
  logging an earlier design had (see "Duplicate submissions" above).
