import { IconBox, IconDownload, IconPlus, IconSearch } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import type { Product, ProductInput } from "@shared/types";
import { api } from "@/api";
import { Badge, Empty, Field, Modal, PageHeader, Pager, toast, usePaged } from "@/components/ui";
import { rupees } from "@/lib/format";
import { useSession } from "@/lib/session";

const blank = (): ProductInput => ({
  name: "", brand: "", model: "", category: "", sku: "", barcode: "", hsn: "8517", gst_rate: 18, unit: "Pcs", warranty_months: 12, track_serial: false,
  is_service: false, customer_price: 0, technician_price: 0, min_stock: 0, rack: "", active: true,
});

export function ProductsPage() {
  const { can } = useSession();
  const canEdit = can("products.edit");
  const canCost = can("billing.cost");
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const [rows, setRows] = useState<Product[]>([]);
  const [edit, setEdit] = useState<ProductInput | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const paged = usePaged(rows, q + all);

  const load = useCallback(async () => {
    try {
      setRows(await api.productList(q, all));
      setCategories(await api.productCategories());
    } catch (e) {
      toast.fromError(e);
    }
  }, [q, all]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 150);
    return () => clearTimeout(t);
  }, [load]);

  function exportCsv() {
    const head = ["Name", "Brand", "Model", "Category", "SKU", "Barcode", "GST %", "Customer price", "Technician price", "Stock", "Warranty (months)"];
    void api.exportCsv("products.csv", [head, ...rows.map((p) => [p.name, p.brand, p.model, p.category, p.sku, p.barcode, p.gst_rate, p.customer_price, p.technician_price, p.qty, p.warranty_months])]);
  }

  return (
    <div className="w-full">
      <PageHeader
        title="Products & Prices"
        icon={IconBox}
        subtitle="Each product keeps two selling prices: one for customers, one for technicians. Both include GST."
        actions={
          <>
            <button className="btn-light" onClick={exportCsv}><IconDownload size={16} /> CSV</button>
            {canEdit && <button className="btn-primary" onClick={() => setEdit(blank())}><IconPlus size={16} /> Add product</button>}
          </>
        }
      />
      <div className="card mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="relative flex-1">
          <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search name, brand, model, SKU, barcode, category" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show switched-off</label>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Product</th><th className="th">Category</th><th className="th text-right">Customer price</th><th className="th text-right">Technician price</th>
              <th className="th text-right">Technician saves</th>{canCost && <th className="th text-right">Cost</th>}<th className="th text-right">GST</th><th className="th text-right">Stock</th><th className="th" />
            </tr>
          </thead>
          <tbody>
            {paged.items.map((p) => (
              <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="td">
                  <div className="font-semibold">{p.name} {!p.active && <Badge tone="red">off</Badge>}</div>
                  <div className="text-[11px] text-slate-500">{[p.brand, p.model, p.sku].filter(Boolean).join(" · ")}{p.track_serial ? " · serial/IMEI" : ""}{p.warranty_months ? ` · ${p.warranty_months} mo warranty` : ""}</div>
                </td>
                <td className="td text-slate-600">{p.category}</td>
                <td className="td text-right font-semibold">{rupees(p.customer_price)}</td>
                <td className="td text-right font-semibold text-brand-700">{p.technician_price > 0 ? rupees(p.technician_price) : <span className="font-normal text-slate-400">same as customer</span>}</td>
                <td className="td text-right text-slate-500">{p.technician_price > 0 ? `${Math.round(((p.customer_price - p.technician_price) / p.customer_price) * 100)}%` : "—"}</td>
                {canCost && <td className="td text-right text-slate-600">{p.is_service ? "—" : rupees(p.purchase_rate)}</td>}
                <td className="td text-right text-slate-500">{p.gst_rate}%</td>
                <td className={`td text-right font-semibold ${!p.is_service && p.qty <= p.min_stock ? "text-rose-600" : ""}`}>{p.is_service ? "—" : p.qty}</td>
                <td className="td text-right">{canEdit && <button className="btn-light px-3 py-1 text-xs" onClick={() => setEdit({ ...p })}>Edit</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty text="No products yet. Add your first product with both prices." />}
        <Pager {...paged} />
      </div>
      {edit && <ProductForm initial={edit} categories={categories} canCost={canCost} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); }} />}
    </div>
  );
}

