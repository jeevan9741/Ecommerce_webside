# E-Commerce Training Academy

Two independently runnable apps:

| Folder      | Stack                                   | Port | Responsibility                                                    |
| ----------- | --------------------------------------- | ---- | ----------------------------------------------------------------- |
| `frontend/` | Next.js 16 (App Router), Tailwind       | 3000 | UI, routing, forms — talks to the backend only over REST          |
| `backend/`  | Express 5, TypeScript, Prisma, JWT auth | 5000 | Auth, OTP email, Razorpay, referrals, courses, admin, database    |

## Running locally

Start the backend first, then the frontend, each in its own terminal.

```bash
# Terminal 1 — backend (http://localhost:5000)
cd backend
npm install          # also runs `prisma generate`
npm run dev

# Terminal 2 — frontend (http://localhost:3000)
cd frontend
npm install
npm run dev
```

Health check: `curl http://localhost:5000/api/health`

## Environment

Full annotated lists: `backend/.env.example` and `frontend/.env.example`. Local development uses
`backend/.env` (all secrets) and `frontend/.env` (public values only).

## Production deployment

These are the **only** canonical production services:

| Piece    | Host                                                        | URL                                                                     |
| -------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| Frontend | Vercel team `ec-ommerce-training-academy`, project `ecommerce-webside` (Git-connected, deploys `master`) | https://www.ecommercetrainingacademyeta.com (apex redirects to `www`)   |
| Backend  | Render service `ecommerce-webside` (auto-deploys `master`)  | https://ecommerce-webside.onrender.com — `/api/health` shows the commit |

Duplicates to retire (not used by the live site): Render service `ecommerce-training-academy-backend`
and Vercel project `jeevan-f45f/ecommerce-training-academy`. Never point `NEXT_PUBLIC_API_URL`, the
Razorpay webhook or any docs at them. Per-deployment `*.vercel.app` URLs are frozen snapshots with the
env values of their build — always test on the custom domain.

### Vercel (frontend) — Settings → Environment Variables, scope **Production**

| Variable                    | Required | Value                                         |
| --------------------------- | -------- | --------------------------------------------- |
| `NEXT_PUBLIC_API_URL`       | yes      | `https://ecommerce-webside.onrender.com`      |
| `NEXT_PUBLIC_SITE_URL`      | yes      | `https://www.ecommercetrainingacademyeta.com` |
| `NEXT_PUBLIC_VERIFY_ORIGIN` | no       | origin printed in partner-card QR codes       |

`NEXT_PUBLIC_*` values are baked in at build time: after changing one, redeploy **without** the build
cache. The build fails if `NEXT_PUBLIC_API_URL` is missing — there is no hardcoded backend fallback.

### Render (backend) — Environment tab

| Variable                        | Required | Notes                                                                                   |
| ------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| `NODE_ENV`                      | yes      | `production`                                                                            |
| `DATABASE_URL`                  | yes      | Neon production connection string                                                       |
| `JWT_SECRET`                    | yes      | `openssl rand -hex 32`                                                                  |
| `EMAIL_VERIFICATION_SECRET`     | yes      | `openssl rand -hex 32`                                                                  |
| `APP_ENCRYPTION_KEY`            | yes      | exactly 64 hex chars — `openssl rand -hex 32`                                           |
| `CORS_ORIGINS`                  | yes      | `https://ecommercetrainingacademyeta.com,https://www.ecommercetrainingacademyeta.com`   |
| `EMAIL_PROVIDER`                | yes      | `resend`                                                                                |
| `RESEND_API_KEY`                | yes      | `re_...` (Resend → API Keys)                                                            |
| `EMAIL_FROM`                    | yes      | `E-Commerce Training Academy <no-reply@ecommercetrainingacademyeta.com>` — verified domain |
| `RAZORPAY_KEY_ID`               | yes      | `rzp_live_...` — the server refuses to start with a TEST key in production              |
| `RAZORPAY_KEY_SECRET`           | yes      | live key secret                                                                         |
| `RAZORPAY_WEBHOOK_SECRET`       | yes      | from the webhook below                                                                  |
| `BLOB_READ_WRITE_TOKEN`         | yes      | Vercel Blob (private store) for course content and certificates                         |
| `BLOB_PUBLIC_READ_WRITE_TOKEN`  | no       | public Blob store for demo videos                                                       |
| `JWT_EXPIRES_IN`                | no       | default `7d`                                                                            |
| `SITE_URL`                      | no       | links in receipt emails; defaults to `https://www.ecommercetrainingacademyeta.com`      |
| `PRODUCTION_DATABASE_ENDPOINTS` | no       | Neon endpoint id(s) of the prod DB, if it moves                                         |
| `RAZORPAYX_ENABLED`, `RAZORPAYX_ACCOUNT_NUMBER` | no | automated payouts, leave off until KYC is done                            |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | no | only with `EMAIL_PROVIDER=smtp`                                     |

At boot the backend logs `CORS origins:`, `[EMAIL]`, `[PAYMENT]` and a `[CONFIG]` line for every
missing or suspicious production setting — check the Render logs after each deploy.

### External services

- **Resend:** verify `ecommercetrainingacademyeta.com` under Domains (SPF/DKIM DNS records) before using it in `EMAIL_FROM`.
- **Razorpay:** live mode; webhook URL `https://ecommerce-webside.onrender.com/api/webhooks/razorpay`, events
  `payment.captured`, `payment.authorized`, `payment.failed`, `refund.processed`; copy its secret into
  `RAZORPAY_WEBHOOK_SECRET`. Enable the methods you want offered (UPI, cards, netbanking, wallets, EMI,
  Pay Later) under Payment Methods — the checkout lists only what the account has enabled.
- **Database:** schema changes are not applied by the deploy — run `npm run db:migrate` against production.

## Database

The Prisma schema and migrations live in `backend/prisma/`.

```bash
cd backend
npm run db:migrate   # prisma migrate deploy
npm run db:seed
```

## Auth model

- `POST /api/auth/login` returns a JWT. The frontend stores it in the `eca_token` cookie and sends it as
  `Authorization: Bearer <token>`; Server Components forward it from the cookie.
- Email verification: `POST /api/email/verify-otp` returns a short-lived `verificationToken`, which
  `POST /api/register` requires. No account can be created without a verified email.

## Payments

Razorpay calls `POST /api/webhooks/razorpay` on the **backend**. That route receives the raw request body so
the HMAC signature is verified against the exact bytes Razorpay signed.
