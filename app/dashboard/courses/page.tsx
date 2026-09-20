import Link from "next/link";
import { BookOpen, ArrowRight } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { COURSE_TYPE_LABEL } from "@/lib/format";

export default async function MyCoursesPage() {
  const session = await auth();
  const userId = session!.user.id;

  const access = await prisma.courseAccess.findMany({
    where: { userId, revokedAt: null },
    include: { course: true },
    orderBy: { unlockedAt: "desc" },
  });

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-parchment">My Courses</h1>
      <p className="mt-1 text-sm text-parchment-muted">Every course you currently have access to.</p>

      {access.length === 0 ? (
        <div className="card mt-8 flex flex-col items-center gap-4 p-12 text-center">
          <BookOpen className="h-10 w-10 text-gold-500" />
          <p className="text-sm text-parchment-muted">You haven&apos;t unlocked any courses yet.</p>
          <Link href="/courses" className="btn-gold">
            Browse Courses <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {access.map((a) => (
            <Link key={a.id} href={`/dashboard/courses/${a.course.id}`} className="card card-hover p-6">
              <span className="eyebrow">{COURSE_TYPE_LABEL[a.course.type]}</span>
              <h3 className="mt-3 font-display text-lg font-semibold text-parchment">{a.course.title}</h3>
              {a.languageGranted && (
                <p className="mt-2 text-xs text-parchment-muted">Language: {a.languageGranted}</p>
              )}
              <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-gold-500">
                Open Course <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
