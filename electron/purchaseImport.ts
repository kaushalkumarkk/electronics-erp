import fs from "node:fs";
import path from "node:path";
import type { PurchaseImportResult, PurchaseImportRow } from "@shared/types";
import { getDb } from "./db";
import electron from "./electronRequire";
import { UserError, r2 } from "./util";

const { dialog } = electron;

/* ---------------- reading the file ---------------- */

/** CSV as saved by Excel or a supplier's software: comma or semicolon, quoted cells, BOM. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell.trim());
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ""));
}

const key = (h: string) => h.toLowerCase().replace(/[^a-z0-9%]/g, "");

/** Column names suppliers and shops actually use, mapped to our fields. */
const ALIASES: Record<string, string[]> = {
  name: ["name", "product", "productname", "item", "itemname", "description", "particulars", "productdescription", "itemdescription", "descriptionofgoods", "goodsdescription", "nameofproduct", "nameofitem", "productdetails", "model"],
  sku: ["sku", "code", "itemcode", "productcode", "partno", "partnumber", "modelno"],
  barcode: ["barcode", "ean", "upc"],
  qty: ["qty", "quantity", "pcs", "nos", "units", "purchaseqty", "billedqty", "qnty", "noofpcs"],
  rate: ["rate", "purchaserate", "costprice", "cost", "unitrate", "unitprice", "price", "netrate", "rateexgst", "basicrate", "purchaseprice"],
  gst: ["gst", "gst%", "gstrate", "tax", "tax%", "taxrate", "igst%"],
  customer_price: ["customerprice", "sellingprice", "saleprice", "mrp", "retailprice", "sp"],
  technician_price: ["technicianprice", "techprice", "dealerprice", "tradeprice", "wholesaleprice", "wsp"],
  serials: ["serial", "serials", "serialno", "serialnos", "serialnumber", "serialnumbers", "imei", "imeino", "imeinumber"],
  hsn: ["hsn", "hsncode"],
  brand: ["brand", "make", "manufacturer", "mfr", "company"],
  category: ["category", "type", "group"],
};

function columnMap(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  header.forEach((h, i) => {
    const k = key(h);
    for (const [field, names] of Object.entries(ALIASES)) {
      if (map[field] === undefined && names.map(key).includes(k)) map[field] = i;
    }
  });
  return map;
}

