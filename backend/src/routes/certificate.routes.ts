import { Router } from "express";
import { asyncHandler } from "../utils/http.js";
import { requireAdmin, requireUser } from "../middleware/auth.middleware.js";
import * as certificate from "../controllers/certificate.controller.js";

// Course completion certificates. Students reach theirs with any signed-in session (so a
// certificate stays downloadable even after course access ends); verification is public.
const router = Router();

router.get("/me/certificates", requireUser, asyncHandler(certificate.myCertificates));
router.get("/me/certificates/:certificateNo", requireUser, asyncHandler(certificate.getCertificate));
router.get("/me/courses/:courseId/certificate", requireUser, asyncHandler(certificate.myCourseCertificate));
router.post("/me/courses/:courseId/certificate", requireUser, asyncHandler(certificate.claimCertificate));

router.get("/public/certificates/:certificateNo", asyncHandler(certificate.verifyCertificate));

router.get("/admin/course-certificates", requireAdmin, asyncHandler(certificate.adminListCertificates));
router.post("/admin/course-certificates", requireAdmin, asyncHandler(certificate.adminIssueCertificate));
router.get("/admin/course-certificates/:certificateNo", requireAdmin, asyncHandler(certificate.adminGetCertificate));
router.post("/admin/course-certificates/:id/revoke", requireAdmin, asyncHandler(certificate.adminRevokeCertificate));
router.post("/admin/course-certificates/:id/restore", requireAdmin, asyncHandler(certificate.adminRestoreCertificate));
router.get("/admin/certificate-settings", requireAdmin, asyncHandler(certificate.adminGetCertificateSettings));
router.put("/admin/certificate-settings", requireAdmin, asyncHandler(certificate.adminSaveCertificateSettings));

export default router;
