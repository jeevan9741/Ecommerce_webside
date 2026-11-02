import { Router } from "express";
import { asyncHandler } from "../utils/http.js";
import { requireAdmin } from "../middleware/auth.middleware.js";
import * as course from "../controllers/admin-course.controller.js";
import * as ops from "../controllers/admin-ops.controller.js";
import * as content from "../controllers/admin-content.controller.js";
import * as partnerCard from "../controllers/partner-card.controller.js";
import * as video from "../controllers/video.controller.js";
import * as category from "../controllers/category.controller.js";
import * as ebook from "../controllers/ebook.controller.js";
import * as legalDocument from "../controllers/legal-document.controller.js";
import * as liveSession from "../controllers/live-session.controller.js";
import * as policy from "../controllers/policy.controller.js";
import * as franchise from "../controllers/franchise.controller.js";
import * as franchiseReview from "../controllers/franchise-review.controller.js";
import * as franchisePartner from "../controllers/franchise-partner.controller.js";

const router = Router();

// Every route below requires an ADMIN session.
router.use("/admin", requireAdmin);
router.use("/upload", requireAdmin);

// Analytics
router.get("/admin/analytics/sales", asyncHandler(ops.salesAnalytics));
router.get("/admin/analytics/payouts", asyncHandler(ops.payoutAnalytics));

// Franchise policies (two-admin governance). Static paths come before /:id.
router.get("/admin/franchise/policies/schema", policy.policySchema);
router.get("/admin/franchise/policies/readiness", asyncHandler(policy.policyReadiness));
router.get("/admin/franchise/policies/resolve", asyncHandler(policy.resolvePolicyAt));
router.get("/admin/franchise/policies", asyncHandler(policy.listPolicyVersions));
router.post("/admin/franchise/policies", asyncHandler(policy.createPolicyDraft));
router.get("/admin/franchise/policies/:id", asyncHandler(policy.getPolicyVersion));
router.get("/admin/franchise/policies/:id/diff", asyncHandler(policy.getPolicyDiff));
router.put("/admin/franchise/policies/:id", asyncHandler(policy.updatePolicyDraft));
router.delete("/admin/franchise/policies/:id", asyncHandler(policy.discardPolicyDraft));
router.post("/admin/franchise/policies/:id/submit", asyncHandler(policy.submitPolicy));
router.get("/admin/franchise/approvals", asyncHandler(policy.listPolicyApprovals));
router.post("/admin/franchise/approvals/:id/approve", asyncHandler(policy.approvePolicy));
router.post("/admin/franchise/approvals/:id/reject", asyncHandler(policy.rejectPolicy));
router.post("/admin/franchise/approvals/:id/cancel", asyncHandler(policy.cancelPolicySubmission));

// Franchise states and districts. New ones start disabled; nothing is ever deleted (imports included).
router.get("/admin/franchise/locations", asyncHandler(franchise.listAdminLocations));
router.post("/admin/franchise/locations/states", asyncHandler(franchise.addState));
router.patch("/admin/franchise/locations/states/:id", asyncHandler(franchise.editState));
router.post("/admin/franchise/locations/states/:id/activate", asyncHandler(franchise.enableState));
router.post("/admin/franchise/locations/districts", asyncHandler(franchise.addDistrict));
router.patch("/admin/franchise/locations/districts/:id", asyncHandler(franchise.editDistrict));
router.post("/admin/franchise/locations/import/preview", asyncHandler(franchise.previewLocationImport));
router.post("/admin/franchise/locations/import/apply", asyncHandler(franchise.applyLocationImport));

// Franchise application review (Phase 5A). Static paths before /:id.
router.get("/admin/franchise/applications/summary", asyncHandler(franchiseReview.franchiseApplicationSummary));
router.get("/admin/franchise/applications", asyncHandler(franchiseReview.listFranchiseApplications));
router.get("/admin/franchise/applications/:id", asyncHandler(franchiseReview.getFranchiseApplication));
router.post("/admin/franchise/applications/:id/transition", asyncHandler(franchiseReview.transitionFranchiseApplication));
router.post("/admin/franchise/applications/:id/notes", asyncHandler(franchiseReview.addFranchiseApplicationNote));

// Franchise partners (Phase 5F-1): suspension is immediate (one admin); reinstating and deactivating
// need a second admin to approve the exact request.
router.get("/admin/franchise/partners", asyncHandler(franchisePartner.adminListPartners));
router.get("/admin/franchise/partners/:id", asyncHandler(franchisePartner.adminPartnerDetail));
router.post("/admin/franchise/partners/:id/suspend", asyncHandler(franchisePartner.adminSuspendPartner));
router.post("/admin/franchise/partners/:id/requests", asyncHandler(franchisePartner.adminRequestPartnerAction));
router.post("/admin/franchise/partner-requests/:id/approve", asyncHandler(franchisePartner.adminApprovePartnerAction));
router.post("/admin/franchise/partner-requests/:id/reject", asyncHandler(franchisePartner.adminRejectPartnerAction));
router.post("/admin/franchise/partner-requests/:id/cancel", asyncHandler(franchisePartner.adminCancelPartnerAction));

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

