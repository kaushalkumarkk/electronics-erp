import { IconAddressBook, IconPlus, IconSearch, IconTrash } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import type { AgreedPrice, Customer, CustomerInput, LedgerRow, PriceTier } from "@shared/types";
import { api } from "@/api";
import { Badge, confirmDialog, Empty, enterToNext, Field, Modal, PageHeader, Pager, Stat, toast, usePaged } from "@/components/ui";
import { ProductSearch } from "@/components/Pickers";
import { dateOnly, rupees } from "@/lib/format";
import { useSession } from "@/lib/session";

const blank = (type: PriceTier = "customer"): CustomerInput => ({ name: "", phone: "", type, shop_name: "", gstin: "", address: "", state: "", credit_limit: 0, opening_balance: 0, active: true });
type View = "all" | PriceTier;

export function CustomersPage() {
  const { can } = useSession();
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("all");
  const [rows, setRows] = useState<Customer[]>([]);
  const [edit, setEdit] = useState<CustomerInput | null>(null);
  const [open, setOpen] = useState<Customer | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.customerList(q, true));
    } catch (e) {
      toast.fromError(e);
    }
  }, [q]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 150);
    return () => clearTimeout(t);
  }, [load]);

  const shown = rows.filter((r) => view === "all" || r.type === view);
  const paged = usePaged(shown, q + view);
  const owed = shown.reduce((s, r) => s + Math.max(0, r.balance), 0);

  return (
    <div className="w-full">
      <PageHeader title="Customers" icon={IconAddressBook} subtitle="Technicians are billed at the technician price automatically. Agreed rates can be set per person."
        actions={can("customers") && <button className="btn-primary" onClick={() => setEdit(blank(view === "technician" ? "technician" : "customer"))}><IconPlus size={16} /> Add</button>} />
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <Stat label="People" value={shown.length} />
        <Stat label="Technicians" value={shown.filter((r) => r.type === "technician").length} />
        <Stat label="Owed to the shop" value={rupees(owed)} tone={owed > 0 ? "amber" : "slate"} />
      </div>
      <div className="card mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {([["all", "All"], ["customer", "Customers"], ["technician", "Technicians"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setView(k)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${view === k ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-white"}`}>{l}</button>
          ))}
        </div>
        <div className="relative flex-1">
          <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input data-search className="input pl-9" placeholder="Search name, shop or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Name</th><th className="th">Phone</th><th className="th">Price type</th><th className="th text-right">Credit limit</th><th className="th text-right">Balance</th><th className="th" /></tr></thead>
          <tbody>
            {paged.items.map((c) => (
              <tr key={c.id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => setOpen(c)}>
                <td className="td"><div className="font-semibold">{c.name} {!c.active && <Badge tone="red">off</Badge>}</div>{c.shop_name && <div className="text-[11px] text-slate-500">{c.shop_name}</div>}</td>
                <td className="td text-slate-600">{c.phone}</td>
                <td className="td"><Badge tone={c.type === "technician" ? "blue" : "slate"}>{c.type === "technician" ? "Technician price" : "Customer price"}</Badge></td>
                <td className="td text-right text-slate-500">{c.credit_limit ? rupees(c.credit_limit) : "—"}</td>
                <td className={`td text-right font-semibold ${c.balance > 0.005 ? "text-amber-700" : ""}`}>{rupees(c.balance)}</td>
                <td className="td text-right" onClick={(e) => e.stopPropagation()}>{can("customers") && <button className="btn-light px-3 py-1 text-xs" onClick={() => setEdit({ ...c })}>Edit</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <Empty text="Nobody saved yet" />}
        <Pager {...paged} />
      </div>
      {edit && <CustomerForm initial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); }} />}
      {open && <Detail customer={open} onClose={() => { setOpen(null); void load(); }} />}
    </div>
  );
}

function CustomerForm({ initial, onClose, onSaved }: { initial: CustomerInput; onClose: () => void; onSaved: () => void }) {
  const [c, setC] = useState(initial);
  const set = <K extends keyof CustomerInput>(k: K, v: CustomerInput[K]) => setC((x) => ({ ...x, [k]: v }));
  async function save() {
    try {
      await api.customerSave(c);
      toast.ok("Saved");
      onSaved();
    } catch (e) {
      toast.fromError(e);
    }
  }
  return (
    <Modal title={c.id ? "Edit" : "Add customer or technician"} onClose={onClose} wide footer={<><button className="btn-light" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={() => void save()}>Save</button></>}>
      <div className="mb-4 flex gap-2">
        {(["customer", "technician"] as const).map((t) => (
          <button key={t} onClick={() => set("type", t)} className={`flex-1 rounded-xl border-2 p-3 text-left ${c.type === t ? "border-brand-600 bg-brand-50" : "border-slate-200 hover:bg-slate-50"}`}>
            <div className="font-bold">{t === "customer" ? "Customer" : "Technician / trade buyer"}</div>
            <div className="text-xs text-slate-500">{t === "customer" ? "Billed at the customer price" : "Billed at the technician price"}</div>
          </button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-3" onKeyDown={(e) => enterToNext(e, () => void save())}>
        <Field label="Name *"><input className="input" autoFocus value={c.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Phone"><input className="input" value={c.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="Shop / business"><input className="input" value={c.shop_name} onChange={(e) => set("shop_name", e.target.value)} /></Field>
        <Field label="GSTIN"><input className="input" value={c.gstin} onChange={(e) => set("gstin", e.target.value)} /></Field>
        <Field label="State" hint="A different state from the shop gets IGST"><input className="input" value={c.state} onChange={(e) => set("state", e.target.value)} /></Field>
        <Field label="Address"><input className="input" value={c.address} onChange={(e) => set("address", e.target.value)} /></Field>
        <Field label="Credit limit (₹)" hint="0 = no limit"><input type="number" min={0} className="input" value={c.credit_limit || ""} onChange={(e) => set("credit_limit", Number(e.target.value))} /></Field>
        <Field label="Opening balance (₹)" hint="Already owed before using this app"><input type="number" className="input" value={c.opening_balance || ""} onChange={(e) => set("opening_balance", Number(e.target.value))} /></Field>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={c.active} onChange={(e) => set("active", e.target.checked)} /> Active</label>
      </div>
    </Modal>
  );
}

function Detail({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { can } = useSession();
  const [tab, setTab] = useState<"ledger" | "rates">(can("payments") ? "ledger" : "rates");
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [rates, setRates] = useState<AgreedPrice[]>([]);
  const [pay, setPay] = useState({ amount: 0, mode: "cash", note: "" });
  const paged = usePaged(ledger);

  const load = useCallback(() => {
    if (can("payments") || can("customers")) api.customerLedger(customer.id).then(setLedger).catch(() => setLedger([]));
    if (can("customers")) api.customerPrices(customer.id).then(setRates).catch(() => setRates([]));
  }, [customer.id, can]);
  useEffect(load, [load]);

  const balance = ledger.length ? ledger[ledger.length - 1].balance : customer.balance;

  async function receive() {
    try {
      await api.paymentSave({ customer_id: customer.id, ...pay });
      toast.ok("Payment recorded");
      setPay({ amount: 0, mode: "cash", note: "" });
      load();
    } catch (e) {
      toast.fromError(e);
    }
  }
  async function setRate(productId: number, rate: number | null) {
    try {
      await api.customerPriceSave(customer.id, productId, rate);
      load();
    } catch (e) {
      toast.fromError(e);
    }
  }

  return (
    <Modal title={`${customer.name} – ${customer.type === "technician" ? "Technician" : "Customer"}`} onClose={onClose} wide>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {can("payments") && <button onClick={() => setTab("ledger")} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === "ledger" ? "bg-brand-600 text-white" : "text-slate-600"}`}>Account</button>}
          {can("customers") && <button onClick={() => setTab("rates")} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === "rates" ? "bg-brand-600 text-white" : "text-slate-600"}`}>Agreed rates</button>}
        </div>
        <div className="text-sm">Owes <b className={balance > 0.005 ? "text-amber-700" : ""}>{rupees(balance)}</b></div>
      </div>

      {tab === "ledger" && (
        <>
          {can("payments") && (
            <div className="mb-3 flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-3">
              <Field label="Payment received (₹)"><input type="number" min={0} className="input w-36" value={pay.amount || ""} onChange={(e) => setPay({ ...pay, amount: Number(e.target.value) })} /></Field>
              <Field label="By"><select className="input w-28" value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}>{["cash", "upi", "card", "bank"].map((m) => <option key={m}>{m}</option>)}</select></Field>
              <Field label="Note" className="flex-1"><input className="input" value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></Field>
              <button className="btn-primary" disabled={!(pay.amount > 0)} onClick={() => void receive()}>Receive</button>
            </div>
          )}
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
        </>
      )}

      {tab === "rates" && (
        <>
          <p className="mb-2 text-xs text-slate-500">An agreed rate beats both list prices for this person. Leave a product out to bill them at the usual {customer.type === "technician" ? "technician" : "customer"} price.</p>
          <div className="mb-3"><ProductSearch placeholder="Add a product to give them a special rate" onPick={(p) => void setRate(p.id, p.technician_price || p.customer_price)} /></div>
          {rates.length === 0 && <Empty text="No agreed rates" />}
          {rates.length > 0 && (
            <table className="w-full">
              <thead><tr><th className="th">Product</th><th className="th text-right">Customer price</th><th className="th text-right">Technician price</th><th className="th text-right">Agreed rate</th><th className="th" /></tr></thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={r.product_id} className="border-b border-slate-100">
                    <td className="td font-semibold">{r.name}</td><td className="td text-right text-slate-500">{rupees(r.customer_price)}</td><td className="td text-right text-slate-500">{r.technician_price ? rupees(r.technician_price) : "—"}</td>
                    <td className="td text-right"><input type="number" min={0} className="input w-28 text-right" defaultValue={r.rate} key={r.rate} onBlur={(e) => Number(e.target.value) !== r.rate && void setRate(r.product_id, Number(e.target.value))} /></td>
                    <td className="td"><button className="text-slate-400 hover:text-rose-600" onClick={async () => (await confirmDialog("Remove this agreed rate?")) && void setRate(r.product_id, null)}><IconTrash size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Modal>
  );
}
