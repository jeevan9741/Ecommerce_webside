import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard/shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/admin/login");

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
        { href: "/admin/languages", label: "Languages", icon: "languages" },
        { href: "/admin/withdrawals", label: "Withdrawals", icon: "wallet" },
        { href: "/admin/employees", label: "Employees", icon: "briefcase" },
        { href: "/admin/jobs", label: "Job Postings", icon: "briefcase" },
        { href: "/admin/reviews", label: "Reviews", icon: "star" },
        { href: "/admin/certificates", label: "Certificates", icon: "fileText" },
        { href: "/admin/settings", label: "Site Settings", icon: "settings" },
      ]}
    >
      {children}
    </DashboardShell>
  );
}

export const dynamic = "force-dynamic";
