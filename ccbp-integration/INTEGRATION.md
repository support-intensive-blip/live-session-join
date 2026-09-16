# CCBP-side integration contract

This service never receives, stores, or forwards a student's CCBP session,
cookie, or access token. It does receive student identity (`uid`, `name`)
as plain query params on the final redirect step — deliberately unsigned;
see "Security notes" for why that's an acceptable trade-off here. The
authenticated CCBP page does the actual authentication, since it's the
only place that legitimately can — see below.

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
time, regardless of CORS. (Confirmed again later with a real captured
browser request from `forms.ccbp.in` while logged in: the request only
succeeds there because the page itself already holds the token.)

Two earlier designs were tried and ruled out before this one:

1. A standalone join-service domain handling identity directly via a
   signed handoff-token redirect through `accounts.ccbp.in`. Turned out to
   depend on a proprietary client-side "Auth SDK" whose exact
   redirect/token contract wasn't discoverable from outside a minified
   private bundle — not a safe thing to build an auth integration on.
2. Submitting the Google Form client-side from the CCBP page directly,
   with the join-service only serving non-identity config. Worked, but
   meant giving up server-side submission verification (browser `no-cors`
   POSTs return an opaque response) and duplicate-click dedup, for no
   real benefit once it became clear an even simpler option existed.

**The shape that actually works, confirmed against a real deployed route
(`https://forms.ccbp.in/joinsession`):** the identity-handling logic runs
*inside* that already-authenticated CCBP page, which calls the profile
endpoint itself (same-origin, works), then does a plain browser
**redirect** — not an SSO operation, just page navigation — to this
join-service with `course`/`uid`/`name` as query params. The join-service
submits the Google Form server-side (reliable: it can read the real HTTP
response, unlike a browser) and 302s straight to the webinar.

Note this redirect is *not* mediated by `accounts.ccbp.in`'s login flow at
all — that SSO system's own redirect-target restrictions (whatever they
turn out to be) are irrelevant here, because by this point the student is
already logged in and `forms.ccbp.in/joinsession` is just a normal page
choosing where to send the browser next, the same as any `<a href>` would.

## What each side does

```
Student lands on https://forms.ccbp.in/joinsession?course=<id>
  |
  v
forms.ccbp.in/joinsession (authenticated CCBP page — NOT this repo)
  | 1. reads `course` from its own URL
  | 2. calls the profile endpoint (already-authenticated, same as today)
  |    -> { user_id, name }
  | 3. redirects the browser (plain navigation) to:
  |    https://join.yourdomain.com/api/join?course=<id>&uid=<user_id>&name=<name>
  v
GET /api/join (this repo — src/routes/join.js)
  | 1. looks up the course; unknown course -> 404, nothing else happens
  | 2. validates uid/name are present and non-empty
  | 3. submits the Google Form server-side (src/lib/googleFormSubmit.js)
  | 4. 302s to that course's webinar URL — always, even if step 3 failed
  |    (a logging hiccup shouldn't lock a student out of class; see
  |    "Google Forms submission reliability" below)
  v
Student lands in the webinar
```

**This repo's job:** `GET /api/join` (the actual integration point) and
`GET /api/courses/:id` (a smaller public config lookup, still available
if useful elsewhere, but not required for this flow). Also runs the admin
dashboard (`/admin`) for managing courses and webinar URLs without a
deploy.

**Confirmed, not assumed:** the profile endpoint's `user_id` (a UUID) is
the same value the Google Form expects as UID — use it directly, no
separate lookup needed.

## What CCBP needs to add

Nothing on the backend. The only change is to `forms.ccbp.in/joinsession`
(or wherever this flow lives)'s own frontend code: implement
`joinCourseFromQueryParam()` from `redirect-snippet.js` (or port the
equivalent logic from `reference-join-page.html`), swapping in however
that page already fetches the student's profile today.

`course` must be one of the ids the join-service's admin dashboard knows
about (`?course=react-js-hooks`, `?course=intro-databases`, etc.) —
coordinate that list with whatever identifies a course in the CCBP app.

## Google Forms submission reliability

Investigated directly: the classic `formResponse` endpoint has no
documented success contract — no request id, no structured response.
Because `/api/join` submits it **server-side** (verified directly against
the actual deployed bundle, not just local dev), it can at least read the
real HTTP status and body — `googleFormSubmit.js` applies a heuristic (2xx
status, no known Google error marker in the body) and logs the outcome,
but this is still a heuristic, not a guarantee, and is never presented to
the student as a confirmed success. If reliable confirmation ever becomes
a requirement, the real fix is an authenticated integration (Forms API
with OAuth, or the Sheets API) — out of scope here.

## Duplicate submissions

`/api/join` has no server-side dedup right now — a repeated click submits
the form again. If duplicate Sheet rows become a real problem, the
lightest fix is a client-side guard on the `forms.ccbp.in` side (a
`sessionStorage` flag per course+day before redirecting) — optional, and
lower-stakes than it sounds, since a few duplicate rows are easy to filter
out of a tracking sheet. A server-side version (keyed by `uid`+course+day)
could be added to `/api/join` later if wanted; ask if so.

## Security notes

- **`uid`/`name` arrive unsigned.** Anyone who knew this URL shape could
  hit `/api/join?course=X&uid=fake&name=fake` directly and create a
  fabricated row in the tracking sheet. This is a deliberate, low-stakes
  trade-off: it only pollutes bookkeeping data, never exposes anything
  sensitive or grants access to anything — the webinar URL a request lands
  on always comes from the join-service's own course config, never from
  the request, so this can't become an open redirect or an auth bypass no
  matter what's sent. If this needs tightening later, a lightweight shared
  secret between `forms.ccbp.in` and the join-service (not full signing)
  would filter out casual/accidental hits without the complexity of the
  JWT approach that was ruled out earlier — ask if that's wanted.
- `GET /api/join` and `GET /api/courses/:id` are intentionally
  unauthenticated for the same reason: nothing sensitive is read or
  written by an unauthenticated caller beyond what's described above.
- The admin dashboard (`/admin`) is the only piece of this service worth
  actually protecting — see the main README's security section for its
  auth model.
