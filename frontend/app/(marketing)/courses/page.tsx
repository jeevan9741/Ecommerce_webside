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
    <div className="container-academy py-16 sm:py-24">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />

      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">Our Courses</p>
        <h1 className="mt-3 font-display text-4xl font-bold text-parchment sm:text-5xl">
          Pick the format that fits how you learn
        </h1>
        <p className="mt-5 text-base text-parchment-muted">
          Every course unlocks automatically the moment your payment is confirmed — no waiting
          on manual approval.
        </p>
      </div>

      {/* pt-5 leaves room for the featured card's badge, which overhangs the card's top edge */}
      <div className="mt-14 grid gap-6 pt-5 sm:grid-cols-2 sm:gap-7 xl:grid-cols-4">
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