const num = (v: string | undefined) => {
  const n = Number(String(v ?? "").replace(/[₹,\s%]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Serial / IMEI numbers typed in one cell: separated by space, comma, semicolon, slash or a new line. */
const splitSerials = (raw: string) => [...new Set(raw.split(/[\s,;|/]+/).map((s) => s.trim()).filter(Boolean))];

type Lite = { id: number; name: string; sku: string; barcode: string; gst_rate: number; track_serial: number; customer_price: number; technician_price: number };

/** The rows of a purchase file, each matched to a product (by barcode, SKU, then exact name) and checked. */
export function importFromTable(table: string[][], fileName: string): PurchaseImportResult {
  const [header, ...body] = table;
  if (!header || body.length === 0) return { ok: false, rows: [], fileName, error: "The file is empty" };
  const col = columnMap(header);
  if (col.name === undefined && col.sku === undefined && col.barcode === undefined) {
    return { ok: false, rows: [], fileName, error: "Could not find a Product / Name column. Use the template (Download template) for the right column names." };
  }
  if (col.qty === undefined) return { ok: false, rows: [], fileName, error: "Could not find a Qty column. Use the template for the right column names." };

  const list = getDb().prepare("select id, name, sku, barcode, gst_rate, track_serial, customer_price, technician_price from products").all() as Lite[];
  const byBarcode = new Map(list.filter((p) => p.barcode).map((p) => [p.barcode, p]));
  const bySku = new Map(list.filter((p) => p.sku).map((p) => [p.sku.toUpperCase(), p]));
  const byName = new Map(list.map((p) => [p.name.trim().toLowerCase(), p]));
  const cell = (r: string[], f: string) => (col[f] === undefined ? "" : (r[col[f]] ?? "").trim());

  const rows: PurchaseImportRow[] = body.map((r, i) => {
    const name = cell(r, "name");
    const sku = cell(r, "sku");
    const barcode = cell(r, "barcode");
    const hit = (barcode && byBarcode.get(barcode)) || (sku && bySku.get(sku.toUpperCase())) || (name && byName.get(name.toLowerCase())) || null;
    const qty = Math.floor(num(cell(r, "qty")));
    const rate = r2(num(cell(r, "rate")));
    const gst = cell(r, "gst") ? num(cell(r, "gst")) : hit?.gst_rate ?? 18;
    const serials = splitSerials(cell(r, "serials"));
    const customer = r2(num(cell(r, "customer_price"))) || hit?.customer_price || 0;
    const issues: string[] = [];
    if (!name && !hit) issues.push("No product name");
    if (!(qty > 0)) issues.push("Quantity is missing");
    if (!(rate > 0)) issues.push("Purchase rate is missing");
    if (hit?.track_serial && serials.length !== qty) issues.push(`Needs ${qty} serial number(s), found ${serials.length}`);
    return {
      line: i + 2,
      name: hit?.name ?? name,
      sku: hit?.sku ?? sku,
      barcode: hit?.barcode ?? barcode,
      product_id: hit?.id ?? null,
      qty,
      rate,
      gst_rate: gst,
      // for a new product the customer price is suggested at 20% over the cost with GST; the shop can change it before importing
      customer_price: customer || (rate > 0 ? Math.ceil(rate * (1 + gst / 100) * 1.2) : 0),
      technician_price: r2(num(cell(r, "technician_price"))) || hit?.technician_price || 0,
      serial_nos: serials,
      track_serial: !!hit?.track_serial,
      hsn: cell(r, "hsn"),
      brand: cell(r, "brand"),
      category: cell(r, "category"),
      issues,
    };
  });
  return { ok: true, rows, fileName };
}

async function chooseFile(title: string, name: string, extensions: string[], maxMb: number) {
  const res = await dialog.showOpenDialog({ title, properties: ["openFile"], filters: [{ name, extensions }] });
  if (res.canceled || !res.filePaths[0]) return null;
  const file = res.filePaths[0];
  if (fs.statSync(file).size > maxMb * 1024 * 1024) throw new UserError(`That file is too big for an invoice (over ${maxMb} MB)`);
  return file;
}

export async function purchaseCsvRead(): Promise<PurchaseImportResult> {
  const file = await chooseFile("Choose the purchase file (CSV)", "CSV file", ["csv", "txt"], 5);
  if (!file) return { ok: false, rows: [] };
  return importFromTable(parseCsv(fs.readFileSync(file, "utf8")), path.basename(file));
}

/** An invoice table read out of a PDF by the screen (header row first), checked like a CSV. */
export const purchaseTableRead = (table: string[][], fileName: string) => importFromTable(table, fileName);

/** Asks for the supplier's invoice as a PDF and hands its bytes to the screen, which reads the table out of it. */
export async function purchasePdfPick(): Promise<{ ok: boolean; fileName?: string; data?: Uint8Array }> {
  const file = await chooseFile("Choose the supplier's invoice (PDF)", "PDF invoice", ["pdf"], 15);
  if (!file) return { ok: false };
  return { ok: true, fileName: path.basename(file), data: new Uint8Array(fs.readFileSync(file)) };
}

/** A ready-made CSV to fill in. */
export async function purchaseTemplate(): Promise<{ ok: boolean; path?: string }> {
  const res = await dialog.showSaveDialog({ defaultPath: "purchase-template.csv", filters: [{ name: "CSV (opens in Excel)", extensions: ["csv"] }] });
  if (res.canceled || !res.filePath) return { ok: false };
  const rows = [
    ["Product", "SKU", "Barcode", "Qty", "Rate (ex GST)", "GST %", "Customer price", "Technician price", "Serial numbers", "HSN", "Brand", "Category"],
    ["Samsung Galaxy A15 128GB", "SM-A15", "", "2", "13200", "18", "15999", "14800", "IMEI0001 IMEI0002", "8517", "Samsung", "Mobiles"],
    ["Type-C Cable 1m", "CBL-TC1", "", "20", "120", "18", "299", "190", "", "8544", "Boat", "Accessories"],
  ];
  fs.writeFileSync(res.filePath, "﻿" + rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n"), "utf8");
  return { ok: true, path: res.filePath };
}
