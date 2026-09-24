/** Title block shared by every student-portal page, with an optional action on the right. */
export function DashboardPageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold text-parchment">{title}</h1>
        <p className="mt-1 text-sm text-parchment-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}
