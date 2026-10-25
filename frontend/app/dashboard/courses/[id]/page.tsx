import { notFound } from "next/navigation";
import { ApiError } from "@/lib/api";
import { serverApi } from "@/lib/session";
import { CoursePlayer } from "@/components/dashboard/course-player";
import { CourseVideoList } from "@/components/videos/course-video-list";
import { CourseCertificatePanel } from "@/components/certificates/course-certificate-panel";
import { EBookLibrary } from "@/components/learning/ebook-library";
import { LiveSchedule } from "@/components/learning/live-schedule";
import { CentreDetails } from "@/components/learning/centre-details";

interface CourseAccess {
  languageGranted: string | null;
  course: {
    id: string;
    title: string;
    type: "EBOOK" | "VIDEO" | "ZOOM" | "CENTRE";
    metadata: unknown;
  };
}

export default async function CourseContentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The backend returns 404 when the course isn't owned or access was revoked.
  const access = await serverApi<{ access: CourseAccess }>(`/me/courses/${id}`)
    .then((r) => r.access)
    .catch((err) => {
      if (err instanceof ApiError && err.status === 404) notFound();
      throw err;
    });

  const { course } = access;

  return (
    <div>
      <p className="eyebrow">{course.type.replace("_", " ")}</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-parchment">{course.title}</h1>

      <CourseCertificatePanel courseId={course.id} />

      {course.type === "EBOOK" && (
        <section className="mt-8">
          <h2 className="mb-3 font-display text-lg font-semibold text-parchment">Your E-Books</h2>
          <EBookLibrary courseId={course.id} />
          {/* Older per-language e-book uploads, if any. */}
          <CoursePlayer courseId={course.id} type="EBOOK" defaultLanguageCode={access.languageGranted} hideWhenEmpty />
        </section>
      )}

      {course.type === "VIDEO" && (
        <CoursePlayer courseId={course.id} type={course.type} defaultLanguageCode={access.languageGranted} />
      )}

      {course.type === "ZOOM" && (
        <section className="mt-8">
          <h2 className="mb-3 font-display text-lg font-semibold text-parchment">Live Session Schedule</h2>
          <LiveSchedule courseId={course.id} />
        </section>
      )}

      {course.type === "CENTRE" && (
        <CentreDetails metadata={course.metadata} />
      )}

      {/* Original course videos uploaded by the academy (any course type can have them). */}
      <CourseVideoList courseId={course.id} />
    </div>
  );
}
