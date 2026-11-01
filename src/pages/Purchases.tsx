import { IconFileSpreadsheet, IconFileTypePdf, IconPlus, IconTrash, IconTruck } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import type { Product, PurchaseDetail, PurchaseImportResult, PurchaseRow, Supplier } from "@shared/types";
import { r2 } from "@shared/pricing";
import { api } from "@/api";
import { Badge, Empty, Field, Modal, PageHeader, Pager, toast, usePaged, DateRange } from "@/components/ui";
import { ProductSearch } from "@/components/Pickers";
import { ImportReview, type ImportedLine } from "@/components/PurchaseImport";
import { readInvoicePdf } from "@/lib/pdfInvoice";
import { daysAgo, dateOnly, rupees, today } from "@/lib/format";

interface PLine {
  product: Product;
  qty: number;
  rate: number;
  gst_rate: number;
  customer_price: number;
  technician_price: number;
  serials: string;
}

export function PurchasesPage() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);
  const paged = usePaged(rows, from + to);

  const load = useCallback(() => {
    api.purchaseList(from, to).then(setRows).catch(toast.fromError);
  }, [from, to]);
  useEffect(load, [load]);

  return (
    <div className="w-full">
      <PageHeader title="Purchases" icon={IconTruck} subtitle="Stock comes in here. Each purchase updates the average cost and can refresh both selling prices."
        actions={<button className="btn-primary" onClick={() => setAdding(true)}><IconPlus size={16} /> New purchase</button>} />
      <div className="card mb-4 p-3"><DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} /></div>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Date</th><th className="th">Invoice</th><th className="th">Supplier</th><th className="th text-right">Taxable</th><th className="th text-right">GST</th><th className="th text-right">Total</th><th className="th">Paid</th></tr></thead>
          <tbody>
            {paged.items.map((p) => (
              <tr key={p.id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => api.purchaseGet(p.id).then(setDetail).catch(toast.fromError)}>
                <td className="td">{dateOnly(p.invoice_date)}</td><td className="td font-semibold">{p.invoice_no}</td><td className="td">{p.supplier}</td>
                <td className="td text-right">{rupees(p.taxable)}</td><td className="td text-right">{rupees(p.gst)}</td><td className="td text-right font-semibold">{rupees(p.total)}</td>
                <td className="td">{p.paid ? <Badge tone="green">paid</Badge> : <Badge tone="amber">unpaid</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty text="No purchases in this period" />}
        <Pager {...paged} />
      </div>
      {adding && <NewPurchase onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      {detail && (
        <Modal title={`${detail.invoice_no} – ${detail.supplier}`} onClose={() => setDetail(null)} wide>
          <table className="w-full">
            <thead><tr><th className="th">Product</th><th className="th text-right">Qty</th><th className="th text-right">Rate</th><th className="th text-right">GST</th><th className="th text-right">Amount</th></tr></thead>
            <tbody>{detail.items.map((i, n) => <tr key={n} className="border-b border-slate-100"><td className="td">{i.name}</td><td className="td text-right">{i.qty}</td><td className="td text-right">{rupees(i.rate)}</td><td className="td text-right">{i.gst_rate}%</td><td className="td text-right">{rupees(i.amount)}</td></tr>)}</tbody>
          </table>
          <div className="mt-3 text-right text-sm">Total <b>{rupees(detail.total)}</b></div>
        </Modal>
      )}
    </div>
  );
}

function NewPurchase({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState(0);
  const [newSupplier, setNewSupplier] = useState<string | null>(null);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [date, setDate] = useState(today());
  const [paid, setPaid] = useState(false);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<PLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<PurchaseImportResult | null>(null);
  const [reading, setReading] = useState("");

  // lines from the review go onto the purchase; a product already on it gets the quantity and serial numbers added
  function addImported(list: ImportedLine[]) {
    setLines((ls) => {
      const out = [...ls];
      for (const l of list) {
        const at = out.findIndex((x) => x.product.id === l.product.id);
        if (at >= 0) out[at] = { ...out[at], qty: out[at].qty + l.qty, rate: l.rate, serials: [out[at].serials, l.serials].filter(Boolean).join("\n") };
        else out.push(l);
      }
      return out;
    });
    setReview(null);
  }

  async function importCsv() {
    try {
      const r = await api.purchaseCsvRead();
      if (r.error) return toast.error(r.error);
      if (r.ok) setReview(r);
    } catch (e) {
      toast.fromError(e);
    }
  }

  async function importPdf() {
    try {
      const picked = await api.purchasePdfPick();
      if (!picked.ok || !picked.data) return;
      setReading("Reading the PDF…");
      const inv = await readInvoicePdf(picked.data, setReading);
      const r = await api.purchaseTableRead(inv.table, picked.fileName ?? "invoice.pdf");
      if (r.error) return toast.error(r.error);
      // the invoice number, date and supplier printed on the PDF fill the form
      if (inv.invoiceNo && !invoiceNo) setInvoiceNo(inv.invoiceNo);
      if (inv.invoiceDate) setDate(inv.invoiceDate);
      const known = suppliers.find((s) => s.gstin && inv.gstins.includes(s.gstin.toUpperCase()));
      if (known) setSupplierId(known.id);
      setReview(r);
    } catch (e) {
      toast.fromError(e);
    } finally {
      setReading("");
    }
  }

  useEffect(() => {
    api.supplierList().then((s) => { setSuppliers(s); if (s[0]) setSupplierId(s[0].id); }).catch(toast.fromError);
  }, []);

  const patch = (i: number, p: Partial<PLine>) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...p } : l)));
  const serialCount = (l: PLine) => l.serials.split(/[\n,]/).map((s) => s.trim()).filter(Boolean).length;
  const taxable = lines.reduce((s, l) => s + l.qty * l.rate, 0);
  const gst = lines.reduce((s, l) => s + (l.qty * l.rate * l.gst_rate) / 100, 0);

  async function addSupplier() {
    try {
      const id = await api.supplierSave({ name: newSupplier ?? "", phone: "", gstin: "", address: "" });
      setSuppliers(await api.supplierList());
      setSupplierId(id);
      setNewSupplier(null);
    } catch (e) {
      toast.fromError(e);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await api.purchaseSave({
        supplier_id: supplierId, invoice_no: invoiceNo, invoice_date: date, paid, notes,
        lines: lines.map((l) => ({
          product_id: l.product.id, qty: l.qty, rate: l.rate, gst_rate: l.gst_rate, serial_nos: l.serials.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
          customer_price: l.customer_price, technician_price: l.technician_price,
        })),
      });
      toast.ok("Purchase saved, stock added");
      onSaved();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New purchase" onClose={onClose} full
      footer={<><span className="mr-auto text-sm text-slate-500">Taxable {rupees(r2(taxable))} + GST {rupees(r2(gst))} = <b className="text-slate-900">{rupees(r2(taxable + gst))}</b></span><button className="btn-light" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !lines.length} onClick={() => void save()}>Save purchase</button></>}>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Supplier *">
          {newSupplier == null ? (
            <div className="flex gap-1"><select className="input" value={supplierId} onChange={(e) => setSupplierId(Number(e.target.value))}>{suppliers.length === 0 && <option value={0}>No supplier yet</option>}{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select><button className="btn-light px-3" onClick={() => setNewSupplier("")}><IconPlus size={16} /></button></div>
          ) : (
            <div className="flex gap-1"><input className="input" autoFocus placeholder="Supplier name" value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} /><button className="btn-primary px-3" onClick={() => void addSupplier()}>Add</button></div>
          )}
        </Field>
        <Field label="Supplier invoice no. *"><input className="input" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></Field>
        <Field label="Invoice date"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> Already paid to supplier</label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button className="btn-light" onClick={() => void importCsv()}><IconFileSpreadsheet size={16} /> Import CSV</button>
        <button className="btn-light" disabled={!!reading} onClick={() => void importPdf()}><IconFileTypePdf size={16} /> {reading || "Import PDF invoice"}</button>
        <button className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => void api.purchaseTemplate()}>Download CSV template</button>
        <span className="text-xs text-slate-400">The list below updates as soon as you confirm what was read.</span>
      </div>
      <div className="my-4">
        <ProductSearch placeholder="Search a product to add" onPick={(p) => !lines.some((l) => l.product.id === p.id) && setLines((ls) => [...ls, { product: p, qty: 1, rate: 0, gst_rate: p.gst_rate, customer_price: p.customer_price, technician_price: p.technician_price, serials: "" }])} filter={(p) => !p.is_service} />
      </div>
      {lines.length === 0 ? <Empty text="Add the products on the supplier's invoice" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead><tr><th className="th">Product</th><th className="th w-20 text-right">Qty</th><th className="th w-28 text-right">Rate (ex GST)</th><th className="th w-20 text-right">GST %</th><th className="th w-28 text-right">Customer price</th><th className="th w-28 text-right">Technician price</th><th className="th w-24 text-right">Amount</th><th className="th w-8" /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.product.id} className="border-b border-slate-100 align-top">
                  <td className="td">
                    <div className="font-semibold">{l.product.name}</div>
                    <div className="text-[11px] text-slate-500">In stock {l.product.qty} · last cost {rupees(l.product.purchase_rate)}</div>
                    {l.product.track_serial && (
                      <div className="mt-1">
                        <textarea className="input h-16 font-mono text-xs" placeholder="One serial / IMEI per line" value={l.serials} onChange={(e) => patch(i, { serials: e.target.value })} />
                        <div className={`text-[11px] ${serialCount(l) === l.qty ? "text-emerald-700" : "text-rose-600"}`}>{serialCount(l)} of {l.qty} serial numbers</div>
                      </div>
                    )}
                  </td>
                  <td className="td text-right"><input type="number" min={1} className="input w-20 text-right" value={l.qty || ""} onChange={(e) => patch(i, { qty: Math.floor(Number(e.target.value)) })} /></td>
                  <td className="td text-right"><input type="number" min={0} step="0.01" className="input w-28 text-right" value={l.rate || ""} onChange={(e) => patch(i, { rate: Number(e.target.value) })} /></td>
                  <td className="td text-right"><input type="number" min={0} className="input w-20 text-right" value={l.gst_rate} onChange={(e) => patch(i, { gst_rate: Number(e.target.value) })} /></td>
                  <td className="td text-right"><input type="number" min={0} className="input w-28 text-right" value={l.customer_price || ""} onChange={(e) => patch(i, { customer_price: Number(e.target.value) })} /></td>
                  <td className="td text-right"><input type="number" min={0} className="input w-28 text-right" value={l.technician_price || ""} onChange={(e) => patch(i, { technician_price: Number(e.target.value) })} /></td>
                  <td className="td text-right font-semibold">{rupees(r2(l.qty * l.rate))}</td>
                  <td className="td"><button className="text-slate-400 hover:text-rose-600" onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}><IconTrash size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">The selling prices are filled from the product. Change them here if the new stock should sell at a different price; both are saved on the product.</p>
        </div>
      )}
      {review && <ImportReview result={review} onClose={() => setReview(null)} onAdd={addImported} />}
      <Field label="Notes" className="mt-3"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Modal>
  );
}
