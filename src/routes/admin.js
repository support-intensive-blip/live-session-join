import { Router } from "express";
import crypto from "node:crypto";
import {
  listCourses,
  createCourse,
  updateCourse,
  deleteCourse,
} from "../lib/courseMappingStore.js";
import {
  getLiveCourseFormOptions,
  GoogleFormFieldsError,
} from "../lib/googleFormFields.js";
import { logger } from "../lib/logger.js";

// Internal tool for managing courses — id (the query-param value that
// selects it), label, which live Google Form option it submits, and its
// webinar URL — without a code deploy. Deliberately bare-bones (a plain
// HTML table + forms, no JS framework) — this is an ops tool for a
// handful of trusted editors, not a student-facing surface.
//
// The "which Google Form option" field is always a <select> populated
// from the live form (never free text) — see src/config/courses.js for
// why a typo there is dangerous. If the live form can't be reached, create
// and update are disabled entirely rather than falling back to free text.
//
// Auth: a single shared admin username/password via HTTP Basic Auth
// (ADMIN_USERNAME / ADMIN_PASSWORD). This is an intentionally simple MVP —
// fine for a small number of trusted internal editors sharing one
// credential. If/when more granular per-person access or an audit trail is
// needed, replace this middleware with real accounts; every other module
// here (courseMappingStore, etc.) is unaffected by that change.

function timingSafeEqual(a, b) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function basicAuth(config) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const [scheme, encoded] = header.split(" ");
    if (scheme === "Basic" && encoded) {
      const [user, pass] = Buffer.from(encoded, "base64")
        .toString("utf8")
        .split(":");
      if (
        user &&
        pass &&
        timingSafeEqual(user, config.admin.username) &&
        timingSafeEqual(pass, config.admin.password)
      ) {
        return next();
      }
    }
    res.setHeader("WWW-Authenticate", 'Basic realm="join-service-admin"');
    return res.status(401).send("Authentication required");
  };
}

