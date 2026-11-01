import type { PaperSize, Sale, Settings } from "@shared/types";

const esc = (s: string | number) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** One printable bill for any paper size. Pure function of the bill and the shop settings. The invoice shows only the price the
 * buyer was charged, never the other tier's price. */
export function billHtml(sale: Sale, s: Settings, paper: PaperSize, balance?: number): string {
  const slip = paper === "80mm";
  const due = Math.max(0, sale.total - sale.paid);
  const gstRows = new Map<number, { taxable: number; gst: number }>();
  for (const i of sale.items) {
    const g = gstRows.get(i.gst_rate) ?? { taxable: 0, gst: 0 };
    g.taxable += i.taxable;
    g.gst += i.gst;
    gstRows.set(i.gst_rate, g);
  }
  const maxWarranty = Math.max(0, ...sale.items.map((i) => i.warranty_months));

  const rows = sale.items
    .map((i, n) => {
      const serial = i.serial_nos.length ? `<div class="sub">S/N: ${esc(i.serial_nos.join(", "))}</div>` : "";
      const warranty = i.warranty_months > 0 ? `<div class="sub">Warranty: ${i.warranty_months} month${i.warranty_months > 1 ? "s" : ""}</div>` : "";
      const disc = i.disc_pct > 0 ? `<div class="sub">Discount ${i.disc_pct}%</div>` : "";
      return slip
        ? `<tr><td colspan="3"><b>${esc(i.name)}</b>${serial}${warranty}</td></tr><tr><td>${i.qty} × ${money(i.unit_price)}</td><td></td><td class="r">${money(i.amount)}</td></tr>`
        : `<tr><td>${n + 1}</td><td><b>${esc(i.name)}</b>${serial}${warranty}${disc}</td><td>${esc(i.hsn)}</td><td class="r">${i.qty}</td><td class="r">${money(i.unit_price)}</td><td class="r">${i.gst_rate}%</td><td class="r">${money(i.amount)}</td></tr>`;
    })
    .join("");

  const gstTable = [...gstRows.entries()]
    .map(([rate, g]) =>
      sale.interstate
        ? `<tr><td>${rate}%</td><td class="r">${money(g.taxable)}</td><td class="r">IGST ${money(g.gst)}</td></tr>`
        : `<tr><td>${rate}%</td><td class="r">${money(g.taxable)}</td><td class="r">CGST ${money(g.gst / 2)} · SGST ${money(g.gst / 2)}</td></tr>`
    )
    .join("");

  const pageCss = slip
    ? "body{width:72mm;font:11px 'Courier New',monospace;margin:0 auto;padding:2mm}"
    : `body{font:12px 'Segoe UI',Arial,sans-serif;margin:0;padding:${paper === "A5" ? "8mm" : "12mm"}}`;
  const items = slip
    ? `<table class="items">${rows}</table>`
    : `<table class="items"><thead><tr><th>#</th><th>Item</th><th>HSN</th><th class="r">Qty</th><th class="r">Price</th><th class="r">GST</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>`;

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}${pageCss}
    h1{margin:0;font-size:${slip ? 15 : 20}px;text-align:${slip ? "center" : "left"}}
    .muted{color:#555}.r{text-align:right}.sub{font-size:${slip ? 9 : 10.5}px;color:#555}
    .head{display:flex;justify-content:space-between;gap:12px;border-bottom:2px solid #4338ca;padding-bottom:8px;margin-bottom:8px}
    .slip-head{text-align:center;border-bottom:1px dashed #000;padding-bottom:4px;margin-bottom:4px}
    .meta{display:flex;justify-content:space-between;gap:12px;margin:8px 0}
    table{width:100%;border-collapse:collapse}
    .items th{background:#eef2ff;text-align:left;padding:5px 6px;font-size:10.5px;text-transform:uppercase;border-bottom:1px solid #c7d2fe}
    .items td{padding:5px 6px;border-bottom:1px solid #e5e7eb;vertical-align:top}
    .tot td{padding:3px 6px}.grand td{font-size:${slip ? 13 : 16}px;font-weight:700;border-top:2px solid #4338ca;padding-top:6px}
    .gst{margin-top:8px;font-size:10.5px}.gst td,.gst th{padding:2px 6px;border-bottom:1px solid #eee;text-align:left}.gst .r{text-align:right}
    .foot{margin-top:14px;font-size:10.5px;color:#444}.sign{display:flex;justify-content:space-between;margin-top:34px}
    .badge{display:inline-block;border:1px solid #4338ca;color:#4338ca;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:700;text-transform:uppercase}
  </style></head><body>
    ${
      slip
        ? `<div class="slip-head"><h1>${esc(s.shop_name)}</h1><div>${esc(s.address)}</div><div>${esc(s.phone)}${s.gstin ? " · GSTIN " + esc(s.gstin) : ""}</div></div>`
        : `<div class="head"><div><h1>${esc(s.shop_name)}</h1><div class="muted">${esc(s.address)}</div><div class="muted">${esc(s.phone)}${s.gstin ? " · GSTIN " + esc(s.gstin) : ""}</div></div>
           <div class="r"><h1 style="text-align:right">TAX INVOICE</h1><div><b>${esc(sale.bill_no)}</b></div><div class="muted">${esc(sale.bill_date.slice(0, 16))}</div></div></div>`
    }
    <div class="meta"><div>${slip ? `<b>${esc(sale.bill_no)}</b> · ${esc(sale.bill_date.slice(0, 16))}<br>` : ""}<b>${esc(sale.customer_name)}</b>${sale.tier === "technician" ? ` <span class="badge">Technician</span>` : ""}
      ${sale.customer_phone ? `<br>${esc(sale.customer_phone)}` : ""}${sale.customer_address ? `<br>${esc(sale.customer_address)}` : ""}${sale.customer_gstin ? `<br>GSTIN ${esc(sale.customer_gstin)}` : ""}</div>
      ${slip ? "" : `<div class="r muted">Served by ${esc(sale.user_name)}<br>Payment: ${esc(sale.payment_mode)}</div>`}</div>
    ${items}
    <table class="tot" style="margin-top:6px;width:${slip ? "100%" : "50%"};margin-left:auto">
      <tr><td>Taxable value</td><td class="r">${money(sale.taxable)}</td></tr>
      ${sale.interstate ? `<tr><td>IGST</td><td class="r">${money(sale.igst)}</td></tr>` : `<tr><td>CGST</td><td class="r">${money(sale.cgst)}</td></tr><tr><td>SGST</td><td class="r">${money(sale.sgst)}</td></tr>`}
      ${sale.bill_flat > 0 ? `<tr><td>Discount</td><td class="r">- ${money(sale.bill_flat)}</td></tr>` : ""}
      ${sale.round_off !== 0 ? `<tr><td>Round off</td><td class="r">${money(sale.round_off)}</td></tr>` : ""}
      <tr class="grand"><td>Total</td><td class="r">₹${money(sale.total)}</td></tr>
      <tr><td>Paid</td><td class="r">${money(sale.paid)}</td></tr>
      ${due > 0 ? `<tr><td><b>Balance due</b></td><td class="r"><b>${money(due)}</b></td></tr>` : ""}
      ${balance != null && balance > 0 ? `<tr><td>Total owed on account</td><td class="r">${money(balance)}</td></tr>` : ""}
    </table>
    <table class="gst"><tr><th>GST</th><th class="r">Taxable</th><th>Tax</th></tr>${gstTable}</table>
    <div class="foot">${maxWarranty > 0 ? `<div>${esc(s.warranty_note)}</div>` : ""}<div>${esc(s.terms)}</div></div>
    ${slip ? `<div class="slip-head" style="border:0;margin-top:6px">Thank you! Visit again.</div>` : `<div class="sign"><div>Customer signature</div><div>For ${esc(s.shop_name)}</div></div>`}
  </body></html>`;
}
