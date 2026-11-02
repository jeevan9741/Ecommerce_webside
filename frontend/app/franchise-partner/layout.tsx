import { DashboardShell } from "@/components/dashboard/shell";
import { requirePartnerProfile } from "@/lib/franchise-partner";

export const metadata = { title: "Franchise Dashboard" };

/**
 * The Franchise Partner dashboard. Separate from the student dashboard (which needs a course purchase)
 * and from admin. Access is decided by the API on every request; this layout only renders for an active
 * partner and is a 404 for everyone else.
 */
export default async function FranchisePartnerLayout({ children }: { children: React.ReactNode }) {
  const partner = await requirePartnerProfile();
  return (
    <DashboardShell
      homeHref="/franchise-partner"
      userLabel={partner.ownerName}
      roleLabel={`Franchise ${partner.franchiseCode}`}
      navItems={[
        { href: "/franchise-partner", label: "Overview", icon: "layoutDashboard" },
        { href: "/franchise-partner/students", label: "Students", icon: "users" },
        { href: "/franchise-partner/support", label: "Support", icon: "fileText" },
      ]}
    >
      {children}
    </DashboardShell>
  );
}

export const dynamic = "force-dynamic";
