import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { asyncHandler, HttpError } from "../utils/http.js";
import { requireUser } from "../middleware/auth.middleware.js";
import { franchisePublicEnabled } from "../utils/feature-flags.js";
import { MAX_DOCUMENT_BYTES, UPLOAD_FIELDS } from "../services/franchise-application.service.js";
import * as franchise from "../controllers/franchise.controller.js";

const router = Router();

// Dark launch: until FRANCHISE_PUBLIC_ENABLED=true the public and applicant franchise API doesn't exist —
// the same 404 as any unknown route. It runs before authentication and before any upload is read.
// Admin franchise routes (/api/admin/franchise/*) live on the admin router and are not affected.
router.use("/franchise", (_req: Request, res: Response, next: NextFunction) => {
  if (franchisePublicEnabled()) return next();
  res.status(404).json({ error: "Not found" });
});

// Documents are held in memory only until they're checked and stored in the private Blob store.
// The service enforces the 5 MB / PDF-JPEG-PNG rules from the file bytes; these limits are a hard ceiling.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: Object.keys(UPLOAD_FIELDS).length, fields: 30, fieldSize: 64 * 1024 },
}).fields(Object.keys(UPLOAD_FIELDS).map((name) => ({ name, maxCount: 1 })));

function documents(req: Request, res: Response, next: NextFunction) {
  upload(req, res, (err?: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") return next(new HttpError(413, "Each document must be 5 MB or smaller.", { code: "FILE_TOO_LARGE", field: err.field }));
      return next(new HttpError(400, "Upload one PDF, JPEG or PNG file per document.", { code: "INVALID_UPLOAD", field: err.field }));
    }
    next(err);
  });
}

router.get("/franchise/info", asyncHandler(franchise.franchiseInfo));
router.get("/franchise/locations", asyncHandler(franchise.franchiseLocations));
// requireUser runs before multer so anonymous uploads are refused without buffering them.
router.post("/franchise/applications", requireUser, documents, asyncHandler(franchise.submitFranchiseApplication));
router.get("/franchise/applications/me", requireUser, asyncHandler(franchise.myFranchiseApplication));
router.get("/franchise/applications/me/documents/:id/url", requireUser, asyncHandler(franchise.myFranchiseDocumentUrl));

export default router;
