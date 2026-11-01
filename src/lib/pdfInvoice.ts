/** Reads a supplier's invoice from a PDF made by billing software (its text). The words come with their positions; they are
 * grouped into lines and cells, the header row (Product / Qty / Rate / GST ...) is found, and every line under it becomes a row
 * of that table. The table then goes through the same checks as a CSV (electron/purchaseImport.ts). A scanned PDF or a photo has
 * no text to read, so for those the screen asks for the CSV instead. */

export interface PdfInvoice {
  table: string[][]; // header row first
  invoiceNo: string;
  invoiceDate: string; // YYYY-MM-DD or ""
  gstins: string[];
}

type Cell = { text: string; x0: number; x1: number };
type Line = { y: number; cells: Cell[] };
type Item = { s: string; x: number; y: number; w: number }; // y grows upward, as in a PDF

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%]/g, "");

/** What a header cell stands for, by the words invoices really use. */
function headerField(text: string): string {
  const k = norm(text);
  if (!k) return "";
  if (/^(qty|quantity|billedqty|pqty|qnty|pcs|nos|units)$/.test(k)) return "qty";
  if (/^(rate|unitrate|unitprice|price|purchaserate|netrate|basicrate|cost)$/.test(k)) return "rate";
  if (/^(gst|gst%|gstrate|igst%|tax|tax%)$/.test(k)) return "gst";
  if (/^(hsn|hsncode|hsnsac)$/.test(k)) return "hsn";
  if (/^(sku|code|itemcode|partno|modelno)$/.test(k)) return "sku";
  if (/^(serial|serialno|serialnumber|imei|imeino)$/.test(k)) return "serial";
  if (/(product|item|description|particulars|nameof|goods)/.test(k) || k === "name" || k === "model") return "name";
  return "other";
}

async function loadPdfjs() {
  // The worker runs in this window: a module worker cannot start from a file:// page, so hand pdf.js its worker code directly.
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs");
  (globalThis as unknown as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
  return import("pdfjs-dist");
}

/** Words that sit within this gap (times the text size) are one cell; a wider gap starts the next column. */
const GAP = 5;
const SAME_LINE = 3;

function toLines(items: Item[]): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: { y: number; items: Item[] }[] = [];
  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= SAME_LINE);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) => {
      const cells: Cell[] = [];
      for (const it of r.items.sort((a, b) => a.x - b.x)) {
        const last = cells[cells.length - 1];
        if (last && it.x - last.x1 < GAP) {
          last.text += (it.x - last.x1 > 0.5 ? " " : "") + it.s.trim();
          last.x1 = it.x + it.w;
        } else cells.push({ text: it.s.trim(), x0: it.x, x1: it.x + it.w });
      }
      return { y: r.y, cells };
    });
}

const isNumeric = (t: string) => /^[\d.,%/+-]+$/.test(t.trim());
const FOOTER = /^(sub\s*total|grand\s*total|total\b|amount in words|rupees|terms|bank|e\.?\s?&\s?o\.?\s?e|authori[sz]ed|declaration|for\s)|gross amount|net payable/i;

