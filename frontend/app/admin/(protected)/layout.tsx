import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { api } from "@/lib/api";
import { mfaRedirect } from "@/lib/admin-mfa";
import { DashboardShell } from "@/components/dashboard/shell";
import { FranchiseAdminSectionNav } from "@/components/franchise/admin-section-nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/admin/login");
  // Two-step verification: the API refuses admin calls without it; send the admin to set it up or sign in again.
  const mfa = await api.get<{ enforced: boolean; enrolled: boolean; sessionVerified: boolean }>("/auth/mfa/status", { token: session.token }).catch(() => null);
  const to = mfa ? mfaRedirect(mfa) : "/admin/login?reason=mfa";
  if (to) redirect(to);

  return (
    <DashboardShell
      homeHref="/admin"
      userLabel={session.user.name ?? "Admin"}
      roleLabel="Administrator"
      navItems={[
        { href: "/admin", label: "Sales Overview", icon: "layoutDashboard" },
        { href: "/admin/orders", label: "Orders", icon: "receipt" },
        { href: "/admin/customers", label: "Customers", icon: "users" },
        { href: "/admin/partners", label: "Partners", icon: "userCog" },
        { href: "/admin/courses", label: "Courses", icon: "bookOpen" },
        { href: "/admin/videos", label: "Videos", icon: "video" },
        { href: "/admin/videos?tab=ebooks", label: "E-Books", icon: "bookDown" },
        { href: "/admin/videos?tab=live", label: "Live Zoom Sessions", icon: "calendarClock" },
        { href: "/admin/center-training", label: "Center Training", icon: "building" },
        { href: "/admin/languages", label: "Languages", icon: "languages" },
        { href: "/admin/withdrawals", label: "Withdrawals", icon: "wallet" },
        { href: "/admin/franchise", label: "Franchise Management", icon: "building", matchPrefixes: ["/admin/franchise-", "/admin/franchise/"] },
        { href: "/admin/referral-claims", label: "Referral Claims", icon: "fileText" },
        { href: "/admin/partner-cards", label: "Partner ID Cards", icon: "badgeCheck" },
        { href: "/admin/partner-card-settings", label: "Partner Card Settings", icon: "settings" },
        { href: "/admin/employees", label: "Employees", icon: "briefcase" },
        { href: "/admin/jobs", label: "Job Postings", icon: "briefcase" },
        { href: "/admin/reviews", label: "Reviews", icon: "star" },
        { href: "/admin/course-certificates", label: "Course Certificates", icon: "award" },
        { href: "/admin/legal-documents", label: "Company Legal Documents", icon: "fileCheck" },
        { href: "/admin/certificates", label: "Academy Certificates", icon: "fileText" },
        { href: "/admin/settings", label: "Site Settings", icon: "settings" },
        { href: "/admin/security", label: "Admin Security", icon: "badgeCheck" },
      ]}
    >
      <FranchiseAdminSectionNav />
      {children}
    </DashboardShell>
  );
}

export const dynamic = "force-dynamic";
