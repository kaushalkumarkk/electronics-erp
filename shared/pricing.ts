import type { PartyPrice, PriceTier } from "./types";

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The price one product sells at for a buyer: an agreed rate for that saved party wins, otherwise the price of the
 * chosen tier. A product with no technician price yet falls back to the customer price, so a bill is never priced at 0. */
export function resolvePrice(p: { customer_price: number; technician_price: number }, tier: PriceTier, agreed?: number | null): PartyPrice {
  if (agreed != null && agreed > 0) return { price: agreed, source: "agreed" };
  if (tier === "technician" && p.technician_price > 0) return { price: p.technician_price, source: "technician" };
  return { price: p.customer_price, source: "customer" };
}

export interface CalcLine {
  unit_price: number;
  qty: number;
  disc_pct: number;
  gst_rate: number;
}
export interface CalcResult {
  amount: number;
  taxable: number;
  gst: number;
}

/** Prices include GST, so GST is taken out of the discounted amount, never added on top. */
export function lineCalc(l: CalcLine, flatShare = 0): CalcResult {
  const amount = Math.max(0, r2(l.unit_price * l.qty * (1 - l.disc_pct / 100) - flatShare));
  const taxable = r2(amount / (1 + l.gst_rate / 100));
  return { amount, taxable, gst: r2(amount - taxable) };
}

export interface BillTotals {
  lines: CalcResult[];
  taxable: number;
  gst: number;
  cgst: number;
  sgst: number;
  igst: number;
  subtotal: number;
  total: number;
  round_off: number;
}

/** The whole bill: each line, the bill-level flat discount shared out pro-rata, GST split, and the nearest-rupee total. */
export function billTotals(lines: CalcLine[], billFlat: number, interstate: boolean): BillTotals {
  const gross = lines.map((l) => lineCalc(l));
  const sum = gross.reduce((s, g) => s + g.amount, 0);
  const flat = Math.min(Math.max(0, billFlat), sum);
  let left = flat;
  const out = lines.map((l, i) => {
    const share = i === lines.length - 1 ? left : sum > 0 ? r2((flat * gross[i].amount) / sum) : 0;
    left = r2(left - share);
    return lineCalc(l, share);
  });
  const taxable = r2(out.reduce((s, o) => s + o.taxable, 0));
  const gst = r2(out.reduce((s, o) => s + o.gst, 0));
  const subtotal = r2(out.reduce((s, o) => s + o.amount, 0));
  const total = Math.round(subtotal);
  return {
    lines: out,
    taxable,
    gst,
    cgst: interstate ? 0 : r2(gst / 2),
    sgst: interstate ? 0 : r2(gst - r2(gst / 2)),
    igst: interstate ? gst : 0,
    subtotal,
    total,
    round_off: r2(total - subtotal),
  };
}

export const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
