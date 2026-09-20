import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, UnauthorizedError } from "@/lib/rbac";
import { createOrderSchema } from "@/lib/validation";
import { getRazorpayClient, RazorpayConfigError } from "@/lib/razorpay";

const LOG_PREFIX = "[create-order]";

export async function POST(req: NextRequest) {
  const reqId = Math.random().toString(36).slice(2, 8);
  const log = (msg: string, extra?: unknown) =>
    console.log(`${LOG_PREFIX}[${reqId}] ${msg}`, extra !== undefined ? extra : "");

  try {
    log("start");

    const user = await requireUser().catch((err) => {
      log("auth check failed", err instanceof Error ? err.message : err);
      throw err;
    });
    log("authenticated", { userId: user.id });

    const body = await req.json().catch((err) => {
      log("request body was not valid JSON", err instanceof Error ? err.message : err);
      return null;
    });
    const parsed = createOrderSchema.safeParse(body);
    if (!parsed.success) {
      log("validation error", parsed.error.flatten());
      return NextResponse.json(
        { error: "Invalid request — please refresh the page and try again.", code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }
    const { courseId, selectedLanguage, referralCode } = parsed.data;
    log("validated body", { courseId, selectedLanguage, hasReferralCode: Boolean(referralCode) });

    const course = await prisma.course
      .findUnique({
        where: { id: courseId },
        include: { languageVideos: { include: { language: true } } },
      })
      .catch((err) => {
        log("database error looking up course", err instanceof Error ? err.message : err);
        throw new DatabaseError("Failed to look up the selected course");
      });

    if (!course || !course.isActive) {
      log("course not found or inactive", { courseId, found: Boolean(course) });
      return NextResponse.json(
        { error: "Invalid course selected — please pick a course again.", code: "INVALID_COURSE" },
        { status: 404 }
      );
    }
    log("course found", { courseId: course.id, title: course.title, priceInPaise: course.priceInPaise });

    if (course.languageVideos.length > 0) {
      const validCodes = course.languageVideos.map((lv) => lv.language.code);
      if (!selectedLanguage || !validCodes.includes(selectedLanguage)) {
        log("invalid or missing language", { selectedLanguage, validCodes });
        return NextResponse.json(
          { error: "Please select a valid language for this course.", code: "INVALID_LANGUAGE" },
          { status: 400 }
        );
      }
    }

    const existingAccess = await prisma.courseAccess.findUnique({
      where: { userId_courseId: { userId: user.id, courseId } },
    });
    if (existingAccess && !existingAccess.revokedAt) {
      log("user already has access", { userId: user.id, courseId });
      return NextResponse.json(
        { error: "You already have access to this course.", code: "ALREADY_PURCHASED" },
        { status: 409 }
      );
    }

    let referrerUserId: string | null = null;
    if (referralCode) {
      const referrer = await prisma.user.findUnique({ where: { referralCode: referralCode.toUpperCase() } });
      if (referrer && referrer.id !== user.id) {
        referrerUserId = referrer.id;
        log("referral applied", { referrerUserId });
      }
    }

    log("creating Razorpay order", { amountInPaise: course.priceInPaise });
    const razorpay = getRazorpayClient();
    const receipt = `ord_${Date.now()}`;
    let rpOrder;
    try {
      rpOrder = await razorpay.orders.create({
        amount: course.priceInPaise,
        currency: "INR",
        receipt,
        notes: { courseId, userId: user.id },
      });
      log("Razorpay order created", { razorpayOrderId: rpOrder.id });
    } catch (err) {
      log("Razorpay order creation failed", JSON.stringify(err));
      throw new PaymentServiceError(describeRazorpayError(err));
    }

    const order = await prisma.order
      .create({
        data: {
          userId: user.id,
          courseId,
          amountInPaise: course.priceInPaise,
          razorpayOrderId: rpOrder.id,
          selectedLanguage: selectedLanguage ?? null,
          referralCodeUsed: referrerUserId ? referralCode!.toUpperCase() : null,
          referrerUserId,
        },
      })
      .catch((err) => {
        log("database error saving order", err instanceof Error ? err.message : err);
        throw new DatabaseError("Order could not be saved after payment was created");
      });
    log("order saved", { orderId: order.id });

    return NextResponse.json({
      orderId: order.id,
      razorpayOrderId: rpOrder.id,
      amountInPaise: course.priceInPaise,
      currency: "INR",
      keyId: process.env.RAZORPAY_KEY_ID,
      courseName: course.title,
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Please log in to purchase this course.", code: "LOGIN_REQUIRED" }, { status: err.status });
    }
    if (err instanceof RazorpayConfigError) {
      console.error(`${LOG_PREFIX} configuration error:`, err.message);
      return NextResponse.json(
        { error: "Payment service is temporarily unavailable. Please try again shortly.", code: "PAYMENT_SERVICE_UNAVAILABLE" },
        { status: 503 }
      );
    }
    if (err instanceof PaymentServiceError) {
      console.error(`${LOG_PREFIX} Razorpay error:`, err.message);
      return NextResponse.json(
        { error: "Payment service is temporarily unavailable. Please try again shortly.", code: "PAYMENT_SERVICE_UNAVAILABLE" },
        { status: 502 }
      );
    }
    if (err instanceof DatabaseError) {
      console.error(`${LOG_PREFIX} database error:`, err.message);
      return NextResponse.json({ error: "Database error — please try again.", code: "DATABASE_ERROR" }, { status: 500 });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError || err instanceof Prisma.PrismaClientInitializationError) {
      console.error(`${LOG_PREFIX} unhandled Prisma error:`, err.message);
      return NextResponse.json({ error: "Database error — please try again.", code: "DATABASE_ERROR" }, { status: 500 });
    }
    console.error(`${LOG_PREFIX} unexpected error:`, err);
    return NextResponse.json({ error: "Order creation failed — please try again.", code: "ORDER_CREATION_FAILED" }, { status: 500 });
  }
}

class PaymentServiceError extends Error {}
class DatabaseError extends Error {}

function describeRazorpayError(err: unknown): string {
  if (err && typeof err === "object" && "error" in err) {
    const rzpErr = (err as { error?: { code?: string; description?: string } }).error;
    if (rzpErr?.description) return `Razorpay: ${rzpErr.code ?? "ERROR"} — ${rzpErr.description}`;
  }
  if (err instanceof Error) return err.message;
  return "Unknown Razorpay error";
}
