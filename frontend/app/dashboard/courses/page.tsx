import Link from "next/link";
import { BookOpen, ArrowRight } from "lucide-react";
import { serverApi } from "@/lib/session";
import { PackageCard, sortByPackage, type EnrolledAccess } from "@/components/dashboard/enrolled-packages";

export default async function MyCoursesPage() {
  const { access } = await serverApi<{ access: EnrolledAccess[] }>("/me/courses");

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
        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {sortByPackage(access).map((a) => (
            <PackageCard key={a.id} access={a} />
          ))}
        </div>
      )}
    </div>
  );
}
