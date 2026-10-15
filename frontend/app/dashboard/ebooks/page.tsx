import type { Metadata } from "next";
import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { EBookLibrary } from "@/components/learning/ebook-library";

export const metadata: Metadata = { title: "My E-Books" };

export default function MyEBooksPage() {
  return (
    <div className="space-y-6">
      <DashboardPageHeader title="My E-Books" description="Download the e-books included with your packages — PDF and EPUB." />
      <EBookLibrary />
    </div>
  );
}
