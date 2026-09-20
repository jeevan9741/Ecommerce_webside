import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard/shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <DashboardShell
      userLabel={session.user.name ?? "Student"}
      roleLabel={`Referral ID: ${session.user.referralCode}`}
      navItems={[
        { href: "/dashboard", label: "Overview", icon: "layoutDashboard" },
        { href: "/dashboard/courses", label: "My Courses", icon: "bookOpen" },
        { href: "/dashboard/referrals", label: "Referral & Earnings", icon: "users" },
        { href: "/dashboard/activity", label: "Activity", icon: "receipt" },
      ]}
    >
      {children}
    </DashboardShell>
  );
}

export const dynamic = "force-dynamic";