// Basic Auth credentials are cached and auto-resent by the browser for the
// whole realm, which makes state-changing GETs/POSTs vulnerable to
// cross-site submission from another tab. Since there's no session/cookie
// in play to attach a real CSRF token to, this instead checks the request
// actually originated from this admin UI itself.
function sameOriginOnly(req, res, next) {
  const origin = req.headers.origin || req.headers.referer || "";
  const host = req.headers.host || "";
  if (origin && host && !origin.includes(host)) {
    logger.warn("admin_rejected_cross_origin_write", { origin, host });
    return res.status(403).send("Cross-origin request rejected");
  }
  next();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formOptionsSelect({ name, options, selected, disabled }) {
  const optionTags = options
    .map(
      (opt) =>
        `<option value="${escapeHtml(opt)}"${opt === selected ? " selected" : ""}>${escapeHtml(opt)}</option>`
    )
    .join("");
  return `<select name="${name}" required ${disabled ? "disabled" : ""}>${optionTags}</select>`;
}

function renderPage({ courses, formOptions, formOptionsError, message }) {
  const canEdit = !formOptionsError;

  const rowsHtml = courses
    .map(
      (c) => `
        <tr>
          <td>
            <form method="post" action="/admin/courses/${encodeURIComponent(c.id)}">
              <input type="text" name="newId" value="${escapeHtml(c.id)}" pattern="[a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9]" required ${canEdit ? "" : "disabled"} />
              <br />
              <input type="text" name="label" value="${escapeHtml(c.label)}" required style="width: 22rem" ${canEdit ? "" : "disabled"} />
              <br />
              ${formOptionsSelect({ name: "formValue", options: formOptions, selected: c.formValue, disabled: !canEdit })}
              <br />
              <input type="url" name="webinarUrl" value="${escapeHtml(c.webinarUrl)}" required style="width: 22rem" ${canEdit ? "" : "disabled"} />
              <br />
              <button type="submit" ${canEdit ? "" : "disabled"}>Save</button>
            </form>
          </td>
          <td>
            <form method="post" action="/admin/courses/${encodeURIComponent(c.id)}/delete"
                  onsubmit="return confirm('Delete course &quot;${escapeHtml(c.id)}&quot;? This cannot be undone.');">
              <button type="submit">Delete</button>
            </form>
          </td>
        </tr>`
    )
    .join("");

  const addFormHtml = `
    <form method="post" action="/admin/courses">
      <input type="text" name="id" placeholder="course-id" pattern="[a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9]" required ${canEdit ? "" : "disabled"} />
      <input type="text" name="label" placeholder="Label" required style="width: 22rem" ${canEdit ? "" : "disabled"} />
      ${formOptionsSelect({ name: "formValue", options: formOptions, selected: null, disabled: !canEdit })}
      <input type="url" name="webinarUrl" placeholder="https://…" required style="width: 22rem" ${canEdit ? "" : "disabled"} />
      <button type="submit" ${canEdit ? "" : "disabled"}>Add course</button>
    </form>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Join service admin</title>
  <meta name="robots" content="noindex" />
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 2rem; }
    th, td { border: 1px solid #ccc; padding: 0.5rem; text-align: left; vertical-align: top; }
    th { background: #f4f4f4; }
    .message { background: #eaffea; border: 1px solid #4a4; padding: 0.5rem 1rem; margin-bottom: 1rem; }
    .error { background: #ffecec; border: 1px solid #c44; padding: 0.5rem 1rem; margin-bottom: 1rem; }
    input, select { margin: 0.15rem 0; }
    fieldset { margin-top: 1rem; }
  </style>
</head>
<body>
  <h1>Course &rarr; join-link mapping</h1>
  <p>Course id (the <code>?course=</code> value), label, which live Google Form option it submits, and its webinar URL — all editable here.</p>
  ${message ? `<div class="message">${escapeHtml(message)}</div>` : ""}
  ${
    formOptionsError
      ? `<div class="error">Could not load the live Google Form's course options (${escapeHtml(formOptionsError)}) — add/edit is disabled until this is reachable again. Delete still works.</div>`
      : ""
  }
  <table>
    <thead>
      <tr><th>Id / label / form option / webinar URL</th><th></th></tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <fieldset>
    <legend>Add a new course</legend>
    ${addFormHtml}
  </fieldset>
</body>
</html>`;
}

async function loadFormOptions(config) {
  try {
    return { options: await getLiveCourseFormOptions(config), error: null };
  } catch (err) {
    const message =
      err instanceof GoogleFormFieldsError ? err.message : "unexpected error";
    logger.error("admin_form_options_fetch_failed", { message });
    return { options: [], error: message };
  }
}

export function createAdminRouter({ config, store }) {
  const router = Router();
  const auth = basicAuth(config);

  router.get("/admin", auth, async (req, res) => {
    const [courses, { options, error }] = await Promise.all([
      listCourses(store),
      loadFormOptions(config),
    ]);
    res.type("html").send(
      renderPage({
        courses,
        formOptions: options,
        formOptionsError: error,
        message: req.query.msg,
      })
    );
  });

  router.post("/admin/courses", auth, sameOriginOnly, async (req, res) => {
    const { id, label, formValue, webinarUrl } = req.body ?? {};
    const { options, error } = await loadFormOptions(config);
    if (error) {
      return res.status(503).send(`Live Google Form is unreachable: ${error}`);
    }

    try {
      await createCourse(store, { id, label, formValue, webinarUrl }, options);
    } catch (err) {
      const courses = await listCourses(store);
      return res
        .status(400)
        .type("html")
        .send(
          renderPage({
            courses,
            formOptions: options,
            formOptionsError: null,
            message: `Error: ${err.message}`,
          })
        );
    }

    logger.info("admin_course_created", { courseId: id });
    res.redirect(`/admin?msg=${encodeURIComponent(`Added course ${id}`)}`);
  });

  router.post(
    "/admin/courses/:id",
    auth,
    sameOriginOnly,
    async (req, res) => {
      const { id } = req.params;
      const { label, formValue, webinarUrl, newId } = req.body ?? {};
      const { options, error } = await loadFormOptions(config);
      if (error) {
        return res.status(503).send(`Live Google Form is unreachable: ${error}`);
      }

      try {
        await updateCourse(store, id, { label, formValue, webinarUrl, newId }, options);
      } catch (err) {
        const courses = await listCourses(store);
        return res
          .status(400)
          .type("html")
          .send(
            renderPage({
              courses,
              formOptions: options,
              formOptionsError: null,
              message: `Error: ${err.message}`,
            })
          );
      }

      logger.info("admin_course_updated", { courseId: id, newId: newId || id });
      res.redirect(
        `/admin?msg=${encodeURIComponent(`Updated ${newId || id}`)}`
      );
    }
  );

  router.post(
    "/admin/courses/:id/delete",
    auth,
    sameOriginOnly,
    async (req, res) => {
      const { id } = req.params;
      await deleteCourse(store, id);
      logger.info("admin_course_deleted", { courseId: id });
      res.redirect(`/admin?msg=${encodeURIComponent(`Deleted ${id}`)}`);
    }
  );

  return router;
}
