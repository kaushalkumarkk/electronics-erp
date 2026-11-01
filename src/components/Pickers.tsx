import { IconSearch, IconUser, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Customer, Product, SellableProduct } from "@shared/types";
import { api } from "@/api";
import { Badge, Field, Modal, toast } from "@/components/ui";
import { useSession } from "@/lib/session";
import { rupees } from "@/lib/format";

/** Runs a search after a short pause in typing, ignoring answers that arrive late. */
function useSearch<T>(q: string, run: (q: string) => Promise<T[]>, enabled = true): T[] {
  const [rows, setRows] = useState<T[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const n = ++seq.current;
    const t = setTimeout(() => {
      run(q)
        .then((r) => n === seq.current && setRows(r))
        .catch(() => undefined);
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, enabled]);
  return rows;
}

/** Pick a saved customer or technician. Empty means a walk-in. */
export function PartyPicker({ value, onChange, placeholder = "Walk-in (search name or phone for a saved party)" }: { value: Customer | null; onChange: (c: Customer | null) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const rows = useSearch(q, (s) => api.customerList(s, false), open);
  const { can } = useSession();
  const [adding, setAdding] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
        <IconUser size={16} className="text-slate-400" />
        <span className="font-semibold">{value.name}</span>
        {value.shop_name && <span className="text-slate-500">· {value.shop_name}</span>}
        <Badge tone={value.type === "technician" ? "blue" : "slate"}>{value.type === "technician" ? "Technician" : "Customer"}</Badge>
        {value.balance > 0.005 && <Badge tone="red">owes {rupees(value.balance)}</Badge>}
        <button className="ml-auto text-slate-400 hover:text-rose-600" title="Remove" onClick={() => onChange(null)}>
          <IconX size={16} />
        </button>
      </div>
    );
  }
  return (
    <div className="relative" ref={box}>
      <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input data-party className="input pl-9" placeholder={placeholder} value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
      {open && (rows.length > 0 || can("customers")) && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
          {rows.map((c) => (
            <button key={c.id} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-brand-50" onClick={() => { onChange(c); setQ(""); setOpen(false); }}>
              <span className="font-semibold">{c.name}</span>
              <span className="text-slate-500">{c.phone}</span>
              <span className="ml-auto flex gap-1">
                <Badge tone={c.type === "technician" ? "blue" : "slate"}>{c.type === "technician" ? "Technician" : "Customer"}</Badge>
                {c.balance > 0.005 && <Badge tone="red">{rupees(c.balance)}</Badge>}
              </span>
            </button>
          ))}
          {can("customers") && (
            <button className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-left text-sm font-semibold text-brand-700 hover:bg-brand-50" onClick={() => setAdding(true)}>
              + New customer / technician{q.trim() ? ` "${q.trim()}"` : ""}
            </button>
          )}
        </div>
      )}
      {adding && (
        <QuickCustomer
          name={/\d{5,}/.test(q) ? "" : q.trim()}
          phone={/^[\d+\- ]{5,}$/.test(q.trim()) ? q.trim() : ""}
          onClose={() => setAdding(false)}
          onSaved={(c) => { setAdding(false); setQ(""); setOpen(false); onChange(c); }}
        />
      )}
    </div>
  );
}

type Found = Product & { available?: number };

/** Search the product list (name, brand, model, SKU, barcode). `sell` uses the billing search (with stock counts). Enter picks the
 * first match, so a barcode scanner works. `onMiss` is called when Enter finds nothing (for serial / IMEI scanning). */
