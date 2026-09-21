import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../utils/http.js";
import { optionalAuth, requireUser } from "../middleware/auth.middleware.js";
import {
  aboutPage,
  applyToJob,
  courseContent,
  demoVideos,
  getJob,
  listCertificates,
  listCourses,
  listJobs,
  listLanguages,
  listReviews,
  publicSettings,
} from "../controllers/course.controller.js";

const router = Router();

// Resumes are held in memory only long enough to stream them to Blob storage; the
// controller enforces the 5MB / PDF-or-Word rules, this limit is just a hard ceiling.
const resumeUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024 } });

router.get("/courses", optionalAuth, asyncHandler(listCourses));
router.get("/courses/:id/content", requireUser, asyncHandler(courseContent));
router.get("/languages", asyncHandler(listLanguages));
router.get("/demo-videos", asyncHandler(demoVideos));
router.get("/reviews", asyncHandler(listReviews));
router.get("/settings/public", asyncHandler(publicSettings));
router.get("/certificates", asyncHandler(listCertificates));
router.get("/about", asyncHandler(aboutPage));
router.get("/jobs", asyncHandler(listJobs));
router.get("/jobs/:id", asyncHandler(getJob));
router.post("/jobs/:id/apply", resumeUpload.single("resume"), asyncHandler(applyToJob));

export default router;
