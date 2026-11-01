import { IconChartBar, IconDownload } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { ActivityRow, DayTotal, DueRow, GstRow, ProfitRow, TierRow } from "@shared/types";
import { api } from "@/api";
import { Badge, DateRange, Empty, PageHeader, Pager, Stat, toast, usePaged } from "@/components/ui";
import { dateOnly, dateTime, monthStart, rupees, today } from "@/lib/format";
import { useSession } from "@/lib/session";

type Tab = "daily" | "tier" | "gst" | "profit" | "dues" | "activity";

export function ReportsPage() {
  const { can } = useSession();
  const tabs = ([
    ["daily", "Daily sales", can("reports")], ["tier", "Customer vs technician", can("reports")], ["gst", "GST", can("reports")],
    ["profit", "Profit", can("reports.profit")], ["dues", "Dues", can("payments")], ["activity", "Activity log", can("reports")],
  ] as [Tab, string, boolean][]).filter((t) => t[2]);
  const [tab, setTab] = useState<Tab>(tabs[0]?.[0] ?? "daily");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());

  return (
    <div className="w-full">
      <PageHeader title="Reports" icon={IconChartBar} />
      <div className="card mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
          {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === k ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-white"}`}>{l}</button>)}
        </div>
        {tab !== "dues" && <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />}
      </div>
      {tab === "daily" && <Daily from={from} to={to} />}
      {tab === "tier" && <Tier from={from} to={to} />}
      {tab === "gst" && <Gst from={from} to={to} />}
      {tab === "profit" && <Profit from={from} to={to} />}
      {tab === "dues" && <Dues />}
      {tab === "activity" && <Activity from={from} to={to} />}
    </div>
  );
}

function useLoad<T>(run: () => Promise<T>, deps: unknown[], initial: T): T {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    run().then(setV).catch(toast.fromError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return v;
}

const Csv = ({ name, rows }: { name: string; rows: (string | number)[][] }) => (
  <button className="btn-light" onClick={() => void api.exportCsv(name, rows)}><IconDownload size={16} /> CSV</button>
);

function Daily({ from, to }: { from: string; to: string }) {
  const rows = useLoad<DayTotal[]>(() => api.salesDaily(from, to), [from, to], []);
  const paged = usePaged(rows, from + to);
  const sum = (k: "bills" | "customer_total" | "technician_total" | "total") => rows.reduce((s, r) => s + r[k], 0);
  return (
    <>
      <div className="mb-4 grid gap-3 md:grid-cols-4"><Stat label="Bills" value={sum("bills")} /><Stat label="Customer price sales" value={rupees(sum("customer_total"))} /><Stat label="Technician price sales" value={rupees(sum("technician_total"))} /><Stat label="Total (after returns)" value={rupees(sum("total"))} tone="green" /></div>
      <div className="card overflow-x-auto">
        <div className="flex justify-end p-3"><Csv name="daily-sales.csv" rows={[["Date", "Bills", "Customer", "Technician", "Total"], ...rows.map((r) => [r.date, r.bills, r.customer_total, r.technician_total, r.total])]} /></div>
        <table className="w-full"><thead className="border-y border-slate-200 bg-slate-50"><tr><th className="th">Date</th><th className="th text-right">Bills</th><th className="th text-right">Customer price</th><th className="th text-right">Technician price</th><th className="th text-right">Total</th></tr></thead>
          <tbody>{paged.items.map((r) => <tr key={r.date} className="border-b border-slate-100"><td className="td">{dateOnly(r.date)}</td><td className="td text-right">{r.bills}</td><td className="td text-right">{rupees(r.customer_total)}</td><td className="td text-right">{rupees(r.technician_total)}</td><td className="td text-right font-semibold">{rupees(r.total)}</td></tr>)}</tbody></table>
        {rows.length === 0 && <Empty text="No sales in this period" />}
        <Pager {...paged} />
      </div>
    </>
  );
}

function Tier({ from, to }: { from: string; to: string }) {
  const { can } = useSession();
  const rows = useLoad<TierRow[]>(() => api.tierReport(from, to), [from, to], []);
  const total = rows.reduce((s, r) => s + r.sales, 0) || 1;
  const profit = can("reports.profit");
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {rows.map((r) => (
        <div key={r.tier} className="card p-5">
          <div className="flex items-center justify-between"><div className="text-lg font-bold">{r.tier === "technician" ? "Technician price" : "Customer price"}</div><Badge tone={r.tier === "technician" ? "blue" : "slate"}>{Math.round((r.sales / total) * 100)}% of sales</Badge></div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><div className="text-xs text-slate-500">Sales</div><div className="text-xl font-extrabold">{rupees(r.sales)}</div></div>
            <div><div className="text-xs text-slate-500">Bills</div><div className="text-xl font-extrabold">{r.bills}</div></div>
            <div><div className="text-xs text-slate-500">Units</div><div className="text-xl font-extrabold">{r.units}</div></div>
            {profit && <div><div className="text-xs text-slate-500">Profit</div><div className="text-xl font-extrabold text-emerald-700">{rupees(r.profit)}</div></div>}
          </div>
          {profit && r.sales > 0 && <div className="mt-2 text-xs text-slate-500">Margin on sales: {Math.round((r.profit / r.sales) * 100)}%</div>}
        </div>
      ))}
    </div>
  );
}

