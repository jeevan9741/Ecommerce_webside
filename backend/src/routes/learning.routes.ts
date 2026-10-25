import { Router } from "express";
import { asyncHandler } from "../utils/http.js";
import { requireCourseAccess, requireUser } from "../middleware/auth.middleware.js";
import { downloadEBook, listMyEBooks } from "../controllers/ebook.controller.js";
import { joinLiveSession, listMyLiveSessions } from "../controllers/live-session.controller.js";
import { downloadLegalDocument, listPublishedLegalDocuments } from "../controllers/legal-document.controller.js";

// Student side of e-books and live Zoom classes. Every handler checks the package was paid for
// (see package-access.service) — hiding buttons in the UI is never the only guard.
const router = Router();

router.get("/me/ebooks", requireUser, asyncHandler(listMyEBooks));
router.post("/me/ebooks/:id/download", requireUser, asyncHandler(downloadEBook));

// Company legal documents: published ones only, for the same customers who can open the dashboard.
router.get("/me/legal-documents", requireCourseAccess, asyncHandler(listPublishedLegalDocuments));
router.post("/me/legal-documents/:id/download", requireCourseAccess, asyncHandler(downloadLegalDocument));

router.get("/me/live-sessions", requireUser, asyncHandler(listMyLiveSessions));
router.post("/me/live-sessions/:id/join", requireUser, asyncHandler(joinLiveSession));

export default router;
