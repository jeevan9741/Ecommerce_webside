import type { Metadata } from "next";
import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { CourseLibrary } from "@/components/library/course-library";

export const metadata: Metadata = { title: "Course Library" };

export default function CourseLibraryPage() {
  return (
    <div className="space-y-6">
      <DashboardPageHeader title="Course Library" description="Every course topic, grouped by category — with your progress." />
      <CourseLibrary />
    </div>
  );
}