function Gst({ from, to }: { from: string; to: string }) {
  const rows = useLoad<GstRow[]>(() => api.gstReport(from, to), [from, to], []);
  const t = (k: "taxable" | "cgst" | "sgst" | "igst") => rows.reduce((s, r) => s + r[k], 0);
  return (
    <div className="card overflow-x-auto">
      <div className="flex justify-end p-3"><Csv name="gst.csv" rows={[["GST %", "Taxable", "CGST", "SGST", "IGST"], ...rows.map((r) => [r.gst_rate, r.taxable, r.cgst, r.sgst, r.igst])]} /></div>
      <table className="w-full"><thead className="border-y border-slate-200 bg-slate-50"><tr><th className="th">GST rate</th><th className="th text-right">Taxable value</th><th className="th text-right">CGST</th><th className="th text-right">SGST</th><th className="th text-right">IGST</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.gst_rate} className="border-b border-slate-100"><td className="td">{r.gst_rate}%</td><td className="td text-right">{rupees(r.taxable)}</td><td className="td text-right">{rupees(r.cgst)}</td><td className="td text-right">{rupees(r.sgst)}</td><td className="td text-right">{rupees(r.igst)}</td></tr>)}
          {rows.length > 0 && <tr className="font-bold"><td className="td">Total</td><td className="td text-right">{rupees(t("taxable"))}</td><td className="td text-right">{rupees(t("cgst"))}</td><td className="td text-right">{rupees(t("sgst"))}</td><td className="td text-right">{rupees(t("igst"))}</td></tr>}</tbody></table>
      {rows.length === 0 && <Empty text="No sales in this period" />}
    </div>
  );
}

function Profit({ from, to }: { from: string; to: string }) {
  const rows = useLoad<ProfitRow[]>(() => api.profitReport(from, to), [from, to], []);
  const paged = usePaged(rows, from + to);
  const sales = rows.reduce((s, r) => s + r.sales, 0), profit = rows.reduce((s, r) => s + r.profit, 0);
  return (
    <>
      <div className="mb-4 grid gap-3 md:grid-cols-3"><Stat label="Sales (before GST)" value={rupees(sales)} /><Stat label="Cost" value={rupees(sales - profit)} /><Stat label="Profit" value={rupees(profit)} tone="green" /></div>
      <div className="card overflow-x-auto">
        <div className="flex justify-end p-3"><Csv name="profit.csv" rows={[["Item", "Qty", "Sales", "Cost", "Profit"], ...rows.map((r) => [r.name, r.qty, r.sales, r.cost, r.profit])]} /></div>
        <table className="w-full"><thead className="border-y border-slate-200 bg-slate-50"><tr><th className="th">Item</th><th className="th text-right">Qty</th><th className="th text-right">Sales</th><th className="th text-right">Cost</th><th className="th text-right">Profit</th></tr></thead>
          <tbody>{paged.items.map((r) => <tr key={r.name} className="border-b border-slate-100"><td className="td">{r.name}</td><td className="td text-right">{r.qty}</td><td className="td text-right">{rupees(r.sales)}</td><td className="td text-right">{rupees(r.cost)}</td><td className={`td text-right font-semibold ${r.profit < 0 ? "text-rose-600" : "text-emerald-700"}`}>{rupees(r.profit)}</td></tr>)}</tbody></table>
        {rows.length === 0 && <Empty text="No sales in this period" />}
        <Pager {...paged} />
      </div>
    </>
  );
}

function Dues() {
  const rows = useLoad<DueRow[]>(() => api.duesList(), [], []);
  const paged = usePaged(rows);
  return (
    <div className="card overflow-x-auto">
      <table className="w-full"><thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Name</th><th className="th">Phone</th><th className="th">Type</th><th className="th">Oldest unpaid bill</th><th className="th text-right">Owes</th></tr></thead>
        <tbody>{paged.items.map((r) => <tr key={r.customer_id} className="border-b border-slate-100"><td className="td font-semibold">{r.name}</td><td className="td">{r.phone}</td><td className="td"><Badge tone={r.type === "technician" ? "blue" : "slate"}>{r.type}</Badge></td><td className="td">{r.oldest_bill ? dateOnly(r.oldest_bill) : "—"}</td><td className="td text-right font-semibold text-amber-700">{rupees(r.balance)}</td></tr>)}</tbody></table>
      {rows.length === 0 && <Empty text="Nobody owes anything" />}
      <Pager {...paged} />
    </div>
  );
}

function Activity({ from, to }: { from: string; to: string }) {
  const [q, setQ] = useState("");
  const rows = useLoad<ActivityRow[]>(() => api.activityList(from, to, q), [from, to, q], []);
  const paged = usePaged(rows, from + to + q);
  return (
    <div className="card overflow-x-auto">
      <div className="p-3"><input data-search className="input max-w-sm" placeholder="Filter by person, action or detail" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <table className="w-full"><thead className="border-y border-slate-200 bg-slate-50"><tr><th className="th">When</th><th className="th">Who</th><th className="th">What</th><th className="th">Detail</th></tr></thead>
        <tbody>{paged.items.map((r, i) => <tr key={i} className="border-b border-slate-100"><td className="td whitespace-nowrap">{dateTime(r.at)}</td><td className="td">{r.user_name}</td><td className="td"><b>{r.action}</b> {r.target}</td><td className="td text-slate-500">{r.detail}</td></tr>)}</tbody></table>
      {rows.length === 0 && <Empty text="Nothing recorded" />}
      <Pager {...paged} />
    </div>
  );
}
