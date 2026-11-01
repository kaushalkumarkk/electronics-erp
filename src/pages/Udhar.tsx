import { IconDownload, IconNotebook, IconSearch } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DueRow, LedgerRow, UdharBill } from "@shared/types";
import { api } from "@/api";
import { Badge, Empty, Field, Modal, PageHeader, Pager, Stat, toast, usePaged } from "@/components/ui";
import { dateOnly, rupees } from "@/lib/format";
import { useSession } from "@/lib/session";

type Tab = "people" | "bills";

/** The udhar book: who owes the shop, and which bills are still unpaid. Payments are taken here too. */
export function UdharPage() {
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>("people");
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<DueRow[]>([]);
  const [bills, setBills] = useState<UdharBill[]>([]);
  const [receive, setReceive] = useState<{ id: number; name: string; owes: number } | null>(null);
  const [ledger, setLedger] = useState<{ id: number; name: string } | null>(null);

  const load = useCallback(() => {
    api.duesList().then(setPeople).catch(toast.fromError);
    api.udharBills().then(setBills).catch(toast.fromError);
  }, []);
  useEffect(load, [load]);

  const needle = q.trim().toLowerCase();
  const shownPeople = useMemo(() => people.filter((p) => !needle || `${p.name} ${p.phone}`.toLowerCase().includes(needle)), [people, needle]);
  const shownBills = useMemo(() => bills.filter((b) => !needle || `${b.customer_name} ${b.phone} ${b.bill_no}`.toLowerCase().includes(needle)), [bills, needle]);
  const pagedPeople = usePaged(shownPeople, q + tab);
  const pagedBills = usePaged(shownBills, q + tab);

  const total = people.reduce((s, p) => s + p.balance, 0);
  const overdue = bills.filter((b) => b.days > 30).reduce((s, b) => s + b.due, 0);

  function exportCsv() {
    if (tab === "people") void api.exportCsv("udhar-by-customer.csv", [["Name", "Phone", "Type", "Oldest bill", "Owes"], ...shownPeople.map((p) => [p.name, p.phone, p.type, p.oldest_bill, p.balance])]);
    else void api.exportCsv("udhar-bills.csv", [["Bill", "Date", "Customer", "Phone", "Total", "Paid", "Due", "Days"], ...shownBills.map((b) => [b.bill_no, b.bill_date, b.customer_name, b.phone, b.total, b.paid, b.due, b.days])]);
  }

  const ageTone = (d: number) => (d > 60 ? "red" : d > 30 ? "amber" : "slate");

  return (
    <div className="w-full">
      <PageHeader title="Udhar" icon={IconNotebook} subtitle="Everything sold on credit. Take payments here as they come in."
        actions={<button className="btn-light" onClick={exportCsv}><IconDownload size={16} /> CSV</button>} />
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <Stat label="Total udhar" value={rupees(total)} tone={total > 0 ? "amber" : "slate"} />
        <Stat label="People owing" value={people.length} />
        <Stat label="Unpaid bills" value={bills.length} />
        <Stat label="Older than 30 days" value={rupees(overdue)} tone={overdue > 0 ? "red" : "slate"} />
      </div>
      <div className="card mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {([["people", "By customer"], ["bills", "Bills on udhar"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === k ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-white"}`}>{l}</button>
          ))}
        </div>
        <div className="relative min-w-60 flex-1">
          <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input data-search className="input pl-9" placeholder="Search name, phone or bill no" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {tab === "people" ? (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Name</th><th className="th">Phone</th><th className="th">Type</th><th className="th">Oldest unpaid bill</th><th className="th text-right">Owes</th><th className="th" /></tr></thead>
            <tbody>
              {pagedPeople.items.map((p) => (
                <tr key={p.customer_id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => setLedger({ id: p.customer_id, name: p.name })}>
                  <td className="td font-semibold">{p.name}</td><td className="td text-slate-600">{p.phone}</td>
                  <td className="td"><Badge tone={p.type === "technician" ? "blue" : "slate"}>{p.type === "technician" ? "Technician" : "Customer"}</Badge></td>
                  <td className="td text-slate-600">{p.oldest_bill ? dateOnly(p.oldest_bill) : "—"}</td>
                  <td className="td text-right text-base font-bold text-amber-700">{rupees(p.balance)}</td>
                  <td className="td text-right" onClick={(e) => e.stopPropagation()}>{can("payments") && <button className="btn-primary px-3 py-1 text-xs" onClick={() => setReceive({ id: p.customer_id, name: p.name, owes: p.balance })}>Receive payment</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shownPeople.length === 0 && <Empty text="Nobody owes anything" />}
          <Pager {...pagedPeople} />
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Bill</th><th className="th">Date</th><th className="th">Customer</th><th className="th text-right">Bill total</th><th className="th text-right">Paid</th><th className="th text-right">Udhar</th><th className="th">Age</th></tr></thead>
            <tbody>
              {pagedBills.items.map((b) => (
                <tr key={b.sale_id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="td font-semibold">{b.bill_no}</td><td className="td text-slate-600">{dateOnly(b.bill_date)}</td>
                  <td className="td">{b.customer_name}<div className="text-[11px] text-slate-500">{b.phone}</div></td>
                  <td className="td text-right">{rupees(b.total)}</td><td className="td text-right text-emerald-700">{rupees(b.paid)}</td>
                  <td className="td text-right font-bold text-amber-700">{rupees(b.due)}</td>
                  <td className="td"><Badge tone={ageTone(b.days)}>{b.days === 0 ? "today" : `${b.days} day${b.days === 1 ? "" : "s"}`}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          {shownBills.length === 0 && <Empty text="No bills on udhar" />}
          <Pager {...pagedBills} />
        </div>
      )}

      {receive && <Receive who={receive} onClose={() => setReceive(null)} onDone={() => { setReceive(null); load(); }} />}
      {ledger && <Ledger who={ledger} onClose={() => setLedger(null)} />}
    </div>
  );
}

function Receive({ who, onClose, onDone }: { who: { id: number; name: string; owes: number }; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(who.owes);
  const [mode, setMode] = useState("cash");
  const [note, setNote] = useState("");
  async function save() {
    try {
      await api.paymentSave({ customer_id: who.id, amount, mode, note });
      toast.ok(amount >= who.owes ? "Payment received. Udhar cleared." : "Payment received");
      onDone();
    } catch (e) {
      toast.fromError(e);
    }
  }
  return (
    <Modal title={`Receive payment – ${who.name}`} onClose={onClose} footer={<><button className="btn-light" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!(amount > 0)} onClick={() => void save()}>Receive {rupees(amount)}</button></>}>
      <div className="space-y-3" onKeyDown={(e) => { if (e.key === "Enter" && amount > 0) { e.preventDefault(); void save(); } }}>
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">Owes {rupees(who.owes)}</div>
        <Field label="Amount received (₹)"><input type="number" min={0} className="input" autoFocus value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="By"><select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>{["cash", "upi", "card", "bank"].map((m) => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Note"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        {amount > who.owes && <div className="text-xs font-semibold text-rose-600">This is more than they owe. The extra will show as credit on their account.</div>}
      </div>
    </Modal>
  );
}

function Ledger({ who, onClose }: { who: { id: number; name: string }; onClose: () => void }) {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  useEffect(() => {
    api.customerLedger(who.id).then(setRows).catch(toast.fromError);
  }, [who.id]);
  const paged = usePaged(rows);
  return (
    <Modal title={`Account – ${who.name}`} onClose={onClose} wide>
      <table className="w-full">
        <thead><tr><th className="th">Date</th><th className="th">Entry</th><th className="th text-right">Billed</th><th className="th text-right">Paid / returned</th><th className="th text-right">Balance</th></tr></thead>
        <tbody>
          {paged.items.map((r, i) => (
            <tr key={i} className="border-b border-slate-100">
              <td className="td">{r.date ? dateOnly(r.date) : ""}</td><td className="td">{r.kind === "payment" ? `Payment ${r.ref}` : r.kind === "return" ? `Return on ${r.ref}` : r.ref}</td>
              <td className="td text-right">{r.debit ? rupees(r.debit) : ""}</td><td className="td text-right text-emerald-700">{r.credit ? rupees(r.credit) : ""}</td><td className="td text-right font-semibold">{rupees(r.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager {...paged} />
    </Modal>
  );
}