export function ProductSearch({
  onPick,
  sell = false,
  highlight,
  placeholder = "Search product, brand, model or scan barcode",
  onMiss,
  autoFocus,
  filter,
  large,
}: {
  onPick: (p: SellableProduct) => void;
  sell?: boolean;
  highlight?: "customer" | "technician";
  placeholder?: string;
  onMiss?: (text: string) => void;
  autoFocus?: boolean;
  filter?: (p: Found) => boolean;
  /** the big search bar of the bill screen */
  large?: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const found = useSearch<Found>(q, (s) => (sell ? api.sellableSearch(s) : api.productList(s, false)), open && q.trim().length > 0);
  const rows = (q.trim() ? found : []).filter((p) => (filter ? filter(p) : true));
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);
  useEffect(() => setCursor(0), [q]);

  const pick = (p: Found) => {
    onPick({ ...p, available: p.available ?? p.qty });
    setQ("");
    setOpen(false);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && q.trim()) {
      e.preventDefault();
      if (rows[cursor]) pick(rows[cursor]);
      else onMiss?.(q.trim());
    } else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div className="relative" ref={box}>
      {large ? (
        <span className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-xl bg-brand-600 text-white"><IconSearch size={20} /></span>
      ) : (
        <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      )}
      <input
        data-search
        className={large ? "w-full rounded-xl border-0 bg-transparent py-3 pl-14 pr-3 text-lg outline-none" : "input pl-9"}
        placeholder={placeholder}
        autoFocus={autoFocus}
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={onKey}
      />
      {open && rows.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
          <div className="grid grid-cols-[1fr_90px_90px_70px] gap-2 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
            <span>Product</span><span className="text-right">Customer</span><span className="text-right">Technician</span><span className="text-right">Stock</span>
          </div>
          {rows.map((p, i) => (
            <button key={p.id} className={`grid w-full grid-cols-[1fr_90px_90px_70px] items-center gap-2 px-3 py-2 text-left text-sm ${i === cursor ? "bg-brand-50" : "hover:bg-slate-50"}`} onMouseEnter={() => setCursor(i)} onClick={() => pick(p)}>
              <span className="min-w-0">
                <span className="block truncate font-semibold">{p.name}</span>
                <span className="block truncate text-[11px] text-slate-500">{[p.brand, p.model, p.category].filter(Boolean).join(" · ")}{p.track_serial ? " · serial" : ""}</span>
              </span>
              <span className={`text-right ${highlight === "customer" ? "font-bold text-brand-700" : "text-slate-600"}`}>{rupees(p.customer_price)}</span>
              <span className={`text-right ${highlight === "technician" ? "font-bold text-brand-700" : "text-slate-600"}`}>{p.technician_price > 0 ? rupees(p.technician_price) : "—"}</span>
              <span className={`text-right ${p.is_service ? "text-slate-400" : (p.available ?? p.qty) <= 0 ? "font-bold text-rose-600" : "text-slate-600"}`}>{p.is_service ? "service" : (p.available ?? p.qty)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A small form to save a customer or technician without leaving the bill. */
function QuickCustomer({ name: n0, phone: p0, onClose, onSaved }: { name: string; phone: string; onClose: () => void; onSaved: (c: Customer) => void }) {
  const [name, setName] = useState(n0);
  const [phone, setPhone] = useState(p0);
  const [type, setType] = useState<"customer" | "technician">("customer");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const id = await api.customerSave({ name, phone, type, shop_name: "", gstin: "", address: "", state: "", credit_limit: 0, opening_balance: 0, active: true });
      const saved = (await api.customerList(name, false)).find((c) => c.id === id);
      if (saved) onSaved(saved);
      toast.ok("Saved");
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="New customer or technician" onClose={onClose} footer={<><button className="btn-light" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !name.trim()} onClick={() => void save()}>Save and use</button></>}>
      <div className="space-y-3" onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { e.preventDefault(); void save(); } }}>
        <div className="flex gap-2">
          {(["customer", "technician"] as const).map((t) => (
            <button key={t} onClick={() => setType(t)} className={`flex-1 rounded-xl border-2 p-2.5 text-left text-sm ${type === t ? "border-brand-600 bg-brand-50" : "border-slate-200 hover:bg-slate-50"}`}>
              <div className="font-bold">{t === "customer" ? "Customer" : "Technician"}</div>
              <div className="text-xs text-slate-500">{t === "customer" ? "Customer price" : "Technician price"}</div>
            </button>
          ))}
        </div>
        <Field label="Name *"><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Phone"><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
