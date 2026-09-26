import { Router } from "express";
import { asyncHandler } from "../utils/http.js";
import { requireUser } from "../middleware/auth.middleware.js";
import { listCourseVideos, saveVideoProgress, watchVideo } from "../controllers/video.controller.js";
import { getMyCategory, listMyCategories } from "../controllers/category.controller.js";

// Student side of the course video library. Each handler checks the student owns the video's
// package, or a package that unlocks the video's category.
const router = Router();

router.get("/me/courses/:courseId/videos", requireUser, asyncHandler(listCourseVideos));
router.get("/me/videos/:id", requireUser, asyncHandler(watchVideo));
router.put("/me/videos/:id/progress", requireUser, asyncHandler(saveVideoProgress));

// Category library: counts and progress for everyone signed in; videos only in unlocked categories.
router.get("/me/categories", requireUser, asyncHandler(listMyCategories));
router.get("/me/categories/:slug", requireUser, asyncHandler(getMyCategory));

export default router;
