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

**`backend/.env`** — all secrets live here only.

```
PORT=5000
CORS_ORIGINS=http://localhost:3000          # comma-separated list of allowed frontend origins
JWT_SECRET=<long random string>
JWT_EXPIRES_IN=7d
DATABASE_URL=<postgres connection string>
APP_ENCRYPTION_KEY=<64 hex chars — encrypts payout details>
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=                    # from Razorpay Dashboard → Settings → Webhooks
EMAIL_PROVIDER=resend
RESEND_API_KEY=
EMAIL_FROM="E-Commerce Training Academy <no-reply@your-verified-domain>"
BLOB_READ_WRITE_TOKEN=
```

**`frontend/.env`** — public configuration only (never put secrets here).

```
NEXT_PUBLIC_API_URL=http://localhost:5000
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

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
