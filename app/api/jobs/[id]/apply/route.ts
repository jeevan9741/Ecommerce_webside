import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jobApplicationSchema } from "@/lib/validation";
import { uploadBuffer, buildStorageKey } from "@/lib/storage";
import { rateLimit } from "@/lib/rate-limit";

const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  if (!rateLimit(`job-apply:${ip}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many applications submitted. Please try again later." }, { status: 429 });
  }

  const job = await prisma.jobPosting.findUnique({ where: { id: jobId } });
  if (!job || !job.isActive) {
    return NextResponse.json({ error: "This position is no longer accepting applications" }, { status: 404 });
  }

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });

  const parsed = jobApplicationSchema.safeParse({
    jobId,
    applicantName: formData.get("applicantName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    coverNote: formData.get("coverNote") || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  let resumeStorageKey: string | undefined;
  const resume = formData.get("resume");
  if (resume instanceof File && resume.size > 0) {
    if (resume.size > MAX_RESUME_BYTES) {
      return NextResponse.json({ error: "Resume must be under 5MB" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(resume.type)) {
      return NextResponse.json({ error: "Resume must be a PDF or Word document" }, { status: 400 });
    }
    const buffer = Buffer.from(await resume.arrayBuffer());
    resumeStorageKey = buildStorageKey("resumes", resume.name);
    await uploadBuffer(resumeStorageKey, buffer, resume.type);
  }

  const application = await prisma.jobApplication.create({
    data: {
      jobId,
      applicantName: parsed.data.applicantName,
      email: parsed.data.email,
      phone: parsed.data.phone,
      coverNote: parsed.data.coverNote,
      resumeStorageKey,
    },
  });

  return NextResponse.json({ ok: true, applicationId: application.id });
}
