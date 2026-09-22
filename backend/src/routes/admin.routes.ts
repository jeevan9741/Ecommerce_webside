import { Router } from "express";
import { asyncHandler } from "../utils/http.js";
import { requireAdmin } from "../middleware/auth.middleware.js";
import * as course from "../controllers/admin-course.controller.js";
import * as ops from "../controllers/admin-ops.controller.js";
import * as content from "../controllers/admin-content.controller.js";

const router = Router();

// Every route below requires an ADMIN session.
router.use("/admin", requireAdmin);
router.use("/upload", requireAdmin);

// Analytics
router.get("/admin/analytics/sales", asyncHandler(ops.salesAnalytics));
router.get("/admin/analytics/payouts", asyncHandler(ops.payoutAnalytics));

// People
router.get("/admin/customers", asyncHandler(ops.listCustomers));
router.get("/admin/partners", asyncHandler(ops.listPartners));

// Orders
router.get("/admin/orders", asyncHandler(ops.listOrders));
router.post("/admin/orders/:id/sync", asyncHandler(ops.syncOrder));

// Withdrawals
router.get("/admin/withdrawals", asyncHandler(ops.listWithdrawals));
router.post("/admin/withdrawals/:id/process", asyncHandler(ops.processWithdrawal));
router.get("/admin/referral-claims", asyncHandler(ops.listReferralClaims));
router.post("/admin/referral-claims/:id/review", asyncHandler(ops.reviewReferralClaim));

// Settings
router.get("/admin/settings", asyncHandler(ops.listSettings));
router.put("/admin/settings", asyncHandler(ops.saveSetting));

// Courses
router.get("/admin/courses", asyncHandler(course.listCourses));
router.post("/admin/courses", asyncHandler(course.createCourse));
router.patch("/admin/courses/:id", asyncHandler(course.updateCourse));
router.delete("/admin/courses/:id", asyncHandler(course.deactivateCourse));

// Per-language course content
router.get("/admin/courses/:id/languages", asyncHandler(course.listCourseLanguages));
router.put("/admin/courses/:id/languages/:languageId", asyncHandler(course.upsertCourseLanguage));
router.delete("/admin/courses/:id/languages/:languageId", asyncHandler(course.removeCourseLanguage));

// Curriculum
router.post("/admin/courses/:id/modules", asyncHandler(course.createModule));
router.patch("/admin/modules/:id", asyncHandler(course.updateModule));
router.delete("/admin/modules/:id", asyncHandler(course.deleteModule));
router.post("/admin/modules/:id/lessons", asyncHandler(course.createLesson));
router.put("/admin/lessons/:id", asyncHandler(course.updateLesson));
router.delete("/admin/lessons/:id", asyncHandler(course.deleteLesson));
router.get("/admin/lessons/:id/preview", asyncHandler(course.previewLesson));

// Languages
router.get("/admin/languages", asyncHandler(course.listLanguages));
router.post("/admin/languages", asyncHandler(course.createLanguage));
router.patch("/admin/languages/:id", asyncHandler(course.updateLanguage));

// Demo videos
router.get("/admin/demo-videos", asyncHandler(course.listDemoVideos));
router.post("/admin/demo-videos", asyncHandler(course.upsertDemoVideo));
router.delete("/admin/demo-videos/:id", asyncHandler(course.deleteDemoVideo));

// Uploads (admin-only signed PUT URLs)
router.post("/upload/presign", asyncHandler(course.presignUpload));

// Reviews
router.get("/admin/reviews", asyncHandler(content.listReviews));
router.post("/admin/reviews", asyncHandler(content.createReview));
router.patch("/admin/reviews/:id", asyncHandler(content.updateReview));
router.delete("/admin/reviews/:id", asyncHandler(content.deleteReview));

// Employees
router.get("/admin/employees", asyncHandler(content.listEmployees));
router.post("/admin/employees", asyncHandler(content.createEmployee));
router.patch("/admin/employees/:id", asyncHandler(content.updateEmployee));
router.delete("/admin/employees/:id", asyncHandler(content.deleteEmployee));

// Job postings & applications
router.get("/admin/jobs", asyncHandler(content.listJobs));
router.post("/admin/jobs", asyncHandler(content.createJob));
router.patch("/admin/jobs/:id", asyncHandler(content.updateJob));
router.delete("/admin/jobs/:id", asyncHandler(content.deactivateJob));
router.get("/admin/jobs/:id/applications", asyncHandler(content.listJobApplications));
router.patch("/admin/applications/:id", asyncHandler(content.updateApplication));

// Certificates
router.get("/admin/certificates", asyncHandler(content.listCertificates));
router.post("/admin/certificates", asyncHandler(content.createCertificate));
router.delete("/admin/certificates/:id", asyncHandler(content.deleteCertificate));

export default router;
