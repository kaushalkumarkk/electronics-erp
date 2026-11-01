import { IconDeviceMobileCog, IconPlus, IconSearch, IconTrash } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { REPAIR_STATUSES, type Customer, type PartyPrice, type PriceTier, type Repair, type RepairInput, type RepairStatus } from "@shared/types";
import { r2 } from "@shared/pricing";
import { api } from "@/api";
import { Badge, Empty, Field, Modal, PageHeader, Pager, toast, usePaged } from "@/components/ui";
import { PartyPicker, ProductSearch } from "@/components/Pickers";
import { BillDone } from "@/pages/Billing";
import { dateOnly, rupees, today } from "@/lib/format";
import { useSession } from "@/lib/session";

const TONE: Record<RepairStatus, "slate" | "amber" | "blue" | "green" | "red"> = {
  Received: "slate", Diagnosing: "amber", "Waiting for parts": "amber", Repairing: "blue", Ready: "green", Delivered: "green", Cancelled: "red",
};

export function RepairsPage() {
  const { can } = useSession();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Repair[]>([]);
  const [edit, setEdit] = useState<number | "new" | null>(null);
  const [deliver, setDeliver] = useState<Repair | null>(null);
  const [done, setDone] = useState<{ id: number; bill_no: string; total: number } | null>(null);
  const paged = usePaged(rows, status + q);

  const load = useCallback(() => {
    api.repairList(status, q).then(setRows).catch(toast.fromError);
  }, [status, q]);
  useEffect(() => {
    const t = setTimeout(load, 150);
    return () => clearTimeout(t);
  }, [load]);

  async function setJobStatus(r: Repair, s: RepairStatus) {
    try {
      await api.repairSetStatus(r.id, s);
      load();
    } catch (e) {
      toast.fromError(e);
    }
  }

  return (
    <div className="w-full">
      <PageHeader title="Repairs" icon={IconDeviceMobileCog} subtitle="Job cards for devices left for repair. Parts are billed at the customer or technician price and come off stock when the job is delivered."
        actions={<button className="btn-primary" onClick={() => setEdit("new")}><IconPlus size={16} /> New job</button>} />
      <div className="card mb-4 flex flex-wrap items-center gap-3 p-3">
        <select className="input w-52" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Open jobs</option>
          {REPAIR_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="relative min-w-60 flex-1"><IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="input pl-9" placeholder="Job no, name, phone, device or serial (searches every job)" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Job</th><th className="th">Customer</th><th className="th">Device / problem</th><th className="th">Status</th><th className="th text-right">Estimate</th><th className="th">Promised</th><th className="th" /></tr></thead>
          <tbody>
            {paged.items.map((r) => {
              const closed = r.status === "Delivered" || r.status === "Cancelled";
              return (
                <tr key={r.id} className="border-b border-slate-100 align-top hover:bg-slate-50">
                  <td className="td font-semibold">{r.job_no}<div className="text-[11px] font-normal text-slate-500">{dateOnly(r.received_at)}</div></td>
                  <td className="td">{r.customer_name}<div className="text-[11px] text-slate-500">{r.phone}</div><Badge tone={r.tier === "technician" ? "blue" : "slate"}>{r.tier === "technician" ? "Technician" : "Customer"}</Badge></td>
                  <td className="td"><div className="font-semibold">{r.device}</div><div className="max-w-xs truncate text-[11px] text-slate-500">{r.issue}</div></td>
                  <td className="td">{closed ? <Badge tone={TONE[r.status]}>{r.status}</Badge> : (
                    <select className="input w-40 py-1 text-xs" value={r.status} onChange={(e) => void setJobStatus(r, e.target.value as RepairStatus)}>{REPAIR_STATUSES.filter((s) => s !== "Delivered").map((s) => <option key={s}>{s}</option>)}</select>)}</td>
                  <td className="td text-right">{rupees(r.estimate)}{r.advance > 0 && <div className="text-[11px] text-emerald-700">advance {rupees(r.advance)}</div>}</td>
                  <td className="td text-slate-600">{r.promised_date ? dateOnly(r.promised_date) : "—"}</td>
                  <td className="td whitespace-nowrap text-right">
                    {!closed && <button className="btn-light mr-1 px-3 py-1 text-xs" onClick={() => setEdit(r.id)}>Open</button>}
                    {!closed && can("billing") && <button className="btn-primary px-3 py-1 text-xs" onClick={() => setDeliver(r)}>Deliver & bill</button>}
                    {closed && r.sale_id && <span className="text-xs text-slate-500">billed</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <Empty text="No jobs" />}
        <Pager {...paged} />
      </div>
      {edit != null && <JobForm id={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {deliver && <Deliver job={deliver} onClose={() => setDeliver(null)} onDone={(d) => { setDeliver(null); setDone(d); load(); }} />}
      {done && <BillDone done={done} onNew={() => setDone(null)} />}
    </div>
  );
}

interface Part {
  product_id: number;
  name: string;
  qty: number;
}

function JobForm({ id, onClose, onSaved }: { id: number | null; onClose: () => void; onSaved: () => void }) {
  const [party, setParty] = useState<Customer | null>(null);
  const [f, setF] = useState<RepairInput>({
    customer_id: null, customer_name: "", phone: "", tier: "customer", device: "", serial_no: "", issue: "", accessories: "", status: "Received", estimate: 0, advance: 0, labour: 0,
    assigned_to: "", promised_date: "", notes: "", parts: [],
  });
  const [parts, setParts] = useState<Part[]>([]);
  const [prices, setPrices] = useState<Record<number, PartyPrice>>({});
  const set = <K extends keyof RepairInput>(k: K, v: RepairInput[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (id == null) return;
    api.repairGet(id).then(async (r) => {
      if (!r) return;
      setF({ ...r, parts: [] });
      setParts(r.parts.map((p) => ({ product_id: p.product_id, name: p.name, qty: p.qty })));
      if (r.customer_id) setParty((await api.customerList(r.customer_name, true)).find((c) => c.id === r.customer_id) ?? null);
    }).catch(toast.fromError);
  }, [id]);

  const ids = useMemo(() => parts.map((p) => p.product_id).join(","), [parts]);
  useEffect(() => {
    if (!ids) return setPrices({});
    api.partyPrices(party?.id ?? null, f.tier, ids.split(",").map(Number)).then(setPrices).catch(() => undefined);
  }, [ids, party?.id, f.tier]);

  function pickParty(c: Customer | null) {
    setParty(c);
    setF((x) => ({ ...x, customer_id: c?.id ?? null, customer_name: c?.name ?? x.customer_name, phone: c?.phone ?? x.phone, tier: c ? c.type : x.tier }));
  }
  const partsTotal = parts.reduce((s, p) => s + p.qty * (prices[p.product_id]?.price ?? 0), 0);

  async function save() {
    try {
      await api.repairSave({ ...f, parts: parts.map((p) => ({ product_id: p.product_id, qty: p.qty })) });
      toast.ok("Job saved");
      onSaved();
    } catch (e) {
      toast.fromError(e);
    }
  }

  return (
    <Modal title={id == null ? "New repair job" : "Repair job"} onClose={onClose} wide footer={<><button className="btn-light" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={() => void save()}>Save job</button></>}>
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <PartyPicker value={party} onChange={pickParty} placeholder="Saved customer or technician (or type a name below)" />
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
            {(["customer", "technician"] as PriceTier[]).map((t) => (
              <button key={t} onClick={() => set("tier", t)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${f.tier === t ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-white"}`}>{t === "customer" ? "Customer price" : "Technician price"}</button>
            ))}
          </div>
        </div>
        {!party && <div className="grid gap-3 md:grid-cols-2"><Field label="Name *"><input className="input" value={f.customer_name} onChange={(e) => set("customer_name", e.target.value)} /></Field><Field label="Phone"><input className="input" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field></div>}
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Device *" className="md:col-span-2"><input className="input" placeholder="e.g. Samsung A14, HP laptop" value={f.device} onChange={(e) => set("device", e.target.value)} /></Field>
          <Field label="Serial / IMEI"><input className="input" value={f.serial_no} onChange={(e) => set("serial_no", e.target.value)} /></Field>
          <Field label="Problem" className="md:col-span-2"><input className="input" value={f.issue} onChange={(e) => set("issue", e.target.value)} /></Field>
          <Field label="Accessories left"><input className="input" placeholder="charger, SIM, cover…" value={f.accessories} onChange={(e) => set("accessories", e.target.value)} /></Field>
          <Field label="Assigned to"><input className="input" value={f.assigned_to} onChange={(e) => set("assigned_to", e.target.value)} /></Field>
          <Field label="Promised date"><input type="date" min={today()} className="input" value={f.promised_date} onChange={(e) => set("promised_date", e.target.value)} /></Field>
          <Field label="Estimate (₹)"><input type="number" min={0} className="input" value={f.estimate || ""} onChange={(e) => set("estimate", Number(e.target.value))} /></Field>
          <Field label="Advance received (₹)"><input type="number" min={0} className="input" value={f.advance || ""} onChange={(e) => set("advance", Number(e.target.value))} /></Field>
          <Field label="Labour charge (₹, GST included)"><input type="number" min={0} className="input" value={f.labour || ""} onChange={(e) => set("labour", Number(e.target.value))} /></Field>
        </div>
        <div className="rounded-xl border border-slate-200 p-3">
          <div className="mb-2 text-sm font-bold">Parts used</div>
          <ProductSearch sell filter={(p) => !p.track_serial && !p.is_service} highlight={f.tier} placeholder="Add a spare part" onPick={(p) => setParts((ps) => (ps.some((x) => x.product_id === p.id) ? ps : [...ps, { product_id: p.id, name: p.name, qty: 1 }]))} />
          {parts.length > 0 && (
            <table className="mt-2 w-full">
              <tbody>
                {parts.map((p, i) => (
                  <tr key={p.product_id} className="border-b border-slate-100">
                    <td className="td font-semibold">{p.name}</td>
                    <td className="td w-24"><input type="number" min={1} className="input w-20 text-right" value={p.qty} onChange={(e) => setParts((ps) => ps.map((x, n) => (n === i ? { ...x, qty: Math.max(1, Math.floor(Number(e.target.value))) } : x)))} /></td>
                    <td className="td text-right text-slate-500">{rupees(prices[p.product_id]?.price ?? 0)} {prices[p.product_id]?.source === "agreed" && <Badge tone="green">agreed</Badge>}</td>
                    <td className="td text-right font-semibold">{rupees(r2(p.qty * (prices[p.product_id]?.price ?? 0)))}</td>
                    <td className="td w-8"><button className="text-slate-400 hover:text-rose-600" onClick={() => setParts((ps) => ps.filter((_, n) => n !== i))}><IconTrash size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-2 text-right text-sm">Parts {rupees(r2(partsTotal))} + labour {rupees(f.labour)} = <b>{rupees(r2(partsTotal + f.labour))}</b></div>
        </div>
        <Field label="Notes"><input className="input" value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function Deliver({ job, onClose, onDone }: { job: Repair; onClose: () => void; onDone: (d: { id: number; bill_no: string; total: number }) => void }) {
  const partsTotal = job.parts.reduce((s, p) => s + p.qty * p.unit_price, 0);
  const total = Math.round(partsTotal + job.labour);
  const left = Math.max(0, total - job.advance);
  const [paid, setPaid] = useState(left);
  const [mode, setMode] = useState("cash");
  async function go() {
    try {
      onDone(await api.repairDeliver(job.id, { mode, paid }));
    } catch (e) {
      toast.fromError(e);
    }
  }
  return (
    <Modal title={`Deliver ${job.job_no} and bill`} onClose={onClose} footer={<><button className="btn-light" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={() => void go()}>Make bill</button></>}>
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-2"><b>{job.customer_name}</b> · {job.device} <Badge tone={job.tier === "technician" ? "blue" : "slate"}>{job.tier === "technician" ? "Technician price" : "Customer price"}</Badge></div>
        <table className="w-full">
          <tbody>
            {job.parts.map((p) => <tr key={p.product_id}><td className="py-1">{p.name} × {p.qty}</td><td className="py-1 text-right">{rupees(r2(p.qty * p.unit_price))}</td></tr>)}
            {job.labour > 0 && <tr><td className="py-1">Labour</td><td className="py-1 text-right">{rupees(job.labour)}</td></tr>}
            <tr className="border-t font-bold"><td className="py-1">Total</td><td className="py-1 text-right">{rupees(total)}</td></tr>
            {job.advance > 0 && <tr className="text-emerald-700"><td className="py-1">Advance received earlier</td><td className="py-1 text-right">- {rupees(job.advance)}</td></tr>}
          </tbody>
        </table>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Received now (₹)"><input type="number" min={0} className="input" value={paid} onChange={(e) => setPaid(Number(e.target.value))} /></Field>
          <Field label="By"><select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>{["cash", "upi", "card", "bank"].map((m) => <option key={m}>{m}</option>)}</select></Field>
        </div>
        {paid < left && <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">{rupees(left - paid)} will go on the customer's account{job.customer_id ? "" : ". This needs a saved customer"}.</div>}
      </div>
    </Modal>
  );
}
