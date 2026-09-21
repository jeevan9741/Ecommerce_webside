import { Router } from "express";
import { asyncHandler } from "../utils/http.js";
import { requireUser } from "../middleware/auth.middleware.js";
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
router.get("/me/dashboard", asyncHandler(dashboardSummary));
router.get("/me/courses", asyncHandler(myCourses));
router.get("/me/courses/:courseId", asyncHandler(myCourseAccess));
router.get("/me/activity", asyncHandler(myActivity));

export default router;
