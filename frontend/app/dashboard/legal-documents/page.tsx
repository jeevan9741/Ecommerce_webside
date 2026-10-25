import type { Metadata } from "next";
import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { LegalDocumentsList } from "@/components/legal/legal-documents-list";

export const metadata: Metadata = { title: "Company Legal Documents" };

export default function LegalDocumentsPage() {
  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Company Legal Documents"
        description="E-Commerce Training Academy's registration certificates and policies, as published by the academy."
      />
      <LegalDocumentsList />
    </div>
  );
}
