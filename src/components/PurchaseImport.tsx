import { useState } from "react";
import type { Product, PurchaseImportResult, PurchaseImportRow } from "@shared/types";
import { api } from "@/api";
import { Badge, Modal, toast } from "@/components/ui";
import { rupees } from "@/lib/format";

export interface ImportedLine {
  product: Product;
  qty: number;
  rate: number;
  gst_rate: number;
  customer_price: number;
  technician_price: number;
  serials: string;
}

type Draft = PurchaseImportRow & { use: boolean; serialText: string };

/** Shows what was read from the CSV / PDF so it can be checked and corrected before it goes onto the purchase. New products are
 * made here (with the prices shown), so nothing has to be typed twice. */
export function ImportReview({ result, onClose, onAdd }: { result: PurchaseImportResult; onClose: () => void; onAdd: (lines: ImportedLine[]) => void }) {
  const [rows, setRows] = useState<Draft[]>(() => result.rows.map((r) => ({ ...r, use: r.issues.every((i) => !/missing|No product/.test(i)), serialText: r.serial_nos.join("\n") })));
  const [busy, setBusy] = useState(false);
  const patch = (i: number, p: Partial<Draft>) => setRows((rs) => rs.map((r, n) => (n === i ? { ...r, ...p } : r)));
  const chosen = rows.filter((r) => r.use);
  const fresh = chosen.filter((r) => r.product_id == null).length;
  const serialsOf = (r: Draft) => r.serialText.split(/[\s,;|]+/).map((s) => s.trim()).filter(Boolean);

  /** What is still wrong with a ticked row. */
  function problem(r: Draft): string {
    if (!r.name.trim()) return "name";
    if (!(r.qty > 0)) return "quantity";
    if (!(r.rate > 0)) return "rate";
    if (r.product_id == null && !(r.customer_price > 0)) return "customer price";
    if ((r.track_serial || serialsOf(r).length > 0) && serialsOf(r).length !== r.qty) return `${r.qty} serial numbers`;
    if (r.technician_price > 0 && r.customer_price > 0 && r.technician_price > r.customer_price) return "technician price (higher than customer)";
    return "";
  }
  const bad = chosen.filter((r) => problem(r));

  async function add() {
    if (bad.length) return toast.error(`Row ${bad[0].line}: check the ${problem(bad[0])}`);
    setBusy(true);
    try {
      const out: ImportedLine[] = [];
      for (const r of chosen) {
        let product: Product | undefined;
        if (r.product_id != null) product = (await api.productList(r.name, false)).find((p) => p.id === r.product_id);
        else {
          const serials = serialsOf(r);
          const id = await api.productSave({
            name: r.name.trim(), brand: r.brand, model: "", category: r.category, sku: r.sku, barcode: r.barcode, hsn: r.hsn || "8517", gst_rate: r.gst_rate, unit: "Pcs",
            warranty_months: 12, track_serial: serials.length > 0, is_service: false, customer_price: r.customer_price, technician_price: r.technician_price, min_stock: 0, rack: "", active: true,
          });
          product = (await api.productList(r.name, true)).find((p) => p.id === id);
        }
        if (!product) throw new Error(`${r.name}: product not found`);
        out.push({ product, qty: r.qty, rate: r.rate, gst_rate: r.gst_rate, customer_price: r.customer_price || product.customer_price, technician_price: r.technician_price || product.technician_price, serials: serialsOf(r).join("\n") });
      }
      onAdd(out);
      toast.ok(`${out.length} product${out.length === 1 ? "" : "s"} added to the purchase${fresh ? `, ${fresh} new` : ""}`);
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Check the list${result.fileName ? ` – ${result.fileName}` : ""}`} onClose={onClose} full
      footer={<>
        <span className="mr-auto text-sm text-slate-500">{chosen.length} of {rows.length} rows selected{fresh ? ` · ${fresh} new product${fresh === 1 ? "" : "s"} will be created` : ""}</span>
        <button className="btn-light" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy || !chosen.length} onClick={() => void add()}>{busy ? "Adding…" : `Add ${chosen.length} to purchase`}</button>
      </>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px]">
          <thead><tr>
            <th className="th w-8"><input type="checkbox" checked={chosen.length === rows.length} onChange={(e) => setRows((rs) => rs.map((r) => ({ ...r, use: e.target.checked })))} /></th>
            <th className="th">Product</th><th className="th w-20 text-right">Qty</th><th className="th w-28 text-right">Rate (ex GST)</th><th className="th w-20 text-right">GST %</th>
            <th className="th w-28 text-right">Customer price</th><th className="th w-28 text-right">Technician price</th><th className="th w-24 text-right">Amount</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const p = r.use ? problem(r) : "";
              return (
                <tr key={r.line} className={`border-b border-slate-100 align-top ${r.use ? "" : "opacity-50"} ${p ? "bg-rose-50/60" : ""}`}>
                  <td className="td"><input type="checkbox" checked={r.use} onChange={(e) => patch(i, { use: e.target.checked })} /></td>
                  <td className="td">
                    {r.product_id == null ? <input className="input" value={r.name} onChange={(e) => patch(i, { name: e.target.value })} /> : <div className="font-semibold">{r.name}</div>}
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                      {r.product_id == null ? <Badge tone="blue">new product</Badge> : <Badge tone="green">found</Badge>}
                      {r.sku && <span>SKU {r.sku}</span>}<span>row {r.line}</span>
                      {r.issues.filter((m) => !/serial/i.test(m)).map((m) => <span key={m} className="font-semibold text-rose-600">{m}</span>)}
                    </div>
                    {(r.track_serial || r.serialText) && (
                      <div className="mt-1">
                        <textarea className="input h-14 font-mono text-xs" placeholder="One serial / IMEI per line" value={r.serialText} onChange={(e) => patch(i, { serialText: e.target.value })} />
                        <div className={`text-[11px] ${serialsOf(r).length === r.qty ? "text-emerald-700" : "text-rose-600"}`}>{serialsOf(r).length} of {r.qty} serial numbers</div>
                      </div>
                    )}
                  </td>
                  <td className="td text-right"><input type="number" min={0} className="input w-20 text-right" value={r.qty || ""} onChange={(e) => patch(i, { qty: Math.floor(Number(e.target.value)) })} /></td>
                  <td className="td text-right"><input type="number" min={0} step="0.01" className="input w-28 text-right" value={r.rate || ""} onChange={(e) => patch(i, { rate: Number(e.target.value) })} /></td>
                  <td className="td text-right"><input type="number" min={0} className="input w-20 text-right" value={r.gst_rate} onChange={(e) => patch(i, { gst_rate: Number(e.target.value) })} /></td>
                  <td className="td text-right"><input type="number" min={0} className="input w-28 text-right" value={r.customer_price || ""} onChange={(e) => patch(i, { customer_price: Number(e.target.value) })} /></td>
                  <td className="td text-right"><input type="number" min={0} className="input w-28 text-right" value={r.technician_price || ""} onChange={(e) => patch(i, { technician_price: Number(e.target.value) })} /></td>
                  <td className="td text-right font-semibold">{rupees(r.qty * r.rate)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">Rows that match an existing product (by barcode, SKU or exact name) are marked found. Others are created as new products with the prices shown (the customer price is suggested at 20% over cost). Untick a row to leave it out.</p>
    </Modal>
  );
}
