import { IconAlertTriangle, IconDeviceMobileCog, IconLayoutDashboard, IconReceipt2, IconWallet } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { DashboardData } from "@shared/types";
import { api } from "@/api";
import { PageHeader, toast } from "@/components/ui";
import { dateOnly, rupees } from "@/lib/format";

function Tile({ icon: I, label, value, sub, to }: { icon: typeof IconWallet; label: string; value: string; sub?: string; to?: string }) {
  const body = (
    <div className="card h-full p-4 transition hover:shadow-md">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500"><I size={16} className="text-brand-500" /> {label}</div>
      <div className="mt-1 text-2xl font-extrabold text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export function DashboardPage() {
  const [d, setD] = useState<DashboardData | null>(null);
  useEffect(() => {
    api.dashboard().then(setD).catch(toast.fromError);
  }, []);
  if (!d) return null;

  const days = d.last_days ?? [];
  const max = Math.max(1, ...days.map((x) => x.total));
  const W = 720, H = 180, bw = days.length ? W / days.length : W;

  return (
    <div className="w-full">
      <PageHeader title="Dashboard" icon={IconLayoutDashboard} />
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {d.today && <Tile icon={IconReceipt2} label="Today's sales" value={rupees(d.today.sales)} sub={`${d.today.bills} bill${d.today.bills === 1 ? "" : "s"}`} to="/bills" />}
        {d.month && <Tile icon={IconReceipt2} label="This month" value={rupees(d.month.sales)} sub={`${d.month.bills} bills`} />}
        {d.receivable != null && <Tile icon={IconWallet} label="Owed to the shop" value={rupees(d.receivable)} to="/customers" />}
        {d.low_stock != null && <Tile icon={IconAlertTriangle} label="Low stock" value={String(d.low_stock)} sub="products at or below reorder level" to="/stock" />}
        {d.open_repairs != null && <Tile icon={IconDeviceMobileCog} label="Open repairs" value={String(d.open_repairs)} sub={`${d.ready_repairs ?? 0} ready for pickup`} to="/repairs" />}
      </div>

      {d.last_days && (
        <div className="card mt-4 p-4">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-bold">Sales, last 30 days</div>
            <div className="flex items-center gap-3 text-xs text-slate-600">
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-slate-400" /> Customer price</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-brand-600" /> Technician price</span>
            </div>
          </div>
          {days.length === 0 ? <div className="py-10 text-center text-sm text-slate-400">No sales yet</div> : (
            <svg viewBox={`0 0 ${W} ${H + 20}`} className="w-full" role="img" aria-label="Daily sales split by customer and technician price">
              {[0.25, 0.5, 0.75, 1].map((g) => <line key={g} x1={0} x2={W} y1={H - H * g} y2={H - H * g} stroke="#e2e8f0" strokeWidth={1} />)}
              {days.map((x, i) => {
                const hc = (x.customer_total / max) * H, ht = (x.technician_total / max) * H, bx = i * bw + bw * 0.15, w = bw * 0.7;
                return (
                  <g key={x.date}>
                    <title>{`${dateOnly(x.date)}: ${rupees(x.total)} (customer ${rupees(x.customer_total)}, technician ${rupees(x.technician_total)})`}</title>
                    <rect x={bx} y={H - hc} width={w} height={hc} rx={2} fill="#94a3b8" />
                    <rect x={bx} y={H - hc - ht} width={w} height={ht} rx={2} fill="#4f46e5" />
                  </g>
                );
              })}
              <text x={0} y={H + 14} fontSize={10} fill="#64748b">{dateOnly(days[0].date)}</text>
              <text x={W} y={H + 14} fontSize={10} fill="#64748b" textAnchor="end">{dateOnly(days[days.length - 1].date)}</text>
            </svg>
          )}
        </div>
      )}

      {d.top_products && d.top_products.length > 0 && (
        <div className="card mt-4 p-4">
          <div className="mb-2 text-sm font-bold">Best sellers (30 days)</div>
          {d.top_products.map((p) => <div key={p.name} className="flex justify-between border-b border-slate-100 py-1.5 text-sm last:border-0"><span>{p.name}</span><b>{p.qty} sold</b></div>)}
        </div>
      )}
    </div>
  );
}
