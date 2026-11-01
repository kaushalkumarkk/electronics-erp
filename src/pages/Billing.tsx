import { IconShoppingCart, IconLock, IconPlus, IconPrinter, IconTrash, IconFileTypePdf } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Customer, PartyPrice, PriceTier, SaleInput, SellableProduct, Serial, Settings } from "@shared/types";
import { billTotals } from "@shared/pricing";
import { api } from "@/api";
import { Badge, confirmDialog, Field, Modal, toast } from "@/components/ui";
import { PartyPicker, ProductSearch } from "@/components/Pickers";
import { rupees } from "@/lib/format";
import { useSession } from "@/lib/session";

interface Line {
  key: number;
  product: SellableProduct | null;
  name: string;
  qty: number;
  unit_price: number;
  disc_pct: number;
  gst_rate: number;
  serials: string[];
  /** the price was typed by hand, so changing the buyer does not reset it */
  manual: boolean;
}

interface HeldBill {
  id: number;
  at: string;
  party: Customer | null;
  tier: PriceTier;
  lines: Line[];
  flat: number;
  walkName: string;
  walkPhone: string;
  notes: string;
}
function loadHeld(): HeldBill[] {
  try {
    return JSON.parse(localStorage.getItem("held_bills") || "[]") as HeldBill[];
  } catch {
    return [];
  }
}

let keySeq = 0;
const MODES = ["cash", "upi", "card", "bank"];

