import { useState } from "react";
import type { ProductImportResult, ProductImportRow } from "@shared/types";
import { api } from "@/api";
import { Badge, Modal, Pager, toast, usePaged } from "@/components/ui";

type Draft = ProductImportRow & { use: boolean };

/** Shows what was read from the products CSV so it can be checked before anything is saved. New products are added, products
 * already in the shop (matched by barcode, SKU or exact name) are updated with only the columns the file had. */
export function ProductImportReview({ result, onClose, onDone }: { result: ProductImportResult; onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<Draft[]>(() => result.rows.map((r) => ({ ...r, use: r.issues.length === 0 })));
  const [busy, setBusy] = useState(false);
  const patch = (i: number, p: Partial<Draft>) => setRows((rs) => rs.map((r, n) => (n === i ? { ...r, ...p } : r)));
  const paged = usePaged(rows);
  const chosen = rows.filter((r) => r.use);
  const fresh = chosen.filter((r) => r.id == null).length;

  /** What is still wrong with a ticked row (the same checks the back end makes). */
  function problem(r: Draft): string {
    if (!r.name.trim()) return "name";
    if (r.id == null && !(r.customer_price > 0)) return "customer price";
    if (r.technician_price > 0 && r.customer_price > 0 && r.technician_price > r.customer_price) return "technician price (higher than customer)";
    return "";
  }
  const bad = chosen.filter((r) => problem(r));

  async function save() {
    if (bad.length) return toast.error(`Row ${bad[0].line}: check the ${problem(bad[0])}`);
    setBusy(true);
    try {
      const res = await api.productCsvSave(chosen);
      toast.ok(`${res.added} added, ${res.updated} updated${res.stocked ? `, ${res.stocked} units of opening stock` : ""}`);
      onDone();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Check the products${result.fileName ? ` – ${result.fileName}` : ""}`} onClose={onClose} full
      footer={<>
        <span className="mr-auto text-sm text-slate-500">{chosen.length} of {rows.length} rows selected · {fresh} new · {chosen.length - fresh} to update</span>
        <button className="btn-light" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy || !chosen.length} onClick={() => void save()}>{busy ? "Saving…" : `Import ${chosen.length} product${chosen.length === 1 ? "" : "s"}`}</button>
      </>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead><tr>
            <th className="th w-8"><input type="checkbox" checked={chosen.length === rows.length} onChange={(e) => setRows((rs) => rs.map((r) => ({ ...r, use: e.target.checked })))} /></th>
            <th className="th">Product</th><th className="th">Status</th><th className="th text-right">Customer price</th><th className="th text-right">Technician price</th>
            <th className="th text-right">GST</th><th className="th text-right">Opening stock</th>
          </tr></thead>
          <tbody>
            {paged.items.map((r) => {
              const i = rows.indexOf(r);
              const p = r.use ? problem(r) : "";
              return (
                <tr key={r.line} className={`border-b border-slate-100 align-top ${r.use ? "" : "opacity-50"} ${p ? "bg-rose-50/60" : ""}`}>
                  <td className="td"><input type="checkbox" checked={r.use} onChange={(e) => patch(i, { use: e.target.checked })} /></td>
                  <td className="td">
                    {r.id == null ? <input className="input h-9" value={r.name} onChange={(e) => patch(i, { name: e.target.value })} /> : <div className="font-semibold">{r.name}</div>}
                    <div className="mt-0.5 text-[11px] text-slate-500">{[r.brand, r.model, r.category, r.sku && `SKU ${r.sku}`, `row ${r.line}`].filter(Boolean).join(" · ")}{r.track_serial ? " · serial/IMEI" : ""}</div>
                    {r.issues.map((m) => <div key={m} className="text-[11px] font-semibold text-rose-600">{m}</div>)}
                  </td>
                  <td className="td">{r.id == null ? <Badge tone="blue">new</Badge> : <Badge tone="green">update</Badge>}</td>
                  <td className="td text-right"><input type="number" min={0} className="input h-9 w-28 text-right" value={r.customer_price || ""} placeholder={r.id != null ? "keep" : ""} onChange={(e) => patch(i, { customer_price: Number(e.target.value), has: { ...r.has, customer_price: Number(e.target.value) > 0 } })} /></td>
                  <td className="td text-right"><input type="number" min={0} className="input h-9 w-28 text-right" value={r.technician_price || ""} placeholder={r.id != null && !r.has.technician_price ? "keep" : ""} onChange={(e) => patch(i, { technician_price: Number(e.target.value), has: { ...r.has, technician_price: true } })} /></td>
                  <td className="td text-right text-slate-500">{r.gst_rate}%</td>
                  <td className="td text-right">{r.id != null ? <span className="text-xs text-slate-400">unchanged</span> : r.track_serial ? `${r.serial_nos.length} serials` : r.qty > 0 ? `${r.qty} ${r.unit || "pcs"}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager {...paged} />
      <p className="mt-2 text-xs text-slate-500">New products are added with the prices shown (per unit, GST included). Products already in the shop are updated using only the columns your file has; their stock is not changed. Untick a row to leave it out.</p>
    </Modal>
  );
}