function ProductForm({ initial, categories, canCost, onClose, onSaved }: { initial: ProductInput; categories: string[]; canCost: boolean; onClose: () => void; onSaved: () => void }) {
  const [p, setP] = useState<ProductInput>(initial);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ProductInput>(k: K, v: ProductInput[K]) => setP((x) => ({ ...x, [k]: v }));
  const num = (k: keyof ProductInput) => ({ type: "number" as const, min: 0, className: "input", value: (p[k] as number) || "", onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never) });
  const margin = p.customer_price > 0 && p.technician_price > 0 ? Math.round(((p.customer_price - p.technician_price) / p.customer_price) * 100) : null;

  async function save() {
    setBusy(true);
    try {
      await api.productSave(p);
      toast.ok("Product saved");
      onSaved();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={p.id ? "Edit product" : "Add product"} onClose={onClose} wide
      footer={<><button className="btn-light" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy} onClick={() => void save()}>Save</button></>}>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Name *" className="md:col-span-2"><input className="input" autoFocus value={p.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Category"><input className="input" list="cats" value={p.category} onChange={(e) => set("category", e.target.value)} /><datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></Field>
        <Field label="Brand"><input className="input" value={p.brand} onChange={(e) => set("brand", e.target.value)} /></Field>
        <Field label="Model"><input className="input" value={p.model} onChange={(e) => set("model", e.target.value)} /></Field>
        <Field label="SKU / code"><input className="input" value={p.sku} onChange={(e) => set("sku", e.target.value)} /></Field>
        <Field label="Barcode"><input className="input" value={p.barcode} onChange={(e) => set("barcode", e.target.value)} /></Field>
        <Field label="HSN"><input className="input" value={p.hsn} onChange={(e) => set("hsn", e.target.value)} /></Field>
        <Field label="GST %"><select className="input" value={p.gst_rate} onChange={(e) => set("gst_rate", Number(e.target.value))}>{[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}%</option>)}</select></Field>
      </div>

      <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50 p-4">
        <div className="mb-2 text-sm font-bold text-brand-800">Selling prices (per unit, GST included)</div>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Customer price *" hint="Walk-in buyers pay this"><input {...num("customer_price")} /></Field>
          <Field label="Technician price" hint="Trade buyers pay this. Leave empty to use the customer price"><input {...num("technician_price")} /></Field>
          <div className="flex items-end pb-1 text-sm text-slate-600">{margin != null ? (margin < 0 ? <Badge tone="red">technician price is higher</Badge> : <>Technician gets <b className="mx-1">{margin}%</b> less</>) : null}</div>
        </div>
        {canCost && p.id && <div className="mt-2 text-xs text-slate-500">Cost is shown on the products list and changes automatically with each purchase.</div>}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <Field label="Unit"><input className="input" value={p.unit} onChange={(e) => set("unit", e.target.value)} /></Field>
        <Field label="Warranty (months)"><input {...num("warranty_months")} /></Field>
        <Field label="Reorder level"><input {...num("min_stock")} /></Field>
        <Field label="Rack / shelf"><input className="input" value={p.rack} onChange={(e) => set("rack", e.target.value)} /></Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={p.track_serial} disabled={p.is_service} onChange={(e) => set("track_serial", e.target.checked)} /> Track each unit by serial / IMEI</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={p.is_service} onChange={(e) => setP((x) => ({ ...x, is_service: e.target.checked, track_serial: e.target.checked ? false : x.track_serial }))} /> This is a service (no stock)</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={p.active} onChange={(e) => set("active", e.target.checked)} /> Active</label>
      </div>
    </Modal>
  );
}
