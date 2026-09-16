import { Router } from "express";
import { getCourse } from "../lib/courseMappingStore.js";
import {
  submitJoinForm,
  GoogleFormSubmissionError,
} from "../lib/googleFormSubmit.js";
import { logger } from "../lib/logger.js";

// The authenticated CCBP page (forms.ccbp.in/joinsession) already has the
// student's identity (it called the profile endpoint itself, same-origin —
// see ccbp-integration/INTEGRATION.md) and simply navigates the browser
// here with it in the query string. This is a plain page navigation, not
// an SSO operation, so it works regardless of what accounts.ccbp.in's own
// redirect_uri support does or doesn't allow.
//
// Trade-off, stated plainly: uid/name arrive unsigned. Anyone who knew
// this URL shape could POST a fabricated registration by hitting it
// directly — low stakes (it only pollutes the tracking sheet; nothing
// sensitive is exposed or granted), and the course allowlist + course's
// own configured webinar URL still make an open redirect impossible
// regardless of what uid/name are sent.
const MAX_FIELD_LENGTH = 200;

function isValidField(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_FIELD_LENGTH
  );
}

export function createJoinRouter({ config, store }) {
  const router = Router();

  router.get("/api/join", async (req, res) => {
    const { course: courseId, uid, name } = req.query;

    if (!courseId || typeof courseId !== "string") {
      return res.status(400).json({ error: "missing_course" });
    }

    const course = await getCourse(store, courseId);
    if (!course) {
      logger.warn("join_rejected_unknown_course", { courseId });
      return res.status(404).json({ error: "unknown_course" });
    }

    if (!isValidField(uid) || !isValidField(name)) {
      logger.warn("join_rejected_invalid_identity", { courseId });
      return res.status(400).json({ error: "missing_or_invalid_uid_or_name" });
    }

    try {
      const result = await submitJoinForm(
        { uid, name, courseFormValue: course.formValue },
        config
      );
      logger.info("join_form_submitted", {
        courseId,
        formVerified: result.verified,
      });
    } catch (err) {
      const details =
        err instanceof GoogleFormSubmissionError ? err.details : undefined;
      logger.error("join_form_submission_failed", {
        courseId,
        message: err.message,
        details,
      });
      // Fall through: the student still gets into the webinar even if the
      // form logging failed — a logging hiccup shouldn't lock them out of
      // class. Ops needs to backfill this registration from the logs.
    }

    return res.redirect(302, course.webinarUrl);
  });

  return router;
}
