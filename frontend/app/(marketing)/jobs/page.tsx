import Link from "next/link";
import { Briefcase, Clock, MapPinned, Wallet } from "lucide-react";
import { serverApi } from "@/lib/session";

interface JobPosting {
  id: string;
  title: string;
  description: string;
  eligibility: string;
  salary: string;
  workType: string;
  workingHours: string;
}

export const metadata = { title: "Careers" };
export const dynamic = "force-dynamic";

const WORK_TYPE_LABEL: Record<string, string> = {
  WORK_FROM_HOME: "Work From Home",
  OFFICE: "Office",
  HYBRID: "Hybrid",
};

export default async function JobsPage() {
  const { jobs } = await serverApi<{ jobs: JobPosting[] }>("/jobs");

  return (
    <div className="container-academy py-16 sm:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">Careers</p>
        <h1 className="mt-3 font-display text-4xl font-bold text-parchment sm:text-5xl">
          Join the E-Commerce Training Academy team
        </h1>
        <p className="mt-5 text-base text-parchment-muted">
          We&apos;re building the team behind India&apos;s most practical e-commerce education —
          here&apos;s what we&apos;re hiring for right now.
        </p>
      </div>

      <div className="mx-auto mt-14 max-w-3xl space-y-5">
        {jobs.length === 0 && (
          <p className="text-center text-sm text-parchment-muted">
            No open positions right now — check back soon.
          </p>
        )}
        {jobs.map((job) => (
          <Link
            key={job.id}
            href={`/jobs/${job.id}`}
            className="card card-hover block p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-semibold text-parchment">{job.title}</h2>
                <p className="mt-2 line-clamp-2 text-sm text-parchment-muted">{job.description}</p>
              </div>
              <span className="btn-outline shrink-0 !py-2 !px-4 text-xs">View &amp; Apply</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-4 text-xs text-parchment-muted">
              <span className="flex items-center gap-1.5">
                <MapPinned className="h-3.5 w-3.5 text-gold-500" /> {WORK_TYPE_LABEL[job.workType]}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-gold-500" /> {job.workingHours}
              </span>
              <span className="flex items-center gap-1.5">
                <Wallet className="h-3.5 w-3.5 text-gold-500" /> {job.salary}
              </span>
              <span className="flex items-center gap-1.5">
                <Briefcase className="h-3.5 w-3.5 text-gold-500" /> {job.eligibility.slice(0, 40)}
                {job.eligibility.length > 40 ? "…" : ""}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