// Partner ID cards
router.get("/admin/partner-cards", asyncHandler(partnerCard.adminListPartnerCards));
router.post("/admin/partner-cards", asyncHandler(partnerCard.adminIssuePartnerCard));
router.get("/admin/partner-cards/:id", asyncHandler(partnerCard.adminGetPartnerCard));
router.patch("/admin/partner-cards/:id", asyncHandler(partnerCard.adminUpdatePartnerCard));
router.post("/admin/partner-cards/:id/review", asyncHandler(partnerCard.adminReviewPartnerCard));
router.post("/admin/partner-cards/:id/status", asyncHandler(partnerCard.adminSetPartnerCardStatus));
router.post("/admin/partner-cards/:id/reissue", asyncHandler(partnerCard.adminReissuePartnerCard));
router.post("/admin/partner-cards/:id/waive-fee", asyncHandler(partnerCard.adminWaivePartnerCardFee));
router.get("/admin/partner-card-settings", asyncHandler(partnerCard.adminGetPartnerCardSettings));
router.put("/admin/partner-card-settings", asyncHandler(partnerCard.adminSavePartnerCardSettings));

// Settings
router.get("/admin/settings", asyncHandler(ops.listSettings));
router.put("/admin/settings", asyncHandler(ops.saveSetting));

// Courses
router.get("/admin/courses", asyncHandler(course.listCourses));
router.post("/admin/courses", asyncHandler(course.createCourse));
router.patch("/admin/courses/:id", asyncHandler(course.updateCourse));
router.get("/admin/courses/:id/enrolment-summary", asyncHandler(course.courseEnrolmentSummary));
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
router.get("/admin/demo-videos", asyncHandler(video.adminListDemoVideos));
router.post("/admin/demo-videos", asyncHandler(video.adminCreateDemoVideo));
router.patch("/admin/demo-videos/:id", asyncHandler(video.adminUpdateDemoVideo));
router.delete("/admin/demo-videos/:id", asyncHandler(video.adminDeleteDemoVideo));

// Course video library (files go browser → private Blob store via scoped client tokens)
router.post("/admin/videos/upload-token", asyncHandler(video.createVideoUploadToken));
router.post("/admin/videos/discard-upload", asyncHandler(video.adminDiscardUpload));
router.get("/admin/videos", asyncHandler(video.adminListVideos));
router.post("/admin/videos", asyncHandler(video.adminCreateVideo));
router.patch("/admin/videos/:id", asyncHandler(video.adminUpdateVideo));
router.delete("/admin/videos/:id", asyncHandler(video.adminDeleteVideo));
router.get("/admin/videos/:id/preview", asyncHandler(video.adminPreviewVideo));

// Course category library (topics like Meesho / Flipkart, and which packages unlock them)
router.get("/admin/categories", asyncHandler(category.adminListCategories));
router.post("/admin/categories", asyncHandler(category.adminCreateCategory));
router.patch("/admin/categories/:id", asyncHandler(category.adminUpdateCategory));
router.post("/admin/categories/:id/move", asyncHandler(category.adminMoveCategory));
router.put("/admin/categories/:id/packages", asyncHandler(category.adminSetCategoryPackages));
router.delete("/admin/categories/:id", asyncHandler(category.adminDeleteCategory));

// E-books (files go browser → private Blob store via scoped client tokens, then are verified here)
router.post("/admin/ebooks/upload-token", asyncHandler(ebook.createEBookUploadToken));
router.post("/admin/ebooks/discard-upload", asyncHandler(ebook.adminDiscardEBookUpload));
router.get("/admin/ebooks", asyncHandler(ebook.adminListEBooks));
router.post("/admin/ebooks", asyncHandler(ebook.adminCreateEBook));
router.patch("/admin/ebooks/:id", asyncHandler(ebook.adminUpdateEBook));
router.delete("/admin/ebooks/:id", asyncHandler(ebook.adminDeleteEBook));

router.post("/admin/legal-documents/upload-token", asyncHandler(legalDocument.createLegalDocumentUploadToken));
router.post("/admin/legal-documents/discard-upload", asyncHandler(legalDocument.adminDiscardLegalDocumentUpload));
router.get("/admin/legal-documents", asyncHandler(legalDocument.adminListLegalDocuments));
router.post("/admin/legal-documents", asyncHandler(legalDocument.adminCreateLegalDocument));
router.patch("/admin/legal-documents/:id", asyncHandler(legalDocument.adminUpdateLegalDocument));
router.delete("/admin/legal-documents/:id", asyncHandler(legalDocument.adminDeleteLegalDocument));
router.get("/admin/legal-documents/:id/preview", asyncHandler(legalDocument.adminPreviewLegalDocument));

// Live Zoom sessions
router.get("/admin/live-sessions", asyncHandler(liveSession.adminListLiveSessions));
router.post("/admin/live-sessions", asyncHandler(liveSession.adminCreateLiveSession));
router.patch("/admin/live-sessions/:id", asyncHandler(liveSession.adminUpdateLiveSession));
router.post("/admin/live-sessions/:id/cancel", asyncHandler(liveSession.adminCancelLiveSession));
router.post("/admin/live-sessions/:id/restore", asyncHandler(liveSession.adminRestoreLiveSession));
router.delete("/admin/live-sessions/:id", asyncHandler(liveSession.adminDeleteLiveSession));

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