function parseLines(pages: Line[][]): PdfInvoice {
  const all = pages.flat();
  const pad = 5;

  // the header row: the first line that names a product column and a quantity
  let headIdx = -1;
  let head: Line | null = null;
  for (let i = 0; i < all.length; i++) {
    const f = new Set(all[i].cells.map((c) => headerField(c.text)));
    if (f.has("name") && f.has("qty") && (f.has("rate") || f.has("gst"))) {
      headIdx = i;
      head = all[i];
      break;
    }
  }
  if (!head) throw new Error("Couldn't find the product table in this PDF (it needs columns like Product, Qty, Rate, GST). Try importing the invoice as a CSV instead.");

  // a header split over two lines ("Unit" / "Rate"): add the second line's words to the cells above them
  const heads = head.cells.map((c) => ({ ...c }));
  const second = all[headIdx + 1];
  let first = headIdx + 1;
  if (second && second.cells.every((c) => !/\d/.test(c.text) && heads.some((h) => c.x0 < h.x1 + pad && c.x1 > h.x0 - pad))) {
    for (const c of second.cells) {
      const h = heads.find((x) => c.x0 < x.x1 + pad && c.x1 > x.x0 - pad);
      if (h) {
        h.text += ` ${c.text}`;
        h.x0 = Math.min(h.x0, c.x0);
        h.x1 = Math.max(h.x1, c.x1);
      }
    }
    first = headIdx + 2;
  }

  /** The header column a body cell belongs to: the header it overlaps most (headers are often centred over left-aligned data). */
  const overlap = (c: Cell, h: Cell) => Math.min(c.x1, h.x1) - Math.max(c.x0, h.x0);
  const columnOf = (c: Cell): number => {
    let best = -1;
    let most = 0;
    heads.forEach((h, i) => {
      const o = overlap(c, h);
      if (o > most) {
        best = i;
        most = o;
      }
    });
    if (best >= 0) return best;
    const centre = (c.x0 + c.x1) / 2;
    return heads.reduce((nearest, h, i) => (Math.abs((h.x0 + h.x1) / 2 - centre) < Math.abs((heads[nearest].x0 + heads[nearest].x1) / 2 - centre) ? i : nearest), 0);
  };

  const nameCol = heads.findIndex((h) => headerField(h.text) === "name");
  const qtyCol = heads.findIndex((h) => headerField(h.text) === "qty");
  const header = heads.map((h) => h.text);
  const body: string[][] = [];
  for (let i = first; i < all.length; i++) {
    const line = all[i];
    const text = line.cells.map((c) => c.text).join(" ").trim();
    const f = new Set(line.cells.map((c) => headerField(c.text)));
    if (f.has("name") && f.has("qty") && (f.has("rate") || f.has("gst"))) continue; // the header repeated on the next page
    if (body.length && FOOTER.test(text)) break;
    const row: string[] = heads.map(() => "");
    for (const c of line.cells) {
      const col = columnOf(c);
      row[col] = row[col] ? `${row[col]} ${c.text}` : c.text;
    }
    const filled = row.filter(Boolean).length;
    if (filled === 0) continue;
    // a product name that wrapped onto a second line belongs to the row above
    if (body.length && filled === 1 && row[nameCol] && !isNumeric(row[nameCol])) {
      body[body.length - 1][nameCol] += ` ${row[nameCol]}`;
      continue;
    }
    if (filled < 3) continue; // a stray line (address, page number ...)
    if (!/\d/.test(row[qtyCol] ?? "")) continue; // a product line always has a quantity; totals, GST tables and notes do not
    body.push(row);
  }
  if (!body.length) throw new Error("Found the table's header but no product lines under it. Try importing the invoice as a CSV instead.");

  // invoice number, date and the GSTINs printed on the invoice, to fill in the purchase form
  const text = all.map((l) => l.cells.map((c) => c.text).join(" ")).join("\n");
  const no = text.match(/(?:invoice|inv|bill)\s*(?:no|number|#)\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9/-]{2,})/i)?.[1] ?? "";
  const d = text.match(/(?:invoice\s*date|inv\.?\s*date|bill\s*date|date)\s*[:\-]?\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/i);
  const year = d ? (d[3].length === 2 ? 2000 + Number(d[3]) : Number(d[3])) : 0;
  const date = d && Number(d[2]) >= 1 && Number(d[2]) <= 12 && Number(d[1]) >= 1 && Number(d[1]) <= 31 ? `${year}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}` : "";
  const gstins = [...new Set(text.toUpperCase().match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g) ?? [])];
  return { table: [header, ...body], invoiceNo: no, invoiceDate: date, gstins };
}

/** Reads the invoice in a PDF file. `progress` gets short status text while it is being read. */
export async function readInvoicePdf(data: Uint8Array, progress?: (text: string) => void): Promise<PdfInvoice> {
  progress?.("Reading the PDF…");
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: data.slice(), useSystemFonts: true, isEvalSupported: false }).promise;
  const pages: Line[][] = [];
  let textItems = 0;
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const content = await (await doc.getPage(p)).getTextContent();
      const items: Item[] = content.items.flatMap((it) => ("str" in it && it.str.trim() ? [{ s: it.str, x: it.transform[4] as number, y: it.transform[5] as number, w: it.width as number }] : []));
      textItems += items.length;
      pages.push(toLines(items));
    }
  } finally {
    await doc.destroy();
  }
  if (textItems < 20) throw new Error("This PDF has no readable text (it looks like a scan or a photo). Ask the supplier for a normal PDF, or import the invoice as a CSV.");
  return parseLines(pages);
}
