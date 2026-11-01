import type { PaperSize, Sale, Settings } from "@shared/types";
import { r2 } from "./util";

/** The two looks a printed bill can have, the same as the medical app's:
 *  - `receiptHtml`: the 80 mm till slip (typewriter font, centred shop name, dashed rules, Qty / Price / Amount / Tax columns,
 *    a tax table, a footer);
 *  - `invoiceHtml`: the clean paper bill for A4 / A5 (heading with the number, a details grid, a ruled table, a GST table,
 *    signature lines), with a green heading rule and total.
 * Both are plain functions of the bill and the shop's settings (no database), so they print the same everywhere.
 * The bill shows only the price the buyer was charged, never the other price tier. */

const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
const two = (n: number) => n.toFixed(2);
const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "2026-10-17 14:25:00" -> dd.mm.yyyy and hh:mm, the way a till slip prints them. */
const slipDate = (d: string) => ({ date: `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`, time: d.slice(11, 16) });

const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const twoDigits = (n: number) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : ""));

/** 1787 -> "one thousand seven hundred eighty-seven" (Indian grouping: crore, lakh, thousand). */
function wholeInWords(n: number): string {
  if (n === 0) return "zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const hundred = Math.floor((n % 1000) / 100);
  const rest = n % 100;
  if (crore) parts.push(`${twoDigits(crore)} crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} thousand`);
  if (hundred) parts.push(`${ONES[hundred]} hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(" ");
}
export const rupeesInWords = (amount: number) => `${wholeInWords(Math.round(Math.abs(amount)))} Rupees only`;

const credit = (sale: Sale) => sale.total - sale.paid > 0.004;
/** The bill's kind, which becomes its heading. */
const heading = (sale: Sale) => (credit(sale) ? "Credit Bill" : sale.customer_gstin ? "Tax Invoice" : "Cash Bill");

/** The GST in the bill, by rate: what was charged, and the tax inside it (CGST + SGST, or IGST for another state). */
function taxByRate(sale: Sale) {
  const m = new Map<number, { gross: number; taxable: number; gst: number }>();
  for (const i of sale.items) {
    const t = m.get(i.gst_rate) ?? { gross: 0, taxable: 0, gst: 0 };
    t.gross += i.amount;
    t.taxable += i.taxable;
    t.gst += i.gst;
    m.set(i.gst_rate, t);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([rate, t]) => ({ rate, gross: r2(t.gross), taxable: r2(t.taxable), gst: r2(t.gst) }));
}

const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
/** What the lines would cost at the prices charged, before any discount. */
const grossOf = (sale: Sale) => r2(sale.items.reduce((t, i) => t + i.unit_price * i.qty, 0));

/* ---------------------------------------------------------------- 80 mm till slip */

const THERMAL_CSS = `
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body { width: 80mm; margin: 0; padding: 4mm 3.5mm 6mm; font-family: "Lucida Console", "Courier New", Courier, monospace; font-weight: 400; font-size: 11px; line-height: 1.35; color: #000; }
  .c { text-align: center; }
  .b { font-weight: 700; }
  .brand { font-size: 19px; font-weight: 700; letter-spacing: 1px; margin-bottom: 1mm; }
  .dash { border: none; border-top: 1px dashed #000; margin: 2mm 0; }
  .row { display: flex; justify-content: space-between; gap: 2mm; }
  .cols, .item { display: grid; grid-template-columns: 1.1fr 1fr 1fr 0.5fr; text-align: right; }
  .cols span:first-child, .item span:first-child { text-align: left; }
  .cols { font-weight: 700; margin: 0 0 1.5mm; }
  .item { margin-top: 2mm; }
  .tax { display: grid; grid-template-columns: 0.5fr 1fr 0.8fr 1fr 0.9fr; text-align: right; }
  .tax span:first-child, .tax span:nth-child(2) { text-align: left; }
  .total { font-size: 14px; font-weight: 700; }
`;
const dash = () => `<hr class="dash" />`;
const row = (left: string, right: string, cls = "") => `<div class="row ${cls}"><span>${left}</span><span>${right}</span></div>`;
const centred = (list: string[]) => list.filter(Boolean).map((l) => `<div class="c">${esc(l)}</div>`).join("");

/** The 80 mm roll bill. `balance` is what a credit customer owes now. */
export function receiptHtml(sale: Sale, s: Settings, balance?: number): string {
  const { date, time } = slipDate(sale.bill_date);
  const rates = taxByRate(sale);
  const codeOf = (rate: number) => String(rates.findIndex((r) => r.rate === rate) + 1).padStart(2, "0");
  const gross = grossOf(sale);
  const discount = r2(gross - sale.items.reduce((t, i) => t + i.amount, 0));
  const flat = sale.bill_flat;

  const itemRows = sale.items
    .map(
      (i) => `
    <div class="item"><span>${i.qty}x</span><span>${two(i.unit_price)}</span><span>${two(i.amount)}</span><span>${codeOf(i.gst_rate)}</span></div>
    <div>${esc(i.name)}${i.disc_pct ? ` (DISC ${i.disc_pct}%)` : ""}</div>
    ${i.serial_nos.length ? `<div>S/N: ${esc(i.serial_nos.join(", "))}</div>` : ""}
    ${i.warranty_months ? `<div>WARRANTY: ${i.warranty_months} MONTH${i.warranty_months > 1 ? "S" : ""}</div>` : ""}
    ${i.hsn ? `<div>HSN CODE : ${esc(i.hsn)}</div>` : ""}`
    )
    .join("");

  const taxRows = rates
    .map((r) => {
      const code = codeOf(r.rate);
      return sale.interstate
        ? `<div class="tax"><span>${code}</span><span>IGST</span><span>${r.rate.toFixed(2)} %</span><span>${two(r.gross)}</span><span>${two(r.gst)}</span></div>`
        : `<div class="tax"><span>${code}</span><span>CGST</span><span>${(r.rate / 2).toFixed(2)} %</span><span>${two(r.gross)}</span><span>${two(r.gst / 2)}</span></div>
      <div class="tax"><span>${code}</span><span>SGST</span><span>${(r.rate / 2).toFixed(2)} %</span><span>${two(r.gross)}</span><span>${two(r.gst / 2)}</span></div>`;
    })
    .join("");

  const footer = lines(s.terms);
  const body = `
  <div class="c brand">${esc(s.shop_name)}</div>
  ${centred([s.address, s.phone ? `Ph: ${s.phone}` : ""])}
  <div class="c">${heading(sale)}</div>
  ${dash()}
  <div class="cols"><span>Qty</span><span>Price</span><span>Amount</span><span>Tax</span></div>
  ${sale.customer_name || sale.customer_phone ? `<div>${sale.customer_gstin ? "Bill to" : "Customer"} : ${esc([sale.customer_name, sale.customer_phone].filter(Boolean).join(" - "))}</div>` : ""}
  ${sale.customer_address ? `<div>${esc(sale.customer_address)}</div>` : ""}
  ${sale.customer_gstin ? `<div>GSTIN : ${esc(sale.customer_gstin)}</div>` : ""}
  ${itemRows}
  ${dash()}
  ${row("Total", two(gross))}
  ${discount + flat > 0.004 ? row("Less: discount", `-${two(discount + flat)}`) : ""}
  ${Math.abs(sale.round_off) > 0.004 ? row("Round off", `${sale.round_off < 0 ? "-" : "+"}${two(Math.abs(sale.round_off))}`) : ""}
  ${row("Net amount", two(sale.total), "total")}
  ${row("Items :", String(sale.items.length))}
  ${row("Paid", `${two(sale.paid)} (${esc(sale.payment_mode.toUpperCase())})`)}
  ${credit(sale) ? `${row("ON ACCOUNT", `INR ${two(sale.total - sale.paid)}`)}${balance !== undefined ? row("BALANCE DUE NOW", `INR ${two(balance)}`) : ""}` : ""}
  ${dash()}
  <div>Tax inclusive:</div>
  ${dash()}
  <div class="tax b"><span>Tax</span><span>TaxCode</span><span>Tax%</span><span>Incl.Tax</span><span>TaxValue</span></div>
  ${taxRows}
  ${dash()}
  ${sale.user_name ? `<div class="c">Served by: ${esc(sale.user_name.toUpperCase())}</div>${dash()}` : ""}
  <div class="row"><span>Date</span><span>Time</span><span>Invoice No.</span></div>
  <div class="row"><span>${date}</span><span>${time}</span><span>${esc(sale.bill_no)}</span></div>
  ${dash()}
  ${centred([s.gstin ? `GSTIN :- ${s.gstin}` : ""])}
  ${sale.items.some((i) => i.warranty_months > 0) ? centred(lines(s.warranty_note)) : ""}
  ${footer.length ? centred(footer) : '<div class="c">Keep bill for Exchange / Return</div>'}`;
  return `<!doctype html><html><head><meta charset="utf-8" /><style>${THERMAL_CSS}</style></head><body>${body}</body></html>`;
}

/* ---------------------------------------------------------------- A5 / A4 sheet */

/** The paper bill for A5 or A4: uppercase heading, big number, a details grid, a ruled table, signature lines, with a green
 * heading rule and total. */
export function invoiceHtml(sale: Sale, s: Settings, size: "A4" | "A5", balance?: number): string {
  const a4 = size === "A4";
  const rates = taxByRate(sale);
  const gross = grossOf(sale);
  const discount = r2(gross - sale.items.reduce((t, i) => t + i.amount, 0) + sale.bill_flat);
  const { date, time } = slipDate(sale.bill_date);
  const footer = lines(s.terms);
  const warranty = sale.items.some((i) => i.warranty_months > 0);
  const meta: [string, string][] = [
    [sale.customer_gstin ? "Bill to" : "Customer", [sale.customer_name, sale.customer_phone && `(${sale.customer_phone})`].filter(Boolean).join(" ")],
    ["Price", sale.tier === "technician" ? "Technician" : ""],
    ...(sale.customer_address ? ([["Address", sale.customer_address]] as [string, string][]) : []),
    ...(sale.customer_gstin ? ([["GSTIN", sale.customer_gstin]] as [string, string][]) : []),
    ["Date", `${date} ${time}`],
    ["Payment", sale.payment_mode.toUpperCase()],
    ["Billed by", sale.user_name],
  ];

  const itemRows = sale.items
    .map(
      (i, n) => `<tr>
      <td>${n + 1}</td>
      <td class="l"><b>${esc(i.name)}</b><div class="sub">${esc([i.hsn && `HSN ${i.hsn}`, i.warranty_months > 0 && `Warranty ${i.warranty_months} month${i.warranty_months > 1 ? "s" : ""}`].filter(Boolean).join(" · "))}</div>${i.serial_nos.length ? `<div class="sub">S/N: ${esc(i.serial_nos.join(", "))}</div>` : ""}</td>
      <td>${i.qty}</td><td class="r">${money(i.unit_price)}</td><td>${i.disc_pct ? `${i.disc_pct}%` : ""}</td><td>${i.gst_rate}%</td><td class="r"><b>${money(i.amount)}</b></td></tr>`
    )
    .join("");

  const taxRows = rates
    .map((r) =>
      sale.interstate
        ? `<tr><td>${r.rate}%</td><td class="r">${money(r.taxable)}</td><td class="r">${money(r.gst)}</td><td class="r">—</td><td class="r">—</td><td class="r">${money(r.gst)}</td></tr>`
        : `<tr><td>${r.rate}%</td><td class="r">${money(r.taxable)}</td><td class="r">—</td><td class="r">${money(r.gst / 2)}</td><td class="r">${money(r.gst / 2)}</td><td class="r">${money(r.gst)}</td></tr>`
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${size}; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, "Segoe UI", Roboto, Arial, sans-serif; color: #0f172a; font-size: ${a4 ? 12 : 10.5}px; line-height: 1.4; }
    .page { width: ${a4 ? "210mm" : "148mm"}; min-height: ${a4 ? "297mm" : "210mm"}; padding: ${a4 ? "12mm" : "8mm"}; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10mm; border-top: 4px solid #10b981; border-bottom: 2px solid #0f172a; padding: 4mm 0 3mm; }
    .shop { font-size: ${a4 ? 22 : 17}px; font-weight: 800; letter-spacing: .3px; }
    .muted { color: #64748b; }
    .kind { text-align: right; }
    .kind .t { font-size: ${a4 ? 11 : 9.5}px; font-weight: 800; letter-spacing: .18em; text-transform: uppercase; color: #10b981; }
    .kind .n { font-size: ${a4 ? 24 : 18}px; font-weight: 800; }
    dl { display: grid; grid-template-columns: 1fr 1fr; gap: 1mm 8mm; margin: 4mm 0; }
    dl div { display: flex; gap: 3mm; }
    dt { width: 18mm; flex-shrink: 0; color: #64748b; }
    dd { margin: 0; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; }
    .items th { background: #f1f5f9; border-top: 1px solid #0f172a; border-bottom: 1px solid #0f172a; padding: 1.6mm 1.5mm; font-size: ${a4 ? 10.5 : 9}px; text-align: center; }
    .items td { border-bottom: 1px solid #e2e8f0; padding: 1.6mm 1.5mm; text-align: center; vertical-align: top; }
    .items .l, .items th.l { text-align: left; } .items .r, .items th.r { text-align: right; }
    .sub { color: #64748b; font-size: ${a4 ? 10 : 8.5}px; }
    tr { break-inside: avoid; }
    .bottom { display: flex; justify-content: space-between; align-items: flex-start; gap: 8mm; margin-top: 4mm; }
    .gst { width: ${a4 ? "98mm" : "70mm"}; font-size: ${a4 ? 10.5 : 9}px; }
    .gst th { background: #f1f5f9; border-bottom: 1px solid #0f172a; padding: 1.2mm 1.5mm; text-align: right; } .gst th:first-child { text-align: left; }
    .gst td { border-bottom: 1px solid #e2e8f0; padding: 1.2mm 1.5mm; } .gst td:first-child { text-align: left; } .gst .r { text-align: right; }
    .sum { width: ${a4 ? "72mm" : "58mm"}; }
    .sum .r { display: flex; justify-content: space-between; padding: .7mm 0; }
    .total { margin-top: 2mm; display: flex; justify-content: space-between; align-items: baseline; border: 1.5px solid #10b981; background: #f0fdf7; border-radius: 2mm; padding: 2mm 3mm; font-weight: 800; }
    .total .v { font-size: ${a4 ? 20 : 16}px; }
    .words { margin-top: 3mm; font-weight: 600; text-transform: capitalize; }
    .acct { margin-top: 2mm; border: 1px dashed #0f172a; border-radius: 2mm; padding: 1.5mm 3mm; font-weight: 700; }
    .terms { margin-top: 5mm; font-size: ${a4 ? 10.5 : 9}px; color: #475569; }
    .sign { margin-top: ${a4 ? "22mm" : "14mm"}; display: grid; grid-template-columns: 1fr 1fr; gap: 14mm; }
    .sign div { border-top: 1px solid #0f172a; padding-top: 1mm; text-align: center; font-weight: 600; }
  </style></head><body><div class="page">
    <div class="head">
      <div>
        <div class="shop">${esc(s.shop_name)}</div>
        <div class="muted">${esc([s.address, s.phone && `Ph: ${s.phone}`].filter(Boolean).join(" · "))}</div>
        <div class="muted">${esc(s.gstin ? `GSTIN: ${s.gstin}` : "")}</div>
      </div>
      <div class="kind"><div class="t">${heading(sale)}</div><div class="n">${esc(sale.bill_no)}</div><div class="muted">${date} ${time}</div></div>
    </div>
    <dl>${meta.filter(([, v]) => v).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
    <table class="items">
      <thead><tr><th>#</th><th class="l">Item</th><th>Qty</th><th class="r">Price</th><th>Disc</th><th>GST</th><th class="r">Amount</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <div class="bottom">
      <table class="gst">
        <thead><tr><th>GST %</th><th>Taxable</th><th>IGST</th><th>CGST</th><th>SGST</th><th>Tax</th></tr></thead>
        <tbody>${taxRows}</tbody>
      </table>
      <div class="sum">
        <div class="r"><span class="muted">Total</span><span>${money(gross)}</span></div>
        ${discount > 0.004 ? `<div class="r"><span class="muted">Discount</span><span>-${money(discount)}</span></div>` : ""}
        <div class="r"><span class="muted">GST included</span><span>${money(sale.cgst + sale.sgst + sale.igst)}</span></div>
        ${Math.abs(sale.round_off) > 0.004 ? `<div class="r"><span class="muted">Round off</span><span>${sale.round_off < 0 ? "-" : "+"}${money(Math.abs(sale.round_off))}</span></div>` : ""}
        <div class="total"><span>TOTAL</span><span class="v">₹${money(sale.total)}</span></div>
        <div class="r"><span class="muted">Paid</span><span>${money(sale.paid)}</span></div>
      </div>
    </div>
    <div class="words">${esc(rupeesInWords(sale.total))}</div>
    ${credit(sale) ? `<div class="acct">ON ACCOUNT (CREDIT) ₹${money(sale.total - sale.paid)}${balance !== undefined ? ` · balance due now ₹${money(balance)}` : ""}</div>` : ""}
    <div class="terms">${warranty ? `${esc(s.warranty_note)}<br>` : ""}${footer.length ? footer.map(esc).join("<br>") : "Keep the bill for exchange / return. E. &amp; O.E."}</div>
    <div class="sign"><div>Customer's signature</div><div>For ${esc(s.shop_name)}</div></div>
  </div></body></html>`;
}

/** The right layout for the paper size chosen in Settings. */
export function billHtml(sale: Sale, s: Settings, paper: PaperSize, balance?: number): string {
  return paper === "80mm" ? receiptHtml(sale, s, balance) : invoiceHtml(sale, s, paper, balance);
}
