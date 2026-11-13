import { DashboardShell } from "@/components/dashboard/shell";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { FranchiseComingSoon } from "@/components/franchise/coming-soon";
import { franchisePartnerEnabled } from "@/lib/feature-flags";
import { requirePartnerProfile } from "@/lib/franchise-partner";
import { partnerAreaTitle } from "@/lib/franchise-nav";

export const metadata = { title: partnerAreaTitle(franchisePartnerEnabled()) };

/**
 * The Franchise Partner dashboard. Separate from the student dashboard (which needs a course purchase)
 * and from admin. Access is decided by the API on every request; this layout only renders for an active
 * partner and is a 404 for everyone else. While the partner dashboard is switched off, every
 * /franchise-partner URL shows a "coming soon" notice instead (no sign-in, no partner API call).
 */
export default async function FranchisePartnerLayout({ children }: { children: React.ReactNode }) {
  if (!franchisePartnerEnabled()) {
    return (
      <>
        <Navbar />
        <main className="flex-1">
          <FranchiseComingSoon title="Franchise Partner Login is coming soon">
            <p>The ETA Franchise Partner dashboard isn&apos;t open yet. Partner accounts will be able to sign in here once the programme launches.</p>
            <p>Students can keep using the Login button for their courses.</p>
          </FranchiseComingSoon>
        </main>
        <Footer />
      </>
    );
  }
  const partner = await requirePartnerProfile();
  return (
    <DashboardShell
      homeHref="/franchise-partner"
      userLabel={partner.ownerName}
      roleLabel={`Franchise ${partner.franchiseCode}`}
      navItems={[
        { href: "/franchise-partner", label: "Overview", icon: "layoutDashboard" },
        { href: "/franchise-partner/students", label: "My Students", icon: "users" },
        { href: "/franchise-partner/enrolments", label: "Course Enrolments", icon: "bookOpen" },
        { href: "/franchise-partner/progress", label: "Learning Progress", icon: "award" },
        { href: "/franchise-partner/earnings", label: "Referral & Earnings", icon: "wallet" },
        { href: "/franchise-partner/support", label: "Support", icon: "fileText" },
        { href: "/franchise-partner/profile", label: "Franchise Profile", icon: "user" },
      ]}
    >
      {children}
    </DashboardShell>
  );
}

export const dynamic = "force-dynamic";
