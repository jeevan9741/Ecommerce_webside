import Script from "next/script";
import { serverApi } from "@/lib/session";
import { CourseCard, type CoursePublic } from "@/components/course-card";
import { BuyCourseButton } from "@/components/buy-course-button";

export const metadata = { title: "Courses" };
export const dynamic = "force-dynamic";

export default async function CoursesPage() {
  // The token (when signed in) lets the backend also report which courses are already owned.
  const data = await serverApi<{ courses: CoursePublic[]; ownedCourseIds: string[] }>("/courses");
  const courses = data.courses;
  const ownedCourseIds = new Set(data.ownedCourseIds);

  return (
    <div className="container-academy pb-16 pt-10 sm:pb-24 sm:pt-12 xl:max-w-[1480px]">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      <h1 className="sr-only">Courses</h1>

      {/* Mobile-first: 1 column, 2 from 768px, 4 in a single row from 1366px. pt-4 leaves room
          for the featured card's badge, which overhangs the card's top edge. */}
      <div className="grid grid-cols-1 gap-8 pt-4 md:grid-cols-2 md:gap-7 desk:grid-cols-4 desk:gap-6 2xl:gap-7">
        {courses.map((course) => {
          const alreadyPurchased = ownedCourseIds.has(course.id);
          return (
            <CourseCard
              key={course.id}
              course={course as CoursePublic}
              alreadyPurchased={alreadyPurchased}
              footer={<BuyCourseButton course={course as CoursePublic} alreadyPurchased={alreadyPurchased} />}
            />
          );
        })}
      </div>

      <div className="mx-auto mt-16 max-w-3xl rounded-2xl border border-border-soft bg-ink-elevated/50 p-6 text-center text-sm text-parchment-muted">
        Have a partner&apos;s referral link? Your discount / their commission is applied
        automatically at checkout — no code needed.
      </div>
    </div>
  );
}