export function BillingPage() {
  const { can } = useSession();
  const canTier = can("billing.tier");
  const canEditPrice = can("billing.discount");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [party, setParty] = useState<Customer | null>(null);
  const [tier, setTier] = useState<PriceTier>("customer");
  const [lines, setLines] = useState<Line[]>([]);
  const [prices, setPrices] = useState<Record<number, PartyPrice>>({});
  const [flat, setFlat] = useState(0);
  const [walkName, setWalkName] = useState("");
  const [walkPhone, setWalkPhone] = useState("");
  const [mode, setModeState] = useState(() => {
    try {
      return localStorage.getItem("pay_mode") || "cash";
    } catch {
      return "cash";
    }
  });
  const setMode = (m: string) => {
    setModeState(m);
    try {
      localStorage.setItem("pay_mode", m);
    } catch {
      // remembered for this session only
    }
  };
  const [paid, setPaid] = useState<number | null>(null); // null = pay in full
  // udhar: the whole bill goes on the customer's account, nothing is taken now
  const [udhar, setUdhar] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [serialFor, setSerialFor] = useState<Line | null>(null);
  const [held, setHeld] = useState<HeldBill[]>(() => loadHeld());
  const [heldOpen, setHeldOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.settingsGet().then((s) => { setSettings(s); setTier(s.default_tier); }).catch(toast.fromError);
  }, []);

  // choosing a saved party switches to their price type (a technician is billed at the technician price)
  function pickParty(c: Customer | null) {
    setParty(c);
    if (!c) setUdhar(false);
    setTier(c ? c.type : settings?.default_tier ?? "customer");
    if (!c) setPaid(null);
  }

  // the price each product sells at for this buyer comes from the back end (agreed rate, else the tier's price)
  const ids = useMemo(() => [...new Set(lines.flatMap((l) => (l.product ? [l.product.id] : [])))].sort().join(","), [lines]);
  useEffect(() => {
    const list = ids ? ids.split(",").map(Number) : [];
    if (!list.length) return setPrices({});
    api.partyPrices(party?.id ?? null, tier, list).then((p) => {
      setPrices(p);
      setLines((ls) => ls.map((l) => (l.product && !l.manual && p[l.product.id] ? { ...l, unit_price: p[l.product.id].price } : l)));
    }).catch(toast.fromError);
  }, [ids, party?.id, tier]);

  function addProduct(p: SellableProduct) {
    if (!p.is_service && p.available <= 0) return toast.error(`${p.name} is out of stock`);
    setLines((ls) => {
      const same = ls.find((l) => l.product?.id === p.id);
      if (same && !p.track_serial) return ls.map((l) => (l === same ? { ...l, qty: Math.min(l.qty + 1, p.is_service ? 9999 : p.available) } : l));
      const price = prices[p.id]?.price ?? (tier === "technician" && p.technician_price > 0 ? p.technician_price : p.customer_price);
      const line: Line = { key: ++keySeq, product: p, name: p.name, qty: p.track_serial ? 0 : 1, unit_price: price, disc_pct: 0, gst_rate: p.gst_rate, serials: [], manual: false };
      if (p.track_serial) setTimeout(() => setSerialFor(line), 0);
      return [...ls, line];
    });
  }

  // scanning an IMEI / serial number into the search box adds that exact unit
  async function addBySerial(text: string) {
    try {
      const hit = (await api.serialLookup(text)).find((s) => s.status === "in_stock" && s.serial_no.toLowerCase() === text.toLowerCase());
      if (!hit) return toast.error("No product or in-stock serial number matches that");
      const [p] = await api.sellableByIds([hit.product_id]);
      setLines((ls) => {
        const same = ls.find((l) => l.product?.id === p.id);
        if (same) return same.serials.includes(hit.serial_no) ? ls : ls.map((l) => (l === same ? { ...l, serials: [...l.serials, hit.serial_no], qty: l.serials.length + 1 } : l));
        const price = prices[p.id]?.price ?? (tier === "technician" && p.technician_price > 0 ? p.technician_price : p.customer_price);
        return [...ls, { key: ++keySeq, product: p, name: p.name, qty: 1, unit_price: price, disc_pct: 0, gst_rate: p.gst_rate, serials: [hit.serial_no], manual: false }];
      });
    } catch (e) {
      toast.fromError(e);
    }
  }

  function addService() {
    setLines((ls) => [...ls, { key: ++keySeq, product: null, name: "", qty: 1, unit_price: 0, disc_pct: 0, gst_rate: settings?.service_gst ?? 18, serials: [], manual: true }]);
  }
  const patch = (key: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const interstate = !!party && !!party.state.trim() && !!settings?.state.trim() && party.state.trim().toLowerCase() !== settings.state.trim().toLowerCase();
  const totals = useMemo(
    () => billTotals(lines.map((l) => ({ unit_price: l.unit_price, qty: l.qty, disc_pct: l.disc_pct, gst_rate: l.gst_rate })), flat, interstate),
    [lines, flat, interstate]
  );
  const pay = udhar ? 0 : paid == null ? totals.total : Math.min(Math.max(0, paid), totals.total);
  const due = totals.total - pay;

  function toggleUdhar() {
    if (!udhar && !party) {
      toast.error("Udhar needs a saved customer. Pick one (F4) or add a new one.");
      document.querySelector<HTMLInputElement>("input[data-party]")?.focus();
      return;
    }
    setUdhar((u) => !u);
  }

  function saveHeld(list: HeldBill[]) {
    setHeld(list);
    try {
      localStorage.setItem("held_bills", JSON.stringify(list));
    } catch {
      // held for this session only
    }
  }
  function holdBill() {
    if (!lines.length) return toast.error("Nothing to hold");
    saveHeld([...held, { id: Date.now(), at: new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }), party, tier, lines, flat, walkName, walkPhone, notes }]);
    toast.ok("Bill put on hold");
    reset();
  }
  function resume(h: HeldBill) {
    if (lines.length && !window.confirm("Replace the bill on screen with the held bill?")) return;
    setParty(h.party); setTier(h.tier); setLines(h.lines); setFlat(h.flat); setWalkName(h.walkName); setWalkPhone(h.walkPhone); setNotes(h.notes); setPaid(null);
    saveHeld(held.filter((x) => x.id !== h.id));
    setHeldOpen(false);
  }

  async function clearBill() {
    if (lines.length && !(await confirmDialog("Clear this bill? The items will be removed (use F6 to hold it instead).", { confirmLabel: "Clear bill", danger: true }))) return;
    reset();
  }

  function reset() {
    setLines([]); setFlat(0); setPaid(null); setNotes(""); setWalkName(""); setWalkPhone(""); setUdhar(false);
    pickParty(null);
  }

  async function save(print = false) {
    if (busy) return;
    if (!lines.length) return toast.error("Add at least one item");
    if (lines.some((l) => l.product?.track_serial && l.serials.length !== l.qty)) return toast.error("Pick the serial numbers for each serial-tracked item");
    if (due > 0 && !party) return toast.error("Choose a saved customer to put the balance on their account, or take the full payment");
    const input: SaleInput = {
      customer_id: party?.id ?? null, walkin_name: walkName, walkin_phone: walkPhone, tier, bill_flat: flat, payment_mode: mode, paid: pay, notes,
      lines: lines.map((l) => ({ product_id: l.product?.id ?? null, name: l.name, qty: l.qty, unit_price: l.unit_price, disc_pct: l.disc_pct, gst_rate: l.gst_rate, serial_nos: l.serials })),
    };
    setBusy(true);
    try {
      const made = await api.saleCreate(input);
      toast.ok(`Bill ${made.bill_no} saved: ${rupees(made.total)}`);
      if (print) {
        const r = await api.printBill(made.id);
        if (!r.ok && r.error) toast.error(r.error);
      }
      reset();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  }

  // a long bill keeps the newest item in view
  const scroller = useRef<HTMLDivElement>(null);
  const lineCount = lines.length;
  useEffect(() => {
    if (lineCount > 0) scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [lineCount]);

  // F2 search, F4 customer, F6 hold, F7 clear, F8 save, F9 save and print (same keys as the medical app)
  const keys = useRef<Record<string, () => void>>({});
  keys.current = {
    F2: () => document.querySelector<HTMLInputElement>("input[data-search]")?.focus(),
    F3: toggleUdhar,
    F4: () => document.querySelector<HTMLInputElement>("input[data-party]")?.focus(),
    F6: holdBill,
    F7: () => void clearBill(),
    F8: () => void save(false),
    F9: () => void save(true),
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const fn = keys.current[e.key];
      if (!fn || e.ctrlKey || e.altKey || document.querySelector("[data-layer]")) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const qtyTotal = lines.reduce((s, l) => s + l.qty, 0);
  const shortOfCash = !udhar && pay < totals.total && !party;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-2">
      {/* A. full-width product search */}
      <div className="pos-panel shrink-0 border-2 border-brand-500 p-1.5">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1" ref={searchRef}>
            <ProductSearch large sell autoFocus highlight={tier} onPick={addProduct} onMiss={(t) => void addBySerial(t)} placeholder="Search product, brand, model or scan barcode / IMEI…" />
          </div>
          <button className="h-10 rounded-md bg-slate-100 px-3 text-sm font-bold text-slate-700 hover:bg-slate-200" onClick={() => setHeldOpen(true)}>Held ({held.length})</button>
          <kbd className="flex h-10 items-center rounded-md bg-slate-100 px-3 text-sm font-bold text-slate-600">F2</kbd>
        </div>
      </div>

      {/* shortcut hints, price type and quick actions */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500">
        {([["F2", "Search"], ["F3", "Udhar"], ["F4", "Customer"], ["F6", "Hold"], ["F7", "Clear"], ["F8", "Save"], ["F9", "Save & print"]] as const).map(([k, l]) => (
          <span key={k} className="flex items-center gap-1"><kbd className="rounded border border-slate-300 bg-white px-1.5 py-px text-[11px] font-bold text-slate-700">{k}</kbd>{l}</span>
        ))}
        <span className="ml-auto flex items-center gap-2">
          <button className="btn-light h-8 px-3 py-0 text-xs" onClick={addService}><IconPlus size={14} /> Service / labour</button>
          <span className="flex items-center gap-0.5 rounded-md bg-slate-200/70 p-0.5" title={canTier ? "" : "You do not have access to change the price type"}>
            {(["customer", "technician"] as const).map((t) => (
              <button key={t} disabled={!canTier && tier !== t} onClick={() => canTier && setTier(t)}
                className={`h-7 rounded px-3 text-xs font-semibold transition ${tier === t ? "bg-brand-600 text-white shadow-sm" : "text-slate-600 hover:bg-white"} ${!canTier ? "cursor-not-allowed" : ""}`}>
                {t === "customer" ? "Customer price" : "Technician price"}
              </button>
            ))}
            {!canTier && <IconLock size={13} className="mx-1 text-slate-400" />}
          </span>
        </span>
      </div>

      {/* B. full-width billing table: takes all the remaining height */}
      <div className="pos-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[1000px] table-fixed">
            <colgroup>
              <col style={{ width: "4%" }} /><col style={{ width: "28%" }} /><col style={{ width: "15%" }} /><col style={{ width: "9%" }} />
              <col style={{ width: "13%" }} /><col style={{ width: "8%" }} /><col style={{ width: "6%" }} /><col style={{ width: "13%" }} /><col style={{ width: "4%" }} />
            </colgroup>
            <thead className="sticky top-0 z-10 border-b-2 border-brand-600 bg-slate-100">
              <tr>
                <th className="th">#</th><th className="th">Item</th><th className="th">Brand / model</th><th className="th text-right">Qty</th>
                <th className="th text-right">Price (incl. GST)</th><th className="th text-right">Disc %</th><th className="th text-right">GST</th><th className="th text-right">Amount</th><th className="th" />
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-24 text-center">
                  <IconShoppingCart size={44} className="mx-auto mb-2 text-slate-300" stroke={1.4} />
                  <div className="text-base font-bold text-slate-500">No items on this bill</div>
                  <div className="mt-1 text-sm text-slate-400">Search or scan a product above. Customers pay the customer price, technicians the technician price.</div>
                </td></tr>
              )}
              {lines.map((l, i) => {
                const src = l.product ? prices[l.product.id]?.source : undefined;
                return (
                  <tr key={l.key} className="border-b border-slate-100 align-top odd:bg-white even:bg-slate-50/60 hover:bg-brand-50/60">
                    <td className="td text-slate-400">{i + 1}</td>
                    <td className="td">
                      {l.product ? <div className="font-semibold leading-snug">{l.name}</div> : <input className="input h-9" placeholder="Service / labour description" value={l.name} onChange={(e) => patch(l.key, { name: e.target.value })} />}
                      {l.product && (
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                          {l.manual ? <Badge tone="amber">price changed</Badge> : src === "agreed" ? <Badge tone="green">agreed rate</Badge> : src === "technician" ? <Badge tone="blue">technician price</Badge> : null}
                          {l.product.track_serial && (
                            <button className="font-semibold text-brand-700 hover:underline" onClick={() => setSerialFor(l)}>{l.serials.length ? `S/N: ${l.serials.join(", ")}` : "Pick serial numbers"}</button>
                          )}
                          {l.product.warranty_months > 0 && <span>{l.product.warranty_months} mo warranty</span>}
                        </div>
                      )}
                    </td>
                    <td className="td text-slate-600">
                      {l.product ? <><div className="truncate">{l.product.brand || "—"}</div><div className="truncate text-[11px] text-slate-400">{l.product.model}</div></> : <span className="text-slate-400">Service</span>}
                    </td>
                    <td className="td text-right">
                      <input type="number" min={1} className="input h-9 w-full text-right" disabled={!!l.product?.track_serial} value={l.qty || ""} max={l.product && !l.product.is_service ? l.product.available : undefined}
                        onChange={(e) => patch(l.key, { qty: Math.max(0, Math.floor(Number(e.target.value))) })} />
                      {l.product && !l.product.is_service && <div className="mt-0.5 text-[10px] text-slate-400">{l.product.available} in stock</div>}
                    </td>
                    <td className="td text-right">
                      <input type="number" min={0} step="0.01" className="input h-9 w-full text-right" disabled={!!l.product && !canEditPrice} value={l.unit_price}
                        onChange={(e) => patch(l.key, { unit_price: Math.max(0, Number(e.target.value)), manual: true })} />
                      {l.product && <div className="mt-0.5 text-[10px] text-slate-400">Cust {rupees(l.product.customer_price)} · Tech {l.product.technician_price > 0 ? rupees(l.product.technician_price) : "—"}</div>}
                    </td>
                    <td className="td text-right"><input type="number" min={0} max={100} className="input h-9 w-full text-right" disabled={!canEditPrice} value={l.disc_pct || ""} onChange={(e) => patch(l.key, { disc_pct: Math.min(100, Math.max(0, Number(e.target.value))) })} /></td>
                    <td className="td pt-3 text-right text-slate-500">{l.gst_rate}%</td>
                    <td className="td pt-3 text-right text-base font-bold text-slate-900">{rupees(totals.lines[i]?.amount ?? 0)}</td>
                    <td className="td pt-3 text-center"><button className="text-slate-400 hover:text-rose-600" title="Remove" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><IconTrash size={16} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex shrink-0 items-center justify-between border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-500">
          <span>{lines.length} item{lines.length === 1 ? "" : "s"} · {qtyTotal} unit{qtyTotal === 1 ? "" : "s"}</span>
          <span>Prices include GST. Enter on the search box adds the highlighted item.</span>
        </div>
      </div>

      {/* C. full-width bottom section: customer | payment | summary and actions */}
      <div className="pos-panel shrink-0 p-3">
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[33fr_30fr_37fr]">
          {/* customer details */}
          <section className="min-w-0 space-y-2 lg:border-r lg:border-slate-200 lg:pr-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Customer</div>
            <PartyPicker up value={party} onChange={pickParty} />
            {party ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
                {party.phone && <span>{party.phone}</span>}
                {party.credit_limit > 0 && <span>Credit limit {rupees(party.credit_limit)}</span>}
                {party.balance > 0.005 && <span className="font-semibold text-amber-700">Owes {rupees(party.balance)}</span>}
                {party.credit_limit > 0 && <span>Available {rupees(Math.max(0, party.credit_limit - party.balance))}</span>}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <input className="input h-9" placeholder="Customer name (optional)" value={walkName} onChange={(e) => setWalkName(e.target.value)} />
                <input className="input h-9" placeholder="Phone (optional)" value={walkPhone} onChange={(e) => setWalkPhone(e.target.value)} />
              </div>
            )}
            <input className="input h-9" placeholder="Note on the bill (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </section>

          {/* payment details */}
          <section className="min-w-0 space-y-2 lg:border-r lg:border-slate-200 lg:pr-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Payment</div>
            <button
              type="button"
              onClick={toggleUdhar}
              className={`flex h-9 w-full items-center justify-between rounded-md border-2 px-3 text-sm font-bold transition ${udhar ? "border-amber-500 bg-amber-50 text-amber-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            >
              <span>{udhar ? "✓ Udhar (credit) is ON" : "Udhar (credit)"}</span>
              <kbd className="rounded bg-slate-200 px-1 text-[10px] text-slate-600">F3</kbd>
            </button>
            <div className="grid grid-cols-4 gap-1">
              {MODES.map((m) => (
                <button key={m} type="button" disabled={udhar} onClick={() => setMode(m)}
                  className={`h-9 rounded-md border text-xs font-bold uppercase transition disabled:opacity-40 ${mode === m && !udhar ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}>{m}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Received now (₹)"><input type="number" min={0} className="input h-9" disabled={udhar} value={udhar ? 0 : paid == null ? totals.total : paid} onChange={(e) => setPaid(Number(e.target.value))} /></Field>
              <Field label="Bill discount (₹)"><input type="number" min={0} className="input h-9" disabled={!canEditPrice} value={flat || ""} onChange={(e) => setFlat(Math.max(0, Number(e.target.value)))} /></Field>
            </div>
            {due > 0 && (
              <div className={`rounded-md px-3 py-1.5 text-xs font-semibold ${party ? "bg-amber-50 text-amber-800" : "bg-rose-50 text-rose-700"}`}>
                {party ? `${rupees(due)} goes on ${party.name}'s account${party.balance > 0.005 ? ` (already owes ${rupees(party.balance)})` : ""}` : "Pick a saved customer to keep a balance, or take full payment"}
              </div>
            )}
            {shortOfCash && <div className="text-xs font-semibold text-rose-600">Received amount is less than the total.</div>}
          </section>

          {/* bill summary and actions */}
          <section className="min-w-0">
            <div className="grid grid-cols-[1fr_auto] gap-4">
              <dl className="grid content-start gap-0.5 text-sm">
                <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Bill summary</div>
                <Row k="Taxable value" v={rupees(totals.taxable)} />
                {interstate ? <Row k="IGST" v={rupees(totals.igst)} /> : <><Row k="CGST" v={rupees(totals.cgst)} /><Row k="SGST" v={rupees(totals.sgst)} /></>}
                {flat > 0 && <Row k="Discount" v={`- ${rupees(flat)}`} />}
                {totals.round_off !== 0 && <Row k="Round off" v={rupees(totals.round_off)} />}
                <div className="mt-1 flex items-center justify-between"><dt className="text-slate-500">Price used</dt><dd><Badge tone={tier === "technician" ? "blue" : "slate"}>{tier === "technician" ? "Technician" : "Customer"}</Badge></dd></div>
              </dl>
              <div className="flex min-w-[11rem] flex-col items-end justify-center rounded-md border border-brand-200 bg-brand-50 px-4 py-2">
                <div className="text-[11px] font-bold uppercase tracking-wide text-brand-800">Grand total</div>
                <div className="text-3xl font-extrabold leading-tight text-brand-700">{rupees(totals.total)}</div>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              <button className="btn-primary h-11 w-full text-base" disabled={busy || !lines.length} onClick={() => void save(true)}>
                <IconPrinter size={18} /> {busy ? "Saving…" : "Save & print"} <kbd className="rounded bg-black/20 px-1.5 text-[10px]">F9</kbd>
              </button>
              <div className="grid grid-cols-3 gap-2">
                <button className="btn-light h-9 px-2 text-xs" disabled={busy || !lines.length} onClick={() => void save(false)}>Save only <kbd className="rounded bg-slate-200 px-1 text-[9px]">F8</kbd></button>
                <button className="btn-light h-9 px-2 text-xs" disabled={!lines.length} onClick={holdBill}>Hold bill <kbd className="rounded bg-slate-200 px-1 text-[9px]">F6</kbd></button>
                <button className="btn-light h-9 px-2 text-xs text-rose-600" disabled={!lines.length && !party} onClick={() => void clearBill()}>Clear bill <kbd className="rounded bg-slate-200 px-1 text-[9px]">F7</kbd></button>
              </div>
            </div>
          </section>
        </div>
      </div>

      {serialFor && <SerialPicker line={serialFor} onClose={() => setSerialFor(null)} onSave={(sn) => { patch(serialFor.key, { serials: sn, qty: sn.length }); setSerialFor(null); }} />}
      {heldOpen && (
        <Modal title="Held bills" onClose={() => setHeldOpen(false)}>
          {held.length === 0 && <div className="py-8 text-center text-sm text-slate-400">No bills on hold. Press F6 to hold the current bill.</div>}
          <div className="space-y-2">
            {held.map((h) => (
              <div key={h.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                <div className="min-w-0 flex-1"><div className="font-semibold">{h.party?.name ?? (h.walkName || "Walk-in")}</div><div className="text-xs text-slate-500">{h.lines.length} items · held at {h.at}</div></div>
                <button className="btn-primary px-3 py-1 text-xs" onClick={() => resume(h)}>Resume</button>
                <button className="text-slate-400 hover:text-rose-600" onClick={() => saveHeld(held.filter((x) => x.id !== h.id))}><IconTrash size={16} /></button>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between"><dt className="text-slate-500">{k}</dt><dd className="font-semibold">{v}</dd></div>;

function SerialPicker({ line, onClose, onSave }: { line: Line; onClose: () => void; onSave: (serials: string[]) => void }) {
  const [list, setList] = useState<Serial[]>([]);
  const [chosen, setChosen] = useState<string[]>(line.serials);
  const [q, setQ] = useState("");
  useEffect(() => {
    if (line.product) api.serialsAvailable(line.product.id).then(setList).catch(toast.fromError);
  }, [line.product]);
  const shown = list.filter((s) => s.serial_no.toLowerCase().includes(q.toLowerCase()));
  const toggle = (sn: string) => setChosen((c) => (c.includes(sn) ? c.filter((x) => x !== sn) : [...c, sn]));
  return (
    <Modal title={`Serial numbers – ${line.name}`} onClose={onClose}
      footer={<><span className="mr-auto text-sm text-slate-500">{chosen.length} selected</span><button className="btn-light" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!chosen.length} onClick={() => onSave(chosen)}>Use {chosen.length || ""} unit{chosen.length === 1 ? "" : "s"}</button></>}>
      <input className="input mb-3" autoFocus placeholder="Type or scan a serial / IMEI" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && shown.length === 1) { e.preventDefault(); toggle(shown[0].serial_no); setQ(""); } }} />
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {shown.length === 0 && <div className="py-6 text-center text-sm text-slate-400">No serial numbers in stock</div>}
        {shown.map((s) => (
          <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">
            <input type="checkbox" checked={chosen.includes(s.serial_no)} onChange={() => toggle(s.serial_no)} /> <span className="font-mono">{s.serial_no}</span>
          </label>
        ))}
      </div>
    </Modal>
  );
}

export function BillDone({ done, onNew }: { done: { id: number; bill_no: string; total: number }; onNew: () => void }) {
  async function run(kind: "print" | "pdf") {
    try {
      const r = kind === "print" ? await api.printBill(done.id) : await api.saveBillPdf(done.id);
      if (!r.ok && r.error) toast.error(r.error);
      else if (kind === "pdf") toast.ok("PDF saved in Documents\\Bills");
    } catch (e) {
      toast.fromError(e);
    }
  }
  return (
    <Modal title="Bill saved" onClose={onNew} footer={<button className="btn-primary" onClick={onNew}>New bill</button>}>
      <div className="space-y-4 text-center">
        <div className="text-sm text-slate-500">{done.bill_no}</div>
        <div className="text-4xl font-extrabold text-brand-700">{rupees(done.total)}</div>
        <div className="flex justify-center gap-2">
          <button className="btn-light" onClick={() => void run("print")}><IconPrinter size={16} /> Print</button>
          <button className="btn-light" onClick={() => void run("pdf")}><IconFileTypePdf size={16} /> Save PDF</button>
        </div>
      </div>
    </Modal>
  );
}
