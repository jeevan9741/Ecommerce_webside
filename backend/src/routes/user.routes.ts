import { Router } from "express";
import { asyncHandler } from "../utils/http.js";
import { requireCourseAccess, requireUser } from "../middleware/auth.middleware.js";
import {
  dashboardSummary,
  getMe,
  myActivity,
  myCourseAccess,
  myCourses,
  myOrders,
  updateMe,
} from "../controllers/user.controller.js";

const router = Router();

router.use("/me", requireUser);
router.get("/me", asyncHandler(getMe));
router.patch("/me", asyncHandler(updateMe));
router.get("/me/orders", asyncHandler(myOrders));
// The student dashboard's own data: only for accounts that actually bought a package.
// /me and /me/orders stay open to every signed-in user — profile and receipts aren't the dashboard.
router.get("/me/dashboard", requireCourseAccess, asyncHandler(dashboardSummary));
router.get("/me/courses", requireCourseAccess, asyncHandler(myCourses));
router.get("/me/courses/:courseId", requireCourseAccess, asyncHandler(myCourseAccess));
router.get("/me/activity", requireCourseAccess, asyncHandler(myActivity));

export default router;
