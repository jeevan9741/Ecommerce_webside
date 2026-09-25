import { Router } from "express";
import { asyncHandler } from "../utils/http.js";
import { requireUser } from "../middleware/auth.middleware.js";
import { listCourseVideos, saveVideoProgress, watchVideo } from "../controllers/video.controller.js";

// Student side of the course video library. Each handler checks the student owns the video's course.
const router = Router();

router.get("/me/courses/:courseId/videos", requireUser, asyncHandler(listCourseVideos));
router.get("/me/videos/:id", requireUser, asyncHandler(watchVideo));
router.put("/me/videos/:id/progress", requireUser, asyncHandler(saveVideoProgress));

export default router;
