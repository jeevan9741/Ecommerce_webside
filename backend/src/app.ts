import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { asyncHandler } from "./utils/http.js";
import { razorpayWebhook } from "./controllers/payment.controller.js";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware.js";
import authRoutes from "./routes/auth.routes.js";
import emailRoutes from "./routes/email.routes.js";
import userRoutes from "./routes/user.routes.js";
import courseRoutes from "./routes/course.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import referralRoutes from "./routes/referral.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import partnerCardRoutes from "./routes/partner-card.routes.js";

export function createApp() {
  const app = express();

  // Behind a proxy (Vercel/Render/Nginx) req.ip must come from X-Forwarded-For for rate limiting.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // Razorpay calls this server-to-server, so it's mounted before CORS and — critically —
  // before express.json(): HMAC verification needs the exact raw bytes that were signed.
  app.post("/api/webhooks/razorpay", express.raw({ type: "*/*", limit: "1mb" }), asyncHandler(razorpayWebhook));

  const reportedOrigins = new Set<string>();
  app.use(
    cors({
      origin(origin, callback) {
        // Allow server-to-server requests (no Origin header) and listed frontends. For anything
        // else, omit the CORS headers so the browser blocks it — throwing here would surface as
        // a 500 and log an error for every request from an unlisted origin.
        const allowed = !origin || env.corsOrigins.includes(origin);
        // Once per origin: a blocked frontend otherwise only shows up as a vague CORS error in the browser.
        if (!allowed && origin && !reportedOrigins.has(origin)) {
          reportedOrigins.add(origin);
          console.warn(`[CORS] Blocked origin ${origin} — add it to CORS_ORIGINS if it's a real frontend.`);
        }
        callback(null, allowed);
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.get("/api/health", (_req, res) => {
    // Render sets RENDER_GIT_COMMIT on every deploy — lets anyone confirm which build is live.
    res.json({ ok: true, service: "ecommerce-academy-backend", commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null });
  });

  for (const router of [authRoutes, emailRoutes, userRoutes, courseRoutes, paymentRoutes, referralRoutes, partnerCardRoutes, adminRoutes]) {
    app.use("/api", router);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
