import { IconDownload, IconPackage, IconSearch } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import type { SerialLookup, StockMove, StockRow } from "@shared/types";
import { api } from "@/api";
import { Badge, Empty, Field, Modal, PageHeader, Pager, Stat, toast, usePaged } from "@/components/ui";
import { dateOnly, dateTime, rupees } from "@/lib/format";
import { useSession } from "@/lib/session";

type Kind = "all" | "low" | "out";

export function StockPage() {
  const { can } = useSession();
  const canCost = can("billing.cost");
  const [kind, setKind] = useState<Kind>("all");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<StockRow[]>([]);
  const [adjust, setAdjust] = useState<StockRow | null>(null);
  const [history, setHistory] = useState<StockRow | null>(null);

  const load = useCallback(() => {
    api.stockReport(kind).then(setRows).catch(toast.fromError);
  }, [kind]);
  useEffect(load, [load]);

  const shown = rows.filter((r) => `${r.name} ${r.brand} ${r.model} ${r.sku}`.toLowerCase().includes(q.toLowerCase()));
  const paged = usePaged(shown, kind + q);
  const value = shown.reduce((s, r) => s + r.value, 0);

  function exportCsv() {
    void api.exportCsv("stock.csv", [["Product", "Brand", "Model", "Stock", "Reorder level", ...(canCost ? ["Value"] : [])], ...shown.map((r) => [r.name, r.brand, r.model, r.qty, r.min_stock, ...(canCost ? [r.value] : [])])]);
  }

  return (
    <div className="w-full">
      <PageHeader title="Stock" icon={IconPackage} subtitle="What is on the shelf, what is running low, and where a serial number went."
        actions={<button className="btn-light" onClick={exportCsv}><IconDownload size={16} /> CSV</button>} />
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <Stat label="Products" value={shown.length} />
        <Stat label="Units in stock" value={shown.reduce((s, r) => s + r.qty, 0)} />
        {canCost && <Stat label="Stock value (at cost)" value={rupees(value)} />}
      </div>
      <SerialCheck />
      <div className="card mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {([["all", "All"], ["low", "Low stock"], ["out", "Out of stock"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setKind(k)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${kind === k ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-white"}`}>{l}</button>
          ))}
        </div>
        <div className="relative flex-1">
          <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr><th className="th">Product</th><th className="th">Rack</th><th className="th text-right">In stock</th><th className="th text-right">Reorder at</th>{canCost && <th className="th text-right">Value</th>}<th className="th" /></tr>
          </thead>
          <tbody>
            {paged.items.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="td"><div className="font-semibold">{r.name}</div><div className="text-[11px] text-slate-500">{[r.brand, r.model].filter(Boolean).join(" · ")}{r.track_serial ? " · serial/IMEI" : ""}</div></td>
                <td className="td text-slate-500">{r.rack}</td>
                <td className="td text-right font-semibold">{r.qty} {r.qty <= 0 ? <Badge tone="red">out</Badge> : r.qty <= r.min_stock ? <Badge tone="amber">low</Badge> : null}</td>
                <td className="td text-right text-slate-500">{r.min_stock}</td>
                {canCost && <td className="td text-right">{rupees(r.value)}</td>}
                <td className="td text-right whitespace-nowrap">
                  <button className="btn-light mr-1 px-3 py-1 text-xs" onClick={() => setHistory(r)}>History</button>
                  {can("stock.adjust") && !r.track_serial && <button className="btn-light px-3 py-1 text-xs" onClick={() => setAdjust(r)}>Correct</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <Empty text="Nothing here" />}
        <Pager {...paged} />
      </div>
      {adjust && <Adjust row={adjust} onClose={() => setAdjust(null)} onSaved={() => { setAdjust(null); load(); }} />}
      {history && <History row={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

/** Type or scan a serial / IMEI to see whether it is in stock or who bought it, and whether the warranty still runs. */
function SerialCheck() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SerialLookup[] | null>(null);
  async function find() {
    if (!q.trim()) return;
    try {
      setRes(await api.serialLookup(q));
    } catch (e) {
      toast.fromError(e);
    }
  }
  return (
    <div className="card mb-4 p-3">
      <div className="flex gap-2">
        <input className="input" placeholder="Serial / IMEI lookup: stock status and warranty" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void find()} />
        <button className="btn-primary" onClick={() => void find()}>Check</button>
      </div>
      {res && (
        <div className="mt-3 space-y-1.5 text-sm">
          {res.length === 0 && <div className="text-slate-500">No unit with that serial number.</div>}
          {res.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
              <span className="font-mono font-semibold">{s.serial_no}</span><span>{s.product_name}</span>
              {s.status === "in_stock" ? <Badge tone="green">in stock</Badge> : <><Badge tone="slate">sold {s.bill_no}</Badge><span className="text-slate-500">{s.customer_name} · {dateOnly(s.bill_date)}</span>
                {s.warranty_end ? <Badge tone={s.in_warranty ? "green" : "red"}>{s.in_warranty ? `warranty till ${dateOnly(s.warranty_end)}` : `warranty ended ${dateOnly(s.warranty_end)}`}</Badge> : <Badge>no warranty</Badge>}</>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Adjust({ row, onClose, onSaved }: { row: StockRow; onClose: () => void; onSaved: () => void }) {
  const [qty, setQty] = useState(row.qty);
  const [reason, setReason] = useState("");
  async function save() {
    try {
      await api.stockAdjust(row.id, qty, reason);
      toast.ok("Stock corrected");
      onSaved();
    } catch (e) {
      toast.fromError(e);
    }
  }
  return (
    <Modal title={`Correct stock – ${row.name}`} onClose={onClose} footer={<><button className="btn-light" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={() => void save()}>Save</button></>}>
      <div className="space-y-3">
        <div className="text-sm text-slate-500">The system shows {row.qty}. Enter what is really on the shelf.</div>
        <Field label="Real count"><input type="number" min={0} className="input" autoFocus value={qty} onChange={(e) => setQty(Math.floor(Number(e.target.value)))} /></Field>
        <Field label="Reason *"><input className="input" placeholder="Recount, damaged, lost…" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function History({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const [moves, setMoves] = useState<StockMove[]>([]);
  useEffect(() => {
    api.stockHistory(row.id).then(setMoves).catch(toast.fromError);
  }, [row.id]);
  return (
    <Modal title={`History – ${row.name}`} onClose={onClose} wide>
      <table className="w-full">
        <thead><tr><th className="th">When</th><th className="th">What</th><th className="th">Ref</th><th className="th text-right">Qty</th><th className="th">Note</th></tr></thead>
        <tbody>
          {moves.map((m, i) => (
            <tr key={i} className="border-b border-slate-100"><td className="td">{dateTime(m.date)}</td><td className="td capitalize">{m.kind}</td><td className="td">{m.ref}</td>
              <td className={`td text-right font-semibold ${m.qty < 0 ? "text-rose-600" : "text-emerald-700"}`}>{m.qty > 0 ? "+" : ""}{m.qty}</td><td className="td text-slate-500">{m.note}</td></tr>
          ))}
        </tbody>
      </table>
      {moves.length === 0 && <Empty text="No movement yet" />}
    </Modal>
  );
}
