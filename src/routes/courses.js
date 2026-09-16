import { Router } from "express";
import { getCourse } from "../lib/courseMappingStore.js";
import { logger } from "../lib/logger.js";

// Public, unauthenticated by design: everything returned here is
// non-sensitive configuration (which Google Form option a course submits,
// and which webinar URL it currently redirects to) — no student identity
// ever passes through this service. See ccbp-integration/INTEGRATION.md:
// the authenticated CCBP page calls this to get what it needs to submit
// the Google Form itself and know where to redirect afterward.
export function createCoursesRouter({ config, store }) {
  const router = Router();

  router.get("/api/courses/:id", async (req, res) => {
    const course = await getCourse(store, req.params.id);
    if (!course) {
      logger.warn("course_lookup_unknown_course", { courseId: req.params.id });
      return res.status(404).json({ error: "unknown_course" });
    }

    res.json({
      id: course.id,
      label: course.label,
      formValue: course.formValue,
      webinarUrl: course.webinarUrl,
      googleForm: {
        actionUrl: config.googleForm.actionUrl,
        entryUid: config.googleForm.entryUid,
        entryName: config.googleForm.entryName,
        entryCourse: config.googleForm.entryCourse,
      },
    });
  });

  return router;
}
