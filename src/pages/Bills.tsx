import { IconFileInvoice, IconFileTypePdf, IconPrinter, IconSearch } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import type { PriceTier, Sale, SaleRow } from "@shared/types";
import { api } from "@/api";
import { Badge, DateRange, Empty, Field, Modal, PageHeader, Pager, toast, usePaged } from "@/components/ui";
import { dateTime, daysAgo, rupees, today } from "@/lib/format";
import { useSession } from "@/lib/session";

export function BillsPage() {
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(today());
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<PriceTier | "">("");
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const paged = usePaged(rows, from + to + q + tier);

  const load = useCallback(() => {
    api.saleList({ from, to, q, tier }).then(setRows).catch(toast.fromError);
  }, [from, to, q, tier]);
  useEffect(() => {
    const t = setTimeout(load, 150);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="w-full">
      <PageHeader title="Bills & Returns" icon={IconFileInvoice} />
      <div className="card mb-4 flex flex-wrap items-center gap-3 p-3">
        <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <select className="input w-44" value={tier} onChange={(e) => setTier(e.target.value as PriceTier | "")}><option value="">All price types</option><option value="customer">Customer price</option><option value="technician">Technician price</option></select>
        <div className="relative min-w-60 flex-1"><IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="input pl-9" placeholder="Bill no, name or phone" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Bill</th><th className="th">Date</th><th className="th">Customer</th><th className="th">Price</th><th className="th text-right">Total</th><th className="th text-right">Due</th></tr></thead>
          <tbody>
            {paged.items.map((s) => (
              <tr key={s.id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => setOpen(s.id)}>
                <td className="td font-semibold">{s.bill_no} {s.returned > 0 && <Badge tone="amber">returned {rupees(s.returned)}</Badge>}</td><td className="td text-slate-600">{dateTime(s.bill_date)}</td><td className="td">{s.customer_name}</td>
                <td className="td"><Badge tone={s.tier === "technician" ? "blue" : "slate"}>{s.tier === "technician" ? "Technician" : "Customer"}</Badge></td>
                <td className="td text-right font-semibold">{rupees(s.total)}</td><td className={`td text-right ${s.total - s.paid > 0 ? "font-semibold text-amber-700" : "text-slate-400"}`}>{s.total - s.paid > 0 ? rupees(s.total - s.paid) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty text="No bills in this period" />}
        <Pager {...paged} />
      </div>
      {open != null && <BillView id={open} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  );
}

function BillView({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { can } = useSession();
  const [sale, setSale] = useState<Sale | null>(null);
  const [returning, setReturning] = useState(false);
  const load = useCallback(() => {
    api.saleGet(id).then(setSale).catch(toast.fromError);
  }, [id]);
  useEffect(load, [load]);
  if (!sale) return null;
  const canCost = can("billing.cost");

  async function run(kind: "print" | "pdf") {
    try {
      const r = kind === "print" ? await api.printBill(id) : await api.saveBillPdf(id);
      if (!r.ok && r.error) toast.error(r.error);
    } catch (e) {
      toast.fromError(e);
    }
  }

  return (
    <Modal title={`${sale.bill_no} – ${sale.customer_name}`} onClose={onClose} wide
      footer={<>
        <button className="btn-light" onClick={() => void run("print")}><IconPrinter size={16} /> Print</button>
        <button className="btn-light" onClick={() => void run("pdf")}><IconFileTypePdf size={16} /> PDF</button>
        {can("bills.return") && <button className="btn-primary" onClick={() => setReturning(true)}>Take return</button>}
      </>}>
      <div className="mb-3 flex flex-wrap gap-2 text-sm text-slate-600">
        <span>{dateTime(sale.bill_date)}</span><Badge tone={sale.tier === "technician" ? "blue" : "slate"}>{sale.tier === "technician" ? "Technician price" : "Customer price"}</Badge>
        <span>by {sale.user_name}</span><span>· {sale.payment_mode}</span>
      </div>
      <table className="w-full">
        <thead><tr><th className="th">Item</th><th className="th text-right">Qty</th><th className="th text-right">Price used</th><th className="th text-right">Customer</th><th className="th text-right">Technician</th><th className="th text-right">Amount</th>{canCost && <th className="th text-right">Cost</th>}</tr></thead>
        <tbody>
          {sale.items.map((i) => (
            <tr key={i.id} className="border-b border-slate-100 align-top">
              <td className="td"><div className="font-semibold">{i.name}</div>
                {i.serial_nos.length > 0 && <div className="font-mono text-[11px] text-slate-500">S/N {i.serial_nos.join(", ")}</div>}
                {i.warranty_months > 0 && <div className="text-[11px] text-slate-500">{i.warranty_months} months warranty</div>}</td>
              <td className="td text-right">{i.qty}{i.returned_qty > 0 && <div className="text-[11px] text-amber-700">{i.returned_qty} returned</div>}</td>
              <td className="td text-right font-semibold">{rupees(i.unit_price)}{i.disc_pct > 0 && <div className="text-[11px] text-slate-500">-{i.disc_pct}%</div>}{i.price_source === "manual" && <div><Badge tone="amber">changed</Badge></div>}{i.price_source === "agreed" && <div><Badge tone="green">agreed</Badge></div>}</td>
              <td className="td text-right text-slate-500">{i.product_id ? rupees(i.customer_price) : "—"}</td><td className="td text-right text-slate-500">{i.product_id && i.technician_price ? rupees(i.technician_price) : "—"}</td>
              <td className="td text-right font-semibold">{rupees(i.amount)}</td>{canCost && <td className="td text-right text-slate-500">{rupees(i.cost)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 ml-auto w-64 space-y-1 text-sm">
        <div className="flex justify-between"><span className="text-slate-500">Taxable</span><span>{rupees(sale.taxable)}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">GST</span><span>{rupees(sale.cgst + sale.sgst + sale.igst)}</span></div>
        <div className="flex justify-between border-t pt-1 text-base font-bold"><span>Total</span><span>{rupees(sale.total)}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Paid</span><span>{rupees(sale.paid)}</span></div>
        {sale.total - sale.paid > 0 && <div className="flex justify-between font-semibold text-amber-700"><span>On account</span><span>{rupees(sale.total - sale.paid)}</span></div>}
      </div>
      {returning && <ReturnForm sale={sale} onClose={() => setReturning(false)} onDone={() => { setReturning(false); load(); onChanged(); }} />}
    </Modal>
  );
}

function ReturnForm({ sale, onClose, onDone }: { sale: Sale; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState<Record<number, number>>({});
  const [serials, setSerials] = useState<Record<number, string[]>>({});
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState("cash");

  async function save() {
    const lines = sale.items.filter((i) => (qty[i.id] ?? 0) > 0).map((i) => ({ sale_item_id: i.id, qty: qty[i.id], serial_nos: serials[i.id] ?? [] }));
    try {
      const r = await api.saleReturn({ sale_id: sale.id, reason, refund_mode: mode, lines });
      toast.ok(r.to_account > 0 ? `Return saved. ${rupees(r.to_account)} set against the account${r.refund > 0 ? `, refund ${rupees(r.refund)}` : ""}` : `Return saved. Refund ${rupees(r.refund)}`);
      onDone();
    } catch (e) {
      toast.fromError(e);
    }
  }

  return (
    <Modal title="Take return" onClose={onClose} footer={<><button className="btn-light" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={() => void save()}>Save return</button></>}>
      <div className="space-y-3">
        {sale.items.map((i) => {
          const left = i.qty - i.returned_qty;
          return (
            <div key={i.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-3">
                <div><div className="font-semibold">{i.name}</div><div className="text-xs text-slate-500">{left} left to return · {rupees(i.amount / i.qty)} each</div></div>
                <input type="number" min={0} max={left} disabled={left === 0} className="input w-20 text-right" value={qty[i.id] ?? ""} onChange={(e) => setQty({ ...qty, [i.id]: Math.min(left, Math.max(0, Math.floor(Number(e.target.value)))) })} />
              </div>
              {i.serial_nos.length > 0 && (qty[i.id] ?? 0) > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {i.serial_nos.map((sn) => (
                    <label key={sn} className="flex items-center gap-1 rounded bg-slate-50 px-2 py-1 font-mono text-xs"><input type="checkbox" checked={(serials[i.id] ?? []).includes(sn)} onChange={(e) => setSerials({ ...serials, [i.id]: e.target.checked ? [...(serials[i.id] ?? []), sn] : (serials[i.id] ?? []).filter((x) => x !== sn) })} /> {sn}</label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <Field label="Reason *"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Defective, wrong item, customer changed mind…" /></Field>
        <Field label="Refund as" hint="Anything the customer still owed on this bill is cleared first"><select className="input" value={mode} onChange={(e) => setMode(e.target.value)}><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option>{sale.customer_id && <option value="credit-note">Credit on account</option>}</select></Field>
      </div>
    </Modal>
  );
}
