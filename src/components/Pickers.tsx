import { IconSearch, IconUser, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Customer, Product, SellableProduct } from "@shared/types";
import { api } from "@/api";
import { Badge } from "@/components/ui";
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
    }, 120);
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
      <input className="input pl-9" placeholder={placeholder} value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
      {open && rows.length > 0 && (
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
        </div>
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
}: {
  onPick: (p: SellableProduct) => void;
  sell?: boolean;
  highlight?: "customer" | "technician";
  placeholder?: string;
  onMiss?: (text: string) => void;
  autoFocus?: boolean;
  filter?: (p: Found) => boolean;
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
      <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        className="input pl-9"
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
