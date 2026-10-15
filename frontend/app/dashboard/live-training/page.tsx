import type { Metadata } from "next";
import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { LiveSchedule } from "@/components/learning/live-schedule";

export const metadata: Metadata = { title: "Live Zoom Training" };

export default function LiveTrainingPage() {
  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Live Zoom Training"
        description="Your 7-day live class schedule. The Join button unlocks shortly before each session starts."
      />
      <LiveSchedule />
    </div>
  );
}
