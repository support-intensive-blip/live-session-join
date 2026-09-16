# CCBP join-service

Backend for the CCBP one-click "join a live session" flow. Handles course
config, Google Form submission, and the redirect to the webinar; the
authenticated CCBP page (`forms.ccbp.in/joinsession`) handles identity,
because it's the only place that legitimately can (see below).

**Read `ccbp-integration/INTEGRATION.md` first if you're wiring this up.**
That's where the CCBP-side half of this flow is specified — this repo is
only the other half.

## 1. Architecture

```
Student lands on https://forms.ccbp.in/joinsession?course=<id>
  |
  v
forms.ccbp.in/joinsession (authenticated CCBP page — NOT this repo)
  | 1. reads `course` from its own URL
  | 2. calls the CCBP profile endpoint (already-authenticated, same as
  |    it presumably does today) -> { user_id, name }
  | 3. redirects the browser (plain navigation, not an SSO operation) to:
  |    GET /api/join?course=<id>&uid=<user_id>&name=<name>
  v
GET /api/join (this service — src/routes/join.js)
  | 1. looks up the course; unknown -> 404, nothing else happens
  | 2. validates uid/name are present
  | 3. submits the Google Form server-side (src/lib/googleFormSubmit.js)
  | 4. 302s to that course's webinar URL — always, even if step 3 failed
  v
Student lands in the webinar
```

### Why identity handling lives on the CCBP side, not here

