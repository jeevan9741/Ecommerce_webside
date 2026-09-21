import { notFound } from "next/navigation";
import { Briefcase, Clock, MapPinned, Wallet } from "lucide-react";
import { ApiError } from "@/lib/api";
import { serverApi } from "@/lib/session";
import { ApplyForm } from "@/components/jobs/apply-form";

interface JobPosting {
  id: string;
  title: string;
  description: string;
  eligibility: string;
  salary: string;
  workType: string;
  workingHours: string;
}

export const dynamic = "force-dynamic";

const WORK_TYPE_LABEL: Record<string, string> = {
  WORK_FROM_HOME: "Work From Home",
  OFFICE: "Office",
  HYBRID: "Hybrid",
};

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The backend returns 404 for missing or inactive postings.
  const job = await serverApi<{ job: JobPosting }>(`/jobs/${id}`)
    .then((r) => r.job)
    .catch((err) => {
      if (err instanceof ApiError && err.status === 404) notFound();
      throw err;
    });

  return (
    <div className="container-academy py-16 sm:py-24">
      <div className="mx-auto grid max-w-4xl gap-10 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <p className="eyebrow">Careers</p>
          <h1 className="mt-2 font-display text-3xl font-bold text-parchment sm:text-4xl">{job.title}</h1>

          <div className="mt-5 flex flex-wrap gap-4 text-sm text-parchment-muted">
            <span className="flex items-center gap-1.5">
              <MapPinned className="h-4 w-4 text-gold-500" /> {WORK_TYPE_LABEL[job.workType]}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-gold-500" /> {job.workingHours}
            </span>
            <span className="flex items-center gap-1.5">
              <Wallet className="h-4 w-4 text-gold-500" /> {job.salary}
            </span>
          </div>

          <div className="prose-invert mt-8 space-y-6">
            <div>
              <h2 className="mb-2 font-display text-lg font-semibold text-parchment">About the role</h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-parchment-muted">{job.description}</p>
            </div>
            <div>
              <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-semibold text-parchment">
                <Briefcase className="h-4 w-4 text-gold-500" /> Eligibility
              </h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-parchment-muted">{job.eligibility}</p>
            </div>
          </div>
        </div>

        <div className="lg:sticky lg:top-28 lg:self-start">
          <ApplyForm jobId={job.id} />
        </div>
      </div>
    </div>
  );
}
