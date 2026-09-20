import { notFound } from "next/navigation";
import { Calendar, MapPin, Utensils, Users } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CoursePlayer } from "@/components/dashboard/course-player";

interface ZoomMeta {
  meetingLink?: string;
  schedule?: string;
  notes?: string;
}
interface CentreMeta {
  address?: string;
  dates?: string;
  notes?: string;
}

export default async function CourseContentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user.id;

  const access = await prisma.courseAccess.findUnique({
    where: { userId_courseId: { userId, courseId: id } },
    include: { course: true },
  });

  if (!access || access.revokedAt) notFound();

  const { course } = access;

  return (
    <div>
      <p className="eyebrow">{course.type.replace("_", " ")}</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-parchment">{course.title}</h1>

      {(course.type === "EBOOK" || course.type === "VIDEO") && (
        <CoursePlayer courseId={course.id} type={course.type} defaultLanguageCode={access.languageGranted} />
      )}

      {course.type === "ZOOM" && (
        <ZoomDetails meta={(course.metadata as ZoomMeta) ?? {}} />
      )}

      {course.type === "CENTRE" && (
        <CentreDetails meta={(course.metadata as CentreMeta) ?? {}} />
      )}
    </div>
  );
}

function ZoomDetails({ meta }: { meta: ZoomMeta }) {
  return (
    <div className="mt-8 space-y-4">
      <div className="card p-6">
        <div className="mb-2 flex items-center gap-2">
          <Calendar className="h-5 w-5 text-gold-500" />
          <h3 className="font-semibold text-parchment">Schedule</h3>
        </div>
        <p className="text-sm text-parchment-muted">{meta.schedule ?? "Schedule will be shared closer to the start date."}</p>
      </div>
      <div className="card p-6">
        <div className="mb-2 flex items-center gap-2">
          <Users className="h-5 w-5 text-gold-500" />
          <h3 className="font-semibold text-parchment">Zoom Joining Link</h3>
        </div>
        {meta.meetingLink ? (
          <a href={meta.meetingLink} target="_blank" rel="noopener noreferrer" className="btn-gold">
            Join Zoom Class
          </a>
        ) : (
          <p className="text-sm text-parchment-muted">The joining link will appear here before your batch starts.</p>
        )}
      </div>
      {meta.notes && (
        <div className="card p-6">
          <p className="text-sm text-parchment-muted">{meta.notes}</p>
        </div>
      )}
    </div>
  );
}

function CentreDetails({ meta }: { meta: CentreMeta }) {
  return (
    <div className="mt-8 space-y-4">
      <div className="card p-6">
        <div className="mb-2 flex items-center gap-2">
          <MapPin className="h-5 w-5 text-gold-500" />
          <h3 className="font-semibold text-parchment">Academy Centre Address</h3>
        </div>
        <p className="text-sm text-parchment-muted">{meta.address ?? "Rayadurgam, Andhra Pradesh, India"}</p>
      </div>
      <div className="card p-6">
        <div className="mb-2 flex items-center gap-2">
          <Calendar className="h-5 w-5 text-gold-500" />
          <h3 className="font-semibold text-parchment">Your Batch Dates</h3>
        </div>
        <p className="text-sm text-parchment-muted">{meta.dates ?? "Dates will be confirmed by our team shortly."}</p>
      </div>
      <div className="card p-6">
        <div className="mb-2 flex items-center gap-2">
          <Utensils className="h-5 w-5 text-gold-500" />
          <h3 className="font-semibold text-parchment">Room &amp; Food</h3>
        </div>
        <p className="text-sm text-parchment-muted">
          Complimentary accommodation and meals are included for the full 3-day program.
        </p>
      </div>
    </div>
  );
}
