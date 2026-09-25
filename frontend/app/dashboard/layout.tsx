import { redirect } from "next/navigation";
import { getSession, hasCourseAccess } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  // Nothing to show anyone who hasn't bought a package yet — the packages are the next step.
  if (!(await hasCourseAccess(session.user))) redirect("/courses");

  return (
    <DashboardShell
      userLabel={session.user.name ?? "Student"}
      roleLabel={`Referral ID: ${session.user.referralCode}`}
      navItems={[
        { href: "/dashboard", label: "Overview", icon: "layoutDashboard" },
        { href: "/dashboard/profile", label: "My Profile", icon: "user" },
        { href: "/dashboard/partner-card", label: "Partner ID Card", icon: "badgeCheck" },
        { href: "/dashboard/courses", label: "My Courses", icon: "bookOpen" },
        { href: "/dashboard/referral", label: "Referral & Earnings", icon: "users" },
        { href: "/dashboard/referral/claim", label: "Claim Partner Commission", icon: "handCoins" },
        { href: "/dashboard/activity", label: "Activity", icon: "receipt" },
      ]}
    >
      {children}
    </DashboardShell>
  );
}

export const dynamic = "force-dynamic";