Investigated directly: the CCBP profile endpoint
(`https://ccbp-forms-backend-prod-apis.ccbp.in/api/otg_forms_auth/user/profile/v1/`)
authenticates via `Authorization: Bearer <token>` (confirmed from its
`401` response's `WWW-Authenticate: Bearer realm="api"` header), not a
cookie. Its CORS is wide open (`Access-Control-Allow-Origin: *`), but that
doesn't help — CORS only governs whether a cross-origin *response* can be
read, not whether a request can authenticate. The bearer token lives in
the CCBP app's own JS context on its own origin, and browser storage is
isolated per-origin, so a page on any other domain has no way to obtain
it — it would just get a clean `401` regardless of CORS. (Confirmed again
with a real captured browser request from `forms.ccbp.in` while logged
in — it succeeds there specifically because that page already holds the
token.)

Two earlier designs were tried and ruled out:

1. A standalone signed "handoff token" redirected through a new backend
   endpoint on `accounts.ccbp.in`. Depended on a proprietary client-side
   Auth SDK whose exact redirect/token contract wasn't discoverable from
   outside a minified private bundle — not safe to build on.
2. Submitting the Google Form client-side from the CCBP page, with this
   service only serving non-identity config. Worked, but gave up
   server-side submission verification and dedup for no real benefit once
   the current, simpler design became clear.

The design that actually works, confirmed against the real deployed route
`https://forms.ccbp.in/joinsession`: identity handling runs **inside**
that already-authenticated page — it already has the bearer token in
scope, so it calls the profile endpoint successfully, then does a plain
browser redirect (not an SSO operation — `accounts.ccbp.in`'s own
redirect-target restrictions don't apply to a page just choosing where to
navigate next) to `GET /api/join` on this service. Full writeup: see
`ccbp-integration/INTEGRATION.md`.

## 2. Project structure

```
join-service/
  src/
    config/
      env.js                  # env var loading + validation
      courses.js               # SEED_COURSES — bootstraps the course store once, on first run
    lib/
      courseMappingStore.js     # full course CRUD (id/label/formValue/webinarUrl), backs /api/join, /api/courses, and /admin
      googleFormFields.js        # fetches the live Form's course dropdown options, for the admin UI's <select>
      googleFormSubmit.js         # server-side Google Form submission + heuristic verification
      store.js                     # pluggable KV store (memory | Redis)
      logger.js                     # structured logging with secret redaction
    routes/
      join.js                        # GET /api/join — the actual student-facing integration point
      courses.js                      # GET /api/courses/:id — smaller public course config lookup
      admin.js                         # GET/POST /admin — course management dashboard
    server.js                         # Express app wiring (createApp only — no listen(), no dotenv)
    start.js                            # standalone entry point (npm start/dev) — never imported by the Netlify function
  ccbp-integration/
    INTEGRATION.md                     # the actual student-facing flow contract (lives outside this repo)
    redirect-snippet.js                 # drop-in logic for the authenticated CCBP page
    reference-join-page.html             # standalone reference/demo of the same logic (local use only — see section 8)
  netlify/
    functions/server.js                   # Netlify Functions adapter around src/server.js
  netlify.toml                              # Netlify build/redirect config
  netlify-public/                            # empty-ish publish dir (no real content — see section 8)
  scripts/
    verify-form-fields.js                 # re-checks live Google Form field ids/options
    local-form-stub.mjs                   # local Google Form stand-in for safe testing (section 7)
  test/                                    # node:test unit + integration tests
```

## 3. Configuration

Copy `.env.example` to `.env` and fill in real values. Key variables:

| Variable | Purpose |
|---|---|
| `GOOGLE_FORM_ACTION_URL`, `GOOGLE_FORM_ENTRY_*` | The form endpoint and field ids — already verified against the live form (see `npm run verify-form`). Submitted server-side by `GET /api/join`; also served as config via `GET /api/courses/:id`. |
| `REDIS_URL` | Set for any multi-instance deployment, or to persist admin overrides across restarts (see section 6). |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Protects `/admin` (see section 5). `ADMIN_PASSWORD` has no default — the app refuses to start without it set. |

## 4. Course configuration

Courses (id, label, which Google Form option they submit, webinar URL) are
fully managed at runtime through the admin dashboard (section 5) — added,
renamed, edited, or removed without a code deploy. `src/config/courses.js`
is only *seed data*: the first time the course store is empty, it's
populated from that file's `SEED_COURSES`; after that, the admin dashboard
is the source of truth and the file is never read again at runtime.

The Google Form's "Select the Course" field is a single-select dropdown
with only 10 atomic options (`Static Website`, `Dynamic Website`,
`JS essentails` [sic, Google's own typo], `SQL`, `Python`, `Node`,
`Developer Foundations`, `React`, `Java`, `Spring Boot`) — confirmed live
via `npm run verify-form`. The seed course list bundles several of these
together (e.g. "Java Fundamentals & Spring Boot"); per your direction each
bundled course submits only its primary skill to the form, confirmed as:
"Progamming Foundations" → `Python`, "Developer Foundations and Node JS" →
`Node`.

`GET /api/join` and `GET /api/courses/:id` both 404 for anything not
currently in the course store — there is no way to make either return or
redirect to anything but a known course's own configured values.

## 5. Admin dashboard (course management)

`GET /admin`, `POST /admin/courses` (create), `POST /admin/courses/:id`
(update, including renaming the id), and `POST /admin/courses/:id/delete`
(`src/routes/admin.js`), backed by `src/lib/courseMappingStore.js`. Lets
you add, rename, edit, or remove a course — including which query-param
value (`?course=<id>`) selects it — without a code deploy or restart.

- **Auth:** HTTP Basic Auth (`ADMIN_USERNAME` / `ADMIN_PASSWORD`). This is
  an intentionally simple MVP for a small number of trusted internal
  editors sharing one credential — there's no per-person audit trail. If
  that becomes a requirement, replace the `basicAuth` middleware in
  `admin.js` with real accounts; nothing else needs to change.
- **Safe by construction, not by convention:** id, label, and webinar URL
  are free text (id is still validated to be a URL-safe slug, and webinar
  URL to be `https://`), but **which Google Form option a course
  submits is always chosen from a `<select>` populated from the live
  form** (`src/lib/googleFormFields.js`, same parsing `npm run
  verify-form` uses) — never free text. A typo there can't silently break
  a course's submissions, because there's no way to type one in. If the
  live form can't be reached, create/update are refused outright (503)
  rather than falling back to an unvalidated text field; viewing the list
  and deleting a course still work.
- **Persistence:** course records live in the shared KV store
  (`src/lib/store.js`) — durable across restarts/instances only when
  `REDIS_URL` is set; in-memory (this process only, reset to the seed
  list on every restart) otherwise.
- **CSRF:** since Basic Auth credentials are cached and auto-resent by the
  browser for the whole realm, state-changing POSTs check the request's
  `Origin`/`Referer` actually matches this host before applying a write
  (`sameOriginOnly` in `admin.js`) — there's no session cookie to hang a
  real CSRF token off of here.

## 6. Security considerations

- **`GET /api/join`'s `uid`/`name` arrive unsigned — stated plainly, not
  glossed over.** Anyone who knew the URL shape could hit
  `/api/join?course=X&uid=fake&name=fake` directly and create a fabricated
  row in the Google Sheet. This is a deliberate trade-off: it's low-stakes
  (only pollutes bookkeeping data — nothing sensitive is exposed, nothing
  is granted), and the webinar URL a request lands on always comes from
  this service's own course config, never from the request, so it can
  never become an open redirect or an auth bypass regardless of what's
  sent. A signed-token version of this was built and then deliberately
  dropped (see `ccbp-integration/INTEGRATION.md`) because it depended on
  CCBP infrastructure that wasn't reliably available; a lighter-weight
  shared secret could be added later if this needs tightening without
  reintroducing that complexity.
- `GET /api/join` and `GET /api/courses/:id` are intentionally public and
  unauthenticated for the same reason — nothing sensitive is read or
  written by an unauthenticated caller beyond the scope described above.
- Course allowlist enforced server-side; both endpoints 404 for anything
  not in the course store, and never return or redirect to arbitrary data
  from the request — there is no way to make this service surface
  anything but a known course's own configured values.
- The admin dashboard lets you set a course's webinar URL and id freely,
  but webinar URL is validated to be `https://` (so it can't be pointed at
  a `javascript:` URL or similar) and id to a URL-safe slug pattern — and
  critically, the Google Form option a course submits can only ever be one
  the live form actually offers (see section 5), never arbitrary text.
- `/admin` sits behind Basic Auth over HTTPS; treat `ADMIN_PASSWORD` like
  any other production credential (long, random, from a secrets manager,
  not committed anywhere). Since the dashboard can now create/rename
  courses (not just change a URL), a leaked admin credential has a larger
  blast radius than before — restrict who has it accordingly.
- Run behind HTTPS in production (terminate TLS at your platform/load
  balancer; the app itself is a plain HTTP Express app expecting that).

## 7. Local development

```bash
cd join-service
npm install
cp .env.example .env
# set ADMIN_PASSWORD to any string for local dev
npm run dev
```

```bash
curl http://localhost:3000/api/courses/react-js-hooks
```

`http://localhost:3000/admin` (Basic Auth: `ADMIN_USERNAME` /
`ADMIN_PASSWORD` from `.env`) opens the course-mapping dashboard.

To try the full student-facing flow locally, first run
`node scripts/local-form-stub.mjs` and point `GOOGLE_FORM_ACTION_URL` in
`.env` at `http://localhost:4001/formResponse` — otherwise the next step
submits to the real production form. Then open
`ccbp-integration/reference-join-page.html` directly in a browser (edit
`JOIN_SERVICE_BASE` inside it if not using port 3000) and watch it
auto-submit and redirect.

## 8. Production deployment

Any Node 20+ host works (this is a plain Express app — no framework
lock-in beyond that): a small VM, a container platform (Fly.io, Render,
Railway), a container behind your existing load balancer/CDN, or Netlify
(see below).

1. Set real env vars (`.env.example` lists all of them).
2. **Set `REDIS_URL`** if running more than one instance, or if you want
   admin dashboard overrides to survive a restart — the default in-memory
   store neither coordinates across processes nor survives a restart. **On
   Netlify this isn't optional** — see below.
3. Put this behind HTTPS (terminate TLS at the platform/LB).
4. Set `ADMIN_USERNAME` / `ADMIN_PASSWORD` to real, unique credentials and
   share them only with whoever will actually edit course mappings.
5. On the CCBP side, implement `ccbp-integration/INTEGRATION.md` —
   `redirect-snippet.js`'s logic ported into the authenticated page that
   will own this flow, pointed at this deployment's origin.

### Deploying to Netlify

Netlify runs this as a serverless function, not a long-running process —
`netlify/functions/server.js` wraps the same Express app
(`src/server.js`) via `serverless-http`; `netlify.toml` redirects every
request there. `src/server.js` only exports `createApp()` — it never calls
`listen()` and never touches `import.meta`/`process.argv` — deliberately,
since Netlify's esbuild-based bundler transforms this ESM project to CJS,
and `import.meta.url` does not survive that transform (it came through as
`undefined` and crashed the function on load, verified directly against
the actual bundled output during development). `src/start.js` is the real
standalone entry point (`npm start`/`npm run dev`); it's never imported by
the Netlify function, so that transform issue never applies to it.

- **`REDIS_URL` is required, not optional, on Netlify.** Serverless
  function invocations are ephemeral and don't reliably share memory
  between requests — without Redis, the course list would silently reset
  to the seed data at unpredictable times and admin dashboard writes
  could vanish. Any Redis-compatible provider works (e.g. Upstash's
  serverless Redis, which is `ioredis`-compatible over TCP).
- Set all other env vars (`ADMIN_USERNAME`, `ADMIN_PASSWORD`,
  `GOOGLE_FORM_ACTION_URL`, `GOOGLE_FORM_ENTRY_*`) in Netlify's site
  environment variable settings — never commit them.
- `netlify.toml`'s `publish` directory (`netlify-public/`) deliberately
  contains no real content and **excludes `ccbp-integration/`** —
  `reference-join-page.html` in there submits to whatever Google Form is
  configured with no auth of its own, so it must never be reachable at a
  public URL, only opened locally as a file for testing (section 7).
- Deploy: connect the repo in Netlify's UI (auto-detects `netlify.toml`),
  or `netlify deploy --prod` via the Netlify CLI from this directory.

## 9. Test plan

Automated (`npm test`, 30 tests, all passing as of this build):

- Seed data: every seed course has a non-empty id/label/formValue and a
  valid `https://` webinar URL; ids are unique.
- Course mapping store: seeds from `SEED_COURSES` on first access;
  `createCourse` adds a course and rejects a duplicate id, an invalid id,
  a non-`https://` URL, and a `formValue` not in the live options list;
  `updateCourse` edits fields in place and can rename a course's id
  (old id gone, new id present, rejecting a rename onto an existing id),
  and rejects an unknown course id; `deleteCourse` removes a course.
- `GET /api/courses/:id`: returns the right form config + webinar URL for
  a known course; 404s for an unknown one; reflects an admin-made change
  immediately.
- `GET /api/join` (against a real running server, Google Form stubbed by
  a local HTTP server so nothing touches production): a valid
  course+uid+name submits the form and 302s to the right webinar URL; an
  unknown course 404s without submitting anything; a missing course, or a
  missing/empty uid or name, is rejected (400) before any submission; a
  Google Form failure still 302s to the webinar (never blocks the
  student); extra request params (`redirect=`, `webinarUrl=`, etc.) never
  change the redirect target — it always comes from the course store.
- Admin dashboard route: `/admin` rejects missing/wrong Basic Auth
  credentials and lists courses with correct credentials; create, update
  (including id rename), and delete all work and persist through the
  store; updating an unknown course id 400s; a cross-origin `Origin`
  header on a write is rejected; when the live Google Form is unreachable,
  create/update are refused with `503` while list and delete still work
  (this specifically exercises `googleFormFields.js`'s cache being cleared
  between tests — see the comment in `admin.route.test.js`).

Also verified directly against the real compiled Netlify function output
(not just the local dev server) during development — this caught two bugs
that only manifested in the actual bundled artifact (see the "Deploying to
Netlify" section above); worth re-running that same check
(`npx @netlify/zip-it-and-ship-it netlify/functions <out-dir>`, then
execute the bundled `server.js` directly with a mocked Lambda event) after
any change that touches `src/server.js`, `src/start.js`, or `netlify/`.

Manual, before go-live (not automatable without a real authenticated CCBP
session / touching the production Sheet):

1. **Port `redirect-snippet.js`'s logic into `forms.ccbp.in/joinsession`**
   (or wherever this flow lives) per `ccbp-integration/INTEGRATION.md`,
   swapping in that page's real profile-fetch call.
2. **End-to-end click-through** — as a real logged-in test student, land
   on that page with `?course=<id>` and confirm it lands them in the
   webinar with no visible UI in between.
3. **One live Google Form submission** — confirm a row appears in the
   linked response Sheet with the expected UID/Name/Course; delete that
   test row afterward.
4. **Course allowlist** — hit `GET /api/join?course=not-a-real-course&uid=x&name=x`;
   confirm `404 unknown_course` and no Sheet row.
5. **Admin dashboard walkthrough** — log into `/admin` with real
   credentials: add a new course, confirm `GET /api/join` works for it
   immediately; edit an existing course's webinar URL and confirm the
   change is reflected; rename a course's id and confirm the old id 404s
   while the new one works; delete a course and confirm it 404s.
6. **Duplicate click** (optional) — click the same join link twice in a
   row as the same student; decide whether the resulting duplicate Sheet
   rows are acceptable or whether server-side dedup (see
   `INTEGRATION.md` "Duplicate submissions") is worth adding.
