import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session?.user) redirect("/login");

  return (
    <DashboardShell
      userLabel={session.user.name ?? "Student"}
      roleLabel="Student"
      navItems={[
        { href: "/dashboard", label: "Overview", icon: "layoutDashboard" },
        { href: "/dashboard/courses", label: "My Courses", icon: "bookOpen" },
        { href: "/dashboard/activity", label: "Activity", icon: "receipt" },
      ]}
    >
      {children}
    </DashboardShell>
  );
}

export const dynamic = "force-dynamic";
