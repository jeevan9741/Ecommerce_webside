import { serverApi } from "@/lib/session";
import { formatInr, formatDateTime, COURSE_TYPE_LABEL } from "@/lib/format";

interface OrderRow {
  id: string;
  amountInPaise: number;
  status: string;
  selectedLanguage: string | null;
  createdAt: string;
  course: { title: string; type: keyof typeof COURSE_TYPE_LABEL };
}

const STATUS_STYLES: Record<string, string> = {
  PAID: "bg-emerald/15 text-emerald border-emerald/40",
  CREATED: "bg-gold-500/15 text-gold-400 border-gold-500/40",
  FAILED: "bg-danger/15 text-danger border-danger/40",
  REFUNDED: "bg-parchment-muted/15 text-parchment-muted border-border-strong",
  CANCELLED: "bg-parchment-muted/15 text-parchment-muted border-border-strong",
};

export default async function ActivityPage() {
  const { orders } = await serverApi<{ orders: OrderRow[] }>("/me/activity");

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-parchment">Activity</h1>
      <p className="mt-1 text-sm text-parchment-muted">All your course purchases and their status.</p>

      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-y-2 text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-parchment-muted">
              <th className="px-4 pb-2">Course</th>
              <th className="px-4 pb-2">Amount</th>
              <th className="px-4 pb-2">Status</th>
              <th className="px-4 pb-2">Date</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="card">
                <td className="rounded-l-2xl px-4 py-4 text-parchment">
                  {o.course.title}
                  <span className="block text-xs text-parchment-muted">
                    {COURSE_TYPE_LABEL[o.course.type]}
                    {o.selectedLanguage ? ` · ${o.selectedLanguage}` : ""}
                  </span>
                </td>
                <td className="px-4 py-4 text-parchment">{formatInr(o.amountInPaise)}</td>
                <td className="px-4 py-4">
                  <span className={`rounded-full border px-3 py-1 text-xs font-medium ${STATUS_STYLES[o.status]}`}>
                    {o.status}
                  </span>
                </td>
                <td className="rounded-r-2xl px-4 py-4 text-parchment-muted">{formatDateTime(o.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {orders.length === 0 && (
          <p className="mt-8 text-center text-sm text-parchment-muted">No activity yet.</p>
        )}
      </div>
    </div>
  );
}
